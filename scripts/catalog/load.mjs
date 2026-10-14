// node --env-file=.env scripts/catalog/load.mjs --in data/products-amazon.json [--dry-run]
// .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (team project admin only; never commit or deploy it).
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {CATEGORIES} from '../../lib/catalog.mjs';
export const MIN_ROWS=100;
export function validateRows(rows){
 if(!Array.isArray(rows))throw Error('JSON 배열이 아닙니다.');
 const ids=new Set();
 for(const r of rows){
  if(!/^amz-[A-Z0-9]{10}$/.test(r.id)||ids.has(r.id))throw Error(`잘못되거나 중복된 id: ${r.id}`);ids.add(r.id);
  if(!CATEGORIES.includes(r.category)||!Number.isSafeInteger(r.price_krw)||r.price_krw<=0||typeof r.name!=='string'||!r.name.trim()||!String(r.image_url).startsWith('https://')||!String(r.source_url).startsWith('https://'))throw Error(`필드 확인 필요: ${r.id}`);
 }
 return rows;
}
export async function load(rows,{url,key,fetcher=fetch,dryRun=false,log=console.log}){
 validateRows(rows);
 const base=`${url.replace(/\/$/,'')}/rest/v1/products`;
 // sb_secret_ keys go in apikey only; legacy service_role JWTs also need Authorization.
 const auth={apikey:key,...(key.startsWith('sb_')?{}:{Authorization:`Bearer ${key}`})};
 const call=async(path,init)=>{const r=await fetcher(base+path,{...init,headers:{...auth,'Content-Type':'application/json',...init.headers}});if(!r.ok)throw Error(`Supabase ${r.status}: ${(await r.text()).slice(0,200)}`);return r;};
 const active=[];
 for(let offset=0;;offset+=1000){const page=await(await call(`?select=id&is_active=eq.true&order=id&limit=1000&offset=${offset}`,{method:'GET'})).json();active.push(...page.map(p=>p.id));if(page.length<1000)break;}
 const ids=new Set(rows.map(r=>r.id)),stale=active.filter(id=>!ids.has(id));
 const deactivate=rows.length>=MIN_ROWS?stale:[];
 if(rows.length<MIN_ROWS&&stale.length)log(`입력이 ${MIN_ROWS}개 미만이라 기존 상품 ${stale.length}개를 비활성화하지 않습니다.`);
 log(`upsert ${rows.length} · deactivate ${deactivate.length}${dryRun?' (dry-run)':''}`);
 if(dryRun)return {upserted:0,deactivated:0};
 for(let i=0;i<rows.length;i+=500)await call('?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows.slice(i,i+500))});
 for(let i=0;i<deactivate.length;i+=100)await call(`?id=in.(${deactivate.slice(i,i+100).join(',')})`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({is_active:false})});
 return {upserted:rows.length,deactivated:deactivate.length};
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const {values:args}=parseArgs({options:{in:{type:'string',default:'data/products-amazon.json'},'dry-run':{type:'boolean',default:false}}});
 const {SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key}=process.env;
 if(!url||!key)throw Error('SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 .env에 설정하세요.');
 console.log(await load(JSON.parse(readFileSync(args.in,'utf8')),{url,key,dryRun:args['dry-run']}));
}
