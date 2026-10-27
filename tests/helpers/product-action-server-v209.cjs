'use strict';
const fs=require('node:fs'),vm=require('node:vm');
function serverMethods({sdk,db,root,key=()=> 'session',timed=(_a,_b,fn)=>fn()}){
 const source=fs.readFileSync('js/firebase/firestore-repository.js','utf8'),start=source.indexOf('    async getProductStatusFromServer(id)'),end=source.indexOf('    async listWhere(',start),module={exports:{}};
 if(start<0||end<start)throw Error('Production read methods not found');
 vm.runInNewContext('module.exports={'+source.slice(start,end)+'};',{module,collectionName:'products',repositoryScopeKey:key,timed,documentRef:id=>sdk.doc(db,root+'/products/'+id),doc:sdk.doc,db,getDocFromServer:sdk.getDocFromServer,convert:s=>s.exists()?{id:s.id,...s.data()}:null,normalizeFirestoreData:d=>d,Set,Array,Object,Error});
 return module.exports;
}
module.exports={serverMethods};
