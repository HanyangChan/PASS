import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const modelNames = new Map([
  ['deepseek-v4-flash', { title: 'DeepSeek', name: 'DeepSeek V4 Flash' }],
  ['gpt-5.6-luna', { title: 'GPT-5.6 Luna', name: 'GPT-5.6 Luna' }],
]);

async function readRun(directory) {
  const lines = (await readFile(join(directory, 'runs.jsonl'), 'utf8')).trimEnd().split('\n');
  const meta = JSON.parse(lines.shift());
  const rows = lines.map(line => JSON.parse(line));
  const progress = JSON.parse(await readFile(join(directory, 'progress.json'), 'utf8'));
  assert.equal(progress.signature, meta.signature);
  assert.ok(modelNames.has(meta.model), `unsupported model: ${meta.model}`);
  assert.equal(progress.model, meta.model);
  assert.equal(progress.status, 'complete');
  assert.equal(rows.length, progress.planned);
  return { directory, meta, rows, progress };
}
const { positionals: paths, values } = parseArgs({
  allowPositionals: true,
  options: { 'catalog-dir': { type: 'string' }, output: { type: 'string' } },
});
assert.ok(paths.length, 'provide one or more results directories');
const directory = resolve(values.output ?? paths[0]);
const runs = await Promise.all(paths.map(path => resolve(path)).map(readRun));
const base = runs[0].meta;
const evaluationSet=base.evaluationSet??'regression';
if(evaluationSet==='holdout') {
  const privateData=fileURLToPath(new URL('../../../data/',import.meta.url));
  assert.ok(directory.startsWith(privateData),'holdout report must stay in the ignored data directory');
}
const model = modelNames.get(base.model);
const catalogDir = values['catalog-dir'] ?? base.catalogDir;
const modeMap = {};
const summary = {};
for (const run of runs) {
  for (const field of ['baseline','sourceRevision','scoringVersion','day','model','rates','reasoning','aMode','repetitions','fixtures','ingredientEvidence']) {
    assert.deepEqual(run.meta[field],base[field],field);
  }
  assert.equal(run.meta.catalog.catalog_sha256,base.catalog.catalog_sha256);
  assert.equal(run.meta.evaluationSet??'regression',evaluationSet,'evaluation set');
  for (const [label,agent] of Object.entries(run.meta.modes)) {
    assert.ok(!Object.hasOwn(modeMap,label), `duplicate mode ${label}`);
    modeMap[label]=agent;
    summary[label]=run.progress.summary[label];
  }
}
const meta = {...base,modes:modeMap};
const rows = runs.flatMap(run=>run.rows);
const specById = new Map(meta.fixtures.map(task => [task.id, task]));
const labels = Object.keys(meta.modes).sort();
const unique = new Set();
for (const row of rows) {
  assert.ok(row.repeat >= 1 && row.repeat <= meta.repetitions);
  assert.ok(Object.values(meta.modes).includes(row.agent));
  const task = specById.get(row.task);
  assert.ok(task);
  assert.equal(row.turns.length, task.steps.length);
  assert.equal(row.group, task.group);
  assert.ok(row.turns.every(turn => turn.status !== 200 || turn.invalidApiResponse || turn.agent === row.agent));
  const key = [row.repeat, row.task, row.agent].join('/');
  assert.ok(!unique.has(key), key);
  unique.add(key);
}

