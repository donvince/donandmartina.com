import assert from "node:assert/strict";
import { test } from "node:test";

import { SignedOutError } from "../../static/shopping/model/errors.js";
import { createCartEvents, parseEventPayloads } from "../../static/shopping/model/realtime.js";

const realtime = { httpDomain: "abc.appsync-api.us-east-1.amazonaws.com", realtimeDomain: "abc.appsync-realtime-api.us-east-1.amazonaws.com", namespace: "shopping" };

function harness({ getToken = async () => "id.token.jwt" } = {}) {
  const sockets = [];
  class FakeSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.sent = [];
      this.listeners = {};
      this.closed = false;
      sockets.push(this);
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; }
    emit(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); }
    receive(message) { this.emit("message", { data: JSON.stringify(message) }); }
  }
  const timers = [];
  const changes = [];
  const reconnects = [];
  const events = createCartEvents({
    realtime,
    cartId: "home",
    clientId: "me",
    getToken,
    onChange: () => changes.push("change"),
    onReconnect: () => reconnects.push("reconnect"),
    WebSocketImpl: FakeSocket,
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (timer) => { timer.cleared = true; },
    logger: { warn() {} },
  });
  return { events, sockets, timers, changes, reconnects };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function connected(h) {
  h.events.start();
  await tick();
  const socket = h.sockets.at(-1);
  socket.emit("open");
  socket.receive({ type: "connection_ack", connectionTimeoutMs: 300000 });
  socket.receive({ type: "subscribe_success", id: socket.sent[1].id });
  return socket;
}

test("connects with the Cognito token and subscribes to the cart channel", async () => {
  const h = harness();
  const socket = await connected(h);

  assert.equal(socket.url, `wss://${realtime.realtimeDomain}/event/realtime`);
  assert.equal(socket.protocols[0], "aws-appsync-event-ws");
  const header = socket.protocols[1].replace(/^header-/, "").replace(/-/g, "+").replace(/_/g, "/");
  assert.deepEqual(JSON.parse(atob(header)), { host: realtime.httpDomain, Authorization: "id.token.jwt" });
  assert.deepEqual(socket.sent[0], { type: "connection_init" });
  assert.deepEqual(socket.sent[1], {
    type: "subscribe",
    id: "cart-1",
    channel: "/shopping/home",
    authorization: { host: realtime.httpDomain, Authorization: "id.token.jwt" },
  });
});

test("reports changes made elsewhere, not by this tab", async () => {
  const h = harness();
  const socket = await connected(h);

  socket.receive({ type: "data", id: "cart-1", event: JSON.stringify({ type: "cart-changed", cartId: "home", source: "other" }) });
  socket.receive({ type: "data", id: "cart-1", event: [JSON.stringify({ type: "cart-changed", cartId: "home", source: "me" })] });
  socket.receive({ type: "data", id: "cart-1", event: JSON.stringify({ type: "cart-changed", cartId: "garage", source: "other" }) });

  assert.deepEqual(h.changes, ["change"]);
});

test("reconnects after the socket closes and catches up", async () => {
  const h = harness();
  const first = await connected(h);

  first.emit("close");
  const retry = h.timers.find((timer) => timer.ms === 1000 && !timer.cleared);
  assert.ok(retry, "schedules a reconnect");
  retry.fn();
  await tick();
  const second = h.sockets.at(-1);
  assert.notEqual(second, first);
  second.emit("open");
  second.receive({ type: "connection_ack" });
  second.receive({ type: "subscribe_success", id: "cart-2" });

  assert.deepEqual(h.reconnects, ["reconnect"], "reloads to catch anything missed");
});

test("reconnects when keep-alives stop", async () => {
  const h = harness();
  const socket = await connected(h);
  const keepAlive = h.timers.find((timer) => timer.ms === 300000 && !timer.cleared);

  keepAlive.fn();

  assert.equal(socket.closed, true);
  assert.ok(h.timers.some((timer) => timer.ms === 1000 && !timer.cleared));
});

test("stays quiet when signed out", async () => {
  const h = harness({ getToken: async () => { throw new SignedOutError(); } });
  h.events.start();
  await tick();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.timers.length, 0);
});

test("stop closes the connection for good", async () => {
  const h = harness();
  const socket = await connected(h);
  h.events.stop();
  socket.emit("close");
  assert.equal(socket.closed, true);
  assert.ok(h.timers.every((timer) => timer.cleared || timer.ms === 300000));
});

test("parseEventPayloads copes with each encoding", () => {
  const event = { type: "cart-changed" };
  assert.deepEqual(parseEventPayloads(JSON.stringify(event)), [event]);
  assert.deepEqual(parseEventPayloads([JSON.stringify(event)]), [event]);
  assert.deepEqual(parseEventPayloads(JSON.stringify(JSON.stringify(event))), [event]);
  assert.deepEqual(parseEventPayloads("not json"), []);
});
