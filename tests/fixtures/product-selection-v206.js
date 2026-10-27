// LOCAL QA ONLY. No Firebase SDK, credentials, remote writes or real records.
window.__fixtureReady = window.__fixtureReady.then(async () => {
  const role = new URLSearchParams(location.search).get('role') || 'owner';
  const uid = 'qa-products-' + role, businessId = 'desktop-shell-fixture', spaceId = 'fixture-space', origin = {uid,businessId,workspaceGeneration:0};
  const fixtureData = structuredClone(DB.carregar());
  await DB.useBusiness(businessId,{uid,permissionSignature:'qa-v206'});
  DB.salvar(fixtureData);
  window.BusinessContext.get = () => ({businessId,role:role==='owner'?'owner':'seller',status:'active',spaceAccess:'selected',allowedSpaceIds:[spaceId],permissions:['products.view',...(role==='seller'?[]:['products.edit'])],access:{canMutate:true}});
  window.FirebaseSession.user.uid = uid;
  window.SpaceContext.homeSpaces = () => [{id:spaceId,name:'Laboratório QA'}];
  window.WorkspaceRuntime = {capture: () => origin};
  window.SpaceEngine = {productAllowsSpace: (p,id) => p.allowedSpaceIds?.includes(id)};
  DB.alterar(data => data.produtos.forEach(p => Object.assign(p,{businessId,workspaceGeneration:0,active:true,spaceAccessMode:'single_space',allowedSpaceIds:[spaceId],defaultSpaceId:spaceId})));
  await DB.flush();
  const remote = new Map(DB.carregar().produtos.map(p => [p.id,structuredClone(p)])), queue = [], stages = [];
  const original = DB.alterar;
  const qa = window.__productQA = {remote,queue,stages,mode:'success',blockedId:'p2',reads:0,errors:window.__desktopAuditErrors};
  DB.alterar = fn => {
    const before = structuredClone(DB.carregar());
    const result = original(fn), after = DB.carregar();
    for (const p of after.produtos) {
      const old = before.produtos.find(x => x.id===p.id);
      if (p.catalogAction && p.catalogAction.operationId !== old?.catalogAction?.operationId) {
        const patch = Object.fromEntries(Object.entries(p).filter(([k,v]) => JSON.stringify(v)!==JSON.stringify(old?.[k])));
        stages.push({id:p.id,patch});
        queue.push({operationId:p.operationId,status:'pending',paths:[`businesses/${businessId}/products/${p.id}`]});
        if (qa.mode==='success'||p.id!==qa.blockedId && qa.mode==='partial') Object.assign(remote.get(p.id),structuredClone(patch));
      }
    }
    return result;
  };
  SyncFirebase.getQueueDiagnostics = () => queue;
  window.FirestoreRepositories = {products:{getProductStatusFromServer:async id=>{
    qa.reads++;
    if(qa.mode==='offline')throw Error('Rede QA indisponível');
    if(qa.mode==='partial'&&id===qa.blockedId&&stages.some(s=>s.id===id))throw Error('Confirmação QA temporariamente indisponível');
    return structuredClone(remote.get(id));
  }}};
  qa.snapshot = () => ({products:DB.carregar().produtos,variants:DB.carregar().variacoesProdutos,sales:DB.carregar().vendas,payments:DB.carregar().pagamentos,movements:DB.carregar().movimentacoesEstoque});
  qa.original = structuredClone(qa.snapshot());
  document.querySelector('.brand').innerHTML = '<img src="../assets/veconi-symbol.svg" alt="VECONI" style="width:48px;height:48px"><small>Laboratório QA · dados fictícios</small>';
  document.querySelector('.local-badge').textContent = 'QA sem rede';
});
