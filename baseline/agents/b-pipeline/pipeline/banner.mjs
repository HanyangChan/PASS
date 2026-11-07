// User-facing lines derived from memory: the "반영 한 줄" banner and the gift-history mark on a card (PRD F2, AC5).
// Display only: nothing here changes conditions or ranking.

const memorySources = sources => sources.filter(s => s.startsWith('memory:')).map(s => s.slice(7));

/** Memory ids that actually shaped this turn's conditions (a memory the user removed this session is not listed). */
export function appliedMemoryIds(provenance) {
  const ids = new Set();
  for (const entries of Object.values(provenance ?? {})) for (const e of entries ?? []) for (const id of memorySources(e.sources ?? [])) ids.add(id);
  return ids;
}

/**
 * "지난 추석 기억을 반영했어요: 단 음식 X · 땅콩 제외 · 등산"
 * @returns {{text, items:[{memoryId,label,evidence}], editable:true}|null}  null when no memory was applied
 */
export function memoryBanner(memory, provenance) {
  const applied = appliedMemoryIds(provenance);
  const items = (memory?.items ?? []).filter(i => applied.has(i.memoryId));
  const labels = [...new Set(items.map(i => i.label).filter(Boolean))];
  if (!labels.length) return null;
  const gifts = (memory?.giftHistory ?? []).filter(g => g.occasion).sort((a, b) => String(b.givenAt ?? '').localeCompare(String(a.givenAt ?? '')));
  const when = gifts.length ? `지난 ${gifts[0].occasion} 기억` : '지난 기억';
  return {
    text: `${when}을 반영했어요: ${labels.join(' · ')}`,
    items: items.map(i => ({ memoryId: i.memoryId, label: i.label, evidence: i.evidence })),
    editable: true,
  };
}

const yearOf = s => (typeof s === 'string' && /^\d{4}/.test(s) ? Number(s.slice(0, 4)) : null);

/** "작년 추석에 드린 선물" for a card whose product was given before. Rank is never changed (D1). */
export function giftHistoryHit(productId, giftHistory, now = new Date().toISOString()) {
  const gifts = (giftHistory ?? []).filter(g => g.productId === productId)
    .sort((a, b) => String(b.givenAt ?? '').localeCompare(String(a.givenAt ?? '')));
  if (!gifts.length) return null;
  const g = gifts[0], year = yearOf(g.givenAt), thisYear = yearOf(now);
  const when = year === null || thisYear === null ? '지난번' : year === thisYear ? '올해' : year === thisYear - 1 ? '작년' : `${year}년`;
  return { giftId: g.id, occasion: g.occasion ?? null, givenAt: g.givenAt ?? null, label: g.occasion ? `${when} ${g.occasion}에 드린 선물` : `${when}에 드린 선물` };
}
