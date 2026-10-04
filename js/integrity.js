(function(root){
  'use strict';
  // Audit-only projection. Never use this to write a document or repair money.
  const meta=new Set(['origin','ownerId','createdAt','criadoEm','updatedAt','atualizadoEm','serverUpdatedAt','localUpdatedAt','revision','version','schemaVersion','syncConfirmedAt','cacheMetadata','syncDiagnostics','runtimeMetadata','imageUploadStatus','imageOperationId','workspaceWriteId']);
  const numberKeys=new Set('saldo saldoAnterior saldoAtual saldoNovo saldoPendente valor valorTotal valorFinal subtotalOriginal descontoTotal custoTotal lucro custo cost price stock minStock preco minPrice maxPrice estoque estoqueAtual estoqueMinimo totalStock activeVariationCount financialVersion totalComprado quantidadeVendas quantidade quantity custoUnitario costSnapshot durationValue spaceScopeVersion'.split(' '));
  const setKeys=new Set(['allowedSpaceIds','etiquetas']);
  const copy=x=>structuredClone(x);
  const numeric=x=>typeof x==='string'&&x.trim()!==''&&Number.isFinite(Number(x))?Number(x):x;
  function stable(value,key=''){
    if(value===undefined)return undefined;
    if(value instanceof Date)return value.toISOString();
    if(value&&typeof value.toDate==='function')return value.toDate().toISOString();
    if(value&&typeof value==='object'&&('seconds'in value||'_seconds'in value)&&Object.keys(value).every(k=>['seconds','nanoseconds','_seconds','_nanoseconds'].includes(k)))return new Date(Number(value.seconds??value._seconds)*1000+Number(value.nanoseconds??value._nanoseconds??0)/1e6).toISOString();
    if(Array.isArray(value)){const result=value.map(v=>stable(v));return setKeys.has(key)?[...new Set(result)].sort():result;}
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k],k)]));
    if(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)&&/(At|Em)$|^(data|date)$/.test(key)&&Number.isFinite(Date.parse(value)))return new Date(value).toISOString();
    return numberKeys.has(key)?numeric(value):value;
  }
  const fill=(doc,defaults)=>{for(const[k,v]of Object.entries(defaults))if(doc[k]===undefined||doc[k]===null)doc[k]=copy(v);return doc;};
  function canonicalizeForIntegrity(entity,document,options={}){
    // Normalize Firestore timestamps before structuredClone erases prototypes.
    const d=stable(document||{}),fin=options.financial||{};
    if(options.businessId&&!d.businessId)d.businessId=options.businessId;
    if(entity==='clients'){
      fill(d,{telefone2:'',email:'',endereco:'',complemento:'',documento:'',observacoes:d.observacao??'',totalComprado:0,quantidadeVendas:0,ultimaCompra:null});
      fill(d,{apelido:'',cidade:'',estado:'',etiquetas:[],financialVersion:0,marketingConsent:false,marketingConsentAt:null,marketingConsentRevokedAt:null,marketingConsentSource:null,origemCadastro:'app',promessaPagamento:null,lastChargeAt:null,lastChargeMessageId:null});
      if(!d.normalizedPhone)d.normalizedPhone=options.normalizePhone?.(d.telefoneNormalizado||d.telefone)||'';
      // Compared separately when authoritative token exists on both sides.
      delete d.portalRefToken;
    }
    if(entity==='products'){
      fill(d,{itemKind:'product',productType:'simple',imageMode:'own',image:null,attributes:[],barcode:'',barcodeType:null,barcodeUpdatedAt:null,alternateBarcodes:[],activeVariationCount:0});
      const recurring=d.productType==='recurring',stock=numeric(d.estoqueAtual??d.estoque??0);
      fill(d,{categoria:'',codigo:'',estoque:stock,estoqueAtual:stock,estoqueMinimo:0,favorito:false,palavrasChave:'',imagem:''});
      fill(d,{imageUrl:d.image?.url||d.imagem||null,imageStoragePath:d.image?.storagePath||null,imageThumbUrl:d.image?.thumbnailUrl||null,imageThumbStoragePath:d.image?.thumbnailStoragePath||null,imageUpdatedAt:d.image?.updatedAt||null});
      fill(d,{hasVariations:d.productType==='variable',durationValue:recurring?30:null,durationUnit:recurring?'days':null,renewalLabel:recurring?d.nome||'Renovação':'',renewalMessage:'',renewalReminders:[],minPrice:d.preco??0,maxPrice:d.preco??0,totalStock:stock,hasAvailableStock:stock>0});
      fill(d,options.normalizeProductAccess?.(d)||{spaceAccessMode:'all_spaces',allowedSpaceIds:[],defaultSpaceId:null,spaceScopeVersion:1});
      if(d.custo===undefined)d.custo=fin.custo??d.cost??0;
    }
    if(entity==='productVariants'){
      fill(d,{image:null,imageMode:d.imageUrl||d.imagem?'own':'inherit',imageUrl:d.imagem||null,imageThumbUrl:null,imageStoragePath:null,imageThumbStoragePath:null,imageUpdatedAt:d.image?.updatedAt||null});
      if(d.cost===undefined)d.cost=fin.cost??d.custo??0;
    }
    if(entity==='sales'){
      // Never discard financial fields. Recompose the remote projection using
      // the corresponding protected document, filling missing fields only.
      for(const k of ['custoTotal','lucro'])if(d[k]===undefined&&fin[k]!==undefined)d[k]=fin[k];
      d.itens=(d.itens||[]).map((item,index)=>{
        const cost=(fin.itemCosts||[]).find(x=>Number(x.index)===index),v={...item};
        if(cost)for(const[k,value]of Object.entries({custoUnitario:cost.custoUnitario,costSnapshot:cost.custoUnitario,custoTotal:cost.custoTotal,lucro:cost.lucro}))if(v[k]===undefined&&value!==undefined)v[k]=value;
        return v;
      });
    }
    for(const k of meta)delete d[k];
    return stable(d);
  }
  const serialized=x=>JSON.stringify(stable(x));
  function differencePaths(a,b,path=''){
    if(serialized(a)===serialized(b))return[];
    if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(k=>differencePaths(a[k],b[k],path?`${path}.${k}`:k));
    return[path||'$'];
  }
  function compare(entity,local,remote,options={}){
    const a=canonicalizeForIntegrity(entity,local,{...options,financial:options.localFinancial}),b=canonicalizeForIntegrity(entity,remote,{...options,financial:options.remoteFinancial}),fields=differencePaths(a,b);
    if(entity==='clients'&&local.portalRefToken&&remote.portalRefToken&&local.portalRefToken!==remote.portalRefToken)fields.push('portalRefToken');
    return{equal:fields.length===0,fields,representationFields:differencePaths(stable(local),stable(remote)),canonicalLocal:a,canonicalRemote:b};
  }
  function balanceContributions(local=[],remote=[]){
    const l=new Map(local.map(x=>[String(x.id),x])),r=new Map(remote.map(x=>[String(x.id),x]));
    return[...new Set([...l.keys(),...r.keys()])].sort().flatMap(clientId=>{const a=l.get(clientId),b=r.get(clientId),localBalance=a?Number(a.saldo||0):null,remoteBalance=b?Number(b.saldo||0):null,difference=Math.round(((localBalance||0)-(remoteBalance||0))*100)/100;
      return difference?[{clientId,localBalance,remoteBalance,difference,localActive:a?.active??a?.ativo??null,remoteActive:b?.active??b?.ativo??null,localDeleted:!!a?.deletedAt,remoteDeleted:!!b?.deletedAt,origin:!a?'only_remote':!b?'only_local':'common'}]:[];
    });
  }
  function severity(collections,balanceAudit){
    const issues=[];
    for(const[name,c]of Object.entries(collections)){
      const financial=['sales','payments','balanceAdjustments'].includes(name)||name.endsWith('Financials');
      for(const x of c.onlyLocal||[])issues.push({level:financial&&!x.hasPendingLocal&&x.queueStatus==='missing'?'CRITICO':'ATENCAO',category:x.category||'local_only',entityType:name,documentId:x.documentId,reason:x.reason});
      for(const x of c.onlyRemote||[])issues.push({level:financial?'CRITICO':'ATENCAO',category:'missing_local',entityType:name,documentId:x.documentId});
      for(const x of c.divergent||[])issues.push({level:financial||x.fields?.includes('saldo')?'CRITICO':'ATENCAO',category:'semantic_difference',entityType:name,documentId:x.documentId,fields:x.fields});
      for(const x of c.historicalTombstones||[])issues.push({level:'INFORMATIVO',category:'historical_tombstone',entityType:name,documentId:x.documentId});
      for(const origin of ['local','remote'])for(const x of c.possibleDuplicates?.[origin]||[])issues.push({level:financial?'CRITICO':'ATENCAO',category:'duplicate_operation',entityType:name,operationId:x.operationId,origin});
    }
    for(const x of balanceAudit?.divergent||[])issues.push({level:'CRITICO',category:'ledger_balance_difference',entityType:'clients',documentId:x.clientId,difference:x.difference});
    for(const x of balanceAudit?.effectBackfills||[])issues.push({level:'INFORMATIVO',category:'historical_effect_missing',entityType:'clients',documentId:x.clientId,balanceAlreadyApplied:true,difference:0});
    const levels=['OK','INFORMATIVO','ATENCAO','CRITICO'],level=issues.reduce((v,x)=>levels.indexOf(x.level)>levels.indexOf(v)?x.level:v,'OK');
    return{level,actionable:['ATENCAO','CRITICO'].includes(level),issues};
  }
  const verifiedLegacyDemo={p1:['products','Brigadeiro gourmet','fnv1a:e4017dac'],p2:['products','Brownie recheado','fnv1a:7cc5a729'],p3:['products','Bolo no pote','fnv1a:c9944109'],c1:['clients','Mariana Silva','fnv1a:ef817bd8'],c2:['clients','Carlos Souza','fnv1a:147a3ce6']};
  function legacyFixtureIdentity(entity,item,businessId){const proof=verifiedLegacyDemo[item?.id];return businessId==='adi-festa'&&!!proof&&proof[0]===entity&&(item.createdAt||item.criadoEm)==='2026-09-24T10:34:12.474Z';}
  function confirmedLegacyFixture(entity,item,checksum,businessId){
    const proof=verifiedLegacyDemo[item?.id];
    return legacyFixtureIdentity(entity,item,businessId)&&proof[1]===item.nome&&proof[2]===checksum&&!item.operationId&&!item.sourceOperationId&&!item.revision&&!item.deletedAt;
  }
  function fixtureCleanupPlan(data,remote,queue,checksum,businessId){
    const rows=[],blocked=[];
    for(const[entity,key]of [['clients','clientes'],['products','produtos']]){
      if(!Array.isArray(remote[entity]))continue; // Absence of a fetch is NOT proof of absence.
      for(const item of data[key]||[]){
        if(!confirmedLegacyFixture(entity,item,checksum(item),businessId))continue;
        const ref=JSON.stringify(item.id),references=Object.entries(data).filter(([k,v])=>Array.isArray(v)&&!['clientes','produtos','messageSequences','localFixtureQuarantine'].includes(k)).filter(([,v])=>v.some(x=>JSON.stringify(x).includes(ref))).map(([k])=>k);
        const queued=queue.some(x=>JSON.stringify(x.payload||{}).includes(ref));
        if(queued||references.length||remote[entity].some(x=>String(x.id)===String(item.id))){blocked.push({entityType:entity,documentId:item.id,reason:queued?'pending_operation':references.length?'referenced_record':'exists_remotely'});continue;}
        rows.push({entityType:entity,key,document:copy(item)});
      }
    }
    return{rows,blocked};
  }
  const api={canonicalizeForIntegrity,compare,differencePaths,balanceContributions,severity,legacyFixtureIdentity,confirmedLegacyFixture,fixtureCleanupPlan};
  root.IntegrityAudit=Object.freeze(api);
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
