import { readFile } from 'node:fs/promises';
const allowed=/^(?:LLM_|GEMINI_|SUPABASE_|EXPO_PUBLIC_)|^(?:CHAT_AGENT|APP_ORIGINS|A_ROUTER_LLM_MODE)$/;
export async function loadLocalEnv({processEnv=process.env}={}) {
  const values={};
  for (const path of [new URL('../mobile/.env.local',import.meta.url),new URL('./.dev.vars',import.meta.url)]) {
    try {
      for (const line of (await readFile(path,'utf8')).split('\n')) {
        const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
        if (match) values[match[1]]=match[2].trim().replace(/^['"]|['"]$/g,'');
      }
    } catch (error) { if(error.code!=='ENOENT') throw error; }
  }
  for (const [key,value] of Object.entries(processEnv)) if(allowed.test(key) && value!==undefined) values[key]=value;
  return values;
}
