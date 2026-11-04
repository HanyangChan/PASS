// P3 orchestrator (TRD §4). One turn: load the session from the DB -> branch on intent -> ① -> ② ③ -> merge ->
// baseline runTurn(kind:'patch') -> CAS save -> cards -> explanations (template until P5) / memory_prompt.
// Ranking, amounts and budget checks come only from the common runTurn; nothing here sorts or scores (K1).
// The client never sends the session: state and meta are always read from the store.
import { runTurn, createSession, BaselineError } from '../../../src/index.mjs';
import { createDialogue, FALLBACK_QUESTION } from '../dialogue/agent.mjs';
import { loadMemory, findRecipient } from '../memory/read.mjs';
import { createMemoryWriter } from '../memory/write.mjs';
import { MemoryError, keyLabel, parseKey, CATEGORY_KO } from '../memory/keys.mjs';
import { StoreError } from '../db/contract.mjs';
import { createHobbyMapper } from '../rag/agent.mjs';
import { templateExplanations, wonShort } from '../explainer/template.mjs';
import { buildFactsheet, planValueLadder, shiftSensitivity } from '../planner/index.mjs';
import { SENSITIVITIES } from '../db/contract.mjs';
import { mergeConditions } from './merge.mjs';
import { dropMemories } from './provenance.mjs';
import { memoryBanner, giftHistoryHit } from './banner.mjs';
import { resolveRecipients, linkCandidates, materialize, isNewRecipientId } from './recipients.mjs';

export const REQUEST_KINDS = ['message', 'patch', 'view', 'what_if_budget', 'ladder_pick', 'feedback', 'memory_edit', 'memory_confirm', 'end_session'];
export const EXPERIMENTS = ['A', 'B'];
const FEEDBACK_ACTIONS = ['chosen', 'dismissed', 'purchased', 'satisfaction'];
const EDIT_OPS = ['delete', 'update', 'resolve_conflict', 'accept_suggested', 'sensitivity'];
const SENSITIVITY_TEXT = { value: '가성비 위주로 기억할까요?', balanced: '균형 있게 고르는 걸로 기억할까요?', quality: '품질 우선으로 기억할까요?' };
const REMEMBER_TEXT = '다음에도 기억할까요?';
const SATISFACTION_TEXT = '지난번 선물은 마음에 들어하셨나요?';
const DISMISS_TEXT = '이 상품만 뺄까요, 이런 종류 모두 뺄까요?';
const DISMISS_SCOPES = ['product', 'category'];
const DISMISS_CHIPS = [{ label: '이 상품만', scope: 'product' }, { label: '이런 종류 모두', scope: 'category' }];
const suggestedPrompt = p => ({ ...p, kind: 'suggested', candidates: p.candidates.map(({ memoryId, label }) => ({ memoryId, label })) });

export const defaultMeta = () => ({
  recipientIds: [], sensitivity: 'balanced', experiment: 'B', provenance: {},
  pendingCandidates: [], pendingGifts: [], pendingPrompt: null, pendingDismissals: [], ladderStreak: null, pendingSensitivity: null, conflicts: [], satisfactionAsked: false, ended: false,
});

const invalid = () => new BaselineError('invalid_request');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const sameCandidate = (a, b) => a.recipientId === b.recipientId && a.key === b.key && a.polarity === b.polarity;
const addCandidates = (list, more) => { const out = [...list]; for (const c of more) if (!out.some(x => sameCandidate(x, c))) out.push(c); return out; };
const MERGED_FIELDS = ['preferences', 'excluded_categories', 'excluded_ingredients', 'packaging'];
const isKnownError = e => e instanceof BaselineError || e instanceof StoreError || e instanceof MemoryError;

/**
 * @param {object} deps
 * @param {object} deps.store       db/store.mjs or db/memory-store.mjs
 * @param {object[]} deps.products  engine products
 * @param {object|null} [deps.llm]  llm/ adapter (null = rules and templates only)
 * @param {Function|null} [deps.explain]  ④ explainer (P5). Any failure falls back to template tags (AC3)
 * @param {() => string} [deps.now]
 */
