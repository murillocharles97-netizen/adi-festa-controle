const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),puppeteer=require('puppeteer');
const {serve}=require('./demo-vitrine-viva.cjs');
const output=path.resolve('qa-artifacts/vitrine-viva');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const click=(frame,sel)=>frame.$eval(sel,el=>el.click());
const publicFrame=page=>page.frames().find(f=>f.parentFrame()===page.mainFrame() && f.url().includes('catalogo.html'));
async function main(){
  fs.mkdirSync(output,{recursive:true});
  const server=await serve(),base='http://127.0.0.1:'+server.address().port;
  const browser=await puppeteer.launch({headless:true}),rows=[];
  try{
    for(const width of [360,390,412,768,1440])for(const theme of ['light','dark']){
      const page=await browser.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      try {
        await page.setViewport({width,height:width>600?960:844,deviceScaleFactor:1});
        await page.goto(base+(theme==='dark'?'/?papelaria=1':'/'));
        if(theme==='dark')await click(page,'#theme');
        const f=publicFrame(page);await f.waitForSelector('.vv-robot');
        const animated=()=>f.$eval('.vv-robot',e=>getComputedStyle(e).transform);
        const start=await animated();await pause(210);assert.notEqual(await animated(),start);
        await click(f,'[data-viva-pause]');await pause(50);const frozen=await animated();await pause(120);assert.equal(await animated(),frozen);
        await click(f,'[data-shift="1"]');assert.match(await f.$eval('.vv-caption h2',e=>e.textContent),/Novidades/);
        await f.focus('[data-shift="-1"]');await page.keyboard.press('ArrowLeft');
        assert.ok(await f.$('.vv-robot'));
        await f.evaluate(()=>{const el=document.querySelector('.vv-hero');
          const event=(type,x)=>{const e=new Event(type);Object.defineProperty(e,type==='touchstart'?'touches':'changedTouches',{value:[{clientX:x,clientY:100}]});el.dispatchEvent(e);};
          event('touchstart',180);event('touchend',55);});
        assert.match(await f.$eval('.vv-caption h2',e=>e.textContent),/Novidades/);await click(f,'[data-shift="-1"]');
        const cards=await f.$$eval('.sf-grid .sf-card',e=>e.length);
        assert.equal(cards,36);await click(f,'[data-viva-more]');assert.equal(await f.$$eval('.sf-grid .sf-card',e=>e.length),72);
        const product=await page.evaluate(()=>[...__lojaQA.publicDocs.values()][0].items[399].productName);
        await f.$eval('#sf-search',(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},product);
        await f.waitForFunction(name=>document.querySelector('.sf-grid')?.textContent.includes(name),{},product);
        await f.$eval('#sf-search',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
        await f.waitForSelector('.sf-featured');
        await f.evaluate(()=>scrollTo(0,0));
        const overflow=await f.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1);
        if([390,1440].includes(width))await page.screenshot({path:path.join(output,`vitrine-${width}-${theme}.png`)});
        await click(f,'.sf-card [data-add]');await click(f,'.sf-cart-btn');await f.waitForSelector('.vv-drawer .sf-line');await pause(320);
        if(width===390&&theme==='light')await page.screenshot({path:path.join(output,'carrinho.png')});
        await f.focus('.vv-drawer [data-back]');await page.keyboard.press('Escape');await f.waitForSelector('.vv-hero');
        await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
        assert.equal(await f.$eval('.vv-robot',e=>getComputedStyle(e).animationName),'none');
        await click(page,'[data-view="orders"]');await page.waitForSelector('.online-v2-order');
        assert.equal(await page.$$eval('.online-v2-order',els=>els.length),4);
        await click(page,'[data-orders-filter="recebido"]');assert.equal(await page.$$eval('.online-v2-order',els=>els.length),1);
        await click(page,'[data-orders-clear]');await page.type('#orders-search','Rafael');
        assert.equal(await page.$$eval('.online-v2-order',els=>els.length),1);
        await click(page,'[data-order]');await page.waitForSelector('#order-title');await click(page,'[data-close-order]');
        await click(page,'[data-orders-clear]');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        if([390,1440].includes(width))await page.screenshot({path:path.join(output,`pedidos-${width}-${theme}.png`)});
        assert.deepEqual(errors,[]);rows.push({width,theme,cards,overflow,motion:true,keyboard:true,reducedMotion:true,orders:true});
      }finally{await page.close();}
    }
    const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
    await page.goto(base);await click(page,'[data-view="editor"]');await page.waitForSelector('[data-v="design"]');
    await click(page,'[data-v="design"]');await page.waitForSelector('.lo-banners');
    await click(page,'[data-slide-action="add"]');
    await page.select('[data-slide-template]','offers');
    await page.$eval('[data-slide-field="title"]',e=>{e.value='Seleção de domingo';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await click(page,'[data-slide-action="up"]');
    const draft=()=>page.evaluate(()=>__lojaQA.stores.get('qa-space-a').presentation.storefrontLayout);
    await page.waitForFunction(()=>__lojaQA.stores.get('qa-space-a').presentation.storefrontLayout.slides[2]?.title==='Seleção de domingo');
    const live=()=>page.evaluate(()=>[...__lojaQA.publicDocs.values()][0].storefrontLayout);
    assert.equal((await live()).slides.length,3);
    await click(page,'[data-slide-index="1"]');await click(page,'[data-slide-field="active"]');
    await page.waitForFunction(()=>!__lojaQA.stores.get('qa-space-a').presentation.storefrontLayout.slides[1].active);
    assert.equal((await draft()).slides.length,4);
    await page.$eval('.lo-banners',e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(output,'construtor.png')});
    await click(page,'[data-v="home"]');await click(page,'[data-act="ask-publish"]');await click(page,'[data-act="do-publish"]');
    await page.waitForFunction(()=>[...__lojaQA.publicDocs.values()][0].storefrontLayout.slides.some(s=>s.title==='Seleção de domingo'));
    const published=await live();assert.equal(published.slides.length,3);assert.ok(!JSON.stringify(published).includes('Novidades'));
    await page.close();
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({rows,draftPublish:true},null,2));console.log('PASS',rows.length,'profiles; draft, preview and explicit publish');
  }finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
