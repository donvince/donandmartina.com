/* global createNeedle */

const OUTPUT_BYTES = 64 * 1024;
const MAX_FAVOURITES = 250;
const MAX_ITEM_LENGTH = 80;

let favourites = [{ name: "milk", aliases: [] }];
let runtime;
let outputPointer;
let ready = false;

function post(type, detail = {}) {
  self.postMessage({ type, ...detail });
}

function report(message) {
  post("progress", { message });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function lastError() {
  const pointer = runtime?._needle_last_error();
  return pointer ? runtime.UTF8ToString(pointer) : "Unknown runtime error";
}

function clean(value) {
  return typeof value === "string" ? value.normalize().trim().replace(/\s+/g, " ") : "";
}

function normaliseFavourites(values) {
  if (!Array.isArray(values)) {
    throw new Error("Favourites must be an array.");
  }

  const seen = new Set();
  const normalised = [];

  for (const value of values) {
    const name = clean(value?.name);
    const key = name.toLocaleLowerCase("en-GB");
    if (!name || name.length > MAX_ITEM_LENGTH || seen.has(key)) continue;
    seen.add(key);
    const aliases = Array.isArray(value.aliases)
      ? [...new Set(value.aliases.map(clean).filter((alias) => alias && alias.length <= MAX_ITEM_LENGTH))]
      : [];
    normalised.push({ name, aliases });
    if (normalised.length === MAX_FAVOURITES) break;
  }

  return normalised;
}

function implicitTerms(name) {
  return name.split(/[^\p{L}\p{N}']+/u).filter((term) => term.length > 2);
}

function toolSchema(items) {
  const choices = new Set();
  for (const favourite of items) {
    choices.add(favourite.name);
    choices.add(favourite.name.toLocaleLowerCase("en-GB"));
    favourite.aliases.forEach((alias) => {
      choices.add(alias);
      choices.add(alias.toLocaleLowerCase("en-GB"));
    });
    implicitTerms(favourite.name).forEach((term) => {
      choices.add(term);
      choices.add(term.toLocaleLowerCase("en-GB"));
    });
  }
  const vocabulary = choices.size ? [...choices] : ["__no_favourites__"];
  return [
    {
      name: "add_grocery",
      description:
        "Add exactly one recognised grocery to the shopping list. Call this tool " +
        "once for every distinct item requested, including terse space-separated " +
        "lists. For a terse list, call the tool for one item at a time; never combine " +
        "multiple grocery words into one item value. Select the wording the user used " +
        "when it is available. If a generic " +
        "word matches several favourites, preserve that generic word for the app " +
        "to resolve. Do not invent items.",
      parameters: {
        type: "object",
        properties: {
          item: {
            type: "string",
            enum: vocabulary,
            description: "The grocery name.",
          },
        },
        required: ["item"],
      },
    },
  ];
}

function initialisePrompt(items) {
  return runtime.ccall(
    "needle_init",
    "number",
    ["string", "string", "number"],
    ["", JSON.stringify(toolSchema(items)), 0],
  );
}

function configure(items) {
  const nextItems = normaliseFavourites(items);

  if (!ready) {
    favourites = nextItems;
    return;
  }

  const previousItems = favourites;
  runtime._needle_reset();
  const prefixTokens = initialisePrompt(nextItems);
  if (prefixTokens < 0) {
    const configurationError = lastError();

    // Needle does not expose an explicit prompt destructor. Rebuilding the
    // previous prompt after reset is the safest recovery its browser API
    // currently permits.
    runtime._needle_reset();
    if (initialisePrompt(previousItems) < 0) {
      throw new Error(
        `Could not update or restore the grocery model: ${configurationError}`,
      );
    }
    throw new Error(`Could not update the grocery model: ${configurationError}`);
  }

  favourites = nextItems;
}

async function fetchWithProgress(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);

  const total = Number(response.headers.get("content-length"));
  if (!response.body || !total) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const bytes = new Uint8Array(total);
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value, received);
    received += value.length;
    report(`Loading grocery model\u2026 ${Math.round((received / total) * 100)}%`);
  }

  return bytes;
}

async function initialise() {
  report("Loading grocery model\u2026");
  importScripts("./vendor/needle.js");

  const wasmResponse = await fetch("./vendor/needle.wasm");
  if (!wasmResponse.ok) {
    throw new Error(`./vendor/needle.wasm returned HTTP ${wasmResponse.status}`);
  }

  const wasmBinary = new Uint8Array(await wasmResponse.arrayBuffer());
  const hasWasmHeader =
    wasmBinary[0] === 0x00 &&
    wasmBinary[1] === 0x61 &&
    wasmBinary[2] === 0x73 &&
    wasmBinary[3] === 0x6d;
  if (!hasWasmHeader) {
    throw new Error("The local model runtime is missing or could not be loaded.");
  }

  runtime = await createNeedle({ wasmBinary });
  const model = await fetchWithProgress("./vendor/needle3.cact");
  report("Preparing grocery recognition\u2026");

  const modelPointer = runtime._malloc(model.length);
  try {
    runtime.HEAPU8.set(model, modelPointer);
    const loaded = runtime._needle_load(modelPointer, BigInt(model.length));
    if (loaded < 0) throw new Error(lastError());
  } finally {
    runtime._free(modelPointer);
  }

  const prefixTokens = initialisePrompt(favourites);
  if (prefixTokens < 0) throw new Error(lastError());

  outputPointer = runtime._malloc(OUTPUT_BYTES);
  if (!outputPointer) throw new Error("Could not reserve memory for model results.");

  ready = true;
  post("ready", { favourites });
}

