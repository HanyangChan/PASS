// One real extraction with synthetic input. No account data or real catalog is sent.
import { loadLocalEnv } from './local-env.mjs';
import { resolveLlm } from '../lib/llm-provider.mjs';
import { singleInitial } from '../lib/single-gift.mjs';
import { products } from '../baseline/examples/catalog.mjs';

try {
  const env=await loadLocalEnv();
  const llm=resolveLlm(env);
  if (!llm.options.apiKey?.trim()) {
    console.error('LLM_API_KEY가 없습니다. api/.dev.vars에 키를 저장한 뒤 다시 실행해 주세요.');
    process.exitCode=2;
  } else {
    let usage={};
    const state={...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}};
    const started=Date.now();
    const turn=await llm.extract({state,issues:[],history:[],source:'typed',text:'어머니는 커피보다 차를 좋아하고 견과류는 피해야 해요. 예산과 배송비 조건은 그대로 유지해 주세요.'},products,{...llm.options,onUsage:value=>{usage=value;}});
    if(turn.session.state.budget.amount_krw!==50000 || turn.session.state.budget.shipping_included!==true || !turn.session.state.preferences.includes('category:coffee_tea') || !turn.session.state.excluded_ingredients.includes('견과류')) throw Object.assign(Error(),{code:'condition_check_failed'});
    console.log(JSON.stringify({ok:true,provider:llm.provider,model:llm.options.model,latencyMs:Date.now()-started,structuredOutput:true,preferences:turn.session.state.preferences,excludedIngredients:turn.session.state.excluded_ingredients,budget:turn.session.state.budget,needsClarification:Boolean(turn.session.issues.length),usage},null,2));
  }
} catch(error) {
  const safeCodes=new Set(['configuration','timeout','network_error','auth_failed','quota_exceeded','endpoint_or_model_not_found','provider_unavailable','request_rejected','invalid_response','condition_check_failed']);
  console.error(JSON.stringify({ok:false,code:safeCodes.has(error?.code)?error.code:'request_failed',status:Number.isInteger(error?.status)?error.status:0}));
  process.exitCode=1;
}
