import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { unseenDialogues } from '../tests/fixtures/unseen-dialogues-2026-11-16.mjs';
import { freshDialogues } from '../tests/fixtures/fresh-dialogues-2026-11-16.mjs';
import { SCENARIOS } from '../tests/scenarios/scenarios.mjs';
import { runners } from '../tests/scenarios/recommend-eval.mjs';
import { products } from '../tests/fixtures/context-feedback.mjs';

const fresh=process.argv.includes('--fresh');
const dataset=fresh?freshDialogues:unseenDialogues;
const group = fresh?'fresh':process.argv.includes('--reserved') ? 'reserved' : 'diagnostic';
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) ?? 'before';
const output = new URL('../work/unseen-evaluation/', import.meta.url);
await mkdir(output, { recursive: true });
// Git may check out CRLF on Windows; line endings do not change frozen labels.
const datasetText = await readFile(new URL(`../tests/fixtures/${fresh?'fresh':'unseen'}-dialogues-2026-11-16.mjs`, import.meta.url), 'utf8');
const datasetHash = createHash('sha256').update(datasetText.replace(/\r\n/g, '\n')).digest('hex');
const frozen=fresh?'frozen-fresh.json':'frozen.json';
const before = await readFile(new URL(frozen, output), 'utf8').catch(() => null);
if (before) assert.equal(JSON.parse(before).datasetHash, datasetHash, 'Frozen labels changed');
else await writeFile(new URL(frozen, output), JSON.stringify({ datasetHash, frozenBeforeFirstRun: new Date().toISOString(), cases: dataset.length, priorCases: SCENARIOS.length }, null, 2));
for (const c of dataset) assert.ok(!SCENARIOS.some(old => JSON.stringify(old.say) === JSON.stringify(c.say)), `Existing dialogue: ${c.id}`);
const { guestRun, serverRun } = runners(products), rows = [];
const equalSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
for (const task of dataset.filter(c => c.group === group)) {
  for (const [path, run] of [['guest', guestRun], ['server', serverRun]]) {
    const actual = await run(task.say), errors = [], expected = task.expect, state = actual.state;
    if (actual.error || !state) errors.push(actual.error ?? 'no_state');
    else {
      for (const [key, field] of [['recipients', 'recipients'], ['prefs', 'preferences'], ['exCat', 'excluded_categories'], ['exIng', 'excluded_ingredients']])
        if (expected[key] && !equalSet(expected[key], state[field])) errors.push(`${field}: ${JSON.stringify(state[field])}`);
      if (expected.recipientContains && !state.recipients.some(r => r.includes(expected.recipientContains))) errors.push(`recipient_missing: ${expected.recipientContains}`);
      if (expected.prefsInclude?.some(p => !state.preferences.includes(p))) errors.push(`preferences_missing: ${JSON.stringify(state.preferences)}`);
      if (Object.hasOwn(expected, 'budget') && expected.budget !== state.budget.amount_krw) errors.push(`budget: ${state.budget.amount_krw}`);
      if (Object.hasOwn(expected, 'shipping') && expected.shipping !== state.budget.shipping_included) errors.push(`shipping: ${state.budget.shipping_included}`);
      if (Object.hasOwn(expected, 'occasion') && expected.occasion !== state.occasion) errors.push(`occasion: ${state.occasion}`);
      if (Object.hasOwn(expected, 'delivery') && expected.delivery !== state.delivery_by) errors.push(`delivery: ${state.delivery_by}`);
      if (Object.hasOwn(expected, 'asks') && expected.asks !== Boolean(actual.question?.key)) errors.push(`question: ${actual.question?.text}`);
      if (!actual.question?.key && expected.forbidsName && actual.items.some(p => new RegExp(expected.forbidsName, 'i').test(p.name))) errors.push('forbidden_product');
    }
    rows.push({ id: task.id, path, say: task.say, expected, actual, errors });
    console.log(JSON.stringify({ id: task.id, path, errors }));
  }
}
const summary = { group, label, datasetHash, executions: rows.length, passed: rows.filter(r => !r.errors.length).length, failed: rows.filter(r => r.errors.length).length,
  note: 'Newly worded internal evaluation, same author as implementation. Reserved group is not an independently authored benchmark.' };
await writeFile(new URL(`${group}-${label}.json`, output), JSON.stringify({ summary, rows }, null, 2) + '\n');
console.log(JSON.stringify(summary));
if (summary.failed) process.exitCode = 1;
