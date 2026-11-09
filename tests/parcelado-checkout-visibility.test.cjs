'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');

test('real checkout, desktop renderer and mobile enhancement expose and submit Parcelado', async () => {
  const root = process.cwd();
  const output = process.env.V227_HOTFIX_QA_OUTPUT;
  if (output) fs.mkdirSync(output,{recursive:true});
  const fixture = fs.readFileSync('tests/desktop-shell-content.fixture.html','utf8')
    .replaceAll('desktop-shell-fixture','adi-festa')
    .replaceAll('Empresa fixture','Adi Festa — sintético')
    .replace('<script src="../js/checkout.js">',
      '<script src="../js/sale-money.js"></script><script src="../functions/src/shared/installment-plan.js"></script><script src="../functions/src/shared/fiado-account.js"></script><script src="../js/installment-credit.js"></script><script src="../js/checkout.js">');
  const server = http.createServer((req,res) => {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/tests/parcelado-fixture.html') {
      res.setHeader('Content-Type','text/html');res.end(fixture);return;
    }
    const file = path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);res.end();return;
    }
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await puppeteer.launch({headless:true});
  try {
    for (const width of [390,1366]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({width,height:900});
      await page.setRequestInterception(true);
      page.on('request',request=>new URL(request.url()).hostname==='127.0.0.1'?request.continue():request.abort());
      await page.goto('http://127.0.0.1:'+server.address().port+'/tests/parcelado-fixture.html?visual=vender');
      await page.waitForFunction(()=>document.body.dataset.visualReady==='vender');
      await page.evaluate(()=>{
        SyncFirebase.prepareSaleCustomer=async()=>({confirmed:true});
        DB.alterar(data=>{
          Object.assign(data.clientes[0],{saldo:-247,legacyBalance:247,legacyBalanceRemaining:247});
          data.produtos.find(p=>p.id==='p1').preco=20;
        });
      });
      await page.click('[data-add="p1"]');
      await page.waitForFunction(()=>Checkout.cartCount()===1);
      if (await page.$eval('#pos-summary',el=>el.hidden)) await page.click('#open-sale-summary');
      if (width>=768) {
        await page.waitForFunction(()=>{
          const el=document.querySelector('#desktop-continue-sale'),r=el.getBoundingClientRect();
          return r.width>0 && r.left>=0 && r.right<=innerWidth;
        });
        await page.click('#desktop-continue-sale');
      }
      await page.waitForSelector('#sale-payment-method option[value="crediario"]',{visible:false});
      const choose = async method => {
        if (width<768) await page.click('[data-payment="'+method+'"]');
        else await page.select('#sale-payment-method',method);
      };
      const beforeOutage = await page.evaluate(() => {
        DB.alterar(data => { data.clientes[0].saldo = 0; });
        window.customerChecks = [];
        SyncFirebase.prepareSaleCustomer = async (_id, options) => {
          window.customerChecks.push(options.paymentMethod);
          throw Object.assign(Error('Não foi possível confirmar o cliente na nuvem. O carrinho foi preservado.'),
            {code:'checkout-customer-unavailable'});
        };
        return JSON.stringify([DB.carregar().vendas, DB.carregar().pagamentos, Produtos.obter('p1').estoqueAtual]);
      });
      await page.select('#sale-client','c1');
      for (const [index, method] of ['pix','dinheiro','cartao'].entries()) {
        await choose(method);
        assert.equal(await page.evaluate(() => window.customerChecks.length), index);
        await page.$eval('#finish-sale', button => button.click());
        try {
          await page.waitForFunction(n => window.customerChecks.length === n, {timeout:3000}, index + 1);
        } catch (error) {
          throw Error('Checkout ' + width + '/' + method + ': ' + await page.evaluate(() => JSON.stringify({
            customer: document.querySelector('#sale-client')?.value,
            method: document.querySelector('#sale-payment-method')?.value,
            state: document.querySelector('#finish-sale')?.dataset.saleState,
            feedback: document.querySelector('#sale-submit-feedback')?.textContent,
            checks: window.customerChecks,
          })), {cause:error});
        }
        assert.match(await page.$eval('#sale-submit-feedback', el => el.textContent), /confirmar o cliente na nuvem/);
        assert.equal(await page.evaluate(() => Checkout.cartCount()), 1);
        assert.equal(await page.evaluate(() => JSON.stringify([DB.carregar().vendas, DB.carregar().pagamentos, Produtos.obter('p1').estoqueAtual])), beforeOutage);
      }
      await page.evaluate(() => {
        SyncFirebase.prepareSaleCustomer = async () => ({source:'server'});
        const context=BusinessContext.get(),uid=FirebaseSession.user.uid;
        BusinessContext.get=()=>({...context,userProfile:{uid,businessId:context.businessId,active:true},
          business:{id:context.businessId,ownerId:uid},access:{canMutate:true}});
        DB.alterar(data => Object.assign(data.clientes[0],{saldo:-247,legacyBalanceRemaining:22}));
        window.historyReads=[];
        window.FirebaseCallable=async(name,payload)=>{
          if(name!=='getOperationalSyncReceipt'||payload.fiadoHistoryVersion!==1)throw Error('Contrato histórico ausente');
          window.historyReads.push(payload.clientId);
          if(!window.historyAvailable)throw Error('Histórico incompleto');
          const c=DB.carregar().clientes.find(c=>c.id===payload.clientId);
          const account=FiadoAccount.project({...c,legacyBalanceRemaining:247},[]);
          return {data:{businessId:payload.businessId,workspaceGeneration:payload.workspaceGeneration,
            account:{...account,version:2,historyProofVersion:1}}};
        };
      });
      await page.select('#sale-client','');
      for (const method of ['pix','dinheiro','cartao','fiado','crediario']) {
        await choose(method);
        assert.equal(await page.$eval('#sale-payment-method',el=>el.value),method);
        assert.equal(await page.$eval('#sale-status',el=>el.value),['fiado','crediario'].includes(method)?'fiado':'pago');
      }
      assert.equal(await page.$eval('#installment-fields',el=>el.hidden),false);
      const before = await page.evaluate(()=>({sales:DB.carregar().vendas.length,payments:DB.carregar().pagamentos.length,stock:Produtos.obter('p1').estoqueAtual}));
      await page.$eval('#finish-sale', button => button.click());
      assert.equal(await page.evaluate(()=>DB.carregar().vendas.length),before.sales);
      assert.match(await page.$eval('#sale-submit-feedback',el=>el.textContent),/Selecione um cliente/);
      await page.select('#sale-client','c1');
      await page.waitForSelector('[data-installment-preview-unavailable]');
      await page.$eval('#finish-sale', button => button.click());
      await page.waitForFunction(()=>document.querySelector('#sale-submit-feedback').textContent.includes('Histórico incompleto'));
      assert.deepEqual(await page.evaluate(()=>({sales:DB.carregar().vendas.length,payments:DB.carregar().pagamentos.length,stock:Produtos.obter('p1').estoqueAtual})),before);
      await page.evaluate(()=>{window.historyAvailable=true;dispatchEvent(new Event('online'));});
      try{await page.waitForSelector('[data-current-due]',{timeout:5000});}
      catch(error){throw Error(await page.evaluate(()=>JSON.stringify({card:document.querySelector('#selected-client-card')?.textContent,checks:window.historyReads,available:window.historyAvailable,errors:window.__desktopAuditErrors})),{cause:error});}
      assert.match(await page.$eval('[data-current-due]',el=>el.textContent),/247,00/);
      assert.match(await page.$eval('[data-new-future]',el=>el.textContent),/20,00/);
      assert.match(await page.$eval('[data-after-due]',el=>el.textContent),/247,00/);
      assert.match(await page.$eval('[data-after-total]',el=>el.textContent),/267,00/);
      assert.equal(await page.$eval('#selected-client-card',el=>el.textContent.includes('267,00 em aberto')),false);
      if (width<768) await page.click('[data-payment="fiado"]');
      else await page.select('#sale-payment-method','fiado');
      assert.match(await page.$eval('#selected-client-card',el=>el.textContent),/267,00 em aberto/);
      if (width<768) await page.click('[data-payment="crediario"]');
      else await page.select('#sale-payment-method','crediario');
      await page.$eval('#installment-count',el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.$eval('#installment-first',el=>{el.value=InstallmentPlan.month(InstallmentPlan.today(),1);el.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.waitForFunction(()=>document.querySelector('[data-installment-preview]').textContent.includes('10 parcelas'));
      await page.$eval('#installment-down',el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.waitForFunction(()=>document.querySelector('[data-after-due]')?.textContent.includes('252,00'));
      assert.match(await page.$eval('[data-after-due]',el=>el.textContent),/252,00/);
      assert.match(await page.$eval('[data-after-future]',el=>el.textContent),/15,00/);
      await page.$eval('#installment-down',el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.$eval('#installment-fields',el=>el.scrollIntoView({block:'center'}));
      assert.equal(await page.$eval('#installment-count',el=>el.getBoundingClientRect().width>0),true);
      if(output) await page.screenshot({path:path.join(output,'parcelado-'+width+'.png'),fullPage:true});
      await page.evaluate(()=>{document.querySelector('#finish-sale').click();document.querySelector('#finish-sale').click();});
      try { await page.waitForFunction(n=>DB.carregar().vendas.length===n+1,{timeout:5000},before.sales); }
      catch (error) { throw Error(JSON.stringify(await page.evaluate(()=>({errors:window.__desktopAuditErrors,text:document.querySelector('#pos-summary')?.textContent,client:document.querySelector('#sale-client')?.value}))),{cause:error}); }
      const after = await page.evaluate(()=>({sales:DB.carregar().vendas,payments:DB.carregar().pagamentos.length,stock:Produtos.obter('p1').estoqueAtual}));
      const sale=after.sales.at(-1);
      assert.equal(sale.clienteId,'c1');assert.equal(sale.formaPagamento,'fiado');
      assert.equal(sale.installmentPlan.installments.length,10);
      assert.equal(sale.installmentPlan.installments.reduce((n,row)=>n+row.amountCents,0),2000);
      assert.equal(after.sales.length,before.sales+1);
      assert.equal(after.payments,before.payments);
      assert.equal(after.stock,before.stock-1);
      await context.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
