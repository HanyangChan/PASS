export const text='어머니 생일 선물로 차를 좋아하시고 우유는 피해요. 선물 하나 예산 5만원 배송비 포함';
const ref=quote=>[{sourceId:'current',quote}];
export const observation=(field,value,quote,subject='recipient',certainty='explicit')=>({field,value,subject,certainty,evidenceRefs:ref(quote)});
export function analysis(role,observations=[]) {return {agentId:role,status:'complete',observations,attributions:[],questions:[]};}
export function fixture(stage,input,roles=['taste']) {
  if(stage==='supervisor')return {tasks:roles.map(agentId=>({agentId,task:'명시된 조건 분석',evidenceRefs:ref(input.text)})),question:null};
  if(stage==='synthesizer')return input.questionOptions.length?{patch:{},questions:[input.questionOptions[0]],unresolved:true}:{patch:input.approvedPatch,questions:[],unresolved:false};
  const outputs={
    recipient:analysis('recipient',[observation('recipients',['어머니'],'어머니')]),
    occasion:analysis('occasion',[observation('occasion','생일','생일')]),
    spending:analysis('spending',[observation('budget.amount_krw',50000,'5만원','giver'),observation('budget.shipping_included',true,'배송비 포함','giver')]),
    taste:analysis('taste',[observation('preferences',['category:coffee_tea'],'차를 좋아'),observation('excluded_ingredients',['우유'],'우유는 피해요')]),
  };
  return outputs[stage];
}
export function makeFetcher({roles=['taste'],override,onStage}={}) {
  const calls=[];
  const fetcher=async(url,options)=>{
    const payload=JSON.parse(options.body);const {stage,input}=JSON.parse(payload.messages[1].content);
    calls.push(stage);await onStage?.(stage,input,options);
    const value=override?await override(stage,input,options):undefined;
    if(value instanceof Response)return value;
    const data=value??fixture(stage,input,roles);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}});
  };
  return {fetcher,calls};
}
