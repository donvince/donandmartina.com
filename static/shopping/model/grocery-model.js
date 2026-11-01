// The on-device language model (worker.js) that turns free text into
// add_grocery tool calls drawn from the favourites. Wraps the worker's
// message protocol; no DOM.

// status: "loading" (with a progress message), "ready" or "unavailable".
export function createGroceryModel({ workerUrl = "/shopping/worker.js?v=5", onStatus = () => {} } = {}) {
  let worker = null;
  let ready = false;
  let unavailable = false;
  let waiting = null;
  let favourites = [];

  function fail() {
    ready = false;
    unavailable = true;
    onStatus("unavailable");
    waiting?.reject(new Error("The grocery model is unavailable"));
    waiting = null;
  }

  function start() {
    if (!("Worker" in globalThis)) {
      unavailable = true;
      onStatus("unavailable", "The grocery model is not supported here");
      return;
    }
    try {
      worker = new Worker(workerUrl);
    } catch (_error) {
      fail();
      return;
    }
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "progress") onStatus("loading", data.message || "Loading language model…");
      if (data.type === "ready") onStatus("loading", "Preparing favourites…");
      if (data.type === "configured") {
        ready = true;
        onStatus("ready");
      }
      if (data.type === "result") {
        waiting?.resolve(data);
        waiting = null;
      }
      if (data.type === "error") fail();
    });
    worker.addEventListener("error", fail);
    worker.postMessage({ type: "configure", favourites });
  }

  return {
    start,
    isReady: () => ready,
    isUnavailable: () => unavailable,
    configure(next) {
      favourites = next;
      worker?.postMessage({ type: "configure", favourites });
    },
    // One prompt at a time; resolves the worker's result message.
    complete(prompt) {
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        worker.postMessage({ type: "complete", prompt });
      });
    },
  };
}
