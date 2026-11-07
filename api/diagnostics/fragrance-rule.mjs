// Synthetic authentication/session, real configured model and product snapshot.
import { readFile, writeFile } from 'node:fs/promises';
import { createApi } from '../worker.mjs';
import { loadLocalEnv } from '../local-env.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { toEngineProduct } from '../../lib/catalog.mjs';
import { isFragranceProduct } from '../../lib/fragrance.mjs';
const local=await loadLocalEnv();
const products=JSON.parse(await readFile(new URL('../../supabase/seed/products-amazon.json',import.meta.url),'utf8')).map(p=>toEngineProduct(p,'2026-11-06'));
const runs=[];
for(const mode of ['a-router','full-chat','full-chat-feedback-2']) {
 const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>String(url).includes('fragrance-check.invalid/auth/v1/user')?Response.json({id:'synthetic',role:'authenticated'}):fetch(url,options)});
 const env={...local,CHAT_AGENT:mode,SUPABASE_URL:'https://fragrance-check.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
 let session={state:{...singleInitial(),recipients:['친구'],occasion:'생일',budget:{amount_krw:100000,shipping_included:null}},issues:[]},history=[];
 const turns=[];
 for(const text of ['향이 강한 제품은 빼고, 먹는 것도 제외해줘.','배송비 포함','예산 7만원으로 바꿔줘']) {
  const response=await api.fetch(new Request('https://api.invalid/api/chat',{method:'POST',headers:{Authorization:'Bearer synthetic.jwt','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',session,history:history.slice(-6),text})}),env);
  const data=await response.json();
  const state=data.session?.state;
  const cards=data.view?.result?.items??[];
  const passed=response.status===200&&state.preferences.includes('avoid_fragrance')&&['food','snack','coffee_tea','health'].every(c=>state.excluded_categories.includes(c))&&!state.excluded_categories.some(c=>['beauty','decor','makeup','personal_care'].includes(c))&&cards.every(p=>!isFragranceProduct(products.find(row=>row.id===p.id)))&&data.message.includes('상품명 기준');
  turns.push({text,status:response.status,passed,state,message:data.message,question:data.question?.key,routing:data.routing,productIds:cards.map(p=>p.id)});
  if(!data.session)break;
  session=data.session;history.push({role:'user',text},{role:'assistant',text:data.message});
 }
 runs.push({mode,turns});console.log(JSON.stringify({mode,passed:turns.length===3&&turns.every(t=>t.passed)}));
}
const passed=runs.every(r=>r.turns.length===3&&r.turns.every(t=>t.passed));
const report={generatedAt:new Date().toISOString(),passed,catalogSize:products.length,fragranceNameMatches:products.filter(isFragranceProduct).length,runs};
await writeFile('docs/verification/fragrance-rule-2026-11-06.json',JSON.stringify(report,null,2)+'\n');
if(!passed)process.exitCode=1;
