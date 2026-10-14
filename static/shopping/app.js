const STORAGE_KEY = "groceries-state-v1";

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

const elements = Object.fromEntries(
  [
    "addTab", "shopTab", "addView", "shopView", "composerForm", "messageInput",
    "micButton", "sendButton", "addList", "addListEmpty", "recognitionPreview", "inputFeedback", "activeCount", "shoppingList",
    "remainingCount", "clearCompletedButton", "emptyList", "emptyAddButton", "allowListDialog",
    "openAllowListButton", "closeAllowListButton", "allowListForm",
    "allowItemInput", "addFavouriteButton", "allowListError", "allowListItems", "resetAllowListButton", "toast", "modelStatus",
    "modelStatusText", "listeningStatus", "interimTranscript",
  ].map((id) => [id, document.getElementById(id)]),
);

let state = loadState();
let worker = null;
let modelReady = false;
let modelBusy = false;
let pendingPrompt = null;
let toastTimer = null;
let recognition = null;
let listening = false;
let voiceTranscript = "";
let suppressSpeechSubmit = false;
let suppressFavouriteAutocomplete = false;
let appliedFavouriteSuggestion = "";

function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function keyFor(value) {
  return cleanName(value).toLocaleLowerCase();
}

function normaliseFavourite(value) {
  const name = cleanName(typeof value === "string" ? value : value?.name);
  if (!name) return null;
  const aliases = Array.isArray(value?.aliases)
    ? [...new Map(value.aliases.map(cleanName).filter(Boolean).map((alias) => [keyFor(alias), alias])).values()]
        .filter((alias) => keyFor(alias) !== keyFor(name))
    : [];
  return { name, aliases };
}

function uniqueFavourites(values) {
  const favourites = new Map();
  for (const value of values) {
    const favourite = normaliseFavourite(value);
    if (favourite) favourites.set(keyFor(favourite.name), favourite);
  }
  return [...favourites.values()];
}

function starterFavourites() {
  return STARTER_FAVOURITES.map((favourite) => ({
    name: favourite.name,
    aliases: [...favourite.aliases],
  }));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const migratedCustom = Array.isArray(saved?.customAllowed) ? saved.customAllowed : [];
    const hasSavedFavourites = Array.isArray(saved?.favourites);
    const favourites = hasSavedFavourites
      ? uniqueFavourites(saved.favourites)
      : uniqueFavourites([...starterFavourites(), ...migratedCustom]);
    return {
      items: Array.isArray(saved?.items)
        ? saved.items.filter((item) => item && cleanName(item.name)).map((item) => ({
            id: String(item.id || makeId()),
            name: cleanName(item.name),
            checked: Boolean(item.checked),
            createdAt: Number(item.createdAt) || Date.now(),
          }))
        : [],
      favourites,
    };
  } catch (_error) {
    return { items: [], favourites: starterFavourites() };
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_error) {
    showToast("This change will last until this tab is closed");
  }
}

