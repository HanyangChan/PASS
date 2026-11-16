// Written after the first diagnostic fixes, before this set's first execution.
// Internal new wording from the same author, not an independent external benchmark.
export const freshDialogues = [
  { id:'F01',group:'fresh',say:['아빠 생일인데 택배비까지 오만원 안에서 손목시계로 골라줘'],expect:{recipients:['아버지'],occasion:'생일',budget:50000,shipping:true,prefs:['category:watch'],asks:false} },
  { id:'F02',group:'fresh',say:['고등학생 조카 입학 선물 삼만원 배송료 포함. 필기구 좋아해'],expect:{recipientContains:'고등학생 조카',occasion:'입학',budget:30000,shipping:true,prefs:['category:stationery','type:writing'],asks:false} },
  { id:'F03',group:'fresh',say:['어머니 선물 택배비 별도로 6만원','예산은 육만원 그대로 두고 꽃다발로 변경해줘'],expect:{recipients:['어머니'],budget:60000,shipping:false,prefs:['category:flower','type:bouquet'],asks:false} },
  { id:'F04',group:'fresh',say:['친구 선물 4만원 배송비 포함 커피로','그거 말고 아버지 선물이야. 5만원 배송비 포함 시계로'],expect:{recipients:['아버지'],budget:50000,shipping:true,prefs:['category:watch'],asks:false} },
  { id:'F05',group:'fresh',say:['할머니 선물 5만원 배송료 포함','땅콩은 빼고 단 건 말고 차로'],expect:{recipients:['할머니'],budget:50000,shipping:true,exIng:['땅콩'],prefsInclude:['category:coffee_tea','type:tea','less_sweet'],asks:false} },
  { id:'F06',group:'fresh',say:['직장 동료 선물 4만원 배송 포함','배송료는 따로 계산해. 예산은 사만원 그대로'],expect:{recipients:['직장동료'],budget:40000,shipping:false,asks:false} }
];
