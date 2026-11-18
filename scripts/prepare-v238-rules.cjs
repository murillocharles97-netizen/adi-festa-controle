'use strict';
// Preparation only: preserve the active policy and add two restrictive public-cost guards.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
function prepare(input,output){
 const before=fs.readFileSync(input,'utf8'),start=before.indexOf('match /products/{productId} {'),end=before.indexOf('\n      match /',start+1);assert.ok(start>=0&&end>start);
 const original=before.slice(start,end);let block=original;
 for(const op of ['create','update']){const anchor='allow '+op+': if ';assert.equal(block.split(anchor).length,2);block=block.replace(anchor,anchor+"!request.resource.data.keys().hasAny(['serviceCostConfig']) && ");}
 const after=before.slice(0,start)+block+before.slice(end);assert.equal(after.replaceAll("!request.resource.data.keys().hasAny(['serviceCostConfig']) && ",''),before);assert.ok(!fs.existsSync(output),'Use a new output path');fs.writeFileSync(output,after);
 const sha=x=>crypto.createHash('sha256').update(x).digest('hex');return{activeSha256:sha(before),selectiveSha256:sha(after),restrictiveGuards:2,deployExecuted:false};
}
if(require.main===module){const[a,b]=process.argv.slice(2);assert.ok(a&&b);console.log(JSON.stringify(prepare(a,b)));}module.exports={prepare};