function parseArguments(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function collectCalls(response, key = "function_calls") {
  if (!Array.isArray(response?.[key])) return [];
  return response[key]
    .filter((call) => call?.name === "add_grocery")
    .map((call) => ({ ...call, arguments: parseArguments(call.arguments) }));
}

function completeOnce(prompt) {
  runtime._needle_reset();
  const returnCode = runtime.ccall(
    "needle_complete",
    "number",
    ["string", "number", "number", "number", "number", "number"],
    [prompt.trim(), 0, 0, 384, outputPointer, OUTPUT_BYTES],
  );

  if (returnCode < 0) throw new Error(lastError());

  let response;
  try {
    return JSON.parse(runtime.UTF8ToString(outputPointer));
  } catch {
    throw new Error(
      "The grocery model returned an unreadable result. Please try again.",
    );
  }
}

function consumeMention(prompt, item) {
  const index = prompt.toLocaleLowerCase("en-GB").indexOf(item.toLocaleLowerCase("en-GB"));
  if (index < 0) return { prompt, consumed: false };
  return {
    prompt: `${prompt.slice(0, index)} ${prompt.slice(index + item.length)}`
      .replace(/\s+/g, " ")
      .trim(),
    consumed: true,
  };
}

function callKey(call) {
  return `${call.name}:${JSON.stringify(call.arguments)}`;
}

function sourceIndex(prompt, call) {
  const item = call?.arguments?.item;
  if (typeof item !== "string") return Number.MAX_SAFE_INTEGER;
  const index = prompt.toLocaleLowerCase("en-GB").indexOf(item.toLocaleLowerCase("en-GB"));
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function complete(prompt, requestId) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Enter a grocery request first.");
  }

  const started = performance.now();
  const calls = [];
  const suppressedCalls = [];
  const trace = [];
  const seen = new Set();
  let remaining = prompt.trim();
  let response;

  // The tiny base model occasionally stops after only part of a terse list.
  // Let it select items first, consume only the selected surface mentions, and
  // ask it to interpret the remainder. This is model-led chunking rather than
  // a deterministic grocery scanner.
  for (let pass = 0; pass < 4 && remaining; pass += 1) {
    const passPrompt = remaining;
    response = completeOnce(remaining);
    const passCalls = [
      ...collectCalls(response),
      ...collectCalls(response, "suppressed_calls"),
    ];
    const tracePass = {
      pass: pass + 1,
      prompt: passPrompt,
      confidence: Number.isFinite(Number(response.confidence))
        ? Number(response.confidence)
        : null,
      calls: [],
    };
    trace.push(tracePass);
    let consumedAny = false;

    for (const call of passCalls) {
      const item = call?.arguments?.item;
      if (typeof item !== "string") continue;
      const consumed = consumeMention(remaining, item);

      // Semantic/off-piste matches are useful on the first pass. Follow-up
      // passes are only for literal leftovers, which avoids inventing items
      // from connective words left behind by a natural sentence.
      if (pass > 0 && !consumed.consumed) {
        tracePass.calls.push({ name: call.name, item, grounded: false, outcome: "ignored" });
        continue;
      }

      // A literal mention is grounded by the user's own text, even if the tiny
      // model's aggregate confidence is low. Semantic guesses always go through
      // confirmation, even when Needle reports confidence in the guess.
      const target = consumed.consumed ? calls : suppressedCalls;
      tracePass.calls.push({
        name: call.name,
        item,
        grounded: consumed.consumed,
        outcome: consumed.consumed ? "accepted" : "suggestion",
      });
      const key = callKey(call);
      if (!seen.has(key)) {
        seen.add(key);
        target.push(call);
      }
      if (consumed.consumed) {
        remaining = consumed.prompt;
        consumedAny = true;
      }
    }

    if (!consumedAny) break;
  }

  calls.sort((left, right) => sourceIndex(prompt, left) - sourceIndex(prompt, right));
  suppressedCalls.sort((left, right) => sourceIndex(prompt, left) - sourceIndex(prompt, right));

  post("result", {
    response,
    calls,
    suppressedCalls,
    trace,
    elapsedMs: performance.now() - started,
    ...(requestId === undefined ? {} : { requestId }),
  });
}

const initialisation = initialise();

self.addEventListener("message", async ({ data }) => {
  const requestId = data?.requestId;

  try {
    if (data?.type === "configure") {
      // Applying this before model startup completes lets the app restore its
      // locally saved custom vocabulary without doing a second initialisation.
      configure(data.favourites);
      await initialisation;
      post("configured", {
        favourites,
        ...(requestId === undefined ? {} : { requestId }),
      });
      return;
    }

    if (data?.type === "complete") {
      await initialisation;
      complete(data.prompt, requestId);
    }
  } catch (error) {
    post("error", {
      message: errorMessage(error),
      ...(requestId === undefined ? {} : { requestId }),
    });
  }
});

initialisation.catch((error) => {
  post("error", { message: errorMessage(error) });
});
