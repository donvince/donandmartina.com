// The favourites sheet: the vocabulary the grocery model and voice input
// recognise.

import {
  cleanName,
  favouriteAutocomplete,
  favouritesFor,
  formatNames,
  matchingFavourites,
} from "../model/groceries.js";
import { MAX_NAME_LENGTH } from "../model/cart.js";

export function favouriteErrorMessage(result, name) {
  switch (result.reason) {
    case "exists": return `${result.matches?.[0]?.name ?? result.name} is already a favourite`;
    case "ambiguous": return `${name} already matches ${formatNames(result.matches.map((match) => match.name))}`;
    case "too-long": return `Keep names under ${MAX_NAME_LENGTH} characters and 20 aliases`;
    default: return "";
  }
}

export function createFavouritesView({ elements, store, showToast }) {
  let editing = false;
  let suppressAutocomplete = false;
  let appliedSuggestion = "";
  let renderedSignature = "";

  const favourites = () => store.getState().cart.favourites;

  function showError(message) {
    if (!elements.allowListError) return;
    elements.allowListError.textContent = message;
    elements.allowListError.hidden = false;
  }

  function clearError() {
    if (elements.allowListError) elements.allowListError.hidden = true;
  }

  function renderItems() {
    editing = false;
    renderedSignature = JSON.stringify(favourites());
    if (!elements.allowListItems) return;
    const rows = matchingFavourites(favourites(), elements.allowItemInput?.value).map((favourite) => {
      const row = document.createElement("li");
      row.className = "allowed-item";
      const copy = document.createElement("div");
      copy.className = "favourite-item__copy";
      const label = document.createElement("span");
      label.className = "allowed-item__name";
      label.textContent = favourite.name;
      copy.append(label);
      if (favourite.aliases.length) {
        const aliases = document.createElement("span");
        aliases.className = "favourite-item__aliases";
        aliases.textContent = favourite.aliases.join(" · ");
        copy.append(aliases);
      }
      const actions = document.createElement("div");
      actions.className = "favourite-item__actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit";
      edit.setAttribute("aria-label", `Edit ${favourite.name}`);
      edit.addEventListener("click", () => renderEditor(row, favourite));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "allowed-item__remove";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${favourite.name} from favourites`);
      remove.addEventListener("click", () => store.removeFavourite(favourite.name));
      actions.append(edit, remove);
      row.append(copy, actions);
      return row;
    });
    elements.allowListItems.replaceChildren(...rows);
  }

  function renderEditor(row, favourite) {
    editing = true;
    row.replaceChildren();
    row.classList.add("is-editing");
    const form = document.createElement("form");
    form.className = "favourite-editor";
    const nameInput = document.createElement("input");
    nameInput.name = "name";
    nameInput.value = favourite.name;
    nameInput.setAttribute("aria-label", "Favourite name");
    const aliasesInput = document.createElement("input");
    aliasesInput.name = "aliases";
    aliasesInput.value = favourite.aliases.join(", ");
    aliasesInput.placeholder = "Aliases, separated by commas";
    aliasesInput.setAttribute("aria-label", "Aliases separated by commas");
    const actions = document.createElement("div");
    actions.className = "favourite-editor__actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "primary-button";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", renderItems);
    actions.append(save, cancel);
    form.append(nameInput, aliasesInput, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!cleanName(nameInput.value)) return;
      const result = store.updateFavourite(favourite.name, {
        name: nameInput.value,
        aliases: aliasesInput.value.split(","),
      });
      if (!result.ok) {
        showError(favouriteErrorMessage(result, cleanName(nameInput.value)));
        return;
      }
      renderItems();
      showToast(`${result.name} saved`);
    });
    row.append(form);
    nameInput.focus();
    nameInput.select();
  }

  function updateInput({ autocomplete = true } = {}) {
    const input = elements.allowItemInput;
    const value = cleanName(input?.value);
    const suggestion = favouriteAutocomplete(favourites(), value);
    if (autocomplete && suggestion && input) {
      input.value = `${value}${suggestion.slice(value.length)}`;
      input.setSelectionRange(value.length, suggestion.length);
      appliedSuggestion = suggestion;
    }
    const currentValue = cleanName(input?.value);
    const matches = favouritesFor(favourites(), value);
    if (elements.addFavouriteButton) {
      elements.addFavouriteButton.disabled = !currentValue || matches.length > 0 || (autocomplete && Boolean(suggestion));
    }
    renderItems();
    clearError();
    if (!autocomplete) appliedSuggestion = "";
  }

  function open() {
    renderItems();
    clearError();
    updateInput();
    if (elements.allowListDialog?.showModal) elements.allowListDialog.showModal();
    else if (elements.allowListDialog) elements.allowListDialog.hidden = false;
    elements.allowItemInput?.focus();
  }

  function close() {
    if (elements.allowListDialog?.close) elements.allowListDialog.close();
    else if (elements.allowListDialog) elements.allowListDialog.hidden = true;
  }

  elements.openAllowListButton?.addEventListener("click", open);
  elements.closeAllowListButton?.addEventListener("click", close);
  elements.allowListForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = cleanName(elements.allowItemInput?.value);
    const result = store.addFavourite(name);
    if (!result.ok) {
      showError(favouriteErrorMessage(result, name));
      return;
    }
    showToast(`${result.name} added to favourites`);
    elements.allowItemInput.value = "";
    updateInput();
  });
  elements.allowItemInput?.addEventListener("keydown", (event) => {
    const input = event.currentTarget;
    suppressAutocomplete = (event.key === "Backspace" || event.key === "Delete")
      && (input.selectionStart !== input.selectionEnd
        || (event.key === "Backspace" && input.value === appliedSuggestion));
  });
  elements.allowItemInput?.addEventListener("beforeinput", (event) => {
    if (event.inputType === "deleteContentBackward" && event.currentTarget.value === appliedSuggestion) {
      suppressAutocomplete = true;
    }
  });
  elements.allowItemInput?.addEventListener("input", () => {
    updateInput({ autocomplete: !suppressAutocomplete });
    suppressAutocomplete = false;
  });
  elements.resetAllowListButton?.addEventListener("click", () => {
    store.resetFavourites();
    showToast("Favourites reset");
  });

  // Keep the sheet current when favourites change (here or on another
  // device), but never throw away an edit in progress.
  store.subscribe(() => {
    if (!editing && JSON.stringify(favourites()) !== renderedSignature) renderItems();
  });
  renderItems();
}
