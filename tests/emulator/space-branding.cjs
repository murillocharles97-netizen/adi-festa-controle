
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = require('firebase/firestore');

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
const businessId = 'brand-company', logoPng = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAUklEQVR4nGPgjA1FQy///ySIMHUxjBo0oAbhMhS/ylGDBo9BcOMIqiFsEPW9ht8sfAYRmaYJGERS/sBpEDXzGnVcRM0womasoZmFXxkdUzaRCADpFvYtFolYxwAAAABJRU5ErkJggg==';
let env;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId:'demo-veconi-branding', firestore:{
    rules: fs.readFileSync(process.env.VECONI_BRANDING_RULES || 'firestore.rules','utf8'),
  } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [tenant, owner] of [[businessId,'brand-owner'],['other-company','other-owner']]) {
      await setDoc(doc(db,'businesses',tenant),{id:tenant,ownerId:owner,active:true,legacyAccessDisabled:true,subscription:{status:'active',planId:'internal'}});
      await setDoc(doc(db,'users',owner),{uid:owner,active:true,businessId:tenant,role:'owner'});
      await setDoc(doc(db,'businesses',tenant,'members',owner),{uid:owner,role:'owner',status:'active',spaceAccess:'all'});
    }
    for (const [uid, role, allowed, permissions] of [['brand-seller','seller',['centro'],{}],
      ['brand-manager','manager',['praia'],{'spaces.manage':true,'financial.view':true}]]) {
      await setDoc(doc(db,'users',uid),{uid,active:true,businessId,role});
      await setDoc(doc(db,'businesses',businessId,'members',uid),{uid,role,status:'active',spaceAccess:'selected',allowedSpaceIds:allowed,permissionsVersion:2,permissions});
    }
    for (const [id,name,tenant,owner] of [['centro','Loja Centro',businessId,'brand-owner'],['praia','Loja Praia',businessId,'brand-owner'],
      ['foreign','Outra empresa','other-company','other-owner']]) {
      await setDoc(doc(db,'financialSpaces',id),{id,name,active:true,type:'business',linkedBusinessId:tenant,businessId:tenant,ownerUid:owner,
        status:'active',operationalType:'unit',isDefault:false,globalSpaceSchemaVersion:1,
        capabilities:{finance:true,sales:true,products:true,inventory:true,goals:true}});
    }
  });
});
test.after(() => env?.cleanup());
const brand = name => ({name,logo:'',primary:'#083e43',secondary:'#eaf6f4',phone:'',instagram:'',address:''});
const asUser = uid => env.authenticatedContext(uid).firestore();
const ref = (db,id) => doc(db,'financialSpaces',id);

test('Firestore keeps branding within existing company, space and role permissions',async () => {
  const owner = asUser('brand-owner'), seller = asUser('brand-seller'), manager = asUser('brand-manager');
  const before = (await getDoc(ref(owner,'praia'))).data();
  await assertSucceeds(updateDoc(ref(owner,'centro'),{documentBranding:brand('Centro Exemplo')}));
  await assertSucceeds(getDoc(ref(seller,'centro')));
  await assertFails(getDoc(ref(seller,'praia')));
  await assertFails(updateDoc(ref(seller,'centro'),{documentBranding:brand('Bloqueada')}));
  await assertSucceeds(updateDoc(ref(manager,'praia'),{documentBranding:brand('Praia Exemplo')}));
  await assertFails(updateDoc(ref(manager,'centro'),{documentBranding:brand('Bloqueada')}));
  await assertFails(updateDoc(ref(owner,'foreign'),{documentBranding:brand('Bloqueada')}));
  await assertFails(getDoc(ref(asUser('other-owner'),'centro')));
  await assertFails(updateDoc(ref(owner,'praia'),{documentBranding:brand('Bloqueada'),name:'Tentativa fora do campo'}));
  await assertFails(updateDoc(ref(owner,'praia'),{documentBranding:{...brand('Inválida'),logo:'https://example.invalid/logo.jpg'}}));
  await assertFails(updateDoc(ref(owner,'praia'),{documentBranding:brand('Inválida'),workspaceGeneration:9}));
  const { documentBranding, ...rest } = (await getDoc(ref(asUser('brand-owner'),'praia'))).data();
  assert.equal(documentBranding.name,'Praia Exemplo');
  assert.deepEqual(rest,before);
});

