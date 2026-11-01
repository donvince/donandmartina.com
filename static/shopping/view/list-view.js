// The list itself, in both tabs: "Add" shows it compactly, "Shop" lets you
// tick items off.

import { sortItems } from "../model/groceries.js";
import { TRASH_ICON, button } from "./dom.js";

export function createListView({ elements, store, showToast }) {
  function remove(id) {
    const item = store.removeItem(id);
    if (item) showToast(`${item.name} removed`);
  }

  function shopRow(item) {
    const row = document.createElement("li");
    row.className = `shopping-item${item.checked ? " is-complete" : ""}`;
    row.dataset.itemId = item.id;

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

    row.append(toggle, button({
      className: "shopping-item__remove",
      label: `Remove ${item.name}`,
      html: TRASH_ICON,
      onClick: () => remove(item.id),
    }));
    return row;
  }

  function addRow(item) {
    const row = document.createElement("li");
    row.className = `add-list-item${item.checked ? " is-complete" : ""}`;
    const name = document.createElement("span");
    name.className = "add-list-item__name";
    name.textContent = item.name;
    row.append(name, button({
      className: "add-list-item__remove",
      label: `Remove ${item.name}`,
      html: TRASH_ICON,
      onClick: () => remove(item.id),
    }));
    return row;
  }

  function render() {
    const { cart } = store.getState();
    const sorted = sortItems(cart.items);
    elements.shoppingList?.replaceChildren(...sorted.map(shopRow));
    elements.addList?.replaceChildren(...sorted.map(addRow));

    const remaining = cart.items.filter((item) => !item.checked).length;
    const completed = cart.items.length - remaining;
    if (elements.activeCount) {
      elements.activeCount.textContent = String(remaining);
      elements.activeCount.setAttribute("aria-label", `${remaining} item${remaining === 1 ? "" : "s"} remaining`);
    }
    if (elements.remainingCount) elements.remainingCount.textContent = String(remaining);
    if (elements.addListEmpty) elements.addListEmpty.hidden = cart.items.length > 0;
    if (elements.emptyList) elements.emptyList.hidden = cart.items.length > 0;
    if (elements.clearCompletedButton) elements.clearCompletedButton.disabled = completed === 0;
  }

  elements.clearCompletedButton?.addEventListener("click", () => {
    const count = store.clearCompleted();
    if (count) showToast(`Cleared ${count} completed item${count === 1 ? "" : "s"}`);
  });

  store.subscribe(render);
  render();
}
