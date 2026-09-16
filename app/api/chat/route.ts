import {env} from 'cloudflare:workers';
import products from '@/lib/products.json';
import {llmTurn,validateRequest} from '@/lib/llm.mjs';
import {singleTurn} from '@/lib/single-gift.mjs';
const config=()=>env as unknown as Record<string,string|undefined>;
const json=(body:any,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function GET(){return json({configured:!!config().GEMINI_API_KEY,provider:'Gemini'});}
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return json({error:'허용되지 않은 요청입니다.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
 const raw=await request.text();if(raw.length>16000)return json({error:'입력이 너무 깁니다.'},413);
 let input;try{input=validateRequest(JSON.parse(raw));}catch{return json({error:'입력 형식을 확인해주세요.'},400);}
 const {GEMINI_API_KEY,GEMINI_MODEL}=config();
 if(!GEMINI_API_KEY)return json({...singleTurn({state:input.state,issues:input.issues},input.text,products),mode:'rules',notice:'Gemini 연결 대기 · 기본 해석으로 처리했습니다.'});
 try{return json({...await llmTurn(input,products,{apiKey:GEMINI_API_KEY,model:GEMINI_MODEL||'gemini-2.5-flash'}),mode:'llm',notice:'Gemini로 대화 조건을 이해했어요.'});}
 catch{return json({...singleTurn({state:input.state,issues:input.issues},input.text,products),mode:'rules',notice:'Gemini 응답을 받지 못해 기본 해석으로 처리했습니다.'});}
}
