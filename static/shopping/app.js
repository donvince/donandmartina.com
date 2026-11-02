// Composition root: builds the model, wires the views to it, and decides
// when to sync. Views only read store state and call store commands; the
// store owns the data.

import { createShoppingApi } from "./model/api.js";
import { HOME_CART } from "./model/cart.js";
import { createGroceryModel } from "./model/grocery-model.js";
import { makeId } from "./model/groceries.js";
import { createCartEvents } from "./model/realtime.js";
import { createSession } from "./model/session.js";
import { createCartStore } from "./model/store.js";
import { createComposerView } from "./view/composer-view.js";
import { createToast, getElements } from "./view/dom.js";
import { createFavouritesView } from "./view/favourites-view.js";
import { createListView } from "./view/list-view.js";
import { createModelStatus, createSyncStatusView } from "./view/status-view.js";

const elements = getElements([
  "composerForm", "messageInput", "micButton", "sendButton", "recognitionPreview", "inputFeedback",
  "shoppingList", "clearCompletedButton", "emptyList", "itemMenu", "itemMenuDone",
  "itemMenuDoneLabel", "itemMenuDelete", "allowListDialog",
  "openAllowListButton", "closeAllowListButton", "allowListForm",
  "allowItemInput", "addFavouriteButton", "allowListError", "allowListItems", "resetAllowListButton", "toast", "modelStatus",
  "modelStatusText", "listeningStatus", "interimTranscript", "syncStatus",
]);

// ── Model ───────────────────────────────────────────────────────────────────
const clientId = makeId();
const session = createSession();
const api = createShoppingApi({ session, clientId });
const store = createCartStore({ api, storage: localStorage, cartId: HOME_CART });

// ── Views ───────────────────────────────────────────────────────────────────
const showToast = createToast(elements.toast);
const setModelStatus = createModelStatus(elements);

let composer = null;
const MODEL_MESSAGES = {
  ready: "Ready for grocery requests",
  unavailable: "The grocery model is unavailable",
};
const groceryModel = createGroceryModel({
  onStatus(state, message) {
    setModelStatus(message || MODEL_MESSAGES[state] || "Loading language model…", state);
    composer?.modelStatusChanged();
  },
});

createListView({ elements, store, showToast });
createFavouritesView({ elements, store, showToast });
createSyncStatusView({ elements, store, showToast });
composer = createComposerView({ elements, store, groceryModel, setModelStatus, showToast });

// ── Sync ────────────────────────────────────────────────────────────────────
// Load everything now; reload when another device changes the cart (an
// AppSync Events notification), and catch up whenever the connection returns
// or the page comes back into view (a phone may have slept through changes).
let cartEvents = null;
function listenForChanges() {
  const { realtime } = store.getState();
  if (cartEvents || !realtime) return;
  cartEvents = createCartEvents({
    realtime,
    cartId: HOME_CART,
    clientId,
    getToken: () => session.getToken(),
    onChange: () => store.sync(),
  });
  cartEvents.start();
}
store.subscribe(listenForChanges);

store.sync();
window.addEventListener("online", () => {
  store.sync();
  cartEvents?.nudge();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  store.sync();
  cartEvents?.nudge();
});

groceryModel.start();
