// Conservative reference parser. Unsupported or ambiguous language asks for clarification.
export function parseRules(text) {
  const patch = {};
  if (/나는|저는|제가|내가|센스|무난|최소|이상|안\s*좋아|싫|알레르|빼|제외/.test(text))
    return { patch, questions:['받는 사람의 조건을 조건 편집으로 명확히 지정해 주세요.'], unresolved:true };
  const recipients = ['어머니','아버지','부모님','친구','동료','교수님'].filter(r => text.replaceAll('엄마','어머니').replaceAll('아빠','아버지').includes(r));
  if (recipients.length > 1) return {patch, questions:['이번에 선물할 수령인 한 명을 지정해 주세요.'], unresolved:true};
  const amounts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(만원|만 원|천원|천 원|원)/g)];
  if (amounts.length > 1) return {patch, questions:['적용할 예산 상한 하나를 알려주세요.'], unresolved:true};
  // Remove only supported phrases; never silently ignore the rest of a message.
  const rest = text.replace(/어머니|아버지|부모님|엄마|아빠|친구|동료|교수님/g,'')
    .replace(/\d+(?:\.\d+)?\s*(만원|만 원|천원|천 원|원)/g,'')
    .replace(/배송비 포함|배송비 별도|상품값만|세트당|총예산|예산|이하|추천해줘|추천|선물|에게|한 세트/g,'')
    .replace(/[\s,.!?]/g,'');
  if (rest) return {patch:{},questions:['조건 편집으로 입력하거나 받는 사람과 예산을 명확히 알려주세요.'],unresolved:true};
  if (recipients.length) patch.recipients=recipients;
  if (amounts.length) {
    const m=amounts[0];
    patch.budget={amount_krw:Number(m[1])*(m[2].includes('만')?10000:m[2].includes('천')?1000:1)};
  }
  if (/세트당|총예산/.test(text)) patch.budget={...patch.budget,scope:text.includes('총예산')?'total':'per_set'};
  if (/배송비 포함/.test(text) && /배송비 별도|상품값만/.test(text)) return {patch:{},questions:['배송비 포함 여부를 하나로 지정해 주세요.'],unresolved:true};
  if (/배송비 포함|배송비 별도|상품값만/.test(text)) patch.budget={...patch.budget,shipping_included:text.includes('배송비 포함')};
  if (/한 세트/.test(text)) Object.assign(patch,{quantity:1,same_product:true});
  return {patch,questions:[],unresolved:false};
}
