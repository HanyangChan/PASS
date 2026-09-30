const options=(values,labels)=>values.map((value,i)=>({value,label:labels[i]}));
export const RESEARCH_OBJECTIVE='예산 변화에 대한 비교 설명이 추천 결과 이해도, 선택 확신, 주관적 판단 부담에 미치는 영향을 탐색합니다.';
export const PRE_QUESTIONS=[
 {key:'age',label:'연령대가 어떻게 되시나요?',options:options(['18_29','30_39','40_49','50_59','60_plus','not_disclosed'],['18–29세','30–39세','40–49세','50–59세','60세 이상','응답하지 않음'])},
 {key:'shopping',label:'최근 6개월 동안 온라인으로 상품을 구매한 빈도는 어느 정도인가요?',options:options(['never','less_monthly','monthly','weekly'],['없음','월 1회 미만','월 1–3회','주 1회 이상'])},
 {key:'gifts',label:'최근 1년 동안 다른 사람에게 줄 명절 선물을 직접 고른 횟수는 얼마나 되나요?',options:options(['never','once','multiple'],['없음','1회','2회 이상'])},
 {key:'chatbot',label:'챗봇에 상품 추천을 요청해 본 횟수는 얼마나 되나요?',options:options(['never','one_two','three_plus'],['없음','1–2회','3회 이상'])},
 {key:'familiarity',label:'온라인에서 여러 상품을 비교하는 일이 얼마나 익숙한가요?',options:options([1,2,3,4,5],['전혀 익숙하지 않음','익숙하지 않은 편','보통','익숙한 편','매우 익숙함'])}
];
export const POST_QUESTIONS=[
 {key:'topChanged',label:'처음 예산에서 비교 예산으로 바꾸면 첫 번째 추천 상품이 달라지나요?',options:options(['yes','no','unsure'],['다른 상품으로 바뀜','그대로 유지됨','모르겠음'])},
 {key:'candidateCount',label:'처음 예산에서 비교 예산으로 바꾸면 선택 가능한 상품 수는 어떻게 되나요?',options:options(['more','same','fewer','unsure'],['늘어남','그대로임','줄어듦','모르겠음'])},
 {key:'confidence',label:'최종 선택이 제시된 선물 조건에 적합하다고 얼마나 확신하나요?',options:options([1,2,3,4,5],['전혀 확신하지 못함','확신하지 못하는 편','보통','확신하는 편','매우 확신함'])},
 {key:'effort',label:'어떤 상품을 선택할지 판단하는 과정이 얼마나 어려웠나요?',options:options([1,2,3,4,5],['전혀 어렵지 않았음','어렵지 않은 편','보통','어려운 편','매우 어려웠음'])}
];
export const POST_TEXT_QUESTIONS=[
 {key:'explanation',label:'예산 변경이 추천 결과에 어떤 영향을 주었는지 한 문장으로 설명해주세요.'},
 {key:'decisionReason',label:'선택을 결정하는 데 가장 영향을 준 정보는 무엇이었나요?'},
 {key:'feedback',label:'이해하기 어렵거나 부족했던 정보가 있었다면 적어주세요.'}
];
export const FINAL_QUESTION={key:'preference',label:'두 화면 중 선물을 고르는 데 더 도움이 된 화면은 무엇인가요?',options:options(['first','second','same','unsure'],['첫 번째 화면','두 번째 화면','차이 없음','판단하기 어려움'])};
export const validChoice=(questions,key,value)=>questions.some(q=>q.key===key&&q.options.some(o=>o.value===value));
export const completeChoices=(questions,answers)=>questions.every(q=>validChoice(questions,q.key,answers[q.key]));
