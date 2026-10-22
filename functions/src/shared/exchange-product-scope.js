'use strict';
const Model=require('./online-store');
// Exchanges must not infer scope for legacy products. single_space is canonical
// only when its primary and explicit allowed link agree with the target.
function allowsExchangeProduct(product,spaceId){
  if(!product||!['all_spaces','selected_spaces','single_space'].includes(product.spaceAccessMode))return false;
  if(product.spaceAccessMode==='single_space'){
    if(typeof product.defaultSpaceId!=='string'||product.defaultSpaceId!==spaceId||!Array.isArray(product.allowedSpaceIds)||product.allowedSpaceIds.length!==1||product.allowedSpaceIds[0]!==spaceId)return false;
    if(product.spaceId!==undefined&&product.spaceId!==null&&product.spaceId!==''&&product.spaceId!==spaceId)return false;
  }
  return Model.allows(product,spaceId);
}
module.exports={allowsExchangeProduct};