export function createOrchestrator({ store, products, llm = null, explain = null, now = () => new Date().toISOString(),
  dialogue = createDialogue({ llm }), hobbyMapper = createHobbyMapper({ llm }), writer = createMemoryWriter({ store }) }) {
  if (!store || !Array.isArray(products)) throw new TypeError('store and products are required');
  const realIds = ids => ids.filter(id => !isNewRecipientId(id));
  const setCost = id => { const p = products.find(x => x.id === id); return p ? p.price_krw + p.shipping_fee_per_set_krw : Infinity; };

  /**
   * 2단계 (TRD §4-7): planner -> Factsheet -> ④ (P5) -> template fallback. Never throws (AC3).
   * Condition A gets a factsheet without contrast/memoryCf/valueLadder; the cards are the same in A and B (AC12).
   */
  async function explainCards({ session, cards, state, provenance, memory, experiment, sensitivity = 'balanced', budgetCap = null }) {
    let factsheet = null;
    try { factsheet = await buildFactsheet({ session, cards, products, state, provenance, memory, experiment, sensitivity, budgetCap, now: now() }); } catch { factsheet = null; }
    const template = () => ({ ...templateExplanations({ cards, products, state, factsheet }), source: 'template' });
    if (!explain || !cards.length || !factsheet) return template();
    try {
      const out = await explain({ cards, products, state, factsheet, experiment });
      if (!out || !Array.isArray(out.items)) return template();
      return { items: out.items, source: 'llm' };
    } catch { return template(); }
  }

  /** Smallest budget cap among the people of this turn; null = none (R3: used only to block "올리기" and to ask). */
  async function budgetCapOf(ownerId, ids) {
    const caps = [];
    for (const id of ids) { const r = await store.getRecipient(ownerId, id); if (r?.budgetCapKrw) caps.push(r.budgetCapKrw); }
    return caps.length ? Math.min(...caps) : null;
  }

  async function recipientChoices(ownerId, state, ids) {
    if (ids.length < 2 || state.recipients.length !== 1) return null;
    const r = await findRecipient(store, ownerId, state.recipients[0]);
    return r.status === 'ambiguous' ? r.chips : null;
  }

  async function satisfactionPrompt(ctx, ids) {
    if (ctx.meta.satisfactionAsked || !ids.length) return null;
    ctx.meta.satisfactionAsked = true; // once per session, at the first turn that knows the person (rule 6)
    for (const id of ids) {
      const gift = (await writer.pendingSatisfaction(ctx.ownerId, id))[0];
      if (gift) {
        const name = products.find(p => p.id === gift.productId)?.name ?? null;
        return { type: 'memory_prompt', kind: 'satisfaction', giftId: gift.id, productId: gift.productId, productName: name, text: SATISFACTION_TEXT };
      }
    }
    return null;
  }

  /**
   * propose() writes nothing; the answer comes back as memory_confirm (AC4). Purchases for a person who has no row
   * yet (first session) wait here too: declining stores neither the memories nor the new person.
   */
  async function rememberPrompt(ctx) {
    const { meta } = ctx;
    if (!meta.pendingCandidates.length && !meta.pendingGifts.length) return null;
    const accepted = meta.pendingCandidates.length ? (await writer.propose(ctx.ownerId, meta.pendingCandidates)).accepted : [];
    if (!accepted.length && !meta.pendingGifts.length) { meta.pendingPrompt = null; return null; }
    meta.pendingPrompt = { candidates: accepted, gifts: [...meta.pendingGifts] };
    const nameOf = id => (isNewRecipientId(id) ? id.slice(4) : null);
    return {
      type: 'memory_prompt', kind: 'remember', text: REMEMBER_TEXT,
      candidates: accepted.map((c, index) => ({ index, recipientName: c.recipientName, label: keyLabel(c.key), evidence: c.evidence })),
      gifts: meta.pendingGifts.map(g => ({ recipientName: nameOf(g.recipientId), productId: g.productId, productName: products.find(p => p.id === g.productId)?.name ?? null, occasion: g.occasion })),
    };
  }

  async function save(ctx, session) {
    // A new session row is written only by a turn that saves (an uninterpretable first message leaves no row, AC2).
    if (ctx.isNew) {
      try { await store.insertSession(ctx.ownerId, session, ctx.meta); } catch (e) {
        if (e instanceof StoreError && e.code === 'session_exists') throw new StoreError((await store.getSession(ctx.ownerId, session.id)) ? 'version_conflict' : 'session_exists');
        throw e;
      }
      ctx.isNew = false;
      return;
    }
    await store.saveSession(ctx.ownerId, session, ctx.meta, ctx.session.version); // CAS: version_conflict if someone saved first
  }

  /**
   * Send question | cards, then memory prompts, then explanations (AC3: cards always first).
   * R3: with a budget cap, a missing budget is asked with a cap chip, and a budget above the cap is asked instead of
   * shown (never clamped). The same gate covers what_if_budget, so nothing above the cap is ever shown (AC14).
   */
  async function present(ctx, out, { memory, provenance, prompts = [], ids }) {
    const banner = memoryBanner(memory, provenance);
    const choices = await recipientChoices(ctx.ownerId, out.session.state, ids);
    const cap = await budgetCapOf(ctx.ownerId, ids);
    const capChips = cap ? [{ label: wonShort(cap), amount_krw: cap }] : null;
    const ask = (question, budgetQuestion) => {
      ctx.send({ type: 'question', question, version: out.session.version, banner, recipientChoices: choices, budgetChips: budgetQuestion ? capChips : null });
      for (const p of prompts) ctx.send(p);
    };
    if (out.kind === 'question') return ask(out.question, out.session.state.budget.amount_krw === null);
    const state = out.evaluatedState;
    // K37: the cap is per set with shipping. A per-set budget above it, or a card above it (shipping excluded), is asked.
    const perSet = state.budget.scope === 'total' ? Math.floor(state.budget.amount_krw / (state.quantity || 1)) : state.budget.amount_krw;
    if (cap && (perSet > cap || out.result.cards.some(c => setCost(c.id) > cap))) {
      return ask(`이 분께는 예산 상한 ${wonShort(cap)}(세트당, 배송비 포함)을 정해 두셨어요. 그 안으로 다시 알려주세요.`, true);
    }
    const tags = templateExplanations({ cards: out.result.cards, products, state });
    ctx.send({
      type: out.kind === 'comparison' ? 'comparison' : 'cards', version: out.session.version, result: out.result, banner, recipientChoices: choices,
      annotations: out.result.cards.map(c => ({ id: c.id, tags: tags.items.find(i => i.id === c.id)?.tags ?? [], giftHistory: giftHistoryHit(c.id, memory?.giftHistory, now()) })),
    });
    for (const p of prompts) ctx.send(p);
    if (out.kind === 'comparison') return;
    const ex = await explainCards({ session: out.session, cards: out.result.cards, state, provenance, memory, experiment: ctx.meta.experiment, sensitivity: ctx.meta.sensitivity, budgetCap: cap });
    ctx.send({ type: 'explanations', version: out.session.version, ...ex });
  }

  /** ② memory, ③ mapping, merge, runTurn(patch), save, present. Shared by message and chip turns. */
  async function recommend(ctx, { utterancePatch, candidates = [], confirmedReleases = [], choice, extraPrompts = [], sensitivity }) {
    const { ownerId, session, meta } = ctx;
    if (!object(utterancePatch)) throw invalid();
    const u = structuredClone(utterancePatch);
    let ids = meta.recipientIds;
    // Who the turn is for, in this order: the people named in the sentence/chip, then a host-picked recipientId,
    // then the session's people. The display name and the memory ids always come from the same resolution, so the
    // screen can never show one person while another person's memories apply (K36).
    if (!Object.hasOwn(u, 'recipients') && ctx.recipientId) {
      const r = await store.getRecipient(ownerId, ctx.recipientId);
      if (!r) throw new StoreError('not_found');
      if (!meta.recipientIds.includes(r.id) || !session.state.recipients.length) u.recipients = [r.name];
    }
    // "어머니만" / "두 분 함께" applies to this request only and is never stored (K36)
    if (!Object.hasOwn(u, 'recipients') && choice !== undefined && session.state.recipients.length) u.recipients = [...session.state.recipients];
    if (Array.isArray(u.recipients) && u.recipients.every(x => typeof x === 'string')) {
      const res = await resolveRecipients(store, ownerId, u.recipients, { choice });
      u.recipients = res.display; // R9: ['어머니','아버지'] -> ['부모님']
      ids = res.ids;
    }

    const memory = await loadMemory(store, ownerId, realIds(ids), { now: now() });
    // ③ one map call (one embedding batch at most) for remembered hobbies and hobbies said in this sentence
    const spoken = candidates.map((c, i) => ({ c, i, k: parseKey(c.key) })).filter(x => x.k?.kind === 'hobby' && x.c.polarity === 1)
      .map(x => ({ memoryId: `utterance-${x.i}`, word: x.k.value }));
    const mapped = await hobbyMapper.map([...memory.hobbies.map(h => ({ memoryId: h.memoryId, word: h.word })), ...spoken]);
    const ragCandidates = mapped.map(r => (r.from.startsWith('memory:utterance-') ? { ...r, from: 'utterance' } : r));

    const merged = mergeConditions({ state: session.state, utterancePatch: u, memory, ragCandidates, previousProvenance: meta.provenance, confirmedReleases });
    const out = await runTurn({ session, request: { kind: 'patch', patch: merged.patch, expectedVersion: session.version }, products });
    const changed = JSON.stringify(out.session.state.recipients) !== JSON.stringify(session.state.recipients);
    // merge owns the list fields and packaging: an empty result there must clear the old record (banner, AC9)
    const kept = { ...meta.provenance, ...merged.provenance };
    for (const f of MERGED_FIELDS) if (!merged.provenance[f]) delete kept[f];
    meta.provenance = changed ? merged.provenance : kept;
    if (JSON.stringify(ids) !== JSON.stringify(meta.recipientIds)) {
      // a new person: start from their remembered sensitivity when all of them agree, else balanced (F4)
      const rows = (await Promise.all(realIds(ids).map(id => store.getRecipient(ownerId, id)))).filter(Boolean);
      const kinds = [...new Set(rows.map(r => r.priceSensitivity))];
      meta.sensitivity = kinds.length === 1 ? kinds[0] : 'balanced';
      // answers that belong to the previous people must not be written to the new ones (review)
      meta.ladderStreak = null; meta.pendingSensitivity = null; meta.pendingDismissals = [];
    }
    if (sensitivity !== undefined) { meta.sensitivity = sensitivity; meta.ladderStreak = null; } // the chip wins over the person's default
    meta.recipientIds = ids;

    const prompts = [...extraPrompts];
    const linked = await linkCandidates(store, ownerId, candidates);
    if (linked.length) {
      const r = await writer.propose(ownerId, linked);
      for (const c of r.conflicts) {
        meta.conflicts = [...meta.conflicts.filter(x => x.existingId !== c.existing.id), { existingId: c.existing.id, candidate: c.candidate }];
        prompts.push({ type: 'memory_prompt', kind: c.prompt?.kind ?? 'memory_conflict', memoryId: c.existing.id, label: keyLabel(c.existing.key), text: c.question });
      }
      meta.pendingCandidates = addCandidates(meta.pendingCandidates, r.accepted);
    }
    for (const q of merged.questions) prompts.push({ type: 'memory_prompt', kind: q.type, ingredients: q.ingredients, memoryIds: q.memoryIds ?? [], text: q.text });
    const sat = await satisfactionPrompt(ctx, realIds(ids));
    if (sat) prompts.push(sat);

    await save(ctx, out.session);
    await present(ctx, out, { memory, provenance: meta.provenance, prompts, ids: realIds(ids) });
  }

  /** After a memory write: drop what the removed memories contributed (AC9), re-run, save, present. */
  async function refresh(ctx, { removedMemoryIds = [], prompts = [] } = {}) {
    const { ownerId, session, meta } = ctx;
    let out;
    if (removedMemoryIds.length) {
      const d = dropMemories(session.state, meta.provenance, removedMemoryIds);
      meta.provenance = d.provenance;
      out = await runTurn({ session, request: { kind: Object.keys(d.patch).length ? 'patch' : 'view', patch: d.patch, expectedVersion: session.version }, products });
    } else {
      out = await runTurn({ session, request: { kind: 'view', expectedVersion: session.version }, products });
    }
    await save(ctx, out.session);
    const memory = await loadMemory(store, ownerId, realIds(meta.recipientIds), { now: now() });
    await present(ctx, out, { memory, provenance: meta.provenance, prompts, ids: realIds(meta.recipientIds) });
  }

  const handlers = {
    async message(ctx, request) {
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 4000) throw invalid();
      const d = await dialogue.interpret({ text: request.text, state: structuredClone(ctx.session.state) });
      // AC2: nothing is saved; exactly one question
      if (d.unresolved) { ctx.send({ type: 'question', question: d.questions[0] || FALLBACK_QUESTION, version: ctx.session.version, banner: null, recipientChoices: null }); return; }
      await recommend(ctx, { utterancePatch: d.patch, candidates: d.memoryCandidates ?? [], choice: request.recipientChoice });
    },
    async patch(ctx, request) {
      const releases = request.confirmedReleases ?? [];
      if (!Array.isArray(releases) || !releases.every(x => typeof x === 'string')) throw invalid();
      // 가성비 / 균형 / 품질 우선 chip: this session only (stored for the person only via the sensitivity prompt). B only.
      if (request.sensitivity !== undefined && (!SENSITIVITIES.includes(request.sensitivity) || ctx.meta.experiment !== 'B')) throw invalid();
      await recommend(ctx, { utterancePatch: request.patch, confirmedReleases: releases, choice: request.recipientChoice, sensitivity: request.sensitivity });
    },
    async view(ctx) {
      const out = await runTurn({ session: ctx.session, request: { kind: 'view', expectedVersion: ctx.session.version }, products });
      const ids = realIds(ctx.meta.recipientIds);
      const memory = await loadMemory(store, ctx.ownerId, ids, { now: now() });
      await present(ctx, out, { memory, provenance: ctx.meta.provenance, ids });
    },
    async what_if_budget(ctx, request) {
      // Session never changes (AC15); P4 puts the planner here.
      const out = await runTurn({ session: ctx.session, request: { kind: 'what_if_budget', amount_krw: request.amount_krw, expectedVersion: ctx.session.version }, products });
      const ids = realIds(ctx.meta.recipientIds);
      await present(ctx, out, { memory: await loadMemory(store, ctx.ownerId, ids, { now: now() }), provenance: ctx.meta.provenance, ids });
    },
    /**
     * AC15: a price option chip. The amount is recomputed here from the saved session (the client sends only the
     * direction), so it is the same option the explanations showed for this version. Only now does the budget change.
     */
    async ladder_pick(ctx, request) {
      const { session, meta, ownerId } = ctx;
      if (!['up', 'down'].includes(request.direction) || meta.experiment !== 'B') throw invalid(); // A has no price options (AC12)
      const view = await runTurn({ session, request: { kind: 'view', expectedVersion: session.version }, products });
      if (view.kind !== 'recommendation' || !view.result.cards.length) throw invalid();
      const ids = realIds(meta.recipientIds);
      const ladder = await planValueLadder({ session, state: view.evaluatedState, products, cards: view.result.cards, sensitivity: meta.sensitivity, budgetCap: await budgetCapOf(ownerId, ids) });
      const option = ladder[request.direction][0];
      if (!option) throw invalid();
      // F4: each pick moves the session sensitivity one step; two picks in a row the same way for the same people ask once
      meta.sensitivity = shiftSensitivity(meta.sensitivity, request.direction);
      const who = JSON.stringify(meta.recipientIds);
      const streak = meta.ladderStreak?.direction === request.direction && meta.ladderStreak.who === who ? meta.ladderStreak.count + 1 : 1;
      meta.ladderStreak = { direction: request.direction, who, count: streak };
      const extraPrompts = [];
      if (streak >= 2 && ids.length) {
        meta.pendingSensitivity = meta.sensitivity;
        meta.ladderStreak = null;
        extraPrompts.push({ type: 'memory_prompt', kind: 'sensitivity', sensitivity: meta.sensitivity, text: SENSITIVITY_TEXT[meta.sensitivity] });
      }
      await recommend(ctx, { utterancePatch: { budget: { amount_krw: option.amount_krw } }, extraPrompts });
    },
    async feedback(ctx, request) {
      const { ownerId, meta, session } = ctx;
      if (!FEEDBACK_ACTIONS.includes(request.action)) throw invalid();
      const prompts = [];
      if (request.action === 'satisfaction') {
        if (typeof request.giftId !== 'string') throw invalid();
        await writer.rateGift(ownerId, request.giftId, request.satisfaction);
      } else {
        const product = products.find(p => p.id === request.productId);
        if (!product || !meta.recipientIds.length) throw invalid();
        if (request.action === 'dismissed') {
          // K28: a dismissal is first asked about ("이 상품만 / 이런 종류 모두"); only "이런 종류 모두" becomes a
          // suggested dislike:category signal. "이 상품만" records nothing (the engine has no per-product exclusion).
          if (request.scope === undefined) {
            if (realIds(meta.recipientIds).length) {
              meta.pendingDismissals = [...meta.pendingDismissals.filter(id => id !== product.id), product.id];
              prompts.push({ type: 'memory_prompt', kind: 'dismiss_scope', productId: product.id, categoryLabel: CATEGORY_KO[product.category] ?? null, text: DISMISS_TEXT, chips: DISMISS_CHIPS });
            }
          } else {
            if (!DISMISS_SCOPES.includes(request.scope) || !meta.pendingDismissals.includes(product.id)) throw invalid();
            meta.pendingDismissals = meta.pendingDismissals.filter(id => id !== product.id);
            if (request.scope === 'category') {
              for (const recipientId of realIds(meta.recipientIds)) {
                const r = await writer.recordFeedback(ownerId, { recipientId, key: `dislike:category:${product.category}`, polarity: -1, sessionId: session.id, productId: product.id });
                if (r.prompt) prompts.push(suggestedPrompt(r.prompt));
              }
            }
          }
          await refresh(ctx, { prompts });
          return;
        }
        for (const recipientId of meta.recipientIds) {
          if (request.action === 'purchased') {
            const gift = { recipientId, productId: product.id, occasion: session.state.occasion, givenAt: now().slice(0, 10) };
            if (isNewRecipientId(recipientId)) meta.pendingGifts = [...meta.pendingGifts, gift]; // saved only if the user accepts remembering
            else await writer.recordPurchase(ownerId, gift);
            continue;
          }
          if (isNewRecipientId(recipientId)) continue; // feedback signals need a person row
          // 찜 = this category is liked; only suggested until confirmed (TRD §5.3-3, K28)
          const r = await writer.recordFeedback(ownerId, { recipientId, key: `pref:category:${product.category}`, polarity: 1, sessionId: session.id, productId: product.id });
          if (r.prompt) prompts.push(suggestedPrompt(r.prompt));
        }
        const p = await rememberPrompt(ctx); if (p) prompts.push(p); // R8: also on selection
      }
      await refresh(ctx, { prompts });
    },
    async memory_edit(ctx, request) {
      const { ownerId, meta } = ctx;
      if (!EDIT_OPS.includes(request.op)) throw invalid();
      const removed = [];
      if (request.op === 'delete') {
        if (await writer.remove(ownerId, request.memoryId)) removed.push(request.memoryId);
        else throw new MemoryError('not_found');
      } else if (request.op === 'update') {
        if (!object(request.patch)) throw invalid();
        await writer.edit(ownerId, request.memoryId, request.patch);
      } else if (request.op === 'resolve_conflict') {
        const r = await writer.resolveConflict(ownerId, { existingId: request.memoryId, accept: request.accept });
        const entry = meta.conflicts.find(x => x.existingId === request.memoryId);
        meta.conflicts = meta.conflicts.filter(x => x.existingId !== request.memoryId);
        if (r.changed) {
          removed.push(request.memoryId);
          if (entry) meta.pendingCandidates = addCandidates(meta.pendingCandidates, [entry.candidate]); // asked again at session end
        }
      } else if (request.op === 'sensitivity') {
        // answer to "가성비 위주로 기억할까요?": the value comes from the session, never from the client
        if (typeof request.accept !== 'boolean' || !meta.pendingSensitivity) throw invalid();
        if (request.accept) for (const id of realIds(meta.recipientIds)) await store.updateRecipient(ownerId, id, { priceSensitivity: meta.pendingSensitivity });
        meta.pendingSensitivity = null;
      } else {
        if (!Array.isArray(request.memoryIds)) throw invalid();
        await writer.acceptSuggested(ownerId, request.memoryIds);
      }
      await refresh(ctx, { removedMemoryIds: removed });
    },
    async memory_confirm(ctx, request) {
      const { ownerId, meta } = ctx;
      const pending = meta.pendingPrompt;
      if (!object(pending) || typeof request.accept !== 'boolean') throw invalid();
      if (request.indexes !== undefined && (!Array.isArray(request.indexes) || !request.indexes.every(Number.isSafeInteger))) throw invalid();
      let saved = [], gifts = [];
      if (request.accept) {
        const pick = request.indexes === undefined ? pending.candidates : pending.candidates.filter((_, i) => request.indexes.includes(i));
        const real = await materialize(store, ownerId, [...pick, ...pending.gifts]);
        saved = (await writer.confirm(ownerId, real.slice(0, pick.length))).saved;
        for (const g of real.slice(pick.length)) gifts.push(await writer.recordPurchase(ownerId, g));
        // placeholders of this session now point at the rows just created
        const rows = await store.listRecipients(ownerId);
        meta.recipientIds = meta.recipientIds.map(id => (isNewRecipientId(id) ? rows.find(r => r.name === id.slice(4))?.id ?? id : id));
      }
      // Declining (or not picking) stores nothing (AC4). Either way the question is answered.
      meta.pendingCandidates = meta.pendingCandidates.filter(c => !pending.candidates.some(p => sameCandidate(p, c)));
      meta.pendingGifts = [];
      meta.pendingPrompt = null;
      await save(ctx, ctx.session);
      ctx.send({ type: 'memory_saved', saved: saved.map(m => ({ id: m.id, recipientId: m.recipientId, label: keyLabel(m.key) })), gifts: gifts.length });
    },
    async end_session(ctx) {
      ctx.meta.ended = true;
      const p = await rememberPrompt(ctx);
      await save(ctx, ctx.session);
      if (p) ctx.send(p);
      ctx.send({ type: 'session_end' });
    },
  };

  /**
   * runPipelineTurn({ownerId, sessionId, recipientId?, request, experiment?, emit?}) -> {events}
   * Events: question | cards -> memory_prompt* -> explanations | comparison | memory_saved | session_end | error
   */
  async function runPipelineTurn({ ownerId, sessionId, recipientId, request, experiment, emit }) {
    const events = [];
    const send = e => { events.push(e); emit?.(e); };
    try {
      if (!object(request) || !REQUEST_KINDS.includes(request.kind)) throw invalid();
      if (experiment !== undefined && !EXPERIMENTS.includes(experiment)) throw invalid();
      const row = await store.getSession(ownerId, sessionId) ?? { session: createSession(sessionId), meta: defaultMeta(), isNew: true };
      const ctx = { ownerId, recipientId, session: row.session, meta: { ...defaultMeta(), ...row.meta }, send, isNew: row.isNew === true };
      if (request.expectedVersion !== undefined && request.expectedVersion !== ctx.session.version) throw new BaselineError('version_conflict');
      if (experiment !== undefined) ctx.meta.experiment = experiment;
      await handlers[request.kind](ctx, request);
    } catch (e) {
      if (!isKnownError(e)) throw e;
      send({ type: 'error', code: e.code });
    }
    return { events };
  }

  return { runPipelineTurn, explainCards };
}
