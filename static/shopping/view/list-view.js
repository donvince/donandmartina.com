// The list: tap an item to tick it off; long-press (or right-click) it for a
// menu to tick it off or delete it.

import { sortItems } from "../model/groceries.js";
import { button } from "./dom.js";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export function createListView({ elements, store, showToast }) {
  const menu = elements.itemMenu;
  let menuItemId = null;
  let menuAnchor = null;

  // ── Menu ──────────────────────────────────────────────────────────────────
  function openMenu(item, anchor) {
    if (!menu) return;
    menuItemId = item.id;
    menuAnchor = anchor;
    if (elements.itemMenuDoneLabel) elements.itemMenuDoneLabel.textContent = item.checked ? "Put back" : "Got it";
    menu.setAttribute("aria-label", item.name);
    menu.hidden = false;

    // Below the row, or above it when there isn't room.
    const row = anchor.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu;
    const below = row.bottom + 4 + height <= window.innerHeight;
    menu.style.top = `${below ? row.bottom + 4 : Math.max(4, row.top - 4 - height)}px`;
    menu.style.left = `${Math.min(row.right - width, window.innerWidth - width - 4)}px`;
    anchor.closest(".shopping-item")?.classList.add("is-menu-open");
    elements.itemMenuDone?.focus({ preventScroll: true });
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    menuAnchor?.closest(".shopping-item")?.classList.remove("is-menu-open");
    if (restoreFocus) menuAnchor?.focus({ preventScroll: true });
    menuItemId = null;
    menuAnchor = null;
  }

  elements.itemMenuDone?.addEventListener("click", () => {
    const id = menuItemId;
    closeMenu();
    if (id) store.toggleItem(id);
  });
  elements.itemMenuDelete?.addEventListener("click", () => {
    const id = menuItemId;
    closeMenu();
    const item = id && store.removeItem(id);
    if (item) showToast(`${item.name} deleted`);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu?.hidden && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu({ restoreFocus: true });
  });
  menu?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const options = [...menu.querySelectorAll("button")];
    const next = options.indexOf(document.activeElement) + (event.key === "ArrowDown" ? 1 : -1);
    options[(next + options.length) % options.length].focus();
  });
  elements.shoppingList?.closest(".list-panel")?.addEventListener("scroll", () => closeMenu());
  window.addEventListener("resize", () => closeMenu());

  // ── Rows ──────────────────────────────────────────────────────────────────
  function attachLongPress(toggle, item) {
    let timer = null;
    let start = null;
    let suppressClick = false;

    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      toggle.classList.remove("is-pressed");
    };

    toggle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      suppressClick = false;
      toggle.classList.add("is-pressed");
      timer = setTimeout(() => {
        timer = null;
        suppressClick = true;
        toggle.classList.remove("is-pressed");
        navigator.vibrate?.(10);
        openMenu(item, toggle);
      }, LONG_PRESS_MS);
    });
    toggle.addEventListener("pointermove", (event) => {
      if (!timer || !start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) toggle.addEventListener(type, cancel);

    // Right-click, the keyboard menu key, and some touch browsers' own long press.
    toggle.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      cancel();
      suppressClick = true;
      if (menuItemId !== item.id) openMenu(item, toggle);
    });

    toggle.addEventListener("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        return;
      }
      store.toggleItem(item.id);
    });
  }

  function row(item) {
    const li = document.createElement("li");
    li.className = `shopping-item${item.checked ? " is-complete" : ""}`;
    li.dataset.itemId = item.id;

    const toggle = button({
      className: "shopping-item__toggle",
      label: `${item.checked ? "Put back" : "Pick up"} ${item.name}`,
    });
    toggle.setAttribute("aria-pressed", String(item.checked));
    toggle.setAttribute("aria-haspopup", "menu");
    const check = document.createElement("span");
    check.className = "shopping-item__check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "shopping-item__name";
    name.textContent = item.name;
    toggle.append(check, name);
    attachLongPress(toggle, item);

    li.append(toggle);
    return li;
  }

  function render() {
    const { cart } = store.getState();
    elements.shoppingList?.replaceChildren(...sortItems(cart.items).map(row));
    // Keep an open menu attached to its item's new row, unless it's gone.
    if (menuItemId) {
      const toggle = elements.shoppingList?.querySelector(`[data-item-id="${CSS.escape(menuItemId)}"] .shopping-item__toggle`);
      if (toggle) {
        menuAnchor = toggle;
        toggle.closest(".shopping-item").classList.add("is-menu-open");
      } else {
        closeMenu();
      }
    }
    if (elements.emptyList) elements.emptyList.hidden = cart.items.length > 0;
  }

  store.subscribe(render);
  render();
}
