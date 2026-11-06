// Real provider, synthetic authentication/session; no user records are touched.
import { writeFile } from 'node:fs/promises';
import { loadLocalEnv } from '../local-env.mjs';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
const local=await loadLocalEnv();
const runs=[];
for(const reasoning of [undefined,false]) {
  const wire=[];
  const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>{
    if(String(url).includes('router-check.invalid/auth/v1/user'))return Response.json({id:'synthetic',role:'authenticated'});
    const response=await fetch(url,options);
    const data=await response.clone().json().catch(()=>null);
    wire.push({status:response.status,finishReason:data?.choices?.[0]?.finish_reason,hasContent:Boolean(data?.choices?.[0]?.message?.content),usage:data?.usage});
    return response;
  }});
  const env={...local,CHAT_AGENT:'a-router',SUPABASE_URL:'https://router-check.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})},LLM_REASONING_ENABLED:reasoning===undefined?'':String(reasoning)};
  let session={state:singleInitial(),issues:[]},history=[];
  const turns=[];
  for(const text of ['친구 생일 선물을 찾고 있어. 예산은 10만 원이고 실용적인 걸 좋아해','향이 강한 제품은 빼고, 먹는 것도 제외해줘.','배송비 포함']) {
    const response=await api.fetch(new Request('https://api.invalid/api/chat',{method:'POST',headers:{Authorization:'Bearer synthetic.jwt','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',session,history:history.slice(-6),text})}),env);
    const data=await response.json();
    turns.push({text,status:response.status,code:data.code,message:data.message,question:data.question,state:data.session?.state});
    if(data.session){session=data.session;history.push({role:'user',text},{role:'assistant',text:data.message});}
  }
  runs.push({reasoning:reasoning??'omitted',turns,wire});
  console.log(JSON.stringify(runs.at(-1)));
}
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify({runs},null,2)+'\n');
