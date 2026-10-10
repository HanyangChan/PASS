import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../mobile/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
const conversation = '00000000-0000-4000-8000-000000000003';
const migration = readFileSync(new URL('../migrations/202610100001_initial_pass.sql', import.meta.url), 'utf8');
async function setup(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${alice}'), ('${bob}');`);
  await db.exec(migration);
  await db.exec(`insert into public.conversations(id,user_id,title) values ('${conversation}','${alice}','private');
    insert into public.messages(conversation_id,user_id,role,content) values ('${conversation}','${alice}','user','private message');
    insert into public.gift_records(user_id,kind,gift_key,snapshot) values ('${alice}','saved','demo','{}');
    insert into public.products(id,name,category,price_krw,is_active) values ('visible','tea','tea',1000,true),('hidden','draft','tea',2000,false);`);
  return db;
}
async function asUser(db, user) {
  await db.exec('reset role; set role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
}
test('owners can read their data while other users cannot read, update or delete it', async t => {
  const db = await setup(t); await asUser(db, alice);
  for (const table of ['conversations','messages','gift_records']) assert.equal((await db.query(`select * from public.${table}`)).rows.length, 1);
  await asUser(db, bob);
  for (const table of ['conversations','messages','gift_records']) {
    assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0);
    assert.equal((await db.query(`delete from public.${table} returning id`)).rows.length, 0);
  }
  assert.equal((await db.query("update public.conversations set title='stolen' returning id")).rows.length, 0);
  await asUser(db, alice);
  assert.equal((await db.query('select title from public.conversations')).rows[0].title, 'private');
});
test('spoofed owners and messages attached to another owner conversation are rejected', async t => {
  const db = await setup(t); await asUser(db, bob);
  await assert.rejects(db.query('insert into public.conversations(user_id) values ($1)', [alice]), /row-level security/);
  await assert.rejects(db.query('insert into public.messages(conversation_id,user_id,role,content) values ($1,$2,\'user\',\'attack\')', [conversation,bob]), /foreign key/);
  await assert.rejects(db.query("insert into public.gift_records(user_id,kind,gift_key,snapshot) values ($1,'saved','attack','{}')", [alice]), /row-level security/);
  await asUser(db, alice);
  await assert.rejects(db.query('update public.conversations set user_id=$1', [bob]), /row-level security/);
});
test('guests can read active products but cannot access personal data or alter prices', async t => {
  const db = await setup(t); await db.exec('set role anon;');
  assert.deepEqual((await db.query('select id from public.products')).rows, [{id:'visible'}]);
  for (const table of ['conversations','messages','gift_records']) await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
  await assert.rejects(db.query('update public.products set price_krw=0'), /permission denied/);
});
test('owner writes and deletes work; deleting conversations cascades only their messages', async t => {
  const db = await setup(t); await asUser(db, bob);
  await db.query('insert into public.conversations(user_id,title) values ($1,\'bob\')',[bob]);
  await db.query("insert into public.gift_records(user_id,kind,gift_key,snapshot) values ($1,'prepared','gift','{}')",[bob]);
  await asUser(db, alice);
  await db.query('delete from public.conversations where id=$1',[conversation]);
  assert.equal((await db.query('select * from public.messages')).rows.length,0);
  await asUser(db,bob);
  assert.equal((await db.query('select * from public.conversations')).rows.length,1);
  assert.equal((await db.query('select * from public.gift_records')).rows.length,1);
});
