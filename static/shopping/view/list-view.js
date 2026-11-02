// The list: tap an item to tick it off, or remove it.

import { sortItems } from "../model/groceries.js";
import { TRASH_ICON, button } from "./dom.js";

export function createListView({ elements, store, showToast }) {
  function remove(id) {
    const item = store.removeItem(id);
    if (item) showToast(`${item.name} removed`);
  }

  function row(item) {
    const li = document.createElement("li");
    li.className = `shopping-item${item.checked ? " is-complete" : ""}`;
    li.dataset.itemId = item.id;

    const toggle = button({
      className: "shopping-item__toggle",
      label: `${item.checked ? "Put back" : "Pick up"} ${item.name}`,
      onClick: () => store.toggleItem(item.id),
    });
    toggle.setAttribute("aria-pressed", String(item.checked));
    const check = document.createElement("span");
    check.className = "shopping-item__check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "shopping-item__name";
    name.textContent = item.name;
    toggle.append(check, name);

    li.append(toggle, button({
      className: "shopping-item__remove",
      label: `Remove ${item.name}`,
      html: TRASH_ICON,
      onClick: () => remove(item.id),
    }));
    return li;
  }

  function render() {
    const { cart } = store.getState();
    elements.shoppingList?.replaceChildren(...sortItems(cart.items).map(row));
    const completed = cart.items.filter((item) => item.checked).length;
    if (elements.emptyList) elements.emptyList.hidden = cart.items.length > 0;
    if (elements.clearCompletedButton) elements.clearCompletedButton.hidden = completed === 0;
  }

  elements.clearCompletedButton?.addEventListener("click", () => {
    const count = store.clearCompleted();
    if (count) showToast(`Cleared ${count} completed item${count === 1 ? "" : "s"}`);
  });

  store.subscribe(render);
  render();
}
