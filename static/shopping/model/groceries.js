// Grocery vocabulary: names, favourites and how free text maps onto them.
// Pure functions only — no DOM, storage or network.

const STARTER_FAVOURITES = [
  ["wholemeal bread", ["whole meal bread"]], ["white bread"], ["sourdough"], ["rolls"],
  ["croissants"], ["pain au chocolat"], ["milk"], ["Lurpak butter"], ["Kerrygold butter"],
  ["eggs"], ["cheddar"], ["mozzarella"], ["soft cheese"], ["yoghurt", ["yogurt"]],
  ["houmous", ["hummus"]], ["avocado"], ["cucumber"], ["carrots"], ["bananas"],
  ["apples"], ["baked beans"], ["pasta"], ["pesto"], ["cereal"], ["Weetabix"],
  ["bran flakes"], ["tea"], ["coffee"], ["sweet chilli sauce"], ["orange juice", ["OJ"]],
  ["squash"], ["water"], ["smoothies"], ["Pepsi Max"], ["crisps"], ["Hula Hoops"],
  ["lentil crisps"], ["Ritz crackers"], ["Kinder chocolate"], ["fruit lollies"], ["pizza"],
  ["frozen potatoes"], ["toilet roll"], ["kitchen roll"], ["fabric conditioner"],
].map(([name, aliases = []]) => ({ name, aliases }));

export function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function keyFor(value) {
  return cleanName(value).toLocaleLowerCase();
}

export function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normaliseFavourite(value) {
  const name = cleanName(typeof value === "string" ? value : value?.name);
  if (!name) return null;
  const aliases = Array.isArray(value?.aliases)
    ? [...new Map(value.aliases.map(cleanName).filter(Boolean).map((alias) => [keyFor(alias), alias])).values()]
        .filter((alias) => keyFor(alias) !== keyFor(name))
    : [];
  return { name, aliases };
}

export function uniqueFavourites(values) {
  const favourites = new Map();
  for (const value of values) {
    const favourite = normaliseFavourite(value);
    if (favourite) favourites.set(keyFor(favourite.name), favourite);
  }
  return [...favourites.values()];
}

export function starterFavourites() {
  return STARTER_FAVOURITES.map((favourite) => ({
    name: favourite.name,
    aliases: [...favourite.aliases],
  }));
}

function implicitTerms(name) {
  return keyFor(name).split(/[^\p{L}\p{N}']+/u).filter((term) => term.length > 2);
}

export function favouriteTerms(favourite) {
  return [...new Set([favourite.name, ...favourite.aliases, ...implicitTerms(favourite.name)])];
}

// Favourites that `value` names exactly, by name, alias or a word of the name.
export function favouritesFor(favourites, value) {
  const key = keyFor(value);
  if (!key) return [];
  return favourites.filter((favourite) =>
    favouriteTerms(favourite).some((term) => keyFor(term) === key),
  );
}

// The favourite `value` unambiguously refers to, or null.
export function canonicalName(favourites, value) {
  const matches = favouritesFor(favourites, value);
  return matches.length === 1 ? matches[0].name : null;
}

// The single term that completes a partly typed favourite, or "".
export function favouriteAutocomplete(favourites, value) {
  const key = keyFor(value);
  if (!key) return "";
  const matches = favourites.filter((favourite) =>
    favouriteTerms(favourite).some((term) => keyFor(term).includes(key)),
  );
  if (matches.length !== 1) return "";
  const candidates = new Map(favouriteTerms(matches[0]).filter((term) => {
    const candidateKey = keyFor(term);
    return candidateKey.startsWith(key) && candidateKey !== key;
  }).map((term) => [keyFor(term), term]));
  return candidates.size === 1 ? [...candidates.values()][0] : "";
}

export function matchingFavourites(favourites, query) {
  const key = keyFor(query);
  return favourites
    .filter((favourite) => !key || favouriteTerms(favourite).some((term) => keyFor(term).includes(key)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Unchecked first, then in the order they were added.
export function sortItems(items) {
  return [...items].sort((a, b) => Number(a.checked) - Number(b.checked) || a.createdAt - b.createdAt);
}

export function stripRequestWords(value) {
  return cleanName(value)
    .replace(/^(?:please\s+)?(?:can you\s+)?(?:add|buy|get|need|pick up|i need|we need)\s+/i, "")
    .replace(/\s+(?:please|thanks|thank you)[.!?]*$/i, "")
    .replace(/^[\s,]+|[\s,.!?]+$/g, "");
}

export function requestWords(prompt) {
  return cleanName(prompt).match(/[\p{L}\p{N}']+/gu) || [];
}

export function formatNames(names) {
  if (names.length < 2) return names[0] || "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
