// Real provider, synthetic input/catalog, no Supabase account or user data.
import assert from 'node:assert/strict';
import {loadLocalEnv} from './local-env.mjs';
import {resolveLlm} from '../lib/llm-provider.mjs';
import {prototypeRouterTurn} from './router-agent.mjs';
import {singleInitial} from '../lib/single-gift.mjs';
import {products} from '../baseline/examples/catalog.mjs';
try {
  const env=await loadLocalEnv();const llm=resolveLlm(env);
  if(llm.provider!=='openai-compatible'||!llm.options.apiKey)throw Object.assign(Error(),{code:'configuration'});
  const started=Date.now();
  const input={operation:'turn',state:singleInitial(),issues:[],history:[],source:'typed',text:'처음 정하는 수령인은 은사님이에요. 생신을 위한 선물로 격식 있는 포장을 원해요. 차를 즐기시고 우유는 피하신대요. 선물 하나의 예산은 배송비 포함 5만원이에요.'};
  const turn=await prototypeRouterTurn(input,products,{extract:llm.extract,...llm.options,llmMode:'subagents'});
  const trace=turn.routing.subagents;
  assert.equal(turn.mode,'llm');assert.equal(trace.selectedAgents.length,4);assert.equal(trace.logicalCalls,6);assert.deepEqual(turn.session.state.recipients,['은사님']);assert.equal(turn.session.state.budget.amount_krw,50000);assert.equal(turn.session.state.budget.shipping_included,true);assert.equal(turn.session.state.packaging,'formal');assert.ok(turn.session.state.occasion);assert.ok(turn.session.state.preferences.includes('category:coffee_tea'));assert.ok(turn.session.state.excluded_ingredients.includes('우유'));assert.equal(turn.question.key,null);
  console.log(JSON.stringify({ok:true,model:llm.options.model,latencyMs:Date.now()-started,routing:turn.routing,conditions:turn.session.state},null,2));
} catch(error) {
  console.error(JSON.stringify({ok:false,code:error?.code==='ERR_ASSERTION'?'condition_check_failed':error?.code??'request_failed',routing:error?.routing??null},null,2));
  process.exitCode=1;
}