function implicitTerms(name) {
  return keyFor(name).split(/[^\p{L}\p{N}']+/u).filter((term) => term.length > 2);
}

function favouriteTerms(favourite) {
  return [...new Set([favourite.name, ...favourite.aliases, ...implicitTerms(favourite.name)])];
}

function favouritesFor(value) {
  const key = keyFor(value);
  if (!key) return [];
  return state.favourites.filter((favourite) =>
    favouriteTerms(favourite).some((term) => keyFor(term) === key),
  );
}

function canonicalName(value) {
  const matches = favouritesFor(value);
  return matches.length === 1 ? matches[0].name : null;
}

function setModelStatus(message, kind = "loading") {
  if (elements.modelStatusText) elements.modelStatusText.textContent = message;
  if (elements.modelStatus) {
    elements.modelStatus.dataset.state = kind;
    elements.modelStatus.classList.toggle("is-ready", kind === "ready");
    elements.modelStatus.classList.toggle("is-error", kind === "unavailable" || kind === "error");
  }
}

function showToast(message) {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2400);
}

function showFavouriteError(message) {
  if (!elements.allowListError) return;
  elements.allowListError.textContent = message;
  elements.allowListError.hidden = false;
}

function clearFavouriteError() {
  if (elements.allowListError) elements.allowListError.hidden = true;
}

function favouriteAutocomplete(value) {
  const key = keyFor(value);
  if (!key) return "";
  const matches = state.favourites.filter((favourite) =>
    favouriteTerms(favourite).some((term) => keyFor(term).includes(key)),
  );
  if (matches.length !== 1) return "";
  const candidates = new Map(favouriteTerms(matches[0]).filter((term) => {
    const candidateKey = keyFor(term);
    return candidateKey.startsWith(key) && candidateKey !== key;
  }).map((term) => [keyFor(term), term]));
  return candidates.size === 1 ? [...candidates.values()][0] : "";
}

function updateFavouriteInput({ autocomplete = true } = {}) {
  const value = cleanName(elements.allowItemInput?.value);
  const suggestion = favouriteAutocomplete(value);
  if (autocomplete && suggestion && elements.allowItemInput) {
    const suffix = suggestion.slice(value.length);
    elements.allowItemInput.value = `${value}${suffix}`;
    elements.allowItemInput.setSelectionRange(value.length, suggestion.length);
    appliedFavouriteSuggestion = suggestion;
  }
  const currentValue = cleanName(elements.allowItemInput?.value);
  const matches = favouritesFor(value);
  const hasSuggestion = autocomplete && Boolean(suggestion);
  if (elements.addFavouriteButton) {
    elements.addFavouriteButton.disabled = !currentValue || matches.length > 0 || hasSuggestion;
  }
  renderAllowedItems();
  clearFavouriteError();
  if (!autocomplete) appliedFavouriteSuggestion = "";
}

function setInputFeedback(text = "", actions = []) {
  if (!elements.inputFeedback) return;
  elements.inputFeedback.replaceChildren();
  const actionList = (Array.isArray(actions) ? actions : [actions]).filter(Boolean);
  elements.inputFeedback.hidden = !text && !actionList.length;
  elements.inputFeedback.classList.toggle("is-predictions", !text && actionList.length > 0);
  if (!text && !actionList.length) return;

  if (text) {
    const copy = document.createElement("p");
    copy.textContent = text;
    elements.inputFeedback.append(copy);
  }

  if (actionList.length) {
    const controls = document.createElement("div");
    controls.className = "input-feedback__actions";
    for (const action of actionList) {
      if (!action) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "input-feedback__action";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
      controls.append(button);
    }
    elements.inputFeedback.append(controls);
  }
}

function formatNames(names) {
  if (names.length < 2) return names[0] || "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function requestWords(prompt) {
  return cleanName(prompt).match(/[\p{L}\p{N}']+/gu) || [];
}

function showRecognition(prompt, recognised = []) {
  const preview = elements.recognitionPreview;
  if (!preview) return;
  const recognisedWords = new Set(
    recognised.flatMap((value) => requestWords(value)).map(keyFor),
  );
  const words = requestWords(prompt);

  preview.replaceChildren();
  let group = null;
  for (const word of words) {
    const found = recognisedWords.has(keyFor(word));
    if (found && !group) {
      group = document.createElement("span");
      group.className = "recognition-preview__group";
      preview.append(group);
    }
    if (!found) group = null;
    const token = document.createElement("span");
    token.className = `recognition-preview__word${found ? " is-recognised" : " is-ignored"}`;
    token.textContent = word;
    token.setAttribute("aria-label", found ? `${word}, recognised` : `${word}, ignored filler`);
    (found ? group : preview).append(token);
  }
  preview.hidden = words.length === 0;
  preview.classList.remove("is-entering");
  requestAnimationFrame(() => preview.classList.add("is-entering"));
  setTimeout(() => { preview.hidden = true; }, 1100);
}

function renderList() {
  const sorted = [...state.items].sort((a, b) => Number(a.checked) - Number(b.checked) || a.createdAt - b.createdAt);
  elements.shoppingList?.replaceChildren();
  elements.addList?.replaceChildren();

  for (const item of sorted) {
    const row = document.createElement("li");
    row.className = `shopping-item${item.checked ? " is-complete" : ""}`;
    row.dataset.itemId = item.id;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "shopping-item__toggle";
    toggle.setAttribute("aria-pressed", String(item.checked));
    toggle.setAttribute("aria-label", `${item.checked ? "Put back" : "Pick up"} ${item.name}`);
    toggle.addEventListener("click", () => {
      item.checked = !item.checked;
      saveState();
      renderList();
    });
    const check = document.createElement("span");
    check.className = "shopping-item__check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "shopping-item__name";
    name.textContent = item.name;
    toggle.append(check, name);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "shopping-item__remove";
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5" /></svg>';
    remove.addEventListener("click", () => removeItem(item));
    row.append(toggle, remove);
    elements.shoppingList?.append(row);

    const addRow = document.createElement("li");
    addRow.className = `add-list-item${item.checked ? " is-complete" : ""}`;
    const addName = document.createElement("span");
    addName.className = "add-list-item__name";
    addName.textContent = item.name;
    const addRemove = document.createElement("button");
    addRemove.type = "button";
    addRemove.className = "add-list-item__remove";
    addRemove.setAttribute("aria-label", `Remove ${item.name}`);
    addRemove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5" /></svg>';
    addRemove.addEventListener("click", () => removeItem(item));
    addRow.append(addName, addRemove);
    elements.addList?.append(addRow);
  }

  const remaining = state.items.filter((item) => !item.checked).length;
  const completed = state.items.length - remaining;
  if (elements.activeCount) {
    elements.activeCount.textContent = String(remaining);
    elements.activeCount.setAttribute("aria-label", `${remaining} item${remaining === 1 ? "" : "s"} remaining`);
  }
  if (elements.remainingCount) elements.remainingCount.textContent = String(remaining);
  if (elements.addListEmpty) elements.addListEmpty.hidden = state.items.length > 0;
  if (elements.emptyList) elements.emptyList.hidden = state.items.length > 0;
  if (elements.clearCompletedButton) elements.clearCompletedButton.disabled = completed === 0;
}

function removeItem(item) {
  state.items = state.items.filter((candidate) => candidate.id !== item.id);
  saveState();
  renderList();
  showToast(`${item.name} removed`);
}

function renderAllowedItems() {
  if (!elements.allowListItems) return;
  const query = keyFor(elements.allowItemInput?.value);
  const matches = state.favourites
    .filter((favourite) => !query || favouriteTerms(favourite).some((term) => keyFor(term).includes(query)))
    .sort((a, b) => a.name.localeCompare(b.name));
  elements.allowListItems.replaceChildren();

  for (const favourite of matches) {
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
    edit.addEventListener("click", () => renderFavouriteEditor(row, favourite));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "allowed-item__remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${favourite.name} from favourites`);
    remove.addEventListener("click", () => {
      state.favourites = state.favourites.filter((item) => keyFor(item.name) !== keyFor(favourite.name));
      saveState();
      configureWorker();
      renderAllowedItems();
    });
    actions.append(edit, remove);
    row.append(copy, actions);
    elements.allowListItems.append(row);
  }
}

function renderFavouriteEditor(row, favourite) {
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
  cancel.addEventListener("click", renderAllowedItems);
  actions.append(save, cancel);
  form.append(nameInput, aliasesInput, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = cleanName(nameInput.value);
    if (!name) return;
    const duplicate = state.favourites.some((item) =>
      keyFor(item.name) === keyFor(name) && keyFor(item.name) !== keyFor(favourite.name),
    );
    if (duplicate) {
      showFavouriteError(`${name} is already a favourite`);
      return;
    }
    const aliases = aliasesInput.value.split(",").map(cleanName).filter(Boolean);
    const index = state.favourites.indexOf(favourite);
    state.favourites[index] = normaliseFavourite({ name, aliases });
    saveState();
    configureWorker();
    applySpeechPhrases();
    renderAllowedItems();
    showToast(`${name} saved`);
  });
  row.append(form);
  nameInput.focus();
  nameInput.select();
}

function addFavourite(value) {
  const name = cleanName(value);
  if (!name) return false;
  const matches = favouritesFor(name);
  if (matches.length > 1) {
    showVariantChoice(matches);
    return false;
  }
  if (matches.length === 1) {
    showFavouriteError(`${matches[0].name} is already a favourite`);
    return false;
  }
  state.favourites.push({ name, aliases: [] });
  clearFavouriteError();
  saveState();
  configureWorker();
  applySpeechPhrases();
  renderAllowedItems();
  showToast(`${name} added to favourites`);
  return true;
}

function favouriteAndAdd(value) {
  const name = cleanName(value);
  if (!name) return;
  if (canonicalName(name) || addFavourite(name)) {
    replyForAdd(addGroceries([name]));
  }
}

function addGroceries(names) {
  const added = [];
  const duplicates = [];
  const existing = new Set(state.items.map((item) => keyFor(item.name)));
  for (const value of names) {
    const name = canonicalName(value);
    if (!name) continue;
    const key = keyFor(name);
    if (existing.has(key)) {
      if (!duplicates.some((item) => keyFor(item) === key)) duplicates.push(name);
      continue;
    }
    existing.add(key);
    state.items.push({ id: makeId(), name, checked: false, createdAt: Date.now() + added.length });
    added.push(name);
  }
  if (added.length) {
    saveState();
    renderList();
  }
  return { added, duplicates };
}

function replyForAdd({ added, duplicates }) {
  if (duplicates.length) {
    setInputFeedback(`${formatNames(duplicates)} ${duplicates.length === 1 ? "is" : "are"} already on your list.`);
  } else if (added.length) {
    setInputFeedback();
  }
}

function showVariantChoice(favourites) {
  setInputFeedback(
    "",
    favourites.map((favourite) => ({
      label: favourite.name,
      onClick: () => replyForAdd(addGroceries([favourite.name])),
    })),
  );
}

function stripRequestWords(value) {
  return cleanName(value)
    .replace(/^(?:please\s+)?(?:can you\s+)?(?:add|buy|get|need|pick up|i need|we need)\s+/i, "")
    .replace(/\s+(?:please|thanks|thank you)[.!?]*$/i, "")
    .replace(/^[\s,]+|[\s,.!?]+$/g, "");
}

function setComposerBusy(busy) {
  modelBusy = busy;
  if (elements.sendButton) elements.sendButton.disabled = busy;
  if (elements.messageInput) elements.messageInput.setAttribute("aria-busy", String(busy));
}

function submitPrompt(rawPrompt, source = "typed") {
  const prompt = cleanName(rawPrompt);
  if (!prompt || modelBusy) return;
  setInputFeedback();
  if (elements.messageInput) elements.messageInput.value = "";
  if (elements.interimTranscript) {
    elements.interimTranscript.textContent = "";
    elements.interimTranscript.hidden = true;
  }

  pendingPrompt = { prompt, source, sent: false };
  setComposerBusy(true);
  if (modelReady) runPendingPrompt();
  else setModelStatus("Waiting for the grocery model…", "loading");
}

function runPendingPrompt() {
  if (!pendingPrompt || pendingPrompt.sent || !modelReady || !worker) return;
  pendingPrompt.sent = true;
  setModelStatus("Understanding your message…", "working");
  worker.postMessage({ type: "complete", prompt: pendingPrompt.prompt });
}

function offerUnknown(value) {
  const name = stripRequestWords(value);
  setInputFeedback("", [{ label: name, onClick: () => favouriteAndAdd(name) }]);
}

function detailsFromCalls(calls = []) {
  const names = [];
  const choices = [];
  for (const call of calls) {
    let args = call?.arguments ?? {};
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch (_error) { args = { item: args }; }
    }
    if (call?.name !== "add_grocery" || typeof args.item !== "string") continue;
    const matches = favouritesFor(args.item);
    if (matches.length > 1) choices.push(matches);
    else if (matches.length === 1) names.push(matches[0].name);
  }
  return {
    names: [...new Set(names)],
    choices,
  };
}

function logNeedleTrace(prompt, data) {
  const passes = Array.isArray(data.trace) ? data.trace : [];
  console.group(`🛒 Grocery trace · “${prompt}”`);
  for (const pass of passes) {
    const confidence = Number.isFinite(pass.confidence)
      ? pass.confidence.toFixed(3)
      : "not reported";
    if (passes.length > 1) {
      console.log(`Pass ${pass.pass} · “${pass.prompt}” · confidence ${confidence}`);
    }
    for (const call of pass.calls ?? []) {
      const canonical = canonicalName(call.item) || call.item;
      const normalised = canonical !== call.item ? ` → “${canonical}”` : "";
      const status = call.outcome === "suggestion"
        ? "prediction"
        : call.outcome === "ignored" ? "ignored" : "grounded";
      console.log(
        `→ ${call.name}(${JSON.stringify(call.item)})${normalised} · ${status} · confidence ${confidence}`,
      );
    }
    if (!(pass.calls ?? []).length) {
      console.log(`No tool calls · confidence ${confidence}`);
    }
  }
  console.log(`Completed in ${Math.round(data.elapsedMs ?? 0)} ms`);
  console.groupEnd();
}

function handleWorkerResult(data) {
  const context = pendingPrompt;
  pendingPrompt = null;
  setComposerBusy(false);
  setModelStatus("Ready for grocery requests", "ready");
  if (!context) return;
  logNeedleTrace(context.prompt, data);

  const accepted = detailsFromCalls(data.calls);
  if (accepted.names.length) {
    const recognisedTerms = data.calls
      ?.map((call) => call?.arguments?.item)
      .filter((item) => typeof item === "string") || [];
    showRecognition(context.prompt, [...recognisedTerms, ...accepted.names]);
    replyForAdd(addGroceries(accepted.names));
  }
  if (accepted.choices.length) {
    showVariantChoice(accepted.choices[0]);
    return;
  }
  if (accepted.names.length) return;

  const suppressed = detailsFromCalls(data.suppressedCalls);
  const originalName = stripRequestWords(context.prompt);
  const addOriginalAction = {
    label: originalName,
    onClick: () => favouriteAndAdd(originalName),
  };
  if (suppressed.choices.length) {
    setInputFeedback(
      "",
      [
        ...suppressed.choices[0].map((favourite) => ({
          label: favourite.name,
          onClick: () => replyForAdd(addGroceries([favourite.name])),
        })),
        addOriginalAction,
      ],
    );
    return;
  }
  if (suppressed.names.length) {
    setInputFeedback(
      "",
      [
        ...suppressed.names.map((name) => ({
          label: name,
          onClick: () => replyForAdd(addGroceries([name])),
        })),
        addOriginalAction,
      ],
    );
    return;
  }
  offerUnknown(context.prompt);
}

function fallBackFromWorker() {
  modelReady = false;
  setComposerBusy(false);
  setModelStatus("The grocery model is unavailable", "unavailable");
  if (!pendingPrompt) return;
  const { prompt } = pendingPrompt;
  pendingPrompt = null;
  const exact = canonicalName(prompt);
  if (exact) replyForAdd(addGroceries([exact]));
  else if (favouritesFor(prompt).length > 1) showVariantChoice(favouritesFor(prompt));
  else setInputFeedback("The grocery model is unavailable. Try again after reloading the page.");
}

function configureWorker() {
  worker?.postMessage({ type: "configure", favourites: state.favourites });
}

function initialiseWorker() {
  if (!("Worker" in window)) {
    setModelStatus("The grocery model is not supported here", "unavailable");
    return;
  }
  try {
    worker = new Worker("./worker.js?v=5");
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "progress") setModelStatus(data.message || "Loading language model…");
      if (data.type === "ready") {
        setModelStatus("Preparing favourites…");
      }
      if (data.type === "configured") {
        modelReady = true;
        setModelStatus("Ready for grocery requests", "ready");
        runPendingPrompt();
      }
      if (data.type === "result") handleWorkerResult(data);
      if (data.type === "error") {
        fallBackFromWorker();
      }
    });
    worker.addEventListener("error", () => {
      fallBackFromWorker();
    });
    configureWorker();
  } catch (_error) {
    setModelStatus("The grocery model is unavailable", "unavailable");
  }
}

