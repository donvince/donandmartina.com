import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalName,
  cleanName,
  favouriteAutocomplete,
  favouritesFor,
  formatNames,
  matchingFavourites,
  sortItems,
  starterFavourites,
  stripRequestWords,
  uniqueFavourites,
} from "../../static/shopping/model/groceries.js";

const favourites = [
  { name: "Lurpak butter", aliases: [] },
  { name: "Kerrygold butter", aliases: [] },
  { name: "yoghurt", aliases: ["yogurt"] },
];

test("cleanName collapses whitespace", () => {
  assert.equal(cleanName("  oat   milk "), "oat milk");
});

test("favouritesFor matches names, aliases and words of a name", () => {
  assert.deepEqual(favouritesFor(favourites, "YOGURT").map((f) => f.name), ["yoghurt"]);
  assert.deepEqual(favouritesFor(favourites, "butter").map((f) => f.name), ["Lurpak butter", "Kerrygold butter"]);
});

test("canonicalName only resolves unambiguous matches", () => {
  assert.equal(canonicalName(favourites, "lurpak"), "Lurpak butter");
  assert.equal(canonicalName(favourites, "butter"), null);
  assert.equal(canonicalName(favourites, "caviar"), null);
});

test("favouriteAutocomplete completes a single candidate", () => {
  assert.equal(favouriteAutocomplete(favourites, "yogh"), "yoghurt");
  assert.equal(favouriteAutocomplete(favourites, "bu"), "");
});

test("uniqueFavourites dedupes by name and drops self-aliases", () => {
  assert.deepEqual(
    uniqueFavourites([{ name: "Tea", aliases: ["tea", "chai", "Chai"] }, "tea", " "]),
    [{ name: "tea", aliases: [] }],
  );
  assert.deepEqual(uniqueFavourites([{ name: "Tea", aliases: ["tea", "chai", "Chai"] }]), [
    { name: "Tea", aliases: ["Chai"] },
  ]);
});

test("starterFavourites returns fresh copies", () => {
  const first = starterFavourites();
  first[0].aliases.push("mutated");
  assert.notDeepEqual(starterFavourites()[0], first[0]);
});

test("matchingFavourites filters and sorts", () => {
  assert.deepEqual(matchingFavourites(favourites, "butt").map((f) => f.name), ["Kerrygold butter", "Lurpak butter"]);
  assert.equal(matchingFavourites(favourites, "").length, 3);
});

test("sortItems puts unchecked first, then by creation", () => {
  const items = [
    { id: "a", checked: true, createdAt: 1 },
    { id: "b", checked: false, createdAt: 3 },
    { id: "c", checked: false, createdAt: 2 },
  ];
  assert.deepEqual(sortItems(items).map((item) => item.id), ["c", "b", "a"]);
});

test("stripRequestWords and formatNames", () => {
  assert.equal(stripRequestWords("please add oat milk thanks!"), "oat milk");
  assert.equal(formatNames(["a", "b", "c"]), "a, b, and c");
  assert.equal(formatNames(["a", "b"]), "a and b");
});
