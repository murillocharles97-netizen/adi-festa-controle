'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {allowsExchangeProduct:allows}=require('../functions/src/shared/exchange-product-scope');
const canonical={spaceAccessMode:'single_space',defaultSpaceId:'qa-space',allowedSpaceIds:['qa-space'],active:true};
test('single_space created by the normal form is accepted only in its canonical space',()=>{
 assert.equal(allows(canonical,'qa-space'),true);assert.equal(allows({...canonical,spaceId:'qa-space'},'qa-space'),true);assert.equal(allows(canonical,'other-space'),false);
});
test('single_space conflicting, absent, malformed or broad links fail closed',()=>{
 for(const patch of [{defaultSpaceId:'other-space'},{defaultSpaceId:null},{defaultSpaceId:''},{allowedSpaceIds:[]},{allowedSpaceIds:null},{allowedSpaceIds:'qa-space'},{allowedSpaceIds:['other-space']},{allowedSpaceIds:['qa-space','other-space']},{allowedSpaceIds:['qa-space','qa-space']},{spaceId:'other-space'},{spaceId:0}])assert.equal(allows({...canonical,...patch},'qa-space'),false,JSON.stringify(patch));
});
test('inactive, deleted, reserved target and legacy products remain rejected',()=>{
 for(const patch of [{active:false},{ativo:false},{deleted:true},{deletedAt:'2026-10-22'}])assert.equal(allows({...canonical,...patch},'qa-space'),false);
 for(const product of [{},{allowedSpaceIds:['qa-space']},{spaceAccessMode:'legacy',allowedSpaceIds:['qa-space']},null])assert.equal(allows(product,'qa-space'),false);
 for(const spaceId of ['',null,'all','all_spaces'])assert.equal(allows({...canonical,defaultSpaceId:spaceId,allowedSpaceIds:[spaceId]},spaceId),false);
});
test('existing explicit all_spaces and selected_spaces semantics are preserved',()=>{
 assert.equal(allows({spaceAccessMode:'all_spaces'},'qa-space'),true);
 assert.equal(allows({spaceAccessMode:'selected_spaces',allowedSpaceIds:['qa-space','qa-two']},'qa-space'),true);
 assert.equal(allows({spaceAccessMode:'selected_spaces',allowedSpaceIds:['qa-two']},'qa-space'),false);
});
