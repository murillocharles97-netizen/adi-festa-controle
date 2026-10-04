import * as sdk from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js';
export * from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js';
function metadata(ref,value={}){
  const guard=window.WorkspaceRuntime,origin=guard?.capture();
  if(!origin||origin.workspaceGeneration===0)return value;
  const parts=ref.fullPath.split('/');
  let businessId;
  if(parts[0]==='businesses')businessId=parts[1];
  else if(parts[0]==='financialSpaces'){
    const space=window.SpaceContext?.list?.().find(row=>row.id===parts[1]);
    if(!space)throw Error('Confirme o espaço do anexo antes de enviar.');
    businessId=space.businessId||space.linkedBusinessId||null;
  }else throw Error('Local de upload não reconhecido.');
  if(!businessId)return value;
  if(businessId!==origin.businessId)throw Error('O arquivo pertence a outra empresa.');
  const stamp=guard.stamp({},origin);
  return{...value,customMetadata:{...value.customMetadata,workspaceGeneration:String(stamp.workspaceGeneration),workspaceWriteId:stamp.workspaceWriteId}};
}
export const uploadBytes=(ref,data,options)=>sdk.uploadBytes(ref,data,metadata(ref,options));
export const uploadBytesResumable=(ref,data,options)=>sdk.uploadBytesResumable(ref,data,metadata(ref,options));
export function deleteObject(ref){
  const origin=window.WorkspaceRuntime?.capture();
  if(!origin||origin.workspaceGeneration===0)return sdk.deleteObject(ref);
  const parts=ref.fullPath.split('/');
  if(parts[0]!=='businesses'||parts[1]!==origin.businessId)throw Error('Exclusão fora do escopo empresarial.');
  return window.FirebaseCallable('deleteWorkspaceAsset',{businessId:origin.businessId,workspaceGeneration:origin.workspaceGeneration,path:ref.fullPath});
}
