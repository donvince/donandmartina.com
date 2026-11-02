// Listens for "cart-changed" events on AppSync Events while the page is
// open, so changes made on another device show up without a reload.
//
// Events carry no list contents, only which cart changed and which tab
// changed it; the page reloads the cart through the API. The connection is
// authorised with the visitor's Cognito ID token, and reconnects (with a
// fresh token) whenever it drops. Protocol:
// https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-websocket-protocol.html

import { SignedOutError } from "./errors.js";

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000];
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 300_000;

function base64Url(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// An event's payload may arrive as a JSON string, a list of them, or (if
// published double-encoded) a JSON string of a JSON string.
export function parseEventPayloads(event) {
  const raw = Array.isArray(event) ? event : [event];
  return raw.flatMap((value) => {
    let parsed = value;
    for (let depth = 0; typeof parsed === "string" && depth < 2; depth += 1) {
      try { parsed = JSON.parse(parsed); } catch (_error) { return []; }
    }
    return parsed && typeof parsed === "object" ? [parsed] : [];
  });
}

export function createCartEvents({
  realtime,
  cartId,
  clientId,
  getToken,
  onChange,
  onReconnect = onChange,
  WebSocketImpl = globalThis.WebSocket,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer),
  logger = console,
}) {
  const channel = `/${realtime.namespace}/${cartId}`;
  let socket = null;
  let stopped = true;
  let attempt = 0;
  let subscribedBefore = false;
  let reconnectTimer = null;
  let keepAliveTimer = null;
  let subscriptionId = 0;
  // Debug trace of the streaming connection; filter the console on "[realtime]".
  const debug = (...args) => logger.log?.("[realtime]", ...args);

  function clearTimers() {
    if (reconnectTimer) clearTimer(reconnectTimer);
    if (keepAliveTimer) clearTimer(keepAliveTimer);
    reconnectTimer = null;
    keepAliveTimer = null;
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
    attempt += 1;
    debug(`reconnecting in ${delay}ms (attempt ${attempt})`);
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function drop() {
    const current = socket;
    socket = null;
    if (keepAliveTimer) clearTimer(keepAliveTimer);
    keepAliveTimer = null;
    try { current?.close(); } catch (_error) { /* already closed */ }
  }

  async function connect() {
    if (stopped || socket) return;
    debug("connecting: fetching ID token");
    let token;
    try {
      token = await getToken();
    } catch (error) {
      if (error instanceof SignedOutError) {
        // Nothing to listen with until the visitor signs in again.
        logger.warn("shopping: change events paused: signed out");
        return;
      }
      debug("token fetch failed", error);
      scheduleReconnect();
      return;
    }
    if (stopped || socket) return;
    debug(`opening websocket to ${realtime.realtimeDomain}, channel ${channel}`);

    const authorization = { host: realtime.httpDomain, Authorization: token };
    const ws = new WebSocketImpl(`wss://${realtime.realtimeDomain}/event/realtime`, [
      "aws-appsync-event-ws",
      `header-${base64Url(authorization)}`,
    ]);
    socket = ws;
    let keepAliveTimeout = DEFAULT_KEEPALIVE_TIMEOUT_MS;

    function armKeepAlive() {
      if (keepAliveTimer) clearTimer(keepAliveTimer);
      keepAliveTimer = setTimer(() => {
        logger.warn("shopping: change events went quiet; reconnecting");
        drop();
        scheduleReconnect();
      }, keepAliveTimeout);
    }

    ws.addEventListener("open", () => {
      debug("websocket open; sending connection_init");
      ws.send(JSON.stringify({ type: "connection_init" }));
    });
    ws.addEventListener("message", ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch (_error) {
        debug("ignoring non-JSON message", data);
        return;
      }
      if (message.type !== "ka") debug(`<- ${message.type}`, message);
      switch (message.type) {
        case "connection_ack":
          keepAliveTimeout = message.connectionTimeoutMs || DEFAULT_KEEPALIVE_TIMEOUT_MS;
          armKeepAlive();
          subscriptionId += 1;
          debug(`connection acked (keep-alive timeout ${keepAliveTimeout}ms); subscribing as cart-${subscriptionId}`);
          ws.send(JSON.stringify({ type: "subscribe", id: `cart-${subscriptionId}`, channel, authorization }));
          break;
        case "ka":
          debug("<- ka (keep-alive)");
          armKeepAlive();
          break;
        case "subscribe_success":
          attempt = 0;
          debug(subscribedBefore ? "subscribed again; reloading to catch missed changes" : "subscribed; waiting for events");
          // Anything published while disconnected was missed.
          if (subscribedBefore) onReconnect();
          subscribedBefore = true;
          break;
        case "data":
          for (const event of parseEventPayloads(message.event)) {
            if (event.type !== "cart-changed") debug("ignoring event: not cart-changed", event);
            else if (event.cartId !== cartId) debug(`ignoring event: for cart ${event.cartId}, not ${cartId}`, event);
            else if (event.source === clientId) debug("ignoring event: caused by this tab", event);
            else {
              debug(`cart changed by ${event.source}; reloading`, event);
              onChange();
            }
          }
          break;
        case "subscribe_error":
        case "connection_error":
        case "error":
          logger.warn("shopping: change events error", message.errors || message);
          drop();
          scheduleReconnect();
          break;
        default:
          break;
      }
    });
    ws.addEventListener("close", ({ code, reason } = {}) => {
      debug(`websocket closed (code ${code}${reason ? `, ${reason}` : ""})${socket === ws ? "" : " after being dropped"}`);
      if (socket !== ws) return;
      socket = null;
      if (keepAliveTimer) clearTimer(keepAliveTimer);
      keepAliveTimer = null;
      scheduleReconnect();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      debug(`starting; this tab is ${clientId}`);
      connect();
    },
    stop() {
      stopped = true;
      debug("stopping");
      clearTimers();
      drop();
    },
    // Reconnect straight away if disconnected (e.g. the network came back).
    nudge() {
      if (stopped || socket) return;
      debug("nudged; reconnecting now");
      if (reconnectTimer) clearTimer(reconnectTimer);
      reconnectTimer = null;
      attempt = 0;
      connect();
    },
  };
}
