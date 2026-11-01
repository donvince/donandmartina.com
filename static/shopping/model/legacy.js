// One-off import of the list each device kept in localStorage before the
// shopping list moved to the shared backend, plus first-time favourites.

import { MAX_ALIASES, MAX_NAME_LENGTH } from "./cart.js";
import { cleanName, keyFor, starterFavourites, uniqueFavourites } from "./groceries.js";

const fits = (name) => name.length <= MAX_NAME_LENGTH;

// Old lists had no length limits; keep only what the server will accept.
function importableFavourites(favourites) {
  return favourites
    .filter((favourite) => fits(favourite.name))
    .map((favourite) => ({ ...favourite, aliases: favourite.aliases.filter(fits).slice(0, MAX_ALIASES) }));
}

export const LEGACY_STORAGE_KEY = "groceries-state-v1";

// Reads the old localStorage format, or null if there is nothing to import.
export function parseLegacy(raw) {
  if (!raw) return null;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (_error) {
    return null;
  }
  if (!saved || typeof saved !== "object") return null;
  const customAllowed = Array.isArray(saved.customAllowed) ? saved.customAllowed : [];
  return {
    items: Array.isArray(saved.items)
      ? saved.items.filter((item) => item && cleanName(item.name) && fits(cleanName(item.name))).map((item, index) => ({
          id: String(item.id || ""),
          name: cleanName(item.name),
          checked: Boolean(item.checked),
          createdAt: Number(item.createdAt) || index,
        }))
      : [],
    favourites: importableFavourites(Array.isArray(saved.favourites)
      ? uniqueFavourites(saved.favourites)
      : uniqueFavourites([...starterFavourites(), ...customAllowed])),
  };
}

const ITEM_ID = /^[A-Za-z0-9-]{1,64}$/;

// Operations that bring a freshly loaded cart up to date:
// * a cart nobody has set favourites for gets this device's old favourites,
//   or the starter set;
// * a device's old favourites missing from an already-initialised cart are
//   added rather than lost;
// * a device's old list items are added (the cart ignores names it already
//   has).
export function initialOps({ cart, pending, legacy, makeId }) {
  const ops = [];
  const seeding = !cart.favouritesInitialised && !pending.some((op) => op.type === "replaceFavourites");
  if (seeding) {
    ops.push({ type: "replaceFavourites", favourites: legacy?.favourites ?? starterFavourites() });
  } else if (legacy) {
    const known = new Set(cart.favourites.map((favourite) => keyFor(favourite.name)));
    for (const favourite of legacy.favourites) {
      if (!known.has(keyFor(favourite.name))) {
        ops.push({ type: "putFavourite", favourite, previousName: null });
      }
    }
  }
  for (const item of legacy?.items ?? []) {
    const id = ITEM_ID.test(item.id) ? item.id : makeId();
    ops.push({ type: "addItem", id, name: item.name, createdAt: item.createdAt });
    if (item.checked) ops.push({ type: "setChecked", id, checked: true });
  }
  return ops;
}
