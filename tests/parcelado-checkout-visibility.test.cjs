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
      await page.evaluate(()=>{ SyncFirebase.prepareSaleCustomer=async()=>({confirmed:true}); });
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
      for (const method of ['pix','dinheiro','cartao','fiado','crediario']) {
        await choose(method);
        assert.equal(await page.$eval('#sale-payment-method',el=>el.value),method);
        assert.equal(await page.$eval('#sale-status',el=>el.value),['fiado','crediario'].includes(method)?'fiado':'pago');
      }
      assert.equal(await page.$eval('#installment-fields',el=>el.hidden),false);
      const before = await page.evaluate(()=>({sales:DB.carregar().vendas.length,payments:DB.carregar().pagamentos.length,stock:Produtos.obter('p1').estoqueAtual}));
      await page.click('#finish-sale');
      assert.equal(await page.evaluate(()=>DB.carregar().vendas.length),before.sales);
      assert.match(await page.$eval('body',el=>el.textContent),/Selecione um cliente/);
      await page.select('#sale-client','c1');
      await page.$eval('#installment-count',el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.$eval('#installment-first',el=>{el.value=InstallmentPlan.month(InstallmentPlan.today(),1);el.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.waitForFunction(()=>document.querySelector('[data-installment-preview]').textContent.includes('10 parcelas'));
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
      assert.equal(sale.installmentPlan.installments.reduce((n,row)=>n+row.amountCents,0),1200);
      assert.equal(after.sales.length,before.sales+1);
      assert.equal(after.payments,before.payments);
      assert.equal(after.stock,before.stock-1);
      await context.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
