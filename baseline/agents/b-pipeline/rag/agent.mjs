// ③ preference mapping: free hobbies (hobby:<word>) -> category:<c> candidates for `preferences`.
// Deterministic keyword table first; embeddings only for words the table misses. Never produces allergies,
// never ranks. A mapped candidate is still a candidate: merge applies exclusions on top of it (merge.mjs).
import { readFileSync } from 'node:fs';
import { CATEGORIES, CATEGORY_NAMES } from '../../../src/vendor/catalog.mjs';
import { createRagIndex } from './index.mjs';

const MAP_URL = new URL('../config/hobby-map.v1.json', import.meta.url);
const bad = () => Object.assign(new Error('invalid_hobby_map'), { code: 'invalid_hobby_map' });
const norm = s => String(s ?? '').normalize('NFC').trim();

export function loadHobbyMap(raw = JSON.parse(readFileSync(MAP_URL, 'utf8'))) {
  if (!raw || typeof raw !== 'object' || typeof raw.table !== 'object' || raw.table === null) throw bad();
  const table = {};
  for (const [word, cats] of Object.entries(raw.table)) {
    if (!Array.isArray(cats) || !cats.length || !cats.every(c => CATEGORIES.includes(c))) throw bad();
    table[norm(word)] = [...cats];
  }
  const minCosine = raw.minCosine ?? 0.75;
  if (typeof minCosine !== 'number' || minCosine < 0 || minCosine > 1) throw bad();
  return { note: String(raw.note ?? ''), minCosine, table };
}

function tableLookup(table, word) {
  if (table[word]) return table[word];
  // substring match only for 2+ characters, so a one-syllable key like 차 does not grab unrelated words
  const hit = Object.keys(table).find(k => k.length >= 2 && word.length >= 2 && (word.includes(k) || k.includes(word)));
  return hit ? table[hit] : null;
}

/** createHobbyMapper({llm, map}) -> {map(items:[{memoryId, word}]) -> [{field:'preferences', value, from:'memory:<id>'}]} */
export function createHobbyMapper({ llm = null, map = loadHobbyMap(), minCosine = map.minCosine } = {}) {
  let indexPromise = null; // category docs are embedded once per mapper
  const buildIndex = async () => {
    const docs = CATEGORIES.map(c => `${CATEGORY_NAMES[c]} ${c} ${Object.entries(map.table).filter(([, v]) => v.includes(c)).map(([k]) => k).join(' ')}`);
    const vectors = await llm.embed(docs);
    if (!Array.isArray(vectors) || vectors.length !== docs.length) return null;
    return createRagIndex(CATEGORIES.map((id, i) => ({ id, vector: vectors[i] })));
  };

  return {
    async map(items) {
      const out = [], missed = [];
      const push = (item, category) => {
        const value = `category:${category}`, from = `memory:${item.memoryId}`;
        if (!out.some(o => o.value === value && o.from === from)) out.push({ field: 'preferences', value, from });
      };
      for (const item of items) {
        const cats = tableLookup(map.table, norm(item.word));
        if (cats) cats.forEach(c => push(item, c)); else missed.push(item);
      }
      if (missed.length && llm?.canEmbed) {
        try {
          indexPromise ??= buildIndex();
          const index = await indexPromise;
          const vectors = index && await llm.embed(missed.map(m => norm(m.word)));
          if (index && Array.isArray(vectors) && vectors.length === missed.length) {
            missed.forEach((item, i) => { const best = index.search(vectors[i], { minCosine, limit: 1 })[0]; if (best) push(item, best.id); });
          }
        } catch { indexPromise = null; /* embedding is optional: fall back to the table result */ }
      }
      return out;
    },
  };
}
