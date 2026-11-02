// DOM lookups and small shared view helpers.

export function getElements(ids) {
  return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
}

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
