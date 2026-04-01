import { EventEmitter } from 'events';

const EVENTS_KEY = Symbol.for('ikgstudio.live-updates');

function getEmitter() {
  if (!globalThis[EVENTS_KEY]) {
    globalThis[EVENTS_KEY] = new EventEmitter();
    globalThis[EVENTS_KEY].setMaxListeners(100);
  }
  return globalThis[EVENTS_KEY];
}

export function emitDatasetUpdated(datasetId) {
  const emitter = getEmitter();
  emitter.emit('datasets:changed');
  emitter.emit(`dataset:${datasetId}:changed`);
}

export function emitUserJobsUpdated(userId) {
  getEmitter().emit(`user:${userId}:jobs-changed`);
}

export function subscribeDatasetUpdates(datasetId, callback) {
  const emitter = getEmitter();
  const handler = () => callback();
  emitter.on('datasets:changed', handler);
  emitter.on(`dataset:${datasetId}:changed`, handler);
  return () => {
    emitter.off('datasets:changed', handler);
    emitter.off(`dataset:${datasetId}:changed`, handler);
  };
}

export function subscribeDatasetsUpdates(callback) {
  const emitter = getEmitter();
  emitter.on('datasets:changed', callback);
  return () => emitter.off('datasets:changed', callback);
}

export function subscribeUserJobsUpdates(userId, callback) {
  const emitter = getEmitter();
  const event = `user:${userId}:jobs-changed`;
  emitter.on(event, callback);
  return () => emitter.off(event, callback);
}