test('mobile and desktop preview, logo persisted across devices, and origin-specific receipts and PDF',async t => {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({headless:true});
  const styles = [...fs.readFileSync('index.html','utf8').matchAll(/href="\.\/(css\/[^?"\s]+\.css)(?:\?[^"]*)?"/g)]
    .map(([,file])=>'/'+file);
  const assets = new Set([...styles,'/assets/fonts/inter-latin-wght-normal.woff2',
    '/assets/lucide.min.js','/assets/jspdf-4.2.1.umd.min.js','/js/utils.js','/js/space-branding.js',
    '/js/recibos.js','/js/receipt-messages.js','/js/consignment-pdf.js','/js/configuracoes-mobile.js','/js/desktop-settings.js']);
  const server = http.createServer(async (req,res) => {
    if (req.url === '/') {
      res.setHeader('content-type','text/html; charset=utf-8');
      res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8">' +
        styles.map(file=>'<link rel="stylesheet" href="'+file+'">').join('') +
        '<main id="app"></main><div id="modal"></div><div id="toasts"></div>' +
        '<script src="/assets/lucide.min.js"></script><script src="/js/utils.js"></script><script src="/js/space-branding.js"></script>' +
        '<script src="/js/configuracoes-mobile.js"></script><script src="/js/desktop-settings.js"></script><script src="/js/recibos.js"></script>' +
        '<script src="/js/receipt-messages.js"></script><script src="/js/consignment-pdf.js"></script><script>' +
        'const c={businessId:"brand-company",role:"owner",business:{workspaceGeneration:0},member:{status:"active"}};' +
        'window.BusinessContext={get:()=>c};window.FirebaseSession={businessId:c.businessId,business:{name:"Empresa Exemplo"},profile:{role:"owner"}};' +
        'window.TeamAccess={has:()=>true,captureSession:()=>1,assertSession:()=>{}};' +
        'window.DB={carregar:()=>({config:{nome:"Empresa Exemplo"}})};' +
        'let spaces=[];window.SpaceContext={list:()=>spaces,activeId:()=>"praia"};' +
        'async function request(id,data){const r=await fetch("/qa/"+id,data?{method:"PUT",body:JSON.stringify(data)}:undefined);if(!r.ok)throw Error("Falha QA");return r.json();}' +
        'window.SpaceService={readDocumentBranding:async id=>(await request(id)).documentBranding,' +
        'saveDocumentBranding:async(id,data)=>{await request(id,data);await reloadSpaces();}};' +
        'async function reloadSpaces(){spaces=await Promise.all(["centro","praia"].map(id=>request(id)));}' +
        'reloadSpaces().then(()=>{const desktop=innerWidth>=768,settings=desktop?DesktopSettings:ConfiguracoesMobile;app.innerHTML=settings.render();settings.bind();});</script>');
    } else if (assets.has(req.url)) {
      res.setHeader('content-type',req.url.endsWith('.css')?'text/css':req.url.endsWith('.woff2')?'font/woff2':'text/javascript');
      res.end(fs.readFileSync('.'+req.url));
    } else if (/^\/qa\/(?:centro|praia)$/.test(req.url)) {
      try {
        const target = ref(asUser('brand-owner'),req.url.split('/').pop());
        if (req.method === 'PUT') {
          const buffer=[];for await (const chunk of req) buffer.push(chunk);
          await updateDoc(target,{documentBranding:JSON.parse(Buffer.concat(buffer)),updatedAt:serverTimestamp()});
        }
        res.setHeader('content-type','application/json');
        res.end(JSON.stringify((await getDoc(target)).data()));
      } catch {res.writeHead(403).end();}
    } else res.writeHead(404).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const url = 'http://127.0.0.1:'+server.address().port;
  const page = await browser.newPage(), second = await browser.createBrowserContext(), desktop = await second.newPage();
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await desktop.setViewport({width:1366,height:900});
  await page.goto(url);
  await page.waitForSelector('[data-settings-action="branding"]',{timeout:8000});
  await page.click('[data-settings-action="branding"]');
  const output = process.env.VECONI_BRANDING_PREVIEW;
  if(output)await page.screenshot({path:path.join(output,'identidade-espacos-mobile.png')});
  await page.click('[data-brand-space="centro"]');
  await page.waitForSelector('[data-brand-form]');
  await page.$eval('[name="name"]',input=>{input.value='Ateliê do Centro';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.type('[name="instagram"]','@ateliecentro');
  await page.type('[name="phone"]','(11) 90000-0000');
  await page.type('[name="address"]','Rua Exemplo, 45');
  await page.$eval('[name="primary"]',input=>{input.value='#115d78';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.$eval('[name="secondary"]',input=>{input.value='#e7c977';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.evaluate(async b64=>{
    const file=new File([Uint8Array.from(atob(b64),ch=>ch.charCodeAt(0))],'logo.png',{type:'image/png'});
    const transfer=new DataTransfer();transfer.items.add(file);
    const input=document.querySelector('[name=logoFile]');input.files=transfer.files;input.dispatchEvent(new Event('change'));
  },logoPng);
  await page.waitForSelector('[data-brand-preview] img');
  assert.match(await page.$eval('[data-brand-preview]',el=>el.textContent),/Ateliê do Centro.*@ateliecentro/);
  if(output) {
    await page.evaluate(()=>{document.activeElement.blur();document.querySelector('.space-branding').scrollTop=0;});
    await page.screenshot({path:path.join(output,'identidade-previa-mobile.png')});
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.click('[data-brand-form] button[type=submit]');
  await page.waitForFunction(()=>document.querySelector('[data-brand-feedback]').textContent.includes('Identidade salva'));
  await desktop.goto(url);
  await desktop.waitForSelector('[data-desktop-branding]',{timeout:8000});
  await desktop.click('[data-desktop-branding]');
  await desktop.click('[data-brand-space="centro"]');
  await desktop.waitForSelector('[data-brand-preview] img');
  assert.equal(await desktop.$eval('[name=name]',el=>el.value),'Ateliê do Centro');
  if(output)await desktop.screenshot({path:path.join(output,'identidade-previa-desktop.png')});
  await desktop.click('[data-brand-close]');
  const proof = await desktop.evaluate(async ()=>{
    const record={id:'qa',businessId:'brand-company',spaceId:'centro',itens:[],data:'2026-11-16',valorFinal:45,
      deliveredOn:'2026-11-16',outlet:{name:'Ponto QA'},company:{name:'Empresa Exemplo'},items:[]};
    const found=SpaceBranding.resolve(record), legacy=SpaceBranding.resolve({businessId:'brand-company'},'Legado'),
      foreign=SpaceBranding.resolve({...record,businessId:'other-company'},'Outra empresa'),
      conflict=SpaceBranding.resolve({...record,financialSpaceId:'praia'},'Origens em conflito');
    const receipt=ReceiptMessages.variables({ ...record,confirmed:true,businessName:'Empresa Exemplo',clientName:'QA',
      paymentDate:'2026-11-16',amount:45,balance:0 });
    const {file}=await ConsignmentPdf.generate(record);
    const png=await Recibos.generateSaleReceiptBlob({sale:record,business:{...found,branded:true}});
    Recibos.mostrar(record,null);
    return {found, legacy:legacy.name, foreign:foreign.name, conflict:conflict.name,
      receipt:receipt.nome_negocio, shown:document.querySelector('.document-brand-header strong').textContent,
      blob:png.size, pdf:[...new Uint8Array(await file.arrayBuffer())]};
  });
  assert.equal(proof.found.name,'Ateliê do Centro');
  assert.match(proof.found.logo,/^data:image\/jpeg/);
  assert.equal(proof.found.primary,'#115d78');
  assert.equal(proof.found.secondary,'#e7c977');
  assert.equal(proof.legacy,'Legado');
  assert.equal(proof.foreign,'VECONI');
  assert.equal(proof.conflict,'Origens em conflito');
  assert.equal(proof.receipt,'Ateliê do Centro');
  assert.equal(proof.shown,'Ateliê do Centro');
  assert.ok(proof.blob>500);
  const pdf=Buffer.from(proof.pdf);
  assert.match(pdf.toString('latin1'),/\/Subtype \/Image/);
  const content=[...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap(([,raw])=>{
    try{return [zlib.inflateSync(Buffer.from(raw,'latin1')).toString('latin1')];}catch{return [];}
  }).join('');
  assert.match(content,/Ateliê do Centro/);
  assert.match(content,/@ateliecentro/);
});


test('branding respects the workspace epoch without modifying the space name',async () => {
  const owner = asUser('brand-owner');
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db,'businesses',businessId),{workspaceGeneration:2});
  });
  const target=ref(owner,'centro'), value=brand('Nome após restauração');
  await assertFails(updateDoc(target,{documentBranding:value}));
  await assertFails(updateDoc(target,{documentBranding:value,workspaceGeneration:1,workspaceWriteId:'workspace-write-valid-1'}));
  await assertSucceeds(updateDoc(target,{documentBranding:value,workspaceGeneration:2,workspaceWriteId:'workspace-write-valid-2'}));
  const result=(await getDoc(target)).data();
  assert.equal(result.name,'Loja Centro');
  assert.equal(result.documentBranding.name,value.name);
});
