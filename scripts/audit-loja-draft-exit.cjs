'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const kit = require('./loja-qa-kit.cjs');
const output = path.resolve(process.argv[2] || 'qa-artifacts/loja-v3/review/saving');
const saveBar = '[data-region="save"]';

async function openDesign(page) {
  await page.click('.lo-tabs [data-v="design"]');
  await page.waitForSelector('#lo-publicName');
}

async function status(page, expected) {
  return page.waitForFunction((selector, text) => document.querySelector(selector)?.textContent.includes(text), {}, saveBar, expected);
}

async function typeSuffix(page, suffix) {
  await page.focus('#lo-publicName');
  await page.keyboard.press('End');
  await page.keyboard.type(suffix);
}

async function saving(browser, base, width, theme) {
  const { page, errors } = await kit.openAdmin(browser, base, { width, theme, latency: 0 });
  try {
    await openDesign(page);
    const take = state => page.screenshot({ path: path.join(output, `${state}-${theme}-${width}.png`) });
    await page.evaluate(() => {
      const call = window.FirebaseCallable;
      window.FirebaseCallable = async (name, data) => {
        if (name !== 'saveOnlineStore' || data.action !== 'save') return call(name, data);
        const shouldSave = await new Promise(resolve => { window.__releaseSave = resolve; });
        delete window.__releaseSave;
        if (!shouldSave) throw Object.assign(Error('Network error QA'), { code: 'functions/unavailable' });
        return call(name, data);
      };
    });
    await typeSuffix(page, ' QA');
    await status(page, 'Alterações pendentes');
    await page.waitForFunction(() => !!window.__releaseSave);
    await status(page, 'Salvando no rascunho');
    assert.deepEqual(await page.$eval('.lo-savebar .lo-spinner',el=>[el.offsetWidth,el.offsetHeight]),[16,16]);
    await take('salvando');
    if (width >= 1000) {
      const prompt = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Chrome não abriu o aviso de saída')), 8000);
        page.once('dialog', async dialog => {
          clearTimeout(timeout);
          await dialog.dismiss();
          resolve(dialog.type());
        });
      });
      await Promise.all([page.close({runBeforeUnload:true}),prompt]).then(([,type])=>assert.equal(type,'beforeunload'));
      assert.equal(page.isClosed(),false);
    }
    assert.equal(await page.$eval('#lo-publicName',el=>el.value),'Doceria Aurora QA');
    await page.evaluate(() => window.__releaseSave(false));
    await status(page, 'Não salvo');
    assert.ok(!(await page.$eval(saveBar, el => el.textContent)).includes('Rascunho salvo às'));
    assert.match(await page.$eval('.lo-savebar.is-error',el=>getComputedStyle(el).backgroundColor),/^rgb\(/);
    await take('nao-salvo');
    await page.click('[data-act="retry-save"]');
    await status(page, 'Salvando no rascunho');
    await page.waitForFunction(() => !!window.__releaseSave);
    await page.evaluate(() => window.__releaseSave(true));
    await status(page, 'Rascunho salvo às');
    assert.equal(await page.evaluate(() => window.__lojaQA.stores.get('qa-space-a').catalogSettings.publicName), 'Doceria Aurora QA');
    assert.equal(await page.evaluate(() => window.__lojaQA.publicDocs.values().next().value.publicName), 'Doceria Aurora');
    assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
    await take('rascunho-salvo');
    assert.deepEqual(errors,[]);
    return { width, theme, pending: true, confirmed: true, retry: true, browserPrompt: width >= 1000 };
  } finally { await page.close(); }
}

async function customization(browser,base,width,theme) {
  const {page}=await kit.openAdmin(browser,base,{width,theme,latency:0});
  try{
    await openDesign(page);
    if(width<1000)await page.click('.lo-fab[data-act="fullpreview"]');
    const selector=width<1000?'.lo-sheet .lo-preview-frame':'.lo-layout-design .lo-preview-frame';
    const element=await page.waitForSelector(selector);
    const frame=await element.contentFrame();
    await frame.waitForSelector('.sf-card');
    await page.screenshot({path:path.join(output,`aparencia-previa-${theme}-${width}.png`)});
  }finally{await page.close();}
}

async function abruptClose(browser, base) {
  const ctx = await browser.createBrowserContext();
  try {
    const original = (await kit.openAdmin(ctx, base, { width:390, theme:'dark', latency:0 })).page;
    await openDesign(original);
    await original.evaluate(()=>Object.defineProperty(navigator,'onLine',{value:false,configurable:true}));
    await typeSuffix(original,' interrompido QA');
    await status(original,'Alterações pendentes');
    await original.close({runBeforeUnload:false});
    const reopened = (await kit.openAdmin(ctx, base, { width:390, theme:'dark', latency:0 })).page;
    await openDesign(reopened);
    assert.equal(await reopened.$eval('#lo-publicName',el=>el.value),'Doceria Aurora');
    assert.doesNotMatch(await reopened.$eval(saveBar,el=>el.textContent),/Salvando|Rascunho salvo/);
    return { forcedCloseOffline: true, restoredConfirmedName: true, unconfirmedEditPersisted: false };
  } finally { await ctx.close(); }
}

async function main() {
  fs.mkdirSync(output, {recursive:true});
  const { server, base } = await kit.serve(), browser = await kit.launch();
  try {
    const results = [];
    for (const [width,theme] of [[1440,'light'],[390,'dark']]) results.push(await saving(browser, base, width, theme));
    results.push(await abruptClose(browser, base));
    await customization(browser,base,1440,'dark');
    await customization(browser,base,390,'light');
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(error => { console.error(error); process.exitCode=1; });
