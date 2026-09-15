import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {conversationTurn,startConversation,nextQuestion} from '../lib/conversation.mjs';
import {recommend} from '../lib/engine.mjs';
const root=new URL('../',import.meta.url);
const raw=readFileSync(new URL('korean-eval-v1.json',import.meta.url),'utf8');
const data=JSON.parse(raw),products=JSON.parse(readFileSync(new URL('../lib/products.json',import.meta.url)));
const get=(v,path)=>path.split('.').reduce((x,k)=>x?.[k],v);
const equal=(a,b)=>JSON.stringify(Array.isArray(a)?[...a].sort():a)===JSON.stringify(Array.isArray(b)?[...b].sort():b);
if(new Set(data.cases.map(c=>c.id)).size!==data.cases.length)throw Error('Duplicate case IDs');
const results=data.cases.map(c=>{
 let session=startConversation();const transcript=[];
 for(const text of c.turns){const turn=conversationTurn(session,text,products);session=turn.session;transcript.push({user:text,assistant:turn.message,question:turn.question.key});}
 const question=nextQuestion(session).key;
 const result=question?{status:'needs_clarification',items:[]}:recommend(products,session.state);
 const actual={state:session.state,question,result,blocked:question!==null||result.status==='insufficient_product_info'};
 const checks=Object.entries(c.expected).map(([path,expected])=>{const value=get(actual,path);if(value===undefined)throw Error(`Unknown assertion path: ${path}`);return {path,expected,actual:value,pass:equal(expected,value)};});
 return {id:c.id,category:c.category,title:c.title,pass:checks.every(x=>x.pass),checks,transcript};
});
const checks=results.flatMap(r=>r.checks);
const report={generatedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(root),encoding:'utf8'}).trim(),datasetSha256:createHash('sha256').update(raw).digest('hex'),datasetVersion:data.version,provenance:data.provenance,casePass:results.filter(r=>r.pass).length,caseTotal:results.length,checkPass:checks.filter(x=>x.pass).length,checkTotal:checks.length,results};
const dir=new URL('results/',import.meta.url);const name=process.argv.find(a=>a.startsWith('--name='))?.slice(7)||'latest';if(!/^[a-zA-Z0-9_-]+$/.test(name)||name==='baseline')throw Error('Use a safe new report name; baseline is frozen.');mkdirSync(dir,{recursive:true});writeFileSync(new URL(`${name}.json`,dir),JSON.stringify(report,null,2));
const table=results.map(r=>`| ${r.id} | ${r.category} | ${r.title} | ${r.pass?'PASS':'FAIL'} | ${r.checks.filter(x=>!x.pass).map(x=>x.path).join(', ')||'—'} |`).join('\n');
const failures=results.filter(r=>!r.pass).map(r=>`### ${r.id} ${r.title}\n\n${r.transcript.map(t=>`- 사용자: ${t.user}`).join('\n')}\n\n${r.checks.filter(x=>!x.pass).map(x=>`- ${x.path}: expected ${JSON.stringify(x.expected)}, actual ${JSON.stringify(x.actual)}`).join('\n')}`).join('\n\n');
writeFileSync(new URL(`${name}.md`,dir),`# PASS 한국어 진단 평가 v1\n\n- Source: ${report.sourceCommit}\n- Dataset SHA-256: ${report.datasetSha256}\n- 사례 통과: ${report.casePass}/${report.caseTotal}\n- 명시된 최종 상태·동작 검사항목 통과: ${report.checkPass}/${report.checkTotal}\n- 합성 진단셋이며 실제 사용자 정확도나 독립 블라인드 평가 점수가 아닙니다. 중간 턴 전체 슬롯 정확도를 측정하지 않습니다.\n\n| ID | 구분 | 사례 | 결과 | 실패 항목 |\n|---|---|---|---|---|\n${table}\n\n## 실패 상세\n\n${failures}\n`);
console.log(JSON.stringify({casePass:report.casePass,caseTotal:report.caseTotal,checkPass:report.checkPass,checkTotal:report.checkTotal}));
// Diagnostic failures are expected in a baseline. Opt into a CI gate explicitly.
if(process.argv.includes('--strict')&&report.casePass!==report.caseTotal)process.exitCode=1;
