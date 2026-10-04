'use strict';

const {HttpsError}=require('firebase-functions/v2/https');
const {validId,generation,assertWritable}=require('./workspace-reset-policy');

// An invocation keeps its ORIGINAL generation. Never refresh/relabel an old event.
// Reading the business INSIDE each write transaction makes a concurrent reset
// conflict/retry the transaction, so a late Admin SDK writer cannot resurrect data.
function workspaceWriteFence(db,{businessId,workspaceGeneration=0}){
  validId(businessId,'Empresa');
  const expected=generation(workspaceGeneration),businessRef=db.doc(`businesses/${businessId}`);
  async function runTransaction(action,options){
    return db.runTransaction(async transaction=>{
      const business=await transaction.get(businessRef);
      assertWritable(business.data(),expected);
      return action(transaction);
    },options);
  }
  async function write(commands){
    if(!Array.isArray(commands)||!commands.length||commands.length>400)
      throw new HttpsError('invalid-argument','Lote operacional inválido.');
    // This primitive deliberately handles the business subtree only. Financial,
    // public-catalog and user indexes require an explicitly scoped adapter.
    for(const command of commands){
      const path=command.ref?.path||'';
      if(!path.startsWith(`businesses/${businessId}/`)||!['create','set','update','delete'].includes(command.method))
        throw new HttpsError('permission-denied','Escrita fora do escopo da empresa.');
      if(['billingCheckoutAttempts','subscriptionIntents','workspaceResetJobs','members'].includes(path.split('/')[2]))
        throw new HttpsError('permission-denied','Este caminho exige serviço específico.');
    }
    return runTransaction(transaction=>{
      for(const {method,ref,data,options}of commands){
        if(method==='delete')transaction.delete(ref);
        else if(method==='set'&&options)transaction.set(ref,{...data,workspaceGeneration:expected},options);
        else transaction[method](ref,{...data,workspaceGeneration:expected});
      }
    });
  }
  return Object.freeze({businessId,workspaceGeneration:expected,runTransaction,write});
}
module.exports={workspaceWriteFence};
