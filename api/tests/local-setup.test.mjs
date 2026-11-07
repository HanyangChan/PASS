import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalEnv } from '../local-env.mjs';
import { localConfig } from '../dev-config.mjs';
import { setupLocal } from '../setup-local.mjs';
import { createApi } from '../worker.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
async function fixture(t) {
 const directory=await mkdtemp(join(tmpdir(),'pass-local-setup-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const root=pathToFileURL(directory+'/');
 await mkdir(new URL('mobile/',root));await mkdir(new URL('api/',root));
 await writeFile(new URL('mobile/.env.example',root),'EXPO_PUBLIC_SUPABASE_URL=https://valid.supabase.co\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_synthetic\nEXPO_PUBLIC_CHAT_API_URL=https://production.example\n');
 await writeFile(new URL('api/.dev.vars.example',root),await readFile(new URL('../.dev.vars.example',import.meta.url)));
 return root;
}
test('fresh setup works in rules mode without model keys and never overwrites existing settings',async t=>{
 const root=await fixture(t);const first=await setupLocal(root);assert.equal(first.created.length,2);
 const env=await loadLocalEnv({root,processEnv:{}});const {env:config}=localConfig(env);
 assert.equal(config.CHAT_AGENT,'a-router');assert.equal(config.SUPABASE_URL,'https://valid.supabase.co');assert.equal(env.LLM_API_KEY,'');
 assert.equal(env.EXPO_PUBLIC_CHAT_API_URL,'http://127.0.0.1:8788');assert.ok(config.APP_ORIGINS.includes('http://localhost:8081'));
 await writeFile(new URL('api/.dev.vars',root),'LLM_API_KEY=private-keep\n');
 const second=await setupLocal(root);assert.equal(second.created.length,0);assert.equal(second.kept.length,2);
 assert.equal(await readFile(new URL('api/.dev.vars',root),'utf8'),'LLM_API_KEY=private-keep\n');
});
test('placeholder Supabase fields do not override valid mobile settings; real server/shell overrides do',async t=>{
 const root=await fixture(t);await setupLocal(root);
 await writeFile(new URL('api/.dev.vars',root),'SUPABASE_URL=https://your-project.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me\n');
 const e=await loadLocalEnv({root,processEnv:{}});assert.equal(localConfig(e).env.SUPABASE_URL,'https://valid.supabase.co');
 await writeFile(new URL('api/.dev.vars',root),'SUPABASE_URL=https://server.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_server\n');
 const shell=await loadLocalEnv({root,processEnv:{SUPABASE_URL:'https://shell.supabase.co',API_PORT:'18789'}});
 assert.equal(localConfig(shell).env.SUPABASE_URL,'https://shell.supabase.co');assert.equal(localConfig(shell).port,18789);
});
test('startup rejects missing/placeholder configuration, old Node and unsupported full-chat modes without leaking keys',()=>{
 assert.throws(()=>localConfig({}),/setup:local/);
 const valid={EXPO_PUBLIC_SUPABASE_URL:'https://valid.supabase.co',EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'};
 assert.throws(()=>localConfig(valid,{nodeVersion:'20.19.0'}),/Node 22.13/);
 assert.throws(()=>localConfig({...valid,CHAT_AGENT:'full-chat'}),/LLM_API_KEY/);
 assert.throws(()=>localConfig({...valid,API_PORT:'oops'}),/API_PORT/);
 assert.throws(()=>localConfig({...valid,SUPABASE_URL:'https://your-project.supabase.co'}),/Supabase/);
 const explicit=localConfig({...valid,APP_ORIGINS:'https://review.example'});assert.equal(explicit.env.APP_ORIGINS,'https://review.example');
});
test('health returns unavailable status when catalog fails and advertises modes supported by the server',async()=>{
 const env={CHAT_AGENT:'a-router',LLM_PROVIDER:'openai-compatible'};
 const bad=await createApi({catalog:async()=>{throw Error('private detail');}}).fetch(new Request('http://local/health'),env);
 assert.equal(bad.status,503);assert.equal((await bad.json()).ok,false);
 const good=await createApi({catalog:async()=>products}).fetch(new Request('http://local/health'),env);
 assert.deepEqual((await good.json()).availableAgents,['a-router','langgraph-advisors']);
 const llm=await createApi({catalog:async()=>products}).fetch(new Request('http://local/health'),{...env,LLM_API_KEY:'synthetic'});
 assert.deepEqual((await llm.json()).availableAgents,['a-router','langgraph-advisors','full-chat','full-chat-feedback-2']);
});
