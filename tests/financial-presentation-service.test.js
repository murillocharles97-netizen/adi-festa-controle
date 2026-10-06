const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function service(role='owner',allowed=true){
 const source=fs.readFileSync('js/firebase/financial-space-service.js','utf8'),writes=[],stats={commits:0,invalidations:0};
 const spaces=[{id:'shop',type:'business',linkedBusinessId:'business-a',ownerUid:'owner'},{id:'other',type:'business',linkedBusinessId:'business-b',ownerUid:'other'},{id:'personal',type:'personal',ownerUid:'owner'}];
 const scope={window:{BusinessContext:{get:()=>({businessId:'business-a',role,member:{status:'active'}})},TeamAccess:{has:()=>allowed}},state:{spaces},auth:{currentUser:{uid:role==='owner'?'owner':'employee'}},db:{},
  assertSpace:id=>{const s=spaces.find(s=>s.id===id);if(!s)throw Error('Invalid space');return s;},requiredText:v=>String(v),childRef:(home,collection,id)=>({path:`financialSpaces/${home}/${collection}/${id}`}),
  now:()=>new Date().toISOString(),writeBatch:()=>({update:(ref,data)=>writes.push({path:ref.path,data}),commit:async()=>{stats.commits++;}}),invalidateFinancialAccountCatalog:()=>stats.invalidations++,invalidateCreditCardCatalog:()=>stats.invalidations++};
 vm.createContext(scope);
 vm.runInContext(source.slice(source.indexOf('function financialInstitutionRefs('),source.indexOf('async function updateFinancialInstitution('))+source.slice(source.indexOf('function canCustomizeFinancialPresentation('),source.indexOf('async function archiveFinancialInstitution(')),scope);
 return {update:scope.updateFinancialPresentation,can:scope.canCustomizeFinancialPresentation,writes,stats};
}
const input=()=>({accounts:[{id:'inter',accountHomeSpaceId:'shop'}],cards:[{id:'inter-card',cardHomeSpaceId:'shop'}],presentation:{displayName:'Inter Principal',color:'#c64e00',gradientVariant:'gradient'},cardNicknames:{'financialSpaces/shop/creditCards/inter-card':'Inter Pessoal'}});
test('actual service writes only presentation metadata in one atomic batch, never financial fields',async()=>{
 const s=service(),data=input(),before=JSON.stringify(data);await s.update(data);assert.equal(s.stats.commits,1);assert.equal(s.writes.length,2);assert.equal(JSON.stringify(data),before);
 for(const write of s.writes)assert.deepEqual(Object.keys(write.data).sort(),['presentation','presentationUpdatedAt']);
 assert.equal(s.writes[1].data.presentation.cardNickname,'Inter Pessoal');assert.equal(s.stats.invalidations,2);
});
test('service blocks seller, unauthorized manager, other business and personal resources of another user',async()=>{
 for(const [role,allowed]of [['seller',true],['manager',false]]){const s=service(role,allowed);await assert.rejects(()=>s.update(input()));assert.equal(s.stats.commits,0);}
 const manager=service('manager');assert.equal(manager.can('shop'),true);assert.equal(manager.can('other'),false);assert.equal(manager.can('personal'),false);
 const s=service();await assert.rejects(()=>s.update({...input(),accounts:[{id:'x',accountHomeSpaceId:'other'}]}));assert.equal(s.stats.commits,0);
});
test('reset clears only appearance; invalid style/color/name cannot reach a committed write',async()=>{
 const s=service();await s.update({...input(),reset:true});for(const w of s.writes)assert.equal(JSON.stringify(w.data.presentation),'{}');
 for(const patch of [{displayName:'x'.repeat(81)},{color:'red;display:none'},{gradientVariant:'script'}]){const bad=service();await assert.rejects(()=>bad.update({...input(),presentation:{...input().presentation,...patch}}));assert.equal(bad.stats.commits,0);}
});
