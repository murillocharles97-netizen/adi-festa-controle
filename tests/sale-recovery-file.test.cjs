'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),client=require('../js/sale-recovery-client'),f=require('./helpers/customer-recovery-v205.cjs');
function fixture(){const samples=[0,1,2].map(n=>f.sample(n));for(const s of samples)Object.assign(s.original.packet,{reviewState:'manual_review',replayBlocked:true,lastErrorMessage:'Alias de estoque divergente.'});return{samples,snapshot:{identity:{uid:f.seller,businessId:f.bid,workspaceGeneration:0},sources:[{packets:samples.flatMap(s=>[s.original.packet,s.packet]),local:{vendas:samples.map(s=>s.original.localSale),movimentacoesEstoque:samples.flatMap(s=>s.original.localMovements)}}]}};}
test('two selected complete original envelopes export privately without changing source or unrelated records',async()=>{
 const {samples,snapshot}=fixture(),before=JSON.stringify(snapshot),ids=samples.slice(0,2).map(s=>s.original.packet.operationId),archive=await client.prepareExport(snapshot,ids),serialized=JSON.stringify(archive.file);
 assert.doesNotMatch(serialized,/recovery-seller|retained-sale|Produto QA|Pessoa fictícia/);assert.equal(JSON.stringify(snapshot),before);
 const data=await client.openExport(archive.file,archive.unlockCode);assert.equal(data.records.length,2);assert.deepEqual(data.records.map(r=>r.operationId),ids);
 for(const [n,record]of data.records.entries()){const original=JSON.parse(record.originalJson);assert.deepEqual(original.packet,samples[n].original.packet);assert.deepEqual(original.localSale,samples[n].original.localSale);assert.deepEqual(original.localMovements,samples[n].original.localMovements);assert.equal(original.clientDependencies.length,1);assert.deepEqual(original.clientDependencies[0].packet,samples[n].packet);}
 const report=await require('../scripts/validate-sale-recovery-file.cjs').validate(archive.file,archive.unlockCode);assert.equal(report.valid,true);assert.equal(report.commercialEffects,false);assert.equal(report.operations.length,2);
});
for(const selected of [[],['missing'],['retained-operation-0','retained-operation-0']])test('empty, missing or duplicate selection fails without inventing packets: '+JSON.stringify(selected),async()=>{const {snapshot}=fixture();await assert.rejects(client.prepareExport(snapshot,selected));});
test('wrong key and tampering are rejected; original identity and hashes cannot be forged',async()=>{
 const {snapshot}=fixture(),archive=await client.prepareExport(snapshot,['retained-operation-0']);await assert.rejects(client.openExport(archive.file,'a'.repeat(32)),/Código incorreto/);
 const altered={...archive.file,ciphertext:(archive.file.ciphertext[0]==='0'?'1':'0')+archive.file.ciphertext.slice(1)};await assert.rejects(client.openExport(altered,archive.unlockCode),/inválido/);
 const data=await client.openExport(archive.file,archive.unlockCode);data.records[0].operationId='forged';await assert.rejects(client.validateExport(data),/divergente/);
});
test('foreign actor, company, generation and product-only diagnostics cannot become sale envelopes',async()=>{
 const {snapshot}=fixture();for(const field of [{uid:'owner'},{businessId:'other'},{workspaceGeneration:1}])await assert.rejects(client.prepareExport({...snapshot,identity:{...snapshot.identity,...field}},['retained-operation-0']),/disponível/);
 const product={...snapshot, sources:[{packets:[{operationId:'product-only',businessId:f.bid,userId:f.seller,status:'error',lastErrorCode:'permission-denied',reviewState:'manual_review',payload:{writes:[{entityType:'products',entityId:'product',operation:'update',data:{estoque:5}}]}}],local:{}}]};await assert.rejects(client.prepareExport(product,['product-only']),/disponível/);
});
test('conflicting copies and credentials block export rather than trimming or guessing originals',async()=>{
 const {snapshot}=fixture(),bad=structuredClone(snapshot.sources[0]);bad.packets[0].payload.writes[0].data.valorFinal=999;snapshot.sources.push(bad);await assert.rejects(client.prepareExport(snapshot,['retained-operation-0']),/cópias diferentes/);
 snapshot.sources.pop();snapshot.sources[0].packets[0].access_token='secret-must-not-export';await assert.rejects(client.prepareExport(snapshot,['retained-operation-0']),/campo protegido/);
});
test('an unrelated conflicting sale cannot block export of selected original operations',async()=>{
 const {snapshot}=fixture(),other=structuredClone(snapshot.sources[0].packets.find(p=>p.operationId==='retained-operation-2'));other.payload.writes[0].data.valorFinal=999;snapshot.sources.push({packets:[other],local:{}});
 const candidates=client.exportCandidates(snapshot);assert.equal(candidates.rows.length,2);assert.equal(candidates.blocked.length,1);assert.equal(candidates.blocked[0].operationId,'retained-operation-2');const archive=await client.prepareExport(snapshot,['retained-operation-0','retained-operation-1']);assert.equal((await client.openExport(archive.file,archive.unlockCode)).records.length,2);
});
module.exports={fixture};