function selectView(view) {
  const shopping = view === "shop";
  if (elements.addView) elements.addView.hidden = shopping;
  if (elements.shopView) elements.shopView.hidden = !shopping;
  elements.addTab?.setAttribute("aria-selected", String(!shopping));
  elements.shopTab?.setAttribute("aria-selected", String(shopping));
  if (elements.addTab) elements.addTab.tabIndex = shopping ? -1 : 0;
  if (elements.shopTab) elements.shopTab.tabIndex = shopping ? 0 : -1;
  elements.addTab?.classList.toggle("is-active", !shopping);
  elements.shopTab?.classList.toggle("is-active", shopping);
  if (!shopping) elements.messageInput?.focus();
}

function setListening(next) {
  listening = next;
  elements.micButton?.classList.toggle("is-listening", next);
  elements.micButton?.setAttribute("aria-pressed", String(next));
  elements.micButton?.setAttribute("aria-label", next ? "Stop listening" : "Add by voice");
  if (elements.listeningStatus) {
    elements.listeningStatus.hidden = !next;
  }
}

function applySpeechPhrases() {
  if (!recognition || !("phrases" in recognition)) return;
  const phraseValues = state.favourites
    .flatMap((favourite) => [favourite.name, ...favourite.aliases])
    .map(cleanName)
    .filter(Boolean);
  const SpeechRecognitionPhrase =
    window.SpeechRecognitionPhrase || window.webkitSpeechRecognitionPhrase;
  if (!SpeechRecognitionPhrase) return;
  try {
    recognition.phrases = phraseValues.map(
      (phrase) => new SpeechRecognitionPhrase({ phrase, boost: 8 }),
    );
  } catch (_error) {
    // Contextual speech biasing is experimental and may be read-only in some browsers.
  }
}

function initialiseSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (elements.micButton) {
      elements.micButton.disabled = true;
      elements.micButton.title = "Voice input is not available in this browser";
    }
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = document.documentElement.lang || "en-GB";
  applySpeechPhrases();
  recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript.trim();
      if (event.results[index].isFinal) voiceTranscript = cleanName(`${voiceTranscript} ${transcript}`);
      else interim = cleanName(`${interim} ${transcript}`);
    }
    if (elements.interimTranscript) {
      elements.interimTranscript.textContent = cleanName(`${voiceTranscript} ${interim}`);
      elements.interimTranscript.hidden = false;
    }
    if (elements.messageInput) elements.messageInput.value = cleanName(`${voiceTranscript} ${interim}`);
  });
  recognition.addEventListener("end", () => {
    const transcript = cleanName(voiceTranscript || elements.messageInput?.value);
    setListening(false);
    voiceTranscript = "";
    if (suppressSpeechSubmit) {
      suppressSpeechSubmit = false;
      return;
    }
    if (transcript) submitPrompt(transcript, "voice");
  });
  recognition.addEventListener("error", (event) => {
    setListening(false);
    voiceTranscript = "";
    suppressSpeechSubmit = true;
    if (event.error !== "aborted") showToast("Voice input stopped. You can keep typing instead.");
  });
}

