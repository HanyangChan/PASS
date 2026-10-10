import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createAuthService, authErrorMessage } from '../src/services/authService.ts';
import { resolveAuthConfig } from '../src/auth/config.ts';
import { createSecureSessionStorage } from '../src/auth/secureSessionStorage.ts';

test('missing config stays guest and secret/admin keys cannot configure a client', async () => {
  assert.equal(resolveAuthConfig(), null);
  assert.throws(() => resolveAuthConfig('https://example.supabase.co','sb_secret_example'), /Publishable/);
  assert.throws(() => resolveAuthConfig('http://example.supabase.co','sb_publishable_example'), /HTTPS/);
  const service = createAuthService(null);
  assert.equal(await service.restore(), null);
  await assert.rejects(service.signIn('test@example.com','password'), /연결/);
});

test('real SDK login uses the password endpoint, emits identity and supports local logout', async t => {
  const calls = [], users = [];
  const client = createClient('https://test.supabase.co', 'sb_publishable_test', {
    auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
    global: { fetch: async (url, options) => {
      calls.push({url:String(url), body:options?.body && JSON.parse(options.body)});
      if (String(url).includes('/logout')) return new Response(null,{status:204});
      return Response.json({access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'user-1',email:'test@example.com',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-10T00:00:00Z'}});
    } },
  });
  const service = createAuthService(client);
  const unsubscribe = service.subscribe(user => users.push(user)); t.after(unsubscribe);
  assert.deepEqual(await service.signIn(' test@example.com ','password'), {id:'user-1',email:'test@example.com'});
  assert.match(calls[0].url,/\/auth\/v1\/token\?grant_type=password/);
  assert.equal(calls[0].body.email,'test@example.com');
  assert.deepEqual(await service.restore(), {id:'user-1',email:'test@example.com'});
  assert.ok(users.some(user => user?.id === 'user-1'));
  await service.signOut(); assert.equal(await service.restore(),null);
  assert.ok(calls.some(call => call.url.includes('scope=local')));
  assert.ok(!JSON.stringify(users).includes('test-access-token'));
});

test('email confirmation signup does not authenticate; SDK errors remain failures', async () => {
  const client = createClient('https://test.supabase.co','sb_publishable_test', {
    auth: {persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global: {fetch: async url => String(url).includes('/signup') ? Response.json({id:'new-user',email:'new@example.com',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:'2026-10-10'}) : Response.json({msg:'Invalid credentials',code:'invalid_credentials'},{status:400,headers:{'x-supabase-api-version':'2024-01-01'}})},
  });
  const service=createAuthService(client);
  assert.deepEqual(await service.signUp('new@example.com','password'),{needsConfirmation:true});
  assert.equal(await service.restore(),null);
  await assert.rejects(service.signIn('new@example.com','wrongpassword'), error => authErrorMessage(error).includes('비밀번호'));
});
function secureMock() {
  const values=new Map(); let fail=false;
  return { values, setFailure: value => {fail=value;},
    driver:{ getItemAsync:async key=>values.get(key)??null, setItemAsync:async(key,value)=>{if(fail&&key.includes('.'))throw new Error('storage failed');values.set(key,value);}, deleteItemAsync:async key=>{values.delete(key);} },
  };
}
test('large Unicode sessions round-trip below native value limits and logout clears fragments', async () => {
  const mock=secureMock(), storage=createSecureSessionStorage(mock.driver);
  const text=JSON.stringify({token:'x'.repeat(6000),metadata:'🧑가'.repeat(1200)});
  await storage.setItem('auth',text);
  assert.equal(await storage.getItem('auth'),text);
  for(const value of mock.values.values())assert.ok(Buffer.byteLength(value,'utf8')<2048);
  await storage.removeItem('auth'); assert.equal(mock.values.size,0);
});
test('failed refresh preserves previous session and later writes still work', async () => {
  const mock=secureMock(), storage=createSecureSessionStorage(mock.driver);
  await storage.setItem('auth','old-session');mock.setFailure(true);
  await assert.rejects(storage.setItem('auth','new-session'),/storage failed/);
  assert.equal(await storage.getItem('auth'),'old-session');
  mock.setFailure(false);await storage.setItem('auth','recovered');
  assert.equal(await storage.getItem('auth'),'recovered');
  assert.equal(mock.values.size,2);
});
test('corrupt or incomplete sessions become guest and allow a fresh sign-in', async () => {
  const mock=secureMock(), storage=createSecureSessionStorage(mock.driver);
  mock.values.set('auth','{corrupt');assert.equal(await storage.getItem('auth'),null);
  await storage.setItem('auth','valid');
  const fragment=[...mock.values.keys()].find(key=>key!=='auth');mock.values.delete(fragment);
  assert.equal(await storage.getItem('auth'),null);
  await storage.setItem('auth','new');assert.equal(await storage.getItem('auth'),'new');
});
