import { EventEmitter } from 'events';

// In-process event bus for session invalidation.
// Single-instance only — for multi-instance deployments, replace with Redis pub/sub.
const authEvents = new EventEmitter();
authEvents.setMaxListeners(0); // unlimited (one listener per connected user)

export function emitUserInvalidated(userId) {
  authEvents.emit(`invalidate:${userId}`);
}

export function onUserInvalidated(userId, handler) {
  const event = `invalidate:${userId}`;
  authEvents.on(event, handler);
  return () => authEvents.off(event, handler);
}
