// Bounded normalization for the rule-based demo, not general Korean understanding.
const digits={영:0,일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9};
export function koreanNumber(word){
 let total=0,part=0,digit=0;
 for(const c of word){if(c in digits){digit=digits[c];continue;}const unit={십:10,백:100,천:1000,만:10000}[c];if(!unit)return null;if(unit===10000){total+=(part+digit||1)*unit;part=0;}else part+=(digit||1)*unit;digit=0;}
 return total+part+digit;
}
export function normalizeMoney(text){
 return text.replace(/(?<![\d,])\d{1,3}(?:,\d{3})+(?![\d,])/g,m=>m.replaceAll(',',''))
 .replace(/([영일이삼사오육칠팔구십백천만]+)\s*원/g,(match,n,offset,whole)=>/[\d.,]\s*$/.test(whole.slice(0,offset))?match:`${koreanNumber(n)}원`)
 .replace(/(\d+(?:\.\d+)?)\s*(만|천)(?!\s*원)/g,'$1$2 원');
}
export function validDate(value){
 const [y,m,d]=value.split('-').map(Number);const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
}
export const unsupportedGoods=/운동화|신발|헤드폰|이어폰|장난감|완구|인형|옷|의류|게임기/;
export const unsupportedMessage='지금은 식품 선물만 추천할 수 있어요. 식품으로 바꾸려면 “식품으로 추천해줘”라고 알려주세요.';
