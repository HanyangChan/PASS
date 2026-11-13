import { readFile } from 'node:fs/promises';
const allowed=/^(?:LLM_|GEMINI_|SUPABASE_|EXPO_PUBLIC_)|^(?:CHAT_AGENT|APP_ORIGINS|A_ROUTER_LLM_MODE|API_PORT|CATALOG_SOURCE|WEB_IMAGES)$/;
export function usableSetting(key,value) {
  return !/^(?:EXPO_PUBLIC_)?SUPABASE_(?:URL|PUBLISHABLE_KEY)$/.test(key)||Boolean(value&&!/your-project|replace_me|your[_-]?(?:url|key)|<[^>]+>/i.test(value));
}
export async function loadLocalEnv({processEnv=process.env,root=new URL('../',import.meta.url)}={}) {
  const values={};
  for (const path of [new URL('mobile/.env.local',root),new URL('api/.dev.vars',root)]) {
    try {
      for (const line of (await readFile(path,'utf8')).split('\n')) {
        const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
        if (match) {
          const value=match[2].trim().replace(/^['"]|['"]$/g,'');
          if(usableSetting(match[1],value))values[match[1]]=value;
        }
      }
    } catch (error) { if(error.code!=='ENOENT') throw error; }
  }
  for (const [key,value] of Object.entries(processEnv)) if(allowed.test(key) && value!==undefined && usableSetting(key,value)) values[key]=value;
  return values;
}