const sum = (entries, value) => entries.reduce((total, entry) => total + value(entry), 0);
const count = (entries, test) => entries.filter(test).length;
const rate = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '—';
const usd = amount => amount === null ? '미확정' : '$' + amount.toFixed(6);
const readableCost = (amount, known) => amount === null ? `${usd(known)} (확인분)` : usd(amount);
const latency = (values, p) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.length ? (ordered[Math.ceil(ordered.length * p) - 1] / 1000).toFixed(2) : '—';
};
const fmtLatency = values => [latency(values, .5), latency(values, .95)].join(' / ');
const modes = labels.map(label => {
  const agent = meta.modes[label];
  const selected = rows.filter(row => row.agent === agent);
  assert.equal(selected.length,meta.fixtures.length*meta.repetitions);
  const turns = selected.flatMap(row => row.turns);
  const exact = selected.filter(row => row.group === 'exact').flatMap(row => row.turns);
  const recommend = selected.filter(row => row.group === 'recommendation').flatMap(row => row.turns);
  const multiRows = selected.filter(row => row.group === 'multiturn');
  const scoredMultiRows=multiRows.filter(row=>!row.turns.some(turn=>turn.score.unsupportedQuantity));
  const multi = multiRows.flatMap(row => row.turns).filter(turn=>!turn.score.unsupportedQuantity);
  const conditional = [...recommend, ...multi];
  const allergy = selected.filter(row => row.group === 'allergy').flatMap(row => row.turns);
  const unclear = allergy.filter(turn => turn.score.clarificationRequired);
  const known = allergy.filter(turn => !turn.score.clarificationRequired);
  const attempts = turns.flatMap(turn => turn.attempts);
  const usage = attempts.filter(attempt => attempt.usage !== null);
  const planned=group=>meta.fixtures.filter(task=>task.group===group).length*meta.repetitions;
  assert.equal(turns.length,sum(meta.fixtures,task=>task.steps.length)*meta.repetitions);
  assert.equal(exact.length,planned('exact'));
  assert.equal(recommend.length,planned('recommendation'));
  assert.equal(multiRows.length,planned('multiturn'));
  assert.equal(allergy.length,planned('allergy'));
  const positions=[0,0,0];
  for(const row of selected.filter(row=>row.group==='exact')) {
    const turn=row.turns[0];
    if(!turn.score.hit3) continue;
    const targets=specById.get(row.task).steps[0].expectedIds;
    const index=turn.ids.findIndex(id=>targets.includes(id));
    assert.ok(index>=0 && index<3);
    positions[index]++;
  }
  assert.equal(positions[0],count(exact,t=>t.score.hit1));
  assert.ok(attempts.every(attempt => !attempt.model || attempt.model === meta.model));
  const knownCost = sum(usage, ({ usage }) => (usage.input * meta.rates.INPUT + usage.output * meta.rates.OUTPUT) / 1e6);
  const s = summary[label];
  assert.ok(Math.abs(s.knownUsd - knownCost) < 1e-8);
  if (s.usd !== null) assert.equal(usage.length, attempts.length);
  return { label, selected, attempts, usage, turns, exact, positions, recommend, multiRows:scoredMultiRows, conditional, allergy, unclear, known, s, knownCost };
});
const qualified = turn => turn.score.answeredWithEligibleRecommendation;
const inputRate = meta.rates.INPUT.toFixed(2);
const outputRate = meta.rates.OUTPUT.toFixed(2);
const entries = [
  `# PASS ${model.title} ${evaluationSet==='holdout'?'비공개 평가':'회귀 평가'} 결과`, '',
  `${model.name} · PASS 기준 커밋 \`${meta.baseline.slice(0, 7)}\` · 영문 Amazon 상품 ${meta.catalog.selected.toLocaleString('ko-KR')}개 · ${meta.fixtures.length}개 × 반복 ${meta.repetitions}회 × ${labels.join('/')} = ${rows.length.toLocaleString('ko-KR')}회`,
  ...(meta.sourceRevision?['', `실행 소스 해시 \`${meta.sourceRevision}\` · 채점 버전 ${meta.scoringVersion}`]:[]),
  '', '## 정확도·응답 시간·비용', '',
  '| 모드 | 정확 상품 Hit@1 / Hit@3 | 일반 추천 | 다중 턴 전체 성공 | 조건형·다중 턴 응답 | HTTP 오류 | API p50 / p95(초) | 추정 비용 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
];
for (const m of modes) {
  entries.push(`| ${m.label} | ${count(m.exact, t => t.score.hit1)} / ${count(m.exact, t => t.score.hit3)} (각 ${m.exact.length}건) | ${count(m.recommend, qualified)}/${m.recommend.length} | ${count(m.multiRows, row => row.turns.every(qualified))}/${m.multiRows.length} | ${count(m.conditional, qualified)}/${m.conditional.length} | ${count(m.turns, t => t.status !== 200)}/${m.turns.length} | ${fmtLatency(m.turns.map(t => t.latencyMs))} | ${readableCost(m.s.usd, m.knownCost)} |`);
}
entries.push('', '## 정확 상품의 반환 위치', '',
  '| 모드 | 1번째 적중 | 2번째 적중 | 3번째 적중 | Top 3 실패 |',
  '|---|---:|---:|---:|---:|',
  ...modes.map(m=>`| ${m.label} | ${m.positions.join(' | ')} | ${m.exact.length-sum(m.positions,n=>n)} |`),
  '', 'Top 1은 첫 번째 카드의 적중을 세고, Top 3는 첫 세 카드의 적중을 센다. 두 점수의 차이는 채점에 포함된 2·3번째 카드 적중 건수다.');
