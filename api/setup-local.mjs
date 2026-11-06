import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function setupLocal(root=new URL('../',import.meta.url)) {
  const created=[],kept=[];
  for(const [destination,template] of [['mobile/.env.local','mobile/.env.example'],['api/.dev.vars','api/.dev.vars.example']]) {
    let contents=await readFile(new URL(template,root),'utf8');
    if(destination.startsWith('mobile/'))contents=contents.replace(/^EXPO_PUBLIC_CHAT_API_URL=.*$/m,'EXPO_PUBLIC_CHAT_API_URL=http://127.0.0.1:8788');
    try{await writeFile(new URL(destination,root),contents,{flag:'wx'});created.push(destination);}
    catch(error){if(error.code!=='EEXIST')throw error;kept.push(destination);}
  }
  return {created,kept};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const result=await setupLocal();
  console.log(JSON.stringify(result));
  console.log('기존 설정은 덮어쓰지 않았습니다. npm run dev:api로 API를, npm --prefix mobile run web -- --port 8766으로 웹을 실행하세요. A는 모델 키 없이 사용 가능하며 서버 채팅에는 Supabase 로그인이 필요합니다. B/C는 api/.dev.vars의 LLM_API_KEY를 설정하세요.');
}
