'use strict';
// Supplied backup stays in an isolated local browser; no Firebase or external IO.
// Outputs counts/assertions only, never copies the backup into the repository.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const input=process.argv[2];if(!input)throw Error('Supply the verified local backup path');
const backup=JSON.parse(fs.readFileSync(input,'utf8'));
if(backup.businessId!=='adi-festa')throw Error('Wrong business');
const root=process.cwd(),sync=fs.readFileSync('js/firebase/sync.js','utf8');
const section=(a,b)=>sync.slice(sync.indexOf(a),sync.indexOf(b,sync.indexOf(a)));
const runtime=fs.readFileSync('js/firebase/firestore-utils.js','utf8').replaceAll('export ','')+'\n'+section('const stableComparable =','const containsInvalidFirestoreValue =')+'\n'+section('async function cleanupConfirmedLegacyFixtures(','async function compareLocalAndCloud(');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript');fs.createReadStream(file).pipe(res)});
async function main(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/business-cache-v156.fixture.html`);
  await page.addScriptTag({path:'js/integrity.js'});await page.addScriptTag({content:runtime});
  const result=await page.evaluate(async backup=>{
   await DB.useBusiness('adi-festa',{uid:'qa-owner',permissionSignature:'all'});DB.salvar(backup);await DB.flush();
   window.BusinessContext={get:()=>({role:'owner'})};window.activeBusinessId=()=> 'adi-festa';window.originalAlter=DB.alterar;window.readQueue=()=>[];window.now=()=>new Date().toISOString();window.traceSync=()=>{};
   const before=structuredClone(DB.carregar()),financialBefore=JSON.stringify([before.vendas,before.pagamentos,before.movimentacoes,before.movimentacoesEstoque]),sequencesBefore=JSON.stringify(before.messageSequences);
   const current=()=>({businessId:'adi-festa',entries:[{name:'clients',documents:before.clientes.filter(x=>!['c1','c2'].includes(x.id))},{name:'products',documents:before.produtos.filter(x=>!['p1','p2','p3'].includes(x.id))}]});
   const base=DB.localRecords;window.__records=base;
   DB.localRecords={...base,transaction:(mode,action)=>mode==='readwrite'?Promise.reject(new DOMException('synthetic quota','QuotaExceededError')):base.transaction(mode,action)};
   let code;try{await cleanupConfirmedLegacyFixtures(current())}catch(e){code=e.code}
   const durable=await base.list('business-cache:v156:adiFestaDB_v1:adi-festa:qa-owner:all');
   const oldSurvived=durable.some(x=>x.field==='clientes'&&x.value?.id==='c1');
   DB.localRecords=base;await DB.flush();await cleanupConfirmedLegacyFixtures(current());
   const after=DB.carregar();return{code,oldSurvived,removed:after.localFixtureCleanup.removed.length,archive:after.localFixtureQuarantine.length,financialSame:financialBefore===JSON.stringify([after.vendas,after.pagamentos,after.movimentacoes,after.movimentacoesEstoque]),sequencesSame:sequencesBefore===JSON.stringify(after.messageSequences),debt:Math.round(after.clientes.reduce((n,x)=>n+Number(x.saldo||0),0)*100)/100};
  },backup);
  assert.equal(result.code,'indexeddb-quota');assert.equal(result.oldSurvived,true);assert.equal(result.removed,5);assert.equal(result.archive,5);assert.equal(result.financialSame,true);assert.equal(result.sequencesSame,true);assert.equal(result.debt,-7866.5);
  await page.reload();await page.evaluate(()=>DB.useBusiness('adi-festa',{uid:'qa-owner',permissionSignature:'all'}));
  const persisted=await page.evaluate(()=>({archive:DB.carregar().localFixtureQuarantine.length,fixtures:DB.carregar().clientes.filter(x=>['c1','c2'].includes(x.id)).length}));assert.equal(persisted.archive,5);assert.equal(persisted.fixtures,0);
  console.log(JSON.stringify({ok:true,isolatedLocalBackupTest:true,result,persisted},null,2));
 }finally{await browser.close();server.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
