'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');
const { root, save } = require('./performance-lab-helpers.cjs');
const read = file => fs.readFileSync(path.join(root,file));
const html = read('index.html').toString();
const tags = [...html.matchAll(/<(?:script|link)\b[^>]+>/g)].map(([tag])=>tag);
const spec = tags.flatMap(tag=>{
 const url=tag.match(/(?:src|href)="(\.\/[^"#]+)"/)?.[1];
 if(!url || (tag.startsWith('<link')&&!tag.includes('rel="stylesheet"')))return [];
 return [url];
});
const precache = vm.runInNewContext(read('service-worker.js')+'\nARQUIVOS',{self:{addEventListener(){}}});
const summarize = paths => paths.map(url=>{
 const file=url.split('?')[0].slice(2)||'index.html';
 try {const bytes=read(file);const textual=/\.(js|css|html|svg|json)$/.test(file);
  return {url,file,bytes:bytes.length,gzip:textual?gzipSync(bytes).length:bytes.length};}
 catch(error){return {url,file,error:error.code};}
});
function totals(rows){
 return {files:rows.length,distinct:new Set(rows.map(x=>x.url)).size,errors:rows.filter(x=>x.error),
  uncompressed:rows.reduce((n,x)=>n+(x.bytes||0),0),gzipEstimate:rows.reduce((n,x)=>n+(x.gzip||0),0),
  top:[...rows].sort((a,b)=>(b.bytes||0)-(a.bytes||0)).slice(0,12)};
}
const css = summarize(spec.filter(s=>s.includes('.css')));
const js = summarize(spec.filter(s=>s.includes('.js')));
const all = summarize(precache);
const bridge = read('css/veconi-fluxo.css').toString();
const bridgeBody=bridge.match(/\/\*[^*]*?(?:bridge|ponte)[^*]*?\*\//gi);
save('static.json',{css:totals(css),js:totals(js),precache:totals(all),
  precacheUrlVariants:spec.filter(url=>url.includes('?')&&precache.includes(url.split('?')[0])&&!precache.includes(url)).length,
  bridgeSelectors:bridge.match(/\.vf-dark-1c\b/g)?.length,bridgeComments:bridgeBody?.slice(0,4)});
