import assert from "node:assert/strict";
import { test } from "node:test";

import { applyOps, emptyCart, normaliseCart } from "../../static/shopping/model/cart.js";

test("adds, checks and removes items", () => {
  const cart = applyOps(emptyCart(), [
    { type: "addItem", id: "a", name: "milk", createdAt: 1 },
    { type: "addItem", id: "b", name: "eggs", createdAt: 2 },
    { type: "setChecked", id: "a", checked: true },
    { type: "removeItem", id: "b" },
  ]);
  assert.deepEqual(cart.items, [{ id: "a", name: "milk", checked: true, createdAt: 1 }]);
});

test("ignores duplicate names and replayed ops", () => {
  const ops = [
    { type: "addItem", id: "a", name: "Milk", createdAt: 1 },
    { type: "addItem", id: "b", name: "milk", createdAt: 2 },
    { type: "setChecked", id: "a", checked: true },
  ];
  const once = applyOps(emptyCart(), ops);
  assert.deepEqual(applyOps(once, ops), once);
  assert.equal(once.items.length, 1);
});

test("does not mutate its input", () => {
  const cart = applyOps(emptyCart(), [{ type: "addItem", id: "a", name: "milk", createdAt: 1 }]);
  applyOps(cart, [{ type: "setChecked", id: "a", checked: true }]);
  assert.equal(cart.items[0].checked, false);
});

test("renames a favourite in place", () => {
  const cart = {
    ...emptyCart(),
    favourites: [{ name: "tea", aliases: [] }, { name: "yogurt", aliases: [] }, { name: "milk", aliases: [] }],
  };
  const next = applyOps(cart, [
    { type: "putFavourite", favourite: { name: "yoghurt", aliases: ["yogurt"] }, previousName: "yogurt" },
  ]);
  assert.deepEqual(next.favourites.map((f) => f.name), ["tea", "yoghurt", "milk"]);
});

test("removes and replaces favourites", () => {
  const cart = applyOps(emptyCart(), [
    { type: "putFavourite", favourite: { name: "tea", aliases: [] }, previousName: null },
    { type: "removeFavourite", name: "TEA" },
  ]);
  assert.deepEqual(cart.favourites, []);
  const replaced = applyOps(cart, [{ type: "replaceFavourites", favourites: [{ name: "coffee", aliases: [] }] }]);
  assert.deepEqual(replaced.favourites, [{ name: "coffee", aliases: [] }]);
  assert.equal(replaced.favouritesInitialised, true);
});

test("normaliseCart tolerates junk", () => {
  assert.deepEqual(normaliseCart(null), emptyCart());
  assert.deepEqual(normaliseCart({ items: [{ id: 1, name: "x", createdAt: "5" }] }).items, [
    { id: "1", name: "x", checked: false, createdAt: 5 },
  ]);
});
