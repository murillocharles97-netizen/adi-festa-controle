import { auth, db, BUSINESS_ID, PROJECT_ID } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { createFirestoreRepository } from './firestore-repository.js';
import { normalizeFirestoreData, sanitizeForFirestore } from './firestore-utils.js';

const QUEUE_KEY='adiFestaFirestoreQueue_v1',BATCH_SIZE=400;
const SOURCES={
  clients:{key:'clientes'},products:{key:'produtos'},sales:{key:'vendas'},payments:{key:'pagamentos'},
  balanceAdjustments:{key:'movimentacoes',filter:item=>item.tipo==='ajuste_saldo'},stockMovements:{key:'movimentacoesEstoque'},
  campaigns:{key:'campanhas'},campaignProgress:{key:'progressosCampanha'},rewards:{key:'recompensas'},charges:{key:'cobrancas'}
};
const CLOUD_NAMES=[...Object.keys(SOURCES),'settings'];
const repositories=Object.fromEntries(CLOUD_NAMES.map(name=>[name,createFirestoreRepository(name)]));
let currentUser=null,lastError='',timer=null,syncOperation=null,originalAlter=null,unsubscribers=[],subscribers=new Set(),applyingCloud=false,currentPath='';
const state={status:navigator.onLine?'idle':'offline',message:navigator.onLine?'Aguardando sincronização':'Offline — salvo no aparelho',progress:0,sent:{},failed:0,testPassed:false,lastSync:localStorage.getItem('adiFestaLastSync')||'',cloudCounts:{},activeListeners:0};

