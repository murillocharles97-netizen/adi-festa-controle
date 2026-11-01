/* Fictitious QA only; never deployed. No Firebase or production fallback. */
(function () {
  const now=new Date(),today=now.toISOString(),yesterday=new Date(now.getTime()-86400000).toISOString();
  const grants={'sales.create':true,'customers.view':true,'products.view':true,'inventory.view':true,'performance.daily':true,'performance.history':false};
  const owner={uid:'qa-owner',role:'owner',status:'active',permissionsVersion:3,permissions:{},spaceAccess:'all',allowedSpaceIds:[]};
  const seller={uid:'qa-seller',name:'Pessoa de teste',email:'pessoa@example.invalid',role:'seller',status:'active',permissionsVersion:3,permissions:grants,spaceAccess:'selected',allowedSpaceIds:['qa-a']};
  let current={businessId:'qa-business',business:{id:'qa-business',name:'Loja fictícia QA',ownerId:'qa-owner',active:true,workspaceGeneration:0,timezone:'America/Sao_Paulo'},userProfile:{uid:'qa-seller',businessId:'qa-business',active:true},role:'seller',member:seller,permissions:Object.keys(grants).filter(k=>grants[k]),spaceAccess:'selected',allowedSpaceIds:['qa-a'],permissionSignature:'qa-seller-v3',access:{canMutate:true,canAccessApp:true,features:{basicSales:true}}};
  const data={businessId:'qa-business',vendas:[{id:'today-owner',businessId:'qa-business',spaceId:'qa-a',actorUid:'qa-owner',data:today,valorFinal:120,status:'pago',itens:[]},{id:'today-other-seller',businessId:'qa-business',spaceId:'qa-a',actorUid:'qa-another-seller',data:today,valorFinal:80,status:'pago',itens:[]},{id:'old-sale',businessId:'qa-business',spaceId:'qa-a',data:yesterday,valorFinal:7777,status:'pago',itens:[]}],clientes:[],produtos:[],pagamentos:[],config:{nome:'Loja fictícia QA',timezone:'America/Sao_Paulo',dashboard:{dailySalesGoal:500,dailySalesGoalsBySpaceId:{'qa-a':500}}}};
  const effects={calls:[],commercialWrites:0,permissionWrites:0};
  window.qaV224={data,seller,owner,effects,context:()=>current,change(patch){current={...current,...patch};window.FirebaseSession={user:{uid:current.userProfile.uid},businessId:current.businessId};dispatchEvent(new CustomEvent('business-context-changed'));}};
  window.BusinessContext={get:()=>current,canAccessSpace:id=>current.role==='owner'||current.allowedSpaceIds.includes(id)};
  window.FirebaseSession={user:{uid:'qa-seller'},businessId:'qa-business'};
  window.DB={carregar:()=>data,getBusinessId:()=>current.businessId,getWorkspaceGeneration:()=>0};
  window.Utils={dinheiro:v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),escapar:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),hoje:v=>new Date(v).toDateString()===new Date().toDateString()};
  window.SpaceContext={ALL_SPACES:'all_spaces',homeId:()=> 'qa-a',homeSpaces:()=>[{id:'qa-a',businessId:'qa-business',name:'Loja QA'}],bind(){},renderBar:()=>'<div class="space-context-bar">Loja QA · espaço autorizado</div>',contextualData:d=>({...d,spaceSelectionId:'qa-a'}),goalFor:()=>500};
  window.Router={atual:()=> 'inicio',ir(){}};window.Campanhas={status:()=>'',metricas:()=>({})};window.OperationMode={enabled:()=>false};window.CustomerSubscriptions={metrics:()=>({})};window.getProductStockStatus=()=> 'disponivel';window.lucide={createIcons(){}};
  window.TeamService={updateMember:async()=>{effects.permissionWrites++;throw Error('QA visual não salva permissões.');}};
  window.FirebaseCallable=async(name,input)=>{
    effects.calls.push({name,input});if(name!=='getDailySalesPerformance')throw Error('Somente leitura do resumo fictício está disponível.');
    return{data:{businessId:input.businessId,workspaceGeneration:0,day:window.VeconiPermissionPolicy.dayKey(new Date(),'America/Sao_Paulo'),timezone:'America/Sao_Paulo',spaceId:input.spaceId,spaceIds:['qa-a'],revenueCents:20000,saleCount:2,goalCents:50000,progressPercent:40,remainingCents:30000,asOf:new Date().toISOString(),source:'canonical',scope:'daily'}};
  };
})();
