// The "Add" composer: typed or spoken requests, interpreted by the grocery
// model, become items on the list.

import {
  canonicalName,
  cleanName,
  favouritesFor,
  formatNames,
  keyFor,
  requestWords,
  stripRequestWords,
} from "../model/groceries.js";
import { favouriteErrorMessage } from "./favourites-view.js";

export function createComposerView({ elements, store, groceryModel, setModelStatus, showToast }) {
  let pendingPrompt = null;
  let busy = false;
  let recognition = null;
  let listening = false;
  let voiceTranscript = "";
  let suppressSpeechSubmit = false;

  const favourites = () => store.getState().cart.favourites;

  // ── Feedback ──────────────────────────────────────────────────────────────
  function setInputFeedback(text = "", actions = []) {
    const feedback = elements.inputFeedback;
    if (!feedback) return;
    feedback.replaceChildren();
    const actionList = (Array.isArray(actions) ? actions : [actions]).filter(Boolean);
    feedback.hidden = !text && !actionList.length;
    feedback.classList.toggle("is-predictions", !text && actionList.length > 0);
    if (!text && !actionList.length) return;

    if (text) {
      const copy = document.createElement("p");
      copy.textContent = text;
      feedback.append(copy);
    }
    if (actionList.length) {
      const controls = document.createElement("div");
      controls.className = "input-feedback__actions";
      for (const action of actionList) {
        const actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.className = "input-feedback__action";
        actionButton.textContent = action.label;
        actionButton.addEventListener("click", action.onClick);
        controls.append(actionButton);
      }
      feedback.append(controls);
    }
  }

  function showRecognition(prompt, recognised = []) {
    const preview = elements.recognitionPreview;
    if (!preview) return;
    const recognisedWords = new Set(recognised.flatMap((value) => requestWords(value)).map(keyFor));
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

  // ── Adding ────────────────────────────────────────────────────────────────
  function add(names) {
    const { added, duplicates } = store.addGroceries(names);
    if (duplicates.length) {
      setInputFeedback(`${formatNames(duplicates)} ${duplicates.length === 1 ? "is" : "are"} already on your list.`);
    } else if (added.length) {
      setInputFeedback();
    }
  }

  function addAction(name) {
    return { label: name, onClick: () => add([name]) };
  }

  function showVariantChoice(matches) {
    setInputFeedback("", matches.map((favourite) => addAction(favourite.name)));
  }

  // Adds something that isn't a favourite yet, making it one first.
  function favouriteAndAdd(value) {
    const name = cleanName(value);
    if (!name) return;
    if (canonicalName(favourites(), name)) {
      add([name]);
      return;
    }
    const result = store.addFavourite(name);
    if (result.ok) {
      showToast(`${name} added to favourites`);
      add([name]);
    } else if (result.reason === "ambiguous") {
      showVariantChoice(result.matches);
    } else {
      setInputFeedback(favouriteErrorMessage(result, name));
    }
  }

  // ── Interpreting requests ────────────────────────────────────────────────
  function setBusy(next) {
    busy = next;
    if (elements.sendButton) elements.sendButton.disabled = next;
    elements.messageInput?.setAttribute("aria-busy", String(next));
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
      const matches = favouritesFor(favourites(), args.item);
      if (matches.length > 1) choices.push(matches);
      else if (matches.length === 1) names.push(matches[0].name);
    }
    return { names: [...new Set(names)], choices };
  }

  function logTrace(prompt, data) {
    const passes = Array.isArray(data.trace) ? data.trace : [];
    console.group(`🛒 Grocery trace · “${prompt}”`);
    for (const pass of passes) {
      const confidence = Number.isFinite(pass.confidence) ? pass.confidence.toFixed(3) : "not reported";
      if (passes.length > 1) console.log(`Pass ${pass.pass} · “${pass.prompt}” · confidence ${confidence}`);
      for (const call of pass.calls ?? []) {
        const canonical = canonicalName(favourites(), call.item) || call.item;
        const normalised = canonical !== call.item ? ` → “${canonical}”` : "";
        const status = call.outcome === "suggestion" ? "prediction" : call.outcome === "ignored" ? "ignored" : "grounded";
        console.log(`→ ${call.name}(${JSON.stringify(call.item)})${normalised} · ${status} · confidence ${confidence}`);
      }
      if (!(pass.calls ?? []).length) console.log(`No tool calls · confidence ${confidence}`);
    }
    console.log(`Completed in ${Math.round(data.elapsedMs ?? 0)} ms`);
    console.groupEnd();
  }

  function handleResult(prompt, data) {
    setBusy(false);
    setModelStatus("Ready for grocery requests", "ready");
    logTrace(prompt, data);

    const accepted = detailsFromCalls(data.calls);
    if (accepted.names.length) {
      const recognisedTerms = data.calls
        ?.map((call) => call?.arguments?.item)
        .filter((item) => typeof item === "string") || [];
      showRecognition(prompt, [...recognisedTerms, ...accepted.names]);
      add(accepted.names);
    }
    if (accepted.choices.length) {
      showVariantChoice(accepted.choices[0]);
      return;
    }
    if (accepted.names.length) return;

    const suppressed = detailsFromCalls(data.suppressedCalls);
    const originalName = stripRequestWords(prompt);
    const addOriginal = { label: originalName, onClick: () => favouriteAndAdd(originalName) };
    if (suppressed.choices.length) {
      setInputFeedback("", [...suppressed.choices[0].map((favourite) => addAction(favourite.name)), addOriginal]);
      return;
    }
    if (suppressed.names.length) {
      setInputFeedback("", [...suppressed.names.map(addAction), addOriginal]);
      return;
    }
    setInputFeedback("", [{ label: originalName, onClick: () => favouriteAndAdd(originalName) }]);
  }

  // Without the model, still add exact favourites.
  function fallBack(prompt) {
    setBusy(false);
    setModelStatus("The grocery model is unavailable", "unavailable");
    const exact = canonicalName(favourites(), prompt);
    if (exact) add([exact]);
    else if (favouritesFor(favourites(), prompt).length > 1) showVariantChoice(favouritesFor(favourites(), prompt));
    else setInputFeedback("The grocery model is unavailable. Try again after reloading the page.");
  }

  function runPendingPrompt() {
    if (!pendingPrompt || pendingPrompt.sent) return;
    if (groceryModel.isUnavailable()) {
      const { prompt } = pendingPrompt;
      pendingPrompt = null;
      fallBack(prompt);
      return;
    }
    if (!groceryModel.isReady()) return;
    pendingPrompt.sent = true;
    const { prompt } = pendingPrompt;
    setModelStatus("Understanding your message…", "working");
    groceryModel.complete(prompt)
      .then((data) => handleResult(prompt, data))
      .catch(() => fallBack(prompt))
      .finally(() => { pendingPrompt = null; });
  }

  function submitPrompt(rawPrompt, source = "typed") {
    const prompt = cleanName(rawPrompt);
    if (!prompt || busy) return;
    setInputFeedback();
    if (elements.messageInput) elements.messageInput.value = "";
    if (elements.interimTranscript) {
      elements.interimTranscript.textContent = "";
      elements.interimTranscript.hidden = true;
    }
    pendingPrompt = { prompt, source, sent: false };
    setBusy(true);
    if (!groceryModel.isReady() && !groceryModel.isUnavailable()) {
      setModelStatus("Waiting for the grocery model…", "loading");
    }
    runPendingPrompt();
  }

  // ── Voice ─────────────────────────────────────────────────────────────────
  function setListening(next) {
    listening = next;
    elements.micButton?.classList.toggle("is-listening", next);
    elements.micButton?.setAttribute("aria-pressed", String(next));
    elements.micButton?.setAttribute("aria-label", next ? "Stop listening" : "Add by voice");
    if (elements.listeningStatus) elements.listeningStatus.hidden = !next;
  }

  function applySpeechPhrases() {
    if (!recognition || !("phrases" in recognition)) return;
    const SpeechRecognitionPhrase = window.SpeechRecognitionPhrase || window.webkitSpeechRecognitionPhrase;
    if (!SpeechRecognitionPhrase) return;
    const phrases = favourites()
      .flatMap((favourite) => [favourite.name, ...favourite.aliases])
      .map(cleanName)
      .filter(Boolean);
    try {
      recognition.phrases = phrases.map((phrase) => new SpeechRecognitionPhrase({ phrase, boost: 8 }));
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

  elements.composerForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPrompt(elements.messageInput?.value);
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

  // Teach the model and speech recogniser the current favourites.
  let favouritesSignature = null;
  function syncVocabulary() {
    const signature = JSON.stringify(favourites());
    if (signature === favouritesSignature) return;
    favouritesSignature = signature;
    groceryModel.configure(favourites());
    applySpeechPhrases();
  }
  store.subscribe(syncVocabulary);

  initialiseSpeech();
  syncVocabulary();

  return {
    // Called when the grocery model's readiness changes.
    modelStatusChanged: runPendingPrompt,
  };
}
