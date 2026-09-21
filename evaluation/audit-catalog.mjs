import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validDate} from '../lib/language.mjs';

const raw=readFileSync(new URL('../lib/products.json',import.meta.url));
const products=JSON.parse(raw);
const archived=JSON.parse(readFileSync(new URL('../docs/research/products.json',import.meta.url)));
const errors=[];const ids=new Set();
const categories=['fruit','hangwa','nuts','tea','coffee','oil'];
for(const p of products){
 const fail=message=>errors.push(`${p.id??'<missing id>'}: ${message}`);
 if(typeof p.id!=='string'||!p.id||ids.has(p.id))fail('missing or duplicate ID');
 ids.add(p.id);
 for(const key of ['name','brand','description'])if(typeof p[key]!=='string'||!p[key].trim())fail(`invalid ${key}`);
 if(!categories.includes(p.category))fail('unknown category');
 for(const key of ['price_krw','shipping_fee_per_set_krw','stock_sets'])if(!Number.isSafeInteger(p[key])||p[key]<(key==='price_krw'?1:0))fail(`invalid ${key}`);
 for(const key of ['ingredients','allergens_declared'])if(!Array.isArray(p[key])||p[key].some(x=>typeof x!=='string'||!x.trim()))fail(`invalid ${key}`);
 if(!['sweet','naturally_sweet','unsweetened'].includes(p.sweetness))fail('unknown sweetness');
 if(!['basic','formal'].includes(p.packaging))fail('unknown packaging');
 if(typeof p.arrival_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.arrival_date)||!validDate(p.arrival_date))fail('invalid arrival date');
 if(p.synthetic!==true)fail('non-synthetic item requires a separate provenance review');
 if(p.allergen_information_complete!==false)fail('synthetic catalog must not claim complete allergen information');
}
if(products.length!==30)errors.push('expected 30 fixture products');
if(JSON.stringify(products)!==JSON.stringify(archived))errors.push('research catalog differs from runtime catalog');
const result={scope:'synthetic fixture integrity; not legal clearance or real product verification',sha256:createHash('sha256').update(raw).digest('hex'),count:products.length,categories:Object.fromEntries(categories.map(c=>[c,products.filter(p=>p.category===c).length])),errors};
console.log(JSON.stringify(result,null,2));
if(errors.length)process.exitCode=1;
