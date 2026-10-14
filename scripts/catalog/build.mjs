// node --env-file=<.env> scripts/catalog/build.mjs --raw <unzipped Kaggle folder> [--out data/products-amazon.json]
import {readFileSync,writeFileSync,readdirSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {parseArgs} from 'node:util';
import {parseCsv,candidates,toRow,awkward,SUBCATEGORIES} from './transform.mjs';
import {translateAll} from './translate.mjs';
const {values:args}=parseArgs({options:{raw:{type:'string'},out:{type:'string',default:'data/products-amazon.json'},cache:{type:'string',default:'data/.gemini-cache.json'}}});
if(!args.raw)throw Error('--raw <압축 해제 폴더>가 필요합니다.');
const apiKey=process.env.GEMINI_API_KEY;
if(!apiKey)throw Error('GEMINI_API_KEY가 없습니다. node --env-file=<.env 경로> 로 실행하세요.');
const rows=readdirSync(args.raw).filter(f=>f.endsWith('.csv')&&f!=='Amazon-Products.csv')
 // Filter per file: all 550k rows at once exceed the default Node heap.
 .flatMap(f=>parseCsv(readFileSync(join(args.raw,f),'utf8')).filter(r=>SUBCATEGORIES.includes(r.sub_category)));
if(!rows.length)throw Error('읽은 CSV 행이 없습니다. --raw 경로를 확인하세요.');
const cands=candidates(rows);
mkdirSync(dirname(args.out),{recursive:true});mkdirSync(dirname(args.cache),{recursive:true});
const cache=existsSync(args.cache)?JSON.parse(readFileSync(args.cache,'utf8')):{};
console.log(`rows ${rows.length} → candidates ${cands.length}, cached ${cands.filter(c=>cache[c.asin]).length}`);
try{await translateAll(cands,cache,{apiKey,model:process.env.GEMINI_MODEL||undefined,onBatch:c=>{writeFileSync(args.cache,JSON.stringify(c));process.stdout.write('.');}});}
finally{writeFileSync(args.cache,JSON.stringify(cache));}
const kept=cands.filter(c=>cache[c.asin]&&cache[c.asin].category!=='exclude'&&!awkward(c.name,cache[c.asin].category));
const out=kept.map(c=>toRow(c,cache[c.asin]));
writeFileSync(args.out,JSON.stringify(out,null,1));
console.log(`\nwrote ${out.length} → ${args.out}; excluded ${cands.filter(c=>cache[c.asin]?.category==='exclude').length}; awkward ${cands.filter(c=>cache[c.asin]&&awkward(c.name,cache[c.asin].category)).length}; untranslated ${cands.filter(c=>!cache[c.asin]).length}`);
console.log(Object.fromEntries(Object.entries(Object.groupBy(out,r=>r.category)).map(([k,v])=>[k,v.length])));
