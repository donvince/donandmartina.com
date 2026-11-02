// The shopping list as the page sees it: the server's copy of one cart, with
// this device's unsent changes applied on top.
//
// Every change is an operation (see cart.js). Commands apply operations
// optimistically, persist them in a queue in localStorage, and send them to
// the server in order. While offline the queue simply grows; it is sent when
// the connection returns, even after a reload. When the server copy is
// reloaded (on page load, or when another device changes the cart), the
// queue is re-applied on top, which is safe because operations are
// idempotent.
//
// No DOM here: views read getState() and call commands.

import { HOME_CART, MAX_ALIASES, MAX_NAME_LENGTH, applyOps, emptyCart, isValidOp, normaliseCart } from "./cart.js";
import { HttpError, OfflineError, SignedOutError } from "./errors.js";
import {
  canonicalName,
  cleanName,
  favouritesFor,
  keyFor,
  makeId as defaultMakeId,
  normaliseFavourite,
  starterFavourites,
} from "./groceries.js";
import { LEGACY_STORAGE_KEY, initialOps, parseLegacy } from "./legacy.js";

const MAX_BATCH = 100;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

// status:
//   loading     no copy of the cart yet
//   synced      the server has every change
//   saving      sending changes or reloading
//   offline     can't reach the server; changes are queued
//   signed-out  the session ended; changes are queued until sign-in
//   error       the server failed; retrying
export function createCartStore({
  api,
  storage,
  cartId = HOME_CART,
  makeId = defaultMakeId,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer),
  logger = console,
}) {
  const keys = {
    snapshot: `shopping:${cartId}:snapshot`,
    pending: `shopping:${cartId}:pending`,
  };

  function read(key) {
    try {
      return JSON.parse(storage.getItem(key));
    } catch (_error) {
      return null;
    }
  }

  function write(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      logger.warn(`shopping: could not save ${key}: ${error.message}`);
    }
  }

  const savedSnapshot = read(keys.snapshot);
  let base = savedSnapshot ? normaliseCart(savedSnapshot) : emptyCart();
  let pending = (read(keys.pending) || []).filter(isValidOp);
  let cart = applyOps(base, pending);
  let loaded = Boolean(savedSnapshot);
  let migrated = false;
  let status = "loading";
  let realtime = null;
  let notice = null;
  let noticeId = 0;

  const listeners = new Set();
  let queue = Promise.resolve();
  let syncQueued = false;
  let pushQueued = false;
  let retryTimer = null;
  let retryAttempt = 0;

  function emit() {
    cart = applyOps(base, pending);
    for (const listener of listeners) listener();
  }

  function setStatus(next) {
    status = next;
    emit();
  }

  function setNotice(message) {
    noticeId += 1;
    notice = { id: noticeId, message };
  }

  // ── Network ───────────────────────────────────────────────────────────────
  // One request at a time, so responses can't land out of order.
  function exclusive(task) {
    queue = queue.then(task).catch(handleFailure);
    return queue;
  }

  function scheduleRetry() {
    if (retryTimer) return;
    const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
    retryAttempt += 1;
    retryTimer = setTimer(() => {
      retryTimer = null;
      sync();
    }, delay);
  }

  function handleFailure(error) {
    if (error instanceof SignedOutError) {
      setStatus("signed-out");
    } else if (error instanceof OfflineError) {
      setStatus("offline");
      scheduleRetry();
    } else {
      logger.error("shopping: sync failed", error);
      setStatus("error");
      scheduleRetry();
    }
  }

  function adoptServerCart(serverCart) {
    base = normaliseCart(serverCart);
    write(keys.snapshot, base);
  }

  function enqueue(ops) {
    const valid = ops.filter(isValidOp);
    if (valid.length < ops.length) logger.warn("shopping: dropped invalid operations", ops.filter((op) => !isValidOp(op)));
    if (!valid.length) return;
    pending = [...pending, ...valid];
    write(keys.pending, pending);
  }

  function migrateOnce() {
    if (migrated) return;
    migrated = true;
    const raw = storage.getItem(LEGACY_STORAGE_KEY);
    enqueue(initialOps({ cart: base, pending, legacy: parseLegacy(raw), makeId }));
    if (raw) {
      // The queue now holds the old list, so retire the old key (keeping a
      // copy, just in case).
      try {
        storage.setItem(`${LEGACY_STORAGE_KEY}.migrated`, raw);
        storage.removeItem(LEGACY_STORAGE_KEY);
      } catch (_error) { /* storage full or blocked; harmless to retry later */ }
    }
  }

  async function pull() {
    setStatus("saving");
    const data = await api.loadAll();
    realtime = data.realtime || null;
    adoptServerCart(data.carts?.[cartId] || emptyCart());
    loaded = true;
    migrateOnce();
    emit();
  }

  async function push() {
    while (pending.length) {
      setStatus("saving");
      const batch = pending.slice(0, MAX_BATCH);
      try {
        const response = await api.applyOps(cartId, batch);
        adoptServerCart(response.cart);
      } catch (error) {
        if (!(error instanceof HttpError && error.permanent)) throw error;
        // The server will never accept this batch; drop it rather than
        // blocking every later change behind it.
        logger.error("shopping: server rejected changes", error, batch);
        setNotice("Some changes couldn't be saved");
      }
      // Commands only ever append, so the batch is still at the front.
      pending = pending.slice(batch.length);
      write(keys.pending, pending);
    }
  }

  function succeeded() {
    retryAttempt = 0;
    if (retryTimer) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    setStatus("synced");
  }

  // Reloads the cart from the server, then sends queued changes. Calls made
  // while one is waiting to start share it.
  function sync() {
    if (syncQueued) return queue;
    syncQueued = true;
    return exclusive(async () => {
      syncQueued = false;
      await pull();
      await push();
      succeeded();
    });
  }

  // Sends queued changes.
  function flush() {
    if (pushQueued || syncQueued) return queue;
    pushQueued = true;
    return exclusive(async () => {
      pushQueued = false;
      // Until the first load, a sync is already on its way.
      if (!loaded) return;
      await push();
      succeeded();
    });
  }

  function change(ops) {
    enqueue(ops);
    emit();
    // Signed out, the queue waits for the visitor to sign in and reload.
    if (status !== "signed-out") flush();
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  // Adds the favourites the names refer to. Names that aren't (exactly one)
  // favourite are skipped; ones already on the list are reported.
  function addGroceries(names) {
    const added = [];
    const duplicates = [];
    const existing = new Map(cart.items.map((item) => [keyFor(item.name), item]));
    const ops = [];
    const createdAt = now();
    for (const value of names) {
      const name = canonicalName(cart.favourites, value);
      if (!name) continue;
      const key = keyFor(name);
      const listed = existing.get(key);
      // Asking again for something already ticked off puts it back.
      if (listed?.checked) {
        existing.set(key, { ...listed, checked: false });
        ops.push({ type: "setChecked", id: listed.id, checked: false });
        added.push(name);
        continue;
      }
      if (listed) {
        if (!duplicates.some((item) => keyFor(item) === key)) duplicates.push(name);
        continue;
      }
      existing.set(key, { name, checked: false });
      ops.push({ type: "addItem", id: makeId(), name, createdAt: createdAt + added.length });
      added.push(name);
    }
    if (ops.length) change(ops);
    return { added, duplicates };
  }

  function toggleItem(id) {
    const item = cart.items.find((candidate) => candidate.id === id);
    if (item) change([{ type: "setChecked", id, checked: !item.checked }]);
  }

  function removeItem(id) {
    const item = cart.items.find((candidate) => candidate.id === id);
    if (item) change([{ type: "removeItem", id }]);
    return item || null;
  }

  function tooLong(favourite) {
    return favourite.name.length > MAX_NAME_LENGTH
      || favourite.aliases.length > MAX_ALIASES
      || favourite.aliases.some((alias) => alias.length > MAX_NAME_LENGTH);
  }

  // Resolves { ok: true, name } or { ok: false, reason, matches }, where
  // reason is "empty", "too-long", "exists" (one match) or "ambiguous"
  // (several).
  function addFavourite(value) {
    const name = cleanName(value);
    if (!name) return { ok: false, reason: "empty", matches: [] };
    if (tooLong({ name, aliases: [] })) return { ok: false, reason: "too-long", matches: [] };
    const matches = favouritesFor(cart.favourites, name);
    if (matches.length) return { ok: false, reason: matches.length > 1 ? "ambiguous" : "exists", matches };
    change([{ type: "putFavourite", favourite: { name, aliases: [] }, previousName: null }]);
    return { ok: true, name };
  }

  function updateFavourite(previousName, value) {
    const favourite = normaliseFavourite(value);
    if (!favourite) return { ok: false, reason: "empty" };
    if (tooLong(favourite)) return { ok: false, reason: "too-long" };
    const duplicate = cart.favourites.some((item) =>
      keyFor(item.name) === keyFor(favourite.name) && keyFor(item.name) !== keyFor(previousName));
    if (duplicate) return { ok: false, reason: "exists", name: favourite.name };
    change([{ type: "putFavourite", favourite, previousName }]);
    return { ok: true, name: favourite.name };
  }

  function removeFavourite(name) {
    change([{ type: "removeFavourite", name }]);
  }

  function resetFavourites() {
    change([{ type: "replaceFavourites", favourites: starterFavourites() }]);
  }

  return {
    getState: () => ({ cart, status, loaded, pendingCount: pending.length, realtime, notice }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sync,
    addGroceries,
    toggleItem,
    removeItem,
    addFavourite,
    updateFavourite,
    removeFavourite,
    resetFavourites,
  };
}
