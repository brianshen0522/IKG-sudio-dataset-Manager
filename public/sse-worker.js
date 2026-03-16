/**
 * Shared Worker — SSE connection sharing across tabs.
 * One EventSource per URL, shared across every tab from the same origin.
 * Each tab communicates via its own MessagePort.
 *
 * Last-message cache: when a new port joins an already-live connection,
 * it immediately receives the most recent payload for each event so the
 * tab doesn't wait for the next server push to render.
 */

// url -> { source: EventSource, ports: Set<MessagePort>, listeners: Set<string>, lastMessages: Map<eventName, data> }
const connections = new Map();

self.onconnect = function (e) {
  const port = e.ports[0];
  port.start();

  port.onmessage = function (evt) {
    const { type, url, events } = evt.data;
    if (type === 'subscribe') {
      subscribe(url, events || [], port);
    } else if (type === 'unsubscribe') {
      unsubscribe(url, port);
    }
  };
};

function subscribe(url, eventNames, port) {
  let conn = connections.get(url);
  if (!conn) {
    conn = createConnection(url);
  }

  const isNewPort = !conn.ports.has(port);
  conn.ports.add(port);

  // Register any new named event listeners on the EventSource
  for (const name of eventNames) {
    if (!conn.listeners.has(name)) {
      conn.listeners.add(name);
      conn.source.addEventListener(name, function (ev) {
        conn.lastMessages.set(name, ev.data);
        broadcastToAll(url, name, ev.data);
      });
    }
  }

  // Replay cached messages to this port so it doesn't wait for the next push
  if (isNewPort) {
    for (const [event, data] of conn.lastMessages) {
      if (eventNames.includes(event)) {
        try { port.postMessage({ url, event, data }); } catch {}
      }
    }
  }
}

function unsubscribe(url, port) {
  const conn = connections.get(url);
  if (!conn) return;
  conn.ports.delete(port);
  if (conn.ports.size === 0) {
    conn.source.close();
    connections.delete(url);
  }
}

function createConnection(url) {
  const source = new EventSource(url, { withCredentials: true });
  const conn = { source, ports: new Set(), listeners: new Set(), lastMessages: new Map() };
  connections.set(url, conn);

  source.onerror = function () {
    broadcastToAll(url, 'error', '');
  };

  return conn;
}

function broadcastToAll(url, event, data) {
  const conn = connections.get(url);
  if (!conn) return;
  const deadPorts = [];
  for (const port of conn.ports) {
    try {
      port.postMessage({ url, event, data });
    } catch {
      deadPorts.push(port);
    }
  }
  for (const p of deadPorts) conn.ports.delete(p);
  if (conn.ports.size === 0) {
    conn.source.close();
    connections.delete(url);
  }
}
