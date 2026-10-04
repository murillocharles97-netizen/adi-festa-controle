import * as sdk from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import '../workspace-writer.js';
export * from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
// Bind external roots by their actual parent, not by the currently selected UI
// business. Personal spaces stay personal. Cache immutable bindings per page
// origin; transactions still read the parent inside their own retry boundary.
let bindingOrigin=null;
const bindings=new Map();
async function resolveExternalScope(ref,data,{reader,writes=[],origin}={}){
  if(!origin||origin.workspaceGeneration===0)return null;
  if(bindingOrigin!==origin){bindings.clear();bindingOrigin=origin;}
  const parts=ref.path.split('/'),parentPath=parts.slice(0,2).join('/');
  async function parent(path,proposed={}){
    const pending=writes.find(write=>write.ref.path===path&&write.method==='set');
    const reference=sdk.doc(ref.firestore,path);
    const read=reader||sdk.getDocFromServer;
    let snapshot;
    if(path===parentPath&&parts.length===2&&(proposed.businessId||proposed.linkedBusinessId||proposed.type==='personal'))snapshot=null;
    else if(!reader&&bindings.has(path))snapshot=bindings.get(path);
    else{const result=await read(reference);snapshot=result.exists()?result.data():null;if(!reader&&snapshot)bindings.set(path,snapshot);}
    const value=snapshot||pending?.data||proposed;
    const links=[value.businessId,value.linkedBusinessId].filter(Boolean);
    if(new Set(links).size>1)throw Object.assign(Error('Espaço com vínculos empresariais conflitantes.'),{code:'workspace-business-mismatch'});
    if(!links.length&&value.type!=='personal')throw Object.assign(Error('Não foi possível confirmar o escopo operacional.'),{code:'workspace-scope-unconfirmed'});
    const linked=links[0]||null;
    if(proposed.businessId&&linked!==proposed.businessId||proposed.linkedBusinessId&&linked!==proposed.linkedBusinessId)
      throw Object.assign(Error('O vínculo empresarial não pode ser alterado nesta operação.'),{code:'workspace-business-mismatch'});
    return linked;
  }
  if(parts[0]==='financialTransfers'){
    const ids=[data.fromSpaceId,data.toSpaceId].filter(Boolean);
    if(ids.length!==2)throw Object.assign(Error('Origem e destino necessários.'),{code:'workspace-scope-unconfirmed'});
    const links=await Promise.all(ids.map(id=>parent(`financialSpaces/${id}`)));
    if(links.some(id=>id&&id!==origin.businessId))throw Object.assign(Error('Transferência entre empresas exige fluxo específico.'),{code:'workspace-business-mismatch'});
    return links.find(Boolean)||null;
  }
  return parent(parentPath,parts.length===2?data:{});
}
const writer=window.WorkspaceWriterFactory.create({sdk,runtime:()=>window.WorkspaceRuntime,
  legacyGeneration:()=>window.BusinessContext?.get?.().business?.workspaceGeneration??0,resolveExternalScope});
export const {setDoc,updateDoc,deleteDoc,writeBatch,runTransaction}=writer;