if(modes.some(m=>Object.hasOwn(m.s,'candidatePreviews'))) {
  entries.push('', '## 확인 질문의 상품 후보', '',
    '| 모드 | 후보 표시 | 후보에 정답 포함 | 확정 또는 후보에 정답 포함 |',
    '|---|---:|---:|---:|',
    ...modes.map(m=>`| ${m.label} | ${m.s.candidatePreviews}/${m.exact.length} | ${m.s.candidateHits}/${m.s.candidatePreviews} | ${count(m.exact,t=>t.score.visibleHit3)}/${m.exact.length} |`),
    '', '확인 질문의 후보는 확정 Top 1·Top 3에서 제외한다.');
}
entries.push('', '일반·다중 턴 성공은 확인 질문 없이 조건을 충족하는 상품 카드가 최소 하나 반환된 경우다. 카테고리·예산·수량·합성 납기를 사용했다. 다중 턴 전체 성공은 두 턴 모두 이 기준을 충족한 사례다. 정확 상품은 카탈로그 ASIN으로 채점했다.',
  ...(meta.scoringVersion>=2?['', '조건 값이 재현되고 질문 없이 반환된 카드만 성공으로 집계했다. 단일 선물 앱에서 지원하는 수량을 초과한 요청은 별도 집계한다.','',
    ...modes.map(m=>'- '+m.label+' 미지원 수량 안내 '+m.s.quantityLimitExplained+'/'+m.s.unsupportedQuantityCases+
      ', HTTP 200 재시도 안내 '+m.s.gracefulFallbacks+', 잘못된 API 응답 '+m.s.invalidApiResponses)]:[]),
  '', '## 알레르기', '',
  '| 모드 | 명시 성분을 제외 조건에 저장 | 성분 미상에서 확인 질문 | 확인 질문과 카드 동시 반환 | 성분 미확인 식품 카드 | 근거 확보 상품의 제외 위반 |',
  '|---|---:|---:|---:|---:|---:|');
for (const m of modes) {
  entries.push(`| ${m.label} | ${count(m.known, t => t.score.ingredientStored)}/${m.known.length} | ${count(m.unclear, t => t.score.clarified)}/${m.unclear.length} | ${count(m.unclear, t => t.score.questionsWithCards)}/${m.unclear.length} | ${count(m.allergy, t => t.score.unverifiedFoodIds.length)}/${m.allergy.length} | ${count(m.known, t => t.score.knownViolations.length)} |`);
}
const evidenceCount=Object.keys(meta.ingredientEvidence).length;
entries.push('', evidenceCount
  ?`확인된 제조사 성분 근거는 ${evidenceCount}개 ASIN이다. 미확인 식품 카드에는 안전 여부를 부여하지 않았다. 알레르기 카드는 API 응답으로 집계했다.`
  :'이번 평가의 알레르기 지표는 성분 저장과 확인 질문 및 카드 반환을 다룬다. 제조사 성분표가 없어 제외 성분 위반 건수는 판정할 수 없다.',
  '', '## 모델 사용량과 비용', '',
  '| 모드 | 모델 시도 / 사용량 수신 | 입력 / 출력 토큰 | 시나리오 누적 p50 / p95(초) | 100 시나리오당 비용 |',
  '|---|---:|---:|---:|---:|');
