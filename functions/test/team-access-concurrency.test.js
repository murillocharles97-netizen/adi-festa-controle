'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {teamAccessService}=require('../src/services/team-access-service');
const clone=value=>JSON.parse(JSON.stringify(value));
const businessId='qa_team',ownerUid='qa_owner',targetUid='qa_seller';
const original=()=>({uid:targetUid,name:'Pessoa QA',email:'pessoa@example.invalid',role:'seller',status:'active',spaceAccess:'selected',allowedSpaceIds:['qa_a','qa_b'],permissions:{'sales.create':true,'products.view':true,'financial.view':false}});
const accessOf=member=>Object.fromEntries(['role','status','spaceAccess','allowedSpaceIds','permissions'].filter(key=>Object.hasOwn(member,key)).map(key=>[key,clone(member[key])]));

function fixture(member=original()){
  const records=new Map([
    [`businesses/${businessId}`,{active:true,ownerId:ownerUid,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}}],
    [`businesses/${businessId}/members/${ownerUid}`,{uid:ownerUid,role:'owner',status:'active',permissions:{},spaceAccess:'all'}],
    [`businesses/${businessId}/members/${targetUid}`,clone(member)],
    [`users/${ownerUid}`,{uid:ownerUid,active:true,businessId,role:'owner'}],
    ['financialSpaces/qa_a',{id:'qa_a',businessId,active:true}],
    ['financialSpaces/qa_b',{id:'qa_b',businessId,active:true}],
  ]),writes=[],reads=[];
  const snapshot=ref=>({id:ref.path.split('/').at(-1),ref,exists:records.has(ref.path),data:()=>clone(records.get(ref.path)||{})});
  const db={doc:path=>{const ref={path,id:path.split('/').at(-1)};ref.get=async()=>snapshot(ref);return ref;},runTransaction:async action=>action({get:async ref=>{reads.push(ref.path);return snapshot(ref);},set:(ref,value,options)=>writes.push({path:ref.path,value,options})})};
  const service=teamAccessService(db,{FieldValue:{serverTimestamp:()=>({qaTimestamp:true})}});
  const request=expectedAccess=>({auth:{uid:ownerUid,token:{email:'owner@example.invalid'}},data:{businessId,uid:targetUid,name:'Pessoa QA revisada',workspaceGeneration:0,...(expectedAccess===undefined?{}:{expectedAccess})}});
  return{records,writes,reads,service,request};
}

test('snapshot idêntico permite atualização pelo proprietário e comparação não modifica o snapshot',async()=>{
  const f=fixture(),expected=accessOf(original()),before=clone(expected);
  const result=await f.service.updateMember(f.request(expected));
  assert.equal(result.member.name,'Pessoa QA revisada');
  assert.equal(f.writes.length,4);
  assert.deepEqual(expected,before);
  assert.equal(f.reads[0],`businesses/${businessId}`);
  assert.equal(f.reads[1],`businesses/${businessId}/members/${targetUid}`);
});

test('ordem das chaves do mapa e dos espaços não cria conflito falso',async()=>{
  const f=fixture(),expected=accessOf(original());
  expected.permissions={'financial.view':false,'products.view':true,'sales.create':true};
  expected.allowedSpaceIds=['qa_b','qa_a'];
  await f.service.updateMember(f.request(expected));
  assert.equal(f.writes.length,4);
});

for(const [name,mutate]of[
  ['cargo',value=>value.role='manager'],
  ['status',value=>value.status='disabled'],
  ['modo dos espaços',value=>value.spaceAccess='all'],
  ['espaços autorizados',value=>value.allowedSpaceIds=['qa_a']],
  ['permissão alterada',value=>value.permissions['sales.create']=false],
  ['nova permissão',value=>value.permissions['inventory.view']=true],
  ['false explícito removido',value=>delete value.permissions['financial.view']],
])test(`snapshot desatualizado em ${name} aborta antes de qualquer escrita`,async()=>{
  const expected=accessOf(original()),f=fixture();
  mutate(f.records.get(`businesses/${businessId}/members/${targetUid}`));
  await assert.rejects(f.service.updateMember(f.request(expected)),error=>error.code==='aborted');
  assert.equal(f.writes.length,0);
});

test('false explícito esperado não equivale a campo ausente no registro persistido',async()=>{
  const member=original();delete member.permissions['financial.view'];
  const f=fixture(member);
  await assert.rejects(f.service.updateMember(f.request(accessOf(original()))),error=>error.code==='aborted');
  assert.equal(f.writes.length,0);
});

test('mapa esparso idêntico não é preenchido por preset durante a comparação',async()=>{
  const member=original();member.permissions={'sales.create':false};
  const f=fixture(member);await f.service.updateMember(f.request(accessOf(member)));
  assert.equal(f.writes.length,4);
});

test('permissões em array raw não equivalem a mapa ou preset preenchido',async()=>{
  const member=original();member.permissions=['sales.create','products.view'];
  const f=fixture(member),expected=accessOf(member);
  expected.permissions={'sales.create':true,'products.view':true};
  await assert.rejects(f.service.updateMember(f.request(expected)),error=>error.code==='aborted');
  assert.equal(f.writes.length,0);
});

test('array raw de permissões idêntico continua compatível',async()=>{
  const member=original();member.permissions=['sales.create','products.view'];
  const f=fixture(member);await f.service.updateMember(f.request(accessOf(member)));
  assert.equal(f.writes.length,4);
});

test('registro sem campo permissions não equivale a permissions vazio',async()=>{
  const member=original();delete member.permissions;
  const f=fixture(member),expected=accessOf(member);expected.permissions={};
  await assert.rejects(f.service.updateMember(f.request(expected)),error=>error.code==='aborted');
  assert.equal(f.writes.length,0);
});

test('cliente antigo sem expectedAccess mantém o contrato de atualização',async()=>{
  const f=fixture();await f.service.updateMember(f.request());
  assert.equal(f.writes.length,4);
});

for(const expected of[null,false,'snapshot',[]])test(`snapshot inválido ${JSON.stringify(expected)} é rejeitado sem escrita`,async()=>{
  const f=fixture();await assert.rejects(f.service.updateMember(f.request(expected)),error=>error.code==='invalid-argument');
  assert.equal(f.writes.length,0);
});