elements.addTab?.addEventListener("click", () => selectView("add"));
elements.shopTab?.addEventListener("click", () => selectView("shop"));
elements.emptyAddButton?.addEventListener("click", () => selectView("add"));
elements.composerForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPrompt(elements.messageInput?.value);
});
elements.clearCompletedButton?.addEventListener("click", () => {
  const count = state.items.filter((item) => item.checked).length;
  if (!count) return;
  state.items = state.items.filter((item) => !item.checked);
  saveState();
  renderList();
  showToast(`Cleared ${count} completed item${count === 1 ? "" : "s"}`);
});
elements.openAllowListButton?.addEventListener("click", () => {
  renderAllowedItems();
  clearFavouriteError();
  updateFavouriteInput();
  if (elements.allowListDialog?.showModal) elements.allowListDialog.showModal();
  else if (elements.allowListDialog) elements.allowListDialog.hidden = false;
  elements.allowItemInput?.focus();
});
elements.closeAllowListButton?.addEventListener("click", () => {
  if (elements.allowListDialog?.close) elements.allowListDialog.close();
  else if (elements.allowListDialog) elements.allowListDialog.hidden = true;
});
elements.allowListForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (addFavourite(elements.allowItemInput?.value)) {
    elements.allowItemInput.value = "";
    updateFavouriteInput();
  }
});
elements.allowItemInput?.addEventListener("keydown", (event) => {
  suppressFavouriteAutocomplete =
    (event.key === "Backspace" || event.key === "Delete")
    && (
      event.currentTarget.selectionStart !== event.currentTarget.selectionEnd
      || (event.key === "Backspace" && event.currentTarget.value === appliedFavouriteSuggestion)
    );
});
elements.allowItemInput?.addEventListener("beforeinput", (event) => {
  if (event.inputType === "deleteContentBackward" && event.currentTarget.value === appliedFavouriteSuggestion) {
    suppressFavouriteAutocomplete = true;
  }
});
elements.allowItemInput?.addEventListener("input", () => {
  updateFavouriteInput({ autocomplete: !suppressFavouriteAutocomplete });
  suppressFavouriteAutocomplete = false;
});
elements.resetAllowListButton?.addEventListener("click", () => {
  state.favourites = starterFavourites();
  saveState();
  configureWorker();
  applySpeechPhrases();
  renderAllowedItems();
  showToast("Favourites reset");
});
elements.micButton?.addEventListener("click", () => {
  if (!recognition) return;
  if (listening) {
    recognition.stop();
    return;
  }
  voiceTranscript = cleanName(elements.messageInput?.value);
  suppressSpeechSubmit = false;
  try {
    recognition.start();
    setListening(true);
  } catch (_error) {
    showToast("Voice input could not start. You can keep typing instead.");
  }
});

renderList();
renderAllowedItems();
selectView("add");
initialiseSpeech();
initialiseWorker();