const readQueue=()=>{try{return JSON.parse(localStorage.getItem(QUEUE_KEY))||[]}catch(error){console.error('[Sync queue read]',error);return[]}};
const saveQueue=queue=>localStorage.setItem(QUEUE_KEY,JSON.stringify(queue));
const errorCode=error=>String(error?.code||'').replace('firestore/','');
const friendlyError=error=>({'permission-denied':'Seu usuário não possui permissão para acessar este negócio.','unavailable':'O Firestore está temporariamente indisponível.','unauthenticated':'Sua sessão expirou. Entre novamente.','invalid-argument':'Um registro contém dados inválidos.','failed-precondition':'O Firestore ainda não está pronto neste aparelho.'}[errorCode(error)]||error?.message||'Não foi possível sincronizar com a nuvem.');
const emit=patch=>{Object.assign(state,patch);const snapshot={...state,details:diagnostics()};subscribers.forEach(callback=>callback(snapshot));dispatchEvent(new CustomEvent('firebase-sync-status',{detail:snapshot}))};
function reportError(error,context='Firestore operation',extra={}){lastError=friendlyError(error);console.error(`[${context}]`,{...extra,code:error?.code,message:error?.message,stack:error?.stack});emit({status:'error',message:`Erro de sincronização — ${lastError}`,failed:state.failed+1});return lastError}
const normalizeText=value=>String(value||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const sourceItems=(data,name)=>{const source=SOURCES[name],items=Array.isArray(data[source.key])?data[source.key]:[];return source.filter?items.filter(source.filter):items};
const localSummary=()=>{const data=DB.carregar();return{clientes:data.clientes.length,produtos:data.produtos.length,vendas:data.vendas.length,pagamentos:data.pagamentos.length,fiado:data.clientes.reduce((total,item)=>total+Math.abs(Math.min(0,Number(item.saldo||0))),0)}};
const diagnostics=()=>{const local=localSummary();return{authenticated:Boolean(auth.currentUser),email:auth.currentUser?.email||'',uid:auth.currentUser?.uid||'',projectId:PROJECT_ID,databaseId:'(default)',businessId:BUSINESS_ID,userDocument:Boolean(window.FirebaseSession?.profile),businessDocument:Boolean(state.businessDocument),connection:state.testPassed?'funcionando':'não testada',activeListeners:state.activeListeners,localClients:local.clientes,cloudClients:state.cloudCounts.clients??'—',localProducts:local.produtos,cloudProducts:state.cloudCounts.products??'—',pending:readQueue().length,lastSync:state.lastSync||'nunca',currentPath:currentPath||`businesses/${BUSINESS_ID}`,lastError}};

function enrich(name,item){
  const clean=sanitizeForFirestore(item)||{};
  if(name==='clients')Object.assign(clean,{nomeNormalizado:normalizeText(clean.nome),telefoneNormalizado:String(clean.telefone||'').replace(/\D/g,'')});
  if(name==='products')Object.assign(clean,{nomeNormalizado:normalizeText(clean.nome),controlaEstoque:!clean.semControleEstoque});
  if(name==='sales')clean.operationId=clean.operationId||clean.id;
  return clean;
}
function cloudPayload(name,id,data){const clean=enrich(name,data);return{...clean,id:String(id),businessId:BUSINESS_ID,ownerId:currentUser.uid,schemaVersion:2,createdAt:clean.createdAt||clean.criadoEm||clean.data||serverTimestamp(),updatedAt:serverTimestamp()}}
function queueOperation(name,id,data,groupId=crypto.randomUUID()){
  if(!id){reportError(Object.assign(new Error('Registro sem identificador.'),{code:'invalid-argument'}),'Queue validation',{collection:name});return false}
  const queue=readQueue(),key=`${name}:${id}`,operation={key,groupId,collection:name,id:String(id),data:enrich(name,data),queuedAt:new Date().toISOString()},index=queue.findIndex(item=>item.key===key);
  index>=0?queue.splice(index,1,operation):queue.push(operation);saveQueue(queue);return true;
}
function captureChanges(before,after){
  if(applyingCloud)return 0;
  const groupId=crypto.randomUUID();let changed=0;
  for(const name of Object.keys(SOURCES)){
    const previous=new Map(sourceItems(before,name).map(item=>[String(item.id),item])),next=new Map(sourceItems(after,name).map(item=>[String(item.id),item]));
    for(const [id,item] of next)if(JSON.stringify(item)!==JSON.stringify(previous.get(id))){queueOperation(name,id,item,groupId);changed++}
    for(const [id,item] of previous)if(!next.has(id)){queueOperation(name,id,{...item,active:false,deletedAt:new Date().toISOString()},groupId);changed++}
  }
  if(JSON.stringify(before.config)!==JSON.stringify(after.config)){queueOperation('settings','default',after.config,groupId);changed++}
  if(changed)schedule();return changed;
}
function installHybridStorage(){
  if(originalAlter)return;
  originalAlter=DB.alterar.bind(DB);
  DB.alterar=function(mutator){const before=structuredClone(DB.carregar()),result=originalAlter(mutator),after=structuredClone(result);captureChanges(before,after);return result};
  DB.__firebaseSyncWrapped=true;
}

async function validateUser(){
  if(PROJECT_ID!=='adi-festa-controle')throw Object.assign(new Error('O app está conectado ao projeto Firebase incorreto.'),{code:'failed-precondition'});
  const user=auth.currentUser||currentUser;if(!user)throw Object.assign(new Error('Usuário não autenticado.'),{code:'unauthenticated'});
  const snapshot=await getDoc(doc(db,'users',user.uid));if(!snapshot.exists())throw Object.assign(new Error('O documento do usuário não foi encontrado.'),{code:'permission-denied'});
  const profile=snapshot.data();if(profile.active!==true||profile.businessId!==BUSINESS_ID)throw Object.assign(new Error('Usuário inativo ou vinculado a outro negócio.'),{code:'permission-denied'});
  currentUser=user;return{user,profile};
}
async function ensureBusinessDocument(){
  const {user}=await validateUser(),reference=doc(db,'businesses',BUSINESS_ID),snapshot=await getDoc(reference);
  if(!snapshot.exists())await setDoc(reference,{id:BUSINESS_ID,name:'Adi Festa',ownerId:user.uid,active:true,schemaVersion:2,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  else{const business=snapshot.data();if(business.ownerId!==user.uid)throw Object.assign(new Error('O proprietário do negócio no Firestore não corresponde ao usuário conectado.'),{code:'permission-denied'});await setDoc(reference,{id:BUSINESS_ID,active:true,updatedAt:serverTimestamp()},{merge:true})}
  emit({businessDocument:true});return reference;
}
async function testFirestoreConnection(){
  emit({status:'testing',message:'Testando autenticação, leitura e gravação…',progress:0});
  try{
    await ensureBusinessDocument();const reference=doc(db,'businesses',BUSINESS_ID,'syncMetadata','connection-test');currentPath=`businesses/${BUSINESS_ID}/syncMetadata/connection-test`;
    await setDoc(reference,{id:'connection-test',businessId:BUSINESS_ID,ownerId:currentUser.uid,status:'ok',projectId:PROJECT_ID,testedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    const snapshot=await getDoc(reference),data=snapshot.data();if(!snapshot.exists()||data.status!=='ok'||data.projectId!==PROJECT_ID)throw new Error('A leitura de confirmação não retornou o documento esperado.');
    currentPath='';sessionStorage.setItem('adiFirebaseConnectionOk','true');emit({status:'success',message:'Conexão com Firestore funcionando.',testPassed:true});return normalizeFirestoreData(data);
  }catch(error){reportError(error,'Firestore connection test',{path:currentPath});throw error}
}

async function pushPendingOperations(){
  if(!navigator.onLine){emit({status:'offline',message:'Offline — salvo no aparelho'});return{sent:0,pending:readQueue().length}}
  await validateUser();let queue=readQueue(),sent=0;
  while(queue.length){
    const firstGroup=queue[0].groupId,group=queue.filter(item=>item.groupId===firstGroup),slice=group.slice(0,BATCH_SIZE),batch=writeBatch(db);
    for(const operation of slice){currentPath=`businesses/${BUSINESS_ID}/${operation.collection}/${operation.id}`;try{batch.set(doc(db,'businesses',BUSINESS_ID,operation.collection,operation.id),cloudPayload(operation.collection,operation.id,operation.data),{merge:true})}catch(error){reportError(error,'Firestore batch prepare',{collection:operation.collection,documentId:operation.id});throw error}}
    emit({status:'syncing',message:`Enviando ${sent+slice.length} de ${sent+queue.length} registros…`,progress:Math.round(((sent+slice.length)/(sent+queue.length))*100)});
    try{await batch.commit()}catch(error){reportError(error,'Firestore batch commit',{documents:slice.map(item=>`${item.collection}/${item.id}`)});throw error}
    const sentKeys=new Set(slice.map(item=>item.key));queue=readQueue().filter(item=>!sentKeys.has(item.key));saveQueue(queue);sent+=slice.length;
  }
  currentPath='';return{sent,pending:0};
}
function pendingIds(name){return new Set(readQueue().filter(item=>item.collection===name).map(item=>item.id))}
function cleanCloudItem(item){const clean=normalizeFirestoreData(item);clean.criadoEm??=clean.createdAt||clean.data;clean.atualizadoEm??=clean.updatedAt||clean.data;return clean}
function applyCloudCollection(name,documents){
  if(!documents.length||!originalAlter)return;
  const pending=pendingIds(name),source=SOURCES[name];applyingCloud=true;
  try{originalAlter(data=>{
    if(name==='settings'){const remote=documents.find(item=>item.id==='default'&&!item.deletedAt);if(!remote||pending.has('default'))return;const {id,businessId,ownerId,schemaVersion,createdAt,updatedAt,...config}=cleanCloudItem(remote);data.config={...data.config,...config};return}
    data[source.key]=Array.isArray(data[source.key])?data[source.key]:[];
    for(const raw of documents){const item=cleanCloudItem(raw),id=String(item.id);if(pending.has(id))continue;const index=data[source.key].findIndex(local=>String(local.id)===id);if(item.deletedAt){if(index>=0)data[source.key].splice(index,1);continue}if(index>=0)data[source.key][index]={...data[source.key][index],...item};else data[source.key].push(item)}
  })}finally{applyingCloud=false}
  dispatchEvent(new CustomEvent('cloud-data-updated',{detail:{collection:name,count:documents.length}}));
}
function startCloudSubscriptions(){
  stopCloudSubscriptions();if(!currentUser)return;
  for(const name of CLOUD_NAMES){const unsubscribe=repositories[name].subscribe(documents=>{state.cloudCounts[name]=documents.filter(item=>!item.deletedAt).length;applyCloudCollection(name,documents);emit({cloudCounts:{...state.cloudCounts},activeListeners:unsubscribers.length})},error=>reportError(error,'Firestore realtime listener',{collection:name}));unsubscribers.push(unsubscribe)}
  emit({activeListeners:unsubscribers.length});
}
function stopCloudSubscriptions(){for(const unsubscribe of unsubscribers){try{unsubscribe()}catch(error){console.error('[Firestore unsubscribe]',error)}}unsubscribers=[];emit({activeListeners:0})}
async function pullCloudCollections(){
  await validateUser();const results=await Promise.all(CLOUD_NAMES.map(async name=>{currentPath=`businesses/${BUSINESS_ID}/${name}`;try{const documents=await repositories[name].list();state.cloudCounts[name]=documents.length;applyCloudCollection(name,documents);return[name,documents.length]}catch(error){reportError(error,'Firestore pull',{collection:name});throw error}}));currentPath='';emit({cloudCounts:{...state.cloudCounts}});return Object.fromEntries(results);
}
function enqueueAllLocal(){const data=DB.carregar(),groupId=crypto.randomUUID();for(const name of Object.keys(SOURCES))for(const item of sourceItems(data,name))queueOperation(name,item.id,item,groupId);queueOperation('settings','default',data.config,groupId);emit({message:`${readQueue().length} registros preparados para envio.`});return readQueue().length}
async function cloudSummary(){const remote={};for(const name of Object.keys(SOURCES)){const snapshot=await getDocs(collection(db,'businesses',BUSINESS_ID,name)),documents=snapshot.docs.map(item=>normalizeFirestoreData(item.data())).filter(item=>!item.deletedAt);remote[name]=documents.length;if(name==='clients')remote.fiado=documents.reduce((total,item)=>total+Math.abs(Math.min(0,Number(item.saldo||0))),0)}return remote}
async function compareLocalAndCloud(){const local=localSummary(),remote=await cloudSummary(),ok=local.clientes===remote.clients&&local.produtos===remote.products&&local.vendas===remote.sales&&local.pagamentos===remote.payments&&Math.abs(local.fiado-(remote.fiado||0))<.01;const comparison={local,remote,ok};emit({comparison,cloudCounts:{...state.cloudCounts,...remote}});return comparison}
async function synchronizeNow(){
  if(syncOperation)return syncOperation;
  syncOperation=(async()=>{try{await testFirestoreConnection();const push=await pushPendingOperations();await pullCloudCollections();const comparison=await compareLocalAndCloud(),time=new Date().toISOString();localStorage.setItem('adiFestaLastSync',time);emit({status:'success',message:`Sincronizado às ${new Date(time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`,progress:100,lastSync:time});return{push,comparison}}catch(error){if(state.status!=='error')reportError(error,'Synchronize now');throw error}})();
  try{return await syncOperation}finally{syncOperation=null}
}
async function startCloudMigration(){
  const metadata=doc(db,'businesses',BUSINESS_ID,'syncMetadata','migration');
  try{
    await testFirestoreConnection();const counts=localSummary();enqueueAllLocal();await setDoc(metadata,{id:'migration',businessId:BUSINESS_ID,ownerId:currentUser.uid,projectId:PROJECT_ID,status:'running',counts,startedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    const push=await pushPendingOperations(),comparison=await compareLocalAndCloud();await setDoc(metadata,{status:comparison.ok?'completed':'divergent',comparison:sanitizeForFirestore(comparison),sent:push.sent,completedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    if(!comparison.ok)throw new Error('As quantidades ou o total de fiado ainda não conferem. Os dados locais foram preservados.');
    const time=new Date().toISOString();localStorage.setItem('adiFestaLastSync',time);emit({status:'success',message:'Migração concluída e conferida.',progress:100,lastSync:time});return{sent:push.sent,check:comparison};
  }catch(error){try{await setDoc(metadata,{businessId:BUSINESS_ID,ownerId:currentUser?.uid||'',status:'error',error:friendlyError(error),updatedAt:serverTimestamp()},{merge:true})}catch(metadataError){console.error('[Migration metadata write failed]',{code:metadataError.code,message:metadataError.message})}if(state.status!=='error')reportError(error,'Cloud migration');throw error}
}
function schedule(){clearTimeout(timer);if(!currentUser)return;emit({status:navigator.onLine?'waiting':'offline',message:navigator.onLine?'Alteração salva. Aguardando envio…':'Offline — salvo no aparelho'});timer=setTimeout(async()=>{if(!navigator.onLine)return;try{if(!state.testPassed)await testFirestoreConnection();const result=await pushPendingOperations(),time=new Date().toISOString();localStorage.setItem('adiFestaLastSync',time);emit({status:'success',message:`Sincronizado às ${new Date(time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`,lastSync:time,progress:100,sent:{automatic:result.sent}})}catch(error){if(state.status!=='error')reportError(error,'Automatic synchronization')}},900)}
function setUser(user){currentUser=user||null;if(!user){stopCloudSubscriptions();return}installHybridStorage();state.testPassed=sessionStorage.getItem('adiFirebaseConnectionOk')==='true';startCloudSubscriptions();if(readQueue().length)schedule()}
addEventListener('online',()=>{emit({status:'waiting',message:'Internet restaurada. Sincronizando…'});schedule()});
addEventListener('offline',()=>emit({status:'offline',message:'Offline — salvo no aparelho'}));

window.FirestoreRepositories=repositories;
window.dataRepository={clients:repositories.clients,products:repositories.products,sales:repositories.sales,payments:repositories.payments,stockMovements:repositories.stockMovements,campaigns:repositories.campaigns,settings:repositories.settings};
window.SyncFirebase={setUser,stop:()=>setUser(null),subscribe:callback=>{subscribers.add(callback);callback({...state,details:diagnostics()});return()=>subscribers.delete(callback)},sanitizeForFirestore,ensureBusinessDocument,testFirestoreConnection,testConnection:testFirestoreConnection,startCloudMigration,processSyncQueue:synchronizeNow,synchronizeNow,syncAll:synchronizeNow,migrate:startCloudMigration,pushPendingOperations,pullCloudCollections,compare:compareLocalAndCloud,startCloudSubscriptions,stopCloudSubscriptions,schedule,snapshot:localSummary,diagnostics,isReady:()=>Boolean(currentUser)};
