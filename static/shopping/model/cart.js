// Cart operations: the only way a cart changes. The page applies them
// optimistically and queues them for the server, which applies the same
// rules (infra/lambda/shopping-api/cart.js); keep the two in step.
//
// Every operation is idempotent, so replaying one the server already has is
// harmless — which is what lets the page re-apply its queue on top of a fresh
// server copy:
//   addItem          ignored if the id exists or the name is already listed
//   setChecked       ignored if the item has since been removed
//   removeItem       no-op when already gone
//   putFavourite     upsert; previousName renames
//   removeFavourite  no-op when already gone
//   replaceFavourites  swaps the whole set and marks favourites initialised

import { keyFor } from "./groceries.js";

export const HOME_CART = "home";

export function emptyCart() {
  return { items: [], favourites: [], favouritesInitialised: false };
}

export function normaliseCart(value) {
  return {
    items: Array.isArray(value?.items) ? value.items.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      checked: Boolean(item.checked),
      createdAt: Number(item.createdAt) || 0,
    })) : [],
    favourites: Array.isArray(value?.favourites) ? value.favourites.map((favourite) => ({
      name: String(favourite.name),
      aliases: Array.isArray(favourite.aliases) ? favourite.aliases.map(String) : [],
    })) : [],
    favouritesInitialised: Boolean(value?.favouritesInitialised),
  };
}

function applyOp(cart, op) {
  switch (op.type) {
    case "addItem": {
      const exists = cart.items.some((item) => item.id === op.id || keyFor(item.name) === keyFor(op.name));
      if (exists) return cart;
      return {
        ...cart,
        items: [...cart.items, { id: op.id, name: op.name, checked: false, createdAt: op.createdAt }],
      };
    }
    case "setChecked":
      return {
        ...cart,
        items: cart.items.map((item) => (item.id === op.id ? { ...item, checked: op.checked } : item)),
      };
    case "removeItem":
      return { ...cart, items: cart.items.filter((item) => item.id !== op.id) };
    case "putFavourite": {
      const drop = new Set([keyFor(op.favourite.name)]);
      if (op.previousName) drop.add(keyFor(op.previousName));
      const index = cart.favourites.findIndex((favourite) => drop.has(keyFor(favourite.name)));
      const favourites = cart.favourites.filter((favourite) => !drop.has(keyFor(favourite.name)));
      // Keep an edited favourite where it was rather than moving it to the end.
      favourites.splice(index === -1 ? favourites.length : index, 0, op.favourite);
      return { ...cart, favourites };
    }
    case "removeFavourite":
      return {
        ...cart,
        favourites: cart.favourites.filter((favourite) => keyFor(favourite.name) !== keyFor(op.name)),
      };
    case "replaceFavourites":
      return { ...cart, favourites: op.favourites, favouritesInitialised: true };
    default:
      return cart;
  }
}

export function applyOps(cart, ops) {
  return ops.reduce(applyOp, cart);
}
