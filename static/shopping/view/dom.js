// DOM lookups and small shared view helpers.

export function getElements(ids) {
  return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
}

export const TRASH_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5" /></svg>';

export function createToast(element) {
  let timer = null;
  return function showToast(message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { element.hidden = true; }, 2400);
  };
}

export function button({ className = "", label, text = "", html = "", onClick }) {
  const element = document.createElement("button");
  element.type = "button";
  if (className) element.className = className;
  if (label) element.setAttribute("aria-label", label);
  if (html) element.innerHTML = html;
  else element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
}
