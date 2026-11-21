'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/firebase/sync.js','utf8');
const proofSource=source.slice(source.indexOf('function serviceConfigurationCanonical('),source.indexOf('function assertSaleQueueDependencies('));
function proofClient({businessId='qa',uid='owner',spaceId='taxi',read,values=new Map()}={}){
 let generation=0;const c={console,Map,Set,JSON,Error,Promise,setTimeout,clearTimeout,navigator:{onLine:true},currentUser:{uid},activeBusinessId:()=>businessId,checksumValue:s=>require('node:crypto').createHash('sha256').update(s).digest('hex'),captureCloudReadScope:()=>generation,assertCloudReadScope:g=>{if(g!==generation)throw Error('session changed');},localStorage:{peekItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},DB:{getWorkspaceGeneration:()=>0,flush:async()=>{}},SpaceContext:{salesId:()=>spaceId},FirebaseCallable:async(name,p)=>{if(name!=='getOperationalSyncReceipt')throw Error('Unexpected write');return {data:await read(p)};}};c.window=c;vm.createContext(c);vm.runInContext(proofSource,c);return{c,values,retire:()=>generation++};
}
module.exports={proofClient};
