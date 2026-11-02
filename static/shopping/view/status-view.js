// Status lines: the grocery model's readiness (a dot in the composer, with
// the message as the input's placeholder until it's ready) and whether the
// list is in step with the server.

import { signInUrl } from "../model/session.js";

export function createModelStatus(elements) {
  return function setModelStatus(message, kind = "loading") {
    if (elements.modelStatusText) elements.modelStatusText.textContent = message;
    if (elements.messageInput) elements.messageInput.placeholder = kind === "ready" ? "Add milk, bread…" : message;
    if (elements.modelStatus) {
      elements.modelStatus.dataset.state = kind;
      elements.modelStatus.classList.toggle("is-ready", kind === "ready");
      elements.modelStatus.classList.toggle("is-error", kind === "unavailable" || kind === "error");
    }
  };
}

function waiting(count) {
  return count ? ` ${count} change${count === 1 ? "" : "s"} waiting.` : "";
}

export function createSyncStatusView({ elements, store, showToast }) {
  const element = elements.syncStatus;
  let lastNoticeId = null;

  function render() {
    const { status, loaded, pendingCount, notice } = store.getState();
    if (notice && notice.id !== lastNoticeId) {
      lastNoticeId = notice.id;
      showToast(notice.message);
    }
    if (!element) return;

    element.dataset.state = status;
    element.replaceChildren();
    switch (status) {
      case "loading":
        element.textContent = "Loading your list…";
        break;
      case "saving":
        // Only worth mentioning before there's anything to show.
        if (!loaded) element.textContent = "Loading your list…";
        break;
      case "offline":
        element.textContent = `You're offline. Changes will sync when you reconnect.${waiting(pendingCount)}`;
        break;
      case "error":
        element.textContent = `Can't reach the list right now. Retrying…${waiting(pendingCount)}`;
        break;
      case "signed-out": {
        element.append(`You've been signed out.${waiting(pendingCount)} `);
        const link = document.createElement("a");
        link.href = signInUrl(location.pathname);
        link.textContent = "Sign in to sync";
        element.append(link);
        break;
      }
      default:
        break;
    }
    element.hidden = !element.textContent;
  }

  store.subscribe(render);
  render();
}
