/**
 * Thin WebSocket client wrapper matching the server's message protocol (see
 * server/src/index.js's own doc comment for the full message list). Uses
 * the browser's native `WebSocket` global directly - no dependency needed,
 * this only ever runs client-side.
 *
 * Two ways to use it:
 *   - request(type, payload, responseType, errorTypes) - send a message,
 *     resolve with the next message of responseType, or reject with the
 *     next message matching one of errorTypes (or on timeout/disconnect).
 *   - on(type, handler) - subscribe to unsolicited broadcasts (game_update,
 *     player_joined, player_disconnected) that aren't a direct response to
 *     something this client sent. Returns an unsubscribe function.
 *
 * Doesn't correlate requests by an id - each request's expected response
 * type is distinct enough for this protocol (a low-frequency, turn-based
 * game, not a high-concurrency RPC system), so the next message of the
 * right type is assumed to be the answer to the most recent matching
 * request. Good enough here; would need real request ids if this protocol
 * ever needs to send two of the same request type concurrently.
 */
export class GameSocket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.listeners = new Map(); // type -> Set<handler>
    this.pending = []; // [{ resolve, reject, matchTypes: Set, errorTypes: Set }]
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", (err) => reject(err), { once: true });
      this.ws.addEventListener("message", (event) => this._handleMessage(event));
      this.ws.addEventListener("close", () => this._handleClose());
    });
  }

  _handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.errorTypes.has(message.type)) {
        this.pending.splice(i, 1);
        p.reject(message);
      } else if (p.matchTypes.has(message.type)) {
        this.pending.splice(i, 1);
        p.resolve(message);
      }
    }
    const handlers = this.listeners.get(message.type);
    if (handlers) for (const handler of [...handlers]) handler(message);
  }

  _handleClose() {
    for (const p of this.pending) p.reject(new Error("connection closed"));
    this.pending = [];
    const handlers = this.listeners.get("_close");
    if (handlers) for (const handler of [...handlers]) handler();
  }

  send(type, payload = {}) {
    this.ws.send(JSON.stringify({ type, ...payload }));
  }

  request(type, payload, responseType, errorTypes = [], timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const entry = { matchTypes: new Set([responseType]), errorTypes: new Set(errorTypes) };
      const timer = setTimeout(() => {
        const idx = this.pending.indexOf(entry);
        if (idx !== -1) this.pending.splice(idx, 1);
        reject(new Error(`timeout waiting for ${responseType}`));
      }, timeoutMs);
      entry.resolve = (msg) => {
        clearTimeout(timer);
        resolve(msg);
      };
      entry.reject = (msg) => {
        clearTimeout(timer);
        reject(msg);
      };
      this.pending.push(entry);
      this.send(type, payload);
    });
  }

  /** Subscribe to a broadcast message type (or the synthetic "_close" type
   * for disconnect notification). Returns an unsubscribe function. */
  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  close() {
    this.ws?.close();
  }
}
