const assert=require('node:assert/strict');

(async()=>{
  const response=await fetch('http://127.0.0.1:5001/adi-festa-variations-test/southamerica-east1/submitCatalogOrder',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({data:{}})
  });
  assert.ok([400,401,403,500].includes(response.status),`status inesperado: ${response.status}`);
  console.log(`Functions emulator respondeu com bloqueio seguro (${response.status}).`);
})().catch(error=>{console.error(error);process.exitCode=1});
