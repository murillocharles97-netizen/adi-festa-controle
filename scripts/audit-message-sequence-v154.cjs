/* Isolated synthetic data. Real Chromium IndexedDB; never sends real WhatsApp messages. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');

async function main() {
  const root = process.cwd(), server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const results = [], url = `http://127.0.0.1:${server.address().port}/tests/message-sequence-v154.fixture.html`;
  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const wait = selector => page.waitForSelector(selector,{timeout:7000});
    const click = async selector => {await wait(selector);await page.click(selector)};
    const clear = async count => {
      await page.goto(url);await page.evaluate(async count => {
        await MessageSequence.ready();await DB.localRecords.transaction('readwrite',(store,done)=>{store.clear();done(true)});
      },count);
      await page.reload();await page.evaluate(count=>{__makeSequenceClients(count);__whatsappAudit.throwAlter=true},count);
    };
    // Real origin quota is exhausted, not just a mocked exception. The new path never calls setItem.
    await clear(80);
    const full=await page.evaluate(()=>{let n=0;try{while(n<100){localStorage.setItem('quota-test-'+n,'x'.repeat(250000));n++}}catch(e){return {code:e.name,keys:n}}});
    assert.equal(full.code,'QuotaExceededError');
    await page.evaluate(()=>MobileMessages.openCenter());await click('[data-center-start]');await wait('#sequence-send');
    assert.match(await page.$eval('.individual-message-sheet header small',el=>el.textContent),/1 de 80/);
    const payload=await page.evaluate(async()=>{const seq=await MessageSequence.active();return {bytes:new Blob([JSON.stringify(seq)]).size,ids:seq.selectedCustomerIds.length,wholeDB:JSON.stringify(seq).includes('movimentacoes')}});
    assert.equal(payload.ids,80);assert.equal(payload.wholeDB,false);assert.ok(payload.bytes<8000);
    for(let i=0;i<3;i++){
      await click('#sequence-send');await wait('[data-sequence-open]');
      const before=await page.evaluate(async()=>({status:(await MessageSequence.active()).status,history:MessageSequence.history().length,opened:__whatsappAudit.opened.length}));
      assert.equal(before.status,'AWAITING_CONFIRMATION');assert.equal(before.history,i);assert.equal(before.opened,i);
      await click('[data-sequence-open]');await wait('[data-sequence-confirm]');
      assert.equal(await page.evaluate(()=>MessageSequence.history().length),i);
      // Resume listeners may all fire; only a single prompt/advance is allowed.
      await page.evaluate(()=>{document.querySelector('#modal').innerHTML='';document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('pageshow'));dispatchEvent(new Event('focus'))});
      await wait('[data-sequence-confirm]');
      await page.evaluate(()=>{const b=document.querySelector('[data-sequence-confirm]');b.click();b.click()});
      await wait('#sequence-send');
      assert.equal(await page.evaluate(async()=>(await MessageSequence.active()).currentIndex),i+1);
    }
    assert.equal(await page.evaluate(()=>MessageSequence.history().length),3);
    assert.match(await page.$eval('.individual-message-sheet header small',el=>el.textContent),/4 de 80/);
    results.push({case:'80 customers with real full localStorage',...payload,confirmed:3});
    await page.reload();await page.evaluate(()=>MobileMessages.openCenter());await wait('[data-sequence-resume]');
    assert.match(await page.$eval('#modal',el=>el.textContent),/3 de 80/);await click('[data-sequence-resume]');await wait('#sequence-send');
    // New runtime still has persisted IDs although its synthetic customer list was reset.
    await page.evaluate(()=>__makeSequenceClients(80));await page.evaluate(async()=>MessageSequenceUI.composer(await MessageSequence.active()));
    await click('#sequence-send');await click('[data-sequence-open]');
    await page.reload();await wait('[data-sequence-confirm]');
    assert.match(await page.$eval('#modal',el=>el.textContent),/Cliente 76|Cliente 3/);
    // Simulate a long suspension without waiting minutes: discard all transient UI and age state.
    await page.evaluate(async()=>{await DB.localRecords.transaction('readwrite',(store,done)=>{const req=store.get('message-active:adi-festa:owner-real-test');req.onsuccess=()=>{req.result.updatedAt=new Date(Date.now()-600000).toISOString();store.put(req.result);done(true)}});document.querySelector('#modal').innerHTML='';dispatchEvent(new Event('pageshow'))});
    await wait('[data-sequence-confirm]');
    results.push({case:'reload and lifecycle resume',awaitingConfirmation:true,simulatedBackgroundMinutes:10});
    // Close and reopen a browser tab: no sessionStorage reliance.
    const reopened=await browser.newPage();await reopened.goto(url);await reopened.waitForSelector('[data-sequence-confirm]');await reopened.close();
    await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('quota-test-'))localStorage.removeItem(k)});

    for(const count of [1,3,10,125]){
      await clear(count);await page.evaluate(()=>MobileMessages.openCenter());await click('[data-center-start]');await wait('#sequence-send');
      assert.equal(await page.evaluate(async()=>(await MessageSequence.active()).selectedCustomerIds.length),count);
      if(count===3){
        for(let index=0;index<3;index++){await click('#sequence-send');await click('[data-sequence-open]');await click('[data-sequence-confirm]');if(index<2)await wait('#sequence-send');else await wait('[data-finish-done]')}
        assert.equal(await page.evaluate(()=>MessageSequence.history().length),3);
        assert.equal(await page.evaluate(()=>MessageSequence.active()),null);
      }
      results.push({case:'selection',count,completed:count===3});
    }
    // Invalid phone is skippable; cancelling/opening does not create events.
    await clear(3);await page.evaluate(()=>{__whatsappAudit.data.clientes[0].telefone='123';__canonicalClients[0].telefone='123'});
    await page.evaluate(()=>MessageSequenceUI.start({type:'charge',clientIds:['client-0','client-1','client-2'],baseMessage:'Olá {{primeiro_nome}}, saldo {{saldo}} — {{nome_negocio}}'}));
    assert.equal(await page.$eval('#sequence-send',el=>el.disabled),true);await click('[data-sequence-skip]');await page.waitForFunction(()=>document.querySelector('#sequence-send')?.disabled===false);
    await page.evaluate(()=>__canonicalClients[1].saldo=-777);
    await click('#sequence-send');await click('[data-sequence-open-cancel]');await wait('#sequence-send');
    assert.equal(await page.evaluate(()=>MessageSequence.history().length),0);
    await click('#sequence-send');await click('[data-sequence-open]');
    const latest=await page.evaluate(()=>({url:__whatsappAudit.opened.at(-1),options:__whatsappAudit.readOptions}));
    assert.match(decodeURIComponent(latest.url),/777,00/);assert.equal(latest.options.force,true);assert.equal(latest.options.persistProjection,false);
    await click('[data-sequence-skip]');await wait('#sequence-send');await click('[data-sequence-end]');await wait('[data-finish-done]');
    assert.equal(await page.evaluate(()=>MessageSequence.history().length),0);
    results.push({case:'invalid phone, skip, cancel, canonical just-in-time',ok:true});

    // Offline persistence for all non-financial message types; failures leave an explicit outbox.
    for(const type of ['campaign','notice','custom']){
      await clear(3);await page.evaluate(()=>{__whatsappAudit.syncError=true});await page.setOfflineMode(true);
      await page.evaluate(type=>MessageSequenceUI.start({type,clientIds:['client-0','client-1','client-2'],baseMessage:'Olá {{nome}} — {{nome_negocio}}'}),type);
      await click('#sequence-send');await click('[data-sequence-open]');await click('[data-sequence-confirm]');await wait('#sequence-send');
      const event=await page.evaluate(()=>MessageSequence.history()[0]);assert.equal(event.status,'sent_confirmed');assert.equal(event.type,type);
      assert.equal(await page.evaluate(()=>__whatsappAudit.published.length),0);
      await page.setOfflineMode(false);await page.evaluate(async()=>{__whatsappAudit.syncError=false;await MessageSequence.flush()});
      assert.equal(await page.evaluate(()=>__whatsappAudit.published.length),1);
      results.push({case:'offline persistence and outbox',type,ok:true});
    }
    // Two tabs share the same actor/business record; no duplicate starts or confirmations.
    await clear(3);const second=await browser.newPage();await second.goto(url);await second.evaluate(()=>MessageSequence.ready());
    const starts=await Promise.all([page,second].map(tab=>tab.evaluate(()=>MessageSequence.start({type:'notice',clientIds:['client-0','client-1'],baseMessage:'Olá'}))));
    assert.equal(starts[0].sequence.id,starts[1].sequence.id);
    await page.evaluate(async()=>{const seq=await MessageSequence.active();await MessageSequence.prepare(seq,{clientId:'client-0',phone:'5517999991111',clientName:'Teste',finalMessage:'Olá',baseMessage:'Olá'})});
    const expected=await page.evaluate(()=>MessageSequence.active());
    await Promise.all([page,second].map(tab=>tab.evaluate(seq=>MessageSequence.advance(seq,'CONFIRMED'),expected)));
    assert.equal(await page.evaluate(async()=>(await MessageSequence.active()).currentIndex),1);
    assert.equal(await page.evaluate(async()=>(await DB.localRecords.list('adi-festa:owner-real-test')).filter(r=>r.kind==='event').length),1);
    await second.close();results.push({case:'multi-tab idempotency',ok:true});
    await page.evaluate(()=>__setWhatsappRole('seller'));
    assert.match(await page.evaluate(async()=>{try{await MessageSequence.start({clientIds:['c1']});return 'allowed'}catch(e){return e.message}}),/não permite/);
    await page.evaluate(()=>__setWhatsappRole('manager'));
    assert.equal(await page.evaluate(async()=>(await MessageSequence.start({type:'notice',clientIds:['c1']})).sequence.actorUid),'manager-real-test');
    // Desktop uses same engine and native direct gesture button.
    await clear(3);await page.setViewport({width:1280,height:900});await page.evaluate(()=>MobileMessages.openCenter());await click('[data-center-start]');await wait('#sequence-send');
    await click('#sequence-send');await click('[data-sequence-open]');await wait('[data-sequence-confirm]');
    await page.screenshot({path:path.join(root,'artifacts','sequence-v154-desktop.png')});
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await wait('[data-sequence-confirm]');await page.screenshot({path:path.join(root,'artifacts','sequence-v154-mobile.png')});
    if(process.env.SEQUENCE_LONG_BACKGROUND==='1'){
      const cdp=await page.createCDPSession();await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
      await new Promise(resolve=>setTimeout(resolve,125000));await cdp.send('Page.setWebLifecycleState',{state:'active'});
      await page.evaluate(()=>dispatchEvent(new Event('pageshow')));await wait('[data-sequence-confirm]');
      results.push({case:'Chromium frozen for 125 seconds',ok:true});
    }
    assert.deepEqual(errors,[]);results.push({case:'desktop/mobile viewport and permissions',ok:true});
    const preserved=await page.evaluate(async()=>{
      const before=await MessageSequence.active(),store=DB.localRecords;
      DB.localRecords={...store,transaction:()=>Promise.reject(new DOMException('setItem quota test','QuotaExceededError'))};
      let message='';try{await MessageSequence.advance(before,'CONFIRMED')}catch(e){message=MessageSequence.friendly(e)}finally{DB.localRecords=store}
      return {message,before:before.currentIndex,after:(await MessageSequence.active()).currentIndex};
    });
    assert.equal(preserved.before,preserved.after);assert.doesNotMatch(preserved.message,/setItem/);assert.match(preserved.message,/progresso/);
    results.push({case:'IndexedDB failure preserves previous step with friendly feedback',ok:true});
    const isolated=await browser.createBrowserContext(),legacy=await isolated.newPage();
    await legacy.goto(url+'?legacy=1');await legacy.waitForSelector('[data-sequence-confirm]');
    const imported=await legacy.evaluate(async()=>({seq:await MessageSequence.active(),history:MessageSequence.history().length,data:__whatsappAudit.data,queue:localStorage.getItem('critical-sync-queue')}));
    assert.equal(imported.seq.status,'AWAITING_CONFIRMATION');assert.equal(imported.history,0);
    assert.equal(imported.seq.current.operationId,'legacy-operation');assert.equal(imported.data.vendas.length,1);assert.equal(imported.data.pagamentos.length,1);assert.equal(imported.queue,'preserve');
    assert.equal(imported.data.messageSequences.length,0);
    await legacy.click('[data-sequence-confirm]');await legacy.waitForSelector('[data-finish-done]');
    const migrated=await legacy.evaluate(()=>MessageSequence.history()[0]);
    assert.equal(migrated.id,'legacy-event');assert.equal(migrated.legacyChargeId,'legacy-charge');assert.equal(migrated.status,'sent_confirmed');
    await legacy.evaluate(async()=>{await DB.localRecords.transaction('readwrite',(store,done)=>{
      const scope='adi-festa:owner-real-test',updatedAt='2020-01-01T00:00:00Z';
      store.put({key:'expired-summary',scope,kind:'summary',updatedAt,status:'FINISHED'});
      store.put({key:'preserve-outbox',scope,kind:'event',updatedAt,event:{id:'pending-old'},syncedAt:null});done(true);
    });__whatsappAudit.syncError=true});
    await legacy.reload();await legacy.evaluate(()=>MessageSequence.ready());
    const gc=await legacy.evaluate(async()=>({summary:await DB.localRecords.read('expired-summary'),outbox:await DB.localRecords.read('preserve-outbox')}));
    assert.equal(gc.summary,null);assert.equal(gc.outbox.event.id,'pending-old');
    await isolated.close();results.push({case:'legacy migration preserves event identity and financial data',ok:true});
    results.push({case:'30-day GC preserves pending business events',ok:true});
    console.log(JSON.stringify({ok:true,results,physicalAndroid:'NOT TESTED',externalWhatsApp:'mocked; no real messages sent'},null,2));
  } finally {await browser.close();server.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