for (const m of modes) {
  entries.push(`| ${m.label} | ${m.attempts.length} / ${m.usage.length} | ${m.s.reportedInputTokens.toLocaleString('ko-KR')} / ${m.s.reportedOutputTokens.toLocaleString('ko-KR')} | ${fmtLatency(m.selected.map(row => sum(row.turns, t => t.latencyMs)))} | ${readableCost(m.s.usdPer100Tasks, m.knownCost * 100 / m.selected.length)} |`);
}
const knownCost = sum(modes, m => m.knownCost);
const allCostKnown = modes.every(m => m.s.usd !== null);
entries.push('', `API 요청 ${sum(modes, m => m.turns.length).toLocaleString('ko-KR')}회 · 모델 시도 ${sum(modes, m => m.attempts.length).toLocaleString('ko-KR')}회 · ${allCostKnown ? '총 추정 비용' : '사용량이 확인된 요청의 비용 소계'} ${usd(knownCost)}`, '',
  `비용은 사용자 첨부 단가인 백만 토큰당 입력 $${inputRate}·출력 $${outputRate}로 계산했다. 캐시 입력은 일반 입력과 동일한 단가를 적용했다. API 시간에는 오류, 메인 Worker 처리와 모델 왕복이 포함된다. 원격 DB, 앱 UI, 초기 카탈로그 로딩은 별도다.`,
  '', '## 시나리오 반복 간 일관성', '',
  '| 모드 | 정확 상품을 한 번 이상 Top 3에 반환 | 정확 상품을 세 번 모두 Top 3에 반환 | 질문 없이 조건 충족 응답 비율 |',
  '|---|---:|---:|---:|');
for (const m of modes) {
  const hits = new Map();
  for (const row of m.selected.filter(r => r.group === 'exact')) {
    hits.set(row.task, (hits.get(row.task) ?? 0) + Number(row.turns[0].score.hit3));
  }
  const counts = [...hits.values()];
  entries.push(`| ${m.label} | ${count(counts, n => n > 0)}/${counts.length} | ${count(counts, n => n === meta.repetitions)}/${counts.length} | ${rate(count(m.conditional, qualified), m.conditional.length)} |`);
}
if (!allCostKnown) {
  const missing = modes.flatMap(mode => mode.attempts.filter(attempt => attempt.usage === null)
    .map(attempt => `${mode.label} ${attempt.networkCode ?? attempt.providerError ?? attempt.status ?? '사용량 미보고'}`));
  entries.push('', `토큰 사용량 미보고 ${missing.length}건 (${missing.join(', ')})은 비용 소계에서 빠져 있다.`);
}
entries.push('', '상품 카테고리·상품 이름 등 관측 가능한 조건을 기준으로 평가했다. 식품의 실제 성분과 선물 취향 적합성은 확인 근거가 있는 범위만 비교할 수 있다.',
  ...(runs.length>1?['', 'A와 B/C는 같은 앱 코드·카탈로그·시나리오·채점 기준으로 별도 시점에 순차 실행했다. 응답 지연에는 각 시점의 모델 공급자 상태가 반영된다.']:[]),
  '', '## 원본', '',
  ...runs.flatMap(run=>{
    const label=Object.keys(run.meta.modes).join('/');
    return [
      `- [${label} 실행 기록과 성분 근거](${relative(directory,join(run.directory,'runs.jsonl'))})`,
      `- [${label} 모드별 집계](${relative(directory,join(run.directory,'progress.json'))})`,
    ];
  }),
  ...(catalogDir?['- [알레르기 응답과 반환 상품](allergy-review.jsonl)']:[]),
  '- 카탈로그 매니페스트와 해시는 원본 실행 기록의 첫 행에 포함된다.', '');

await mkdir(directory,{recursive:true});
if(catalogDir) {
  const review = rows.flatMap(row => row.turns.flatMap((turn, i) => {
    if (!turn.score.needsReview) return [];
    const step = specById.get(row.task).steps[i];
    return [{ repeat: row.repeat, task: row.task, mode: labels.find(label => meta.modes[label] === row.agent),
      text: step.text, ingredient: step.ingredient, status: turn.status, score: turn.score,
      response: turn.response, notice: turn.notice, question: turn.question, ids: turn.ids }];
  }));
  assert.equal(review.length,sum(modes,m=>m.allergy.length));
  const needed = new Set(review.flatMap(row => row.ids));
  const products = new Map();
  for await (const line of createInterface({ input: createReadStream(join(resolve(catalogDir), 'catalog.jsonl')) })) {
    const p = JSON.parse(line);
    const id = 'amz-' + p.asin;
    if (needed.has(id)) products.set(id, { id, name: p.name, category: p.category });
    if (products.size === needed.size) break;
  }
  assert.equal(products.size, needed.size);
  await writeFile(join(directory, 'allergy-review.jsonl'), review.map(row =>
    JSON.stringify({ ...row, products: row.ids.map(id => products.get(id)) })).join('\n') + '\n');
}
await writeFile(join(directory, 'comparison.md'), entries.join('\n'));
console.log(entries.join('\n'));
