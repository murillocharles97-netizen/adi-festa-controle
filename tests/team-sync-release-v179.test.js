'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8');
test('normal V179 ships no timing activation, recorder, style or hooks',()=>{for(const p of ['js/sale-timing.js','js/sale-timing-access.js','js/sale-timing-policy.js','css/sale-timing.css'])assert.equal(fs.existsSync(p),false);for(const p of ['index.html','service-worker.js','js/checkout.js','js/firebase/sync.js'])assert.doesNotMatch(read(p),/VeconiSaleTiming|sale-timing|saleTimingWait|saleTimingContext/);});
test('release cache and imports preserve the published V191 singleton; the next release must refresh changed entry points',()=>{
 const version=read('js/build-info.js').match(/release: "(\d+)"/)[1];assert.ok(Number(version)>=179);
 assert.ok(read('service-worker.js').includes(`veconi-v${version}-`));assert.ok(read('service-worker.js').includes(`release:'${version}'`));
 // V191 intentionally shipped only Team UI/updateTeamMember and retained V190
 // Sync/Auth imports. This is the audited published baseline, not a new release.
 // Once the hotfix gets its new release number, require fresh URLs throughout.
 const syncVersion=version==='191'?'190':version;
 for(const p of ['js/firebase/auth.js','js/firebase/firebase-ui.js'])assert.ok(read(p).includes(`import './sync.js?v=${syncVersion}'`));
 for(const asset of ['checkout','build-info','firebase/auth','firebase/firebase-ui']){
  const assetVersion=version==='191'?({'checkout':'187','build-info':'191','firebase/auth':'190','firebase/firebase-ui':'190'}[asset]):version;
  assert.ok(read('index.html').includes(`./js/${asset}.js?v=${assetVersion}`));
 }
});
test('normal checkout stays identical to V177 outside approved preferences and the isolated exchange-credit branch',()=>{
 let checkout=read('js/checkout.js').replace(/\r\n/g,'\n');
 // Trocas V1 adds an online tender branch. Reverse precisely that branch in
 // memory; the historical digest still guards every unrelated normal-sale edit.
 const removeOnce=(pattern,replacement='')=>{assert.equal((checkout.match(new RegExp(pattern.source,'g'))||[]).length,1,'exchange hook must be unique');checkout=checkout.replace(pattern,replacement);};
 removeOnce(/    void window\.ExchangeCreditCheckout\?\.mount\?\.\(\{[\s\S]*?      onRecovered: completeRecoveredCreditSale,\n    \}\);\n/);
 removeOnce(/\n  function completeRecoveredCreditSale\(sale\) \{[\s\S]*?\n  \}\n/);
 removeOnce(/      if \(window\.ExchangeCreditCheckout\?\.hasPending\?\.\(\)\) return validationError\([^\n]+\n/);
 removeOnce(/          const usingExchangeCredit = [^\n]+\n          if \(usingExchangeCredit[^\n]+\n            finishing = false;[^\n]+\n          \}\n/);
 removeOnce(/            if \(usingExchangeCredit\) \{\n              sale = await window\.ExchangeCreditCheckout\.finish\(saleDraft\);\n            \} else \{\n/);
 removeOnce(/(              sale = \{ \.\.\.sale, status: "fiado", formaPagamento: "fiado" \};\n)            \}\n/,'$1');
 removeOnce(/          if \(usingExchangeCredit\) window\.ExchangeCreditCheckout\?\.reset\?\.\(\);\n/);
 removeOnce(/const pendingSync = !usingExchangeCredit && \(navigator.onLine === false \|\| window.SyncFirebase\?\.isSalePending\?\.\(sale\)\);/,'const pendingSync = navigator.onLine === false || window.SyncFirebase?.isSalePending?.(sale);');
 // Revert only the approved preference read and its fenced picker write in memory.
 // The original full-file digest continues to reject every unrelated change.
 const restoreOnce=(current,legacy)=>{assert.equal(checkout.split(current).length-1,1,'approved checkout block must occur exactly once');checkout=checkout.replace(current,legacy);};
 restoreOnce('      recent = DB.getRecentClientIds()','      recent = (DB.carregar().config.recentClientIds || [])');
 restoreOnce(`    const pickerOrigin = {
      businessId: DB.getBusinessId(),
      principal: DB.getPrincipal(),
      generation: DB.getWorkspaceGeneration(),
    };
`,'');
 restoreOnce(`    const modal = document.querySelector("#modal");
    modal.innerHTML =`,`    document.querySelector("#modal").innerHTML =`);
 restoreOnce(`    const input = document.querySelector("#client-picker-search"),
      results = document.querySelector("#client-result-list"),
      more = document.querySelector("#client-result-more");
    let timer, closed = false;
    const currentPicker = () => !closed &&
      pickerOrigin.businessId === DB.getBusinessId() &&
      pickerOrigin.principal === DB.getPrincipal() &&
      pickerOrigin.generation === DB.getWorkspaceGeneration() &&
      document.querySelector("#modal") === modal &&
      document.querySelector("#client-picker-search") === input &&
      document.querySelector("#client-result-list") === results &&
      document.querySelector("#client-result-more") === more;
    const close = () => {
      const ownsModal = currentPicker();
      closed = true;
      clearTimeout(timer);
      if (ownsModal) modal.innerHTML = "";
    };
    document
      .querySelectorAll("#modal .close")
      .forEach((x) => (x.onclick = close));
    input.oninput = () => {
      if (!currentPicker()) return;`,`    const close = () => (document.querySelector("#modal").innerHTML = "");
    document
      .querySelectorAll("#modal .close")
      .forEach((x) => (x.onclick = close));
    const input = document.querySelector("#client-picker-search");
    let timer;
    input.oninput = () => {`);
 restoreOnce(`      timer = setTimeout(() => {
        if (!currentPicker()) return;`,`      timer = setTimeout(() => {`);
 restoreOnce('        results.innerHTML =','        document.querySelector("#client-result-list").innerHTML =');
 restoreOnce('        more.textContent =','        document.querySelector("#client-result-more").textContent =');
 restoreOnce(`    modal.onclick = (e) => {
      if (!currentPicker()) return;`,`    document.querySelector("#modal").onclick = (e) => {`);
 restoreOnce('        if (sel.value) DB.rememberRecentClient(sel.value);',`        if (sel.value)
          DB.alterar(
            (db) =>
              (db.config.recentClientIds = [
                sel.value,
                ...(db.config.recentClientIds || []).filter(
                  (id) => id !== sel.value,
                ),
              ].slice(0, 5)),
          );`);
 assert.equal(crypto.createHash('sha256').update(checkout).digest('hex'),'8a96f9f01d2d767dd75083e8305e8ebd3d812150741c20aee337692d0747e52d');
});
