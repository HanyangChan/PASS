// Descriptive overlap across different situations, within the same catalog/history condition.
export function crossContextOverlap(paired) {
  let count = 0, before = 0, after = 0;
  const overlap = (a, b) => {
    const left = new Set(a), right = new Set(b), union = new Set([...left, ...right]);
    return union.size ? [...left].filter(id => right.has(id)).length / union.size : null;
  };
  for (let i = 0; i < paired.length; i++) for (let j = i + 1; j < paired.length; j++) {
    const a = paired[i], b = paired[j];
    if (a.source !== b.source || a.history !== b.history || a.name === b.name) continue;
    const oldOverlap = overlap(a.before, b.before), newOverlap = overlap(a.after, b.after);
    if (oldOverlap === null || newOverlap === null) continue;
    count++; before += oldOverlap; after += newOverlap;
  }
  return { pairs: count, beforeMeanJaccard: count ? before / count : null, afterMeanJaccard: count ? after / count : null };
}
