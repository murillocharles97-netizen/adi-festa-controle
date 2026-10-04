'use strict';

const {workspaceWriteFence}=require('./workspace-write-fence');

// A delayed/delete trigger belongs to the generation of its source document,
// not to the generation found when the trigger eventually executes.
async function projectInWorkspace(db,businessId,source,action){
  try{
    return await workspaceWriteFence(db,{
      businessId,workspaceGeneration:source?.workspaceGeneration??0,
    }).runTransaction(action);
  }catch(error){
    if(['workspace-reset-locked','workspace-generation-mismatch','workspace-unavailable'].includes(error?.details?.reason))
      return{created:false,applied:false,skipped:error.details.reason};
    throw error;
  }
}
module.exports={projectInWorkspace};
