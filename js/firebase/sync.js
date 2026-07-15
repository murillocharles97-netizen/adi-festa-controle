import { db, BUSINESS_ID } from './firebase-config.js';
import { collection, doc, getDocs, setDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const sources={clients:'clients',products:'products',sales:'vendas',payments:'pagamentos',balanceAdjustments:'movimentacoes',stockMovements:'movimentacoesEstoque',charges:'cobrancas'};
let currentUser=null,timer=null;
const businessRef=()=>doc(db,'businesses',BUSINESS_ID);
const base=(item,uid)=>({id:item.id,businessId:BUSINESS_ID,ownerId:uid,createdAt:item.criadoEm||item.data||new Date().toISOString(),updatedAt:item.atualizadoEm||item.data||new Date().toISOString(),deletedAt:null,schemaVersion:2,...item});
function snapshot(){const d=DB.carregar();return {clientes:d.clientes.length,produtos:d.produtos.length,vendas:d.vendas.length,pagamentos:d.pagamentos.length,movimentacoesEstoque:d.movimentacoesEstoque.length,fiado:d.clientes.reduce((s,c)=>s+Math.abs(Math.min(0,Number(c.saldo||0))),0)}}
async function writeItems(name,items,uid){for(let i=0;i<items.length;i+=400){const batch=writeBatch(db);items.slice(i,i+400).forEach(item=>batch.set(doc(collection(businessRef(),name),item.id),base(item,uid),{merge:true}));await batch.commit()}}
async function syncAll(){if(!currentUser||!navigator.onLine)return {skipped:true};const data=DB.carregar();await setDoc(businessRef(),{name:data.config.nome||'Adi Festa',ownerId:currentUser.uid,updatedAt:serverTimestamp(),schemaVersion:2},{merge:true});for(const [target,source] of Object.entries(sources))await writeItems(target,data[source]||[],currentUser.uid);await setDoc(doc(collection(businessRef(),'settings'),'default'),base(data.config,currentUser.uid),{merge:true});return snapshot()}
async function migrate(){if(!currentUser)throw Error('Faça login antes de migrar.');const counts=snapshot(),ref=doc(collection(businessRef(),'syncMetadata'),'migration');await setDoc(ref,{source:'localStorage',status:'running',startedAt:serverTimestamp(),schemaVersion:2,counts,userId:currentUser.uid},{merge:true});try{const result=await syncAll();await setDoc(ref,{status:'completed',completedAt:serverTimestamp(),counts:result,userId:currentUser.uid},{merge:true});return result}catch(error){await setDoc(ref,{status:'error',error:String(error.message||error),updatedAt:serverTimestamp()},{merge:true});throw error}}
async function compare(){const local=snapshot(),remote={};for(const [target] of Object.entries(sources)){const s=await getDocs(collection(businessRef(),target));remote[target]=s.size}return{local,remote}}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>syncAll().catch(()=>{}),1200)}
window.addEventListener('online',schedule);
window.SyncFirebase={setUser:user=>{currentUser=user},syncAll,migrate,compare,schedule,snapshot,isReady:()=>Boolean(currentUser)};
