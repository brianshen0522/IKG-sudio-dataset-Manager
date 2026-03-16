/**
 * Client-side SSE helper using a SharedWorker.
 *
 * All tabs share ONE EventSource per URL through the worker.
 * Falls back to a regular EventSource if SharedWorker is unavailable,
 * but still deduplicates connections — only ONE EventSource per URL per tab.
 *
 * Usage:
 *   const unsub = subscribeSSE('/api/datasets/stream', {
 *     datasets: (e) => handleData(JSON.parse(e.data)),
 *     error:    ()  => setLoading(false),
 *   });
 *   // call unsub() to stop listening (React useEffect cleanup)
 */

// ── SharedWorker singleton ─────────────────────────────────────────────────
let _worker = null;
let _workerFailed = false;

// url -> { count: number, handlers: Set<fn>, eventNames: Set<string> }
const _subscriptions = new Map();

function getWorker() {
  if (_workerFailed) return null;
  if (_worker) return _worker;
  if (typeof SharedWorker === 'undefined') { _workerFailed = true; return null; }
  try {
    _worker = new SharedWorker('/sse-worker.js');
    _worker.port.start();
    _worker.port.onmessage = function (e) {
      const { url, event, data } = e.data;
      const sub = _subscriptions.get(url);
      if (!sub) return;
      for (const handler of sub.handlers) {
        handler(event, data);
      }
    };
    _worker.onerror = function () {
      _workerFailed = true;
      _worker = null;
    };
    return _worker;
  } catch {
    _workerFailed = true;
    return null;
  }
}

// ── Fallback EventSource pool (one per URL per tab) ───────────────────────
// url -> { source: EventSource, count: number }
// Each subscribeSSE call adds its own event listeners directly on the shared source.
const _fallbackPool = new Map();

function fallbackSubscribe(url, eventHandlers) {
  let entry = _fallbackPool.get(url);
  if (!entry) {
    entry = { source: new EventSource(url), count: 0 };
    _fallbackPool.set(url, entry);
  }
  entry.count++;

  // Add named listeners directly on the shared source.
  // Keep a local list so we can remove exactly these on cleanup.
  const attached = [];
  for (const [event, handler] of Object.entries(eventHandlers)) {
    const listener = (e) => handler({ data: e.data });
    entry.source.addEventListener(event, listener);
    attached.push([event, listener]);
  }

  return () => {
    const e = _fallbackPool.get(url);
    if (!e) return;
    for (const [event, listener] of attached) {
      e.source.removeEventListener(event, listener);
    }
    e.count--;
    if (e.count === 0) {
      e.source.close();
      _fallbackPool.delete(url);
    }
  };
}

// ── Public API ─────────────────────────────────────────────────────────────
export function subscribeSSE(url, eventHandlers) {
  if (typeof window === 'undefined') return () => {};

  const w = getWorker();

  if (!w) {
    return fallbackSubscribe(url, eventHandlers);
  }

  // ── SharedWorker path ─────────────────────────────────────────────────
  const eventNames = Object.keys(eventHandlers);

  if (!_subscriptions.has(url)) {
    _subscriptions.set(url, { count: 0, handlers: new Set(), eventNames: new Set() });
  }
  const sub = _subscriptions.get(url);

  const handler = (event, data) => {
    if (eventHandlers[event]) eventHandlers[event]({ data });
  };
  sub.handlers.add(handler);

  const isFirst = sub.count === 0;
  sub.count++;

  const newEvents = eventNames.filter((n) => !sub.eventNames.has(n));
  for (const n of newEvents) sub.eventNames.add(n);

  if (isFirst) {
    w.port.postMessage({ type: 'subscribe', url, events: eventNames });
  } else if (newEvents.length > 0) {
    w.port.postMessage({ type: 'subscribe', url, events: newEvents });
  }

  return () => {
    sub.handlers.delete(handler);
    sub.count--;
    if (sub.count === 0) {
      _subscriptions.delete(url);
      w.port.postMessage({ type: 'unsubscribe', url });
    }
  };
}
