'use strict';
module.exports=async function* report(events){for await(const e of events){if(e.type==='test:fail')yield JSON.stringify({name:e.data.name,file:e.data.file,line:e.data.line,error:String(e.data.details?.error?.cause?.message||e.data.details?.error?.message||'').slice(0,420)})+'\n';if(e.type==='test:summary')yield JSON.stringify({summary:e.data})+'\n';}};
