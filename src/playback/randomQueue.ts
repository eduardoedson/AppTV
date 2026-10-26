import {PersistedRandomQueue} from '../domain/playback';

const shuffled = (values: string[], random: () => number) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
};

export const createRandomQueue = (
  seriesId: string,
  eligibleIds: string[],
  random: () => number = Math.random,
): PersistedRandomQueue => {
  const unique = [...new Set(eligibleIds)];
  const order = shuffled(unique, random);
  return {
    seriesId,
    eligibleIds: unique,
    currentId: order.shift() ?? null,
    remainingIds: order,
    historyIds: [],
    updatedAt: Date.now(),
  };
};

export const nextRandom = (queue: PersistedRandomQueue, random: () => number = Math.random): PersistedRandomQueue => {
  let remaining = [...queue.remainingIds];
  if (!remaining.length) remaining = shuffled(queue.eligibleIds, random);
  if (remaining.length > 1 && remaining[0] === queue.currentId) {
    [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
  }
  const currentId = remaining.shift() ?? null;
  return {
    ...queue,
    currentId,
    remainingIds: remaining,
    historyIds: queue.currentId ? [...queue.historyIds, queue.currentId] : queue.historyIds,
    updatedAt: Date.now(),
  };
};

export const previousRandom = (queue: PersistedRandomQueue): PersistedRandomQueue => {
  if (!queue.historyIds.length) return queue;
  const history = [...queue.historyIds];
  const previous = history.pop() ?? null;
  return {
    ...queue,
    currentId: previous,
    remainingIds: queue.currentId ? [queue.currentId, ...queue.remainingIds] : queue.remainingIds,
    historyIds: history,
    updatedAt: Date.now(),
  };
};

export const reconcileQueue = (queue: PersistedRandomQueue, eligibleIds: string[]): PersistedRandomQueue => {
  const allowed = new Set(eligibleIds);
  if (eligibleIds.length !== queue.eligibleIds.length || eligibleIds.some(id => !queue.eligibleIds.includes(id))) {
    return createRandomQueue(queue.seriesId, eligibleIds);
  }
  return {
    ...queue,
    currentId: queue.currentId && allowed.has(queue.currentId) ? queue.currentId : null,
    remainingIds: queue.remainingIds.filter(id => allowed.has(id)),
    historyIds: queue.historyIds.filter(id => allowed.has(id)),
  };
};

// Moves the queue forward or back while keeping the user's selection.
// Only episodes that no longer exist in the catalog are removed from the eligible list.
export const stepRandomQueue = (
  queue: PersistedRandomQueue,
  availableIds: string[],
  direction: 1 | -1,
  random: () => number = Math.random,
): PersistedRandomQueue => {
  const available = new Set(availableIds);
  const reconciled = reconcileQueue(queue, queue.eligibleIds.filter(id => available.has(id)));
  return direction === 1 ? nextRandom(reconciled, random) : previousRandom(reconciled);
};

// Makes the queue point at the episode being watched, keeping the current no-repeat cycle.
// Used when random order is turned on while an episode was chosen by hand.
export const queueStartingAt = (
  existing: PersistedRandomQueue | undefined,
  seriesId: string,
  availableIds: string[],
  currentId: string,
  random: () => number = Math.random,
): PersistedRandomQueue => {
  const available = new Set(availableIds);
  const base = existing ? reconcileQueue(existing, existing.eligibleIds.filter(id => available.has(id))) : null;
  if (base && base.eligibleIds.length) {
    if (base.currentId === currentId) return base;
    return {
      ...base,
      currentId,
      remainingIds: base.remainingIds.filter(id => id !== currentId),
      historyIds: base.currentId ? [...base.historyIds, base.currentId] : base.historyIds,
      updatedAt: Date.now(),
    };
  }
  const unique = [...new Set(availableIds)];
  return {
    seriesId,
    eligibleIds: unique,
    currentId,
    remainingIds: shuffled(unique.filter(id => id !== currentId), random),
    historyIds: [],
    updatedAt: Date.now(),
  };
};
