import { resolveLlm } from '../lib/llm-provider.mjs';
import { usableSetting } from './local-env.mjs';
const modes=['a-router','legacy','full-chat','full-chat-feedback-1','full-chat-feedback-2'];
export function localConfig(values,{nodeVersion=process.versions.node}={}) {
  const [major,minor]=nodeVersion.split('.').map(Number);
  if(major<22||major===22&&minor<13)throw Error('Node 22.13 이상이 필요합니다. Node를 업그레이드한 뒤 다시 실행하세요.');
  const SUPABASE_URL=values.SUPABASE_URL||values.EXPO_PUBLIC_SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY=values.SUPABASE_PUBLISHABLE_KEY||values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let validUrl=false;try{const url=new URL(SUPABASE_URL);validUrl=url.protocol==='https:'&&!url.username&&!url.password;}catch{}
  if(!validUrl||!SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')||!usableSetting('SUPABASE_URL',SUPABASE_URL)||!usableSetting('SUPABASE_PUBLISHABLE_KEY',SUPABASE_PUBLISHABLE_KEY))throw Error('Supabase 공개 설정이 필요합니다. 저장소 루트에서 npm run setup:local을 실행하거나 mobile/.env.local / api/.dev.vars를 설정하세요.');
  const CHAT_AGENT=values.CHAT_AGENT||'a-router';
  if(!modes.includes(CHAT_AGENT))throw Error('CHAT_AGENT 설정을 확인하세요. a-router, full-chat, full-chat-feedback-2 등을 사용할 수 있습니다.');
  const env={...values,SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,CHAT_AGENT,APP_ORIGINS:values.APP_ORIGINS||[8766,8081,19006].flatMap(port=>[`http://127.0.0.1:${port}`,`http://localhost:${port}`]).join(',')};
  let llm;try{llm=resolveLlm(env);}catch{throw Error('LLM 공급자·주소·응답 형식 설정을 확인하세요. api/.dev.vars.example을 참고하세요.');}
  if(CHAT_AGENT.startsWith('full-chat')&&(llm.provider!=='openai-compatible'||!llm.options.apiKey))throw Error('B/C 모드는 LLM_PROVIDER=openai-compatible과 서버 LLM_API_KEY가 필요합니다. 키 없이 검토하려면 CHAT_AGENT=a-router를 사용하세요.');
  const port=Number(values.API_PORT||8788);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('API_PORT는 1~65535 정수여야 합니다.');
  return {env,port,llm};
}
