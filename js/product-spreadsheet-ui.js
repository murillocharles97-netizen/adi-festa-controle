(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const Model = window.ProductSpreadsheet;
  let opened = false;
  function worker(action, payload) {
    return new Promise((resolve, reject) => {
      const task = new Worker('./js/product-spreadsheet-worker.js'), timer = setTimeout(() => finish(Error('A planilha demorou demais para processar. Divida o arquivo ou verifique seu formato.')), 20000);
      function finish(error, result) { clearTimeout(timer); task.terminate(); error ? reject(error) : resolve(result); }
      task.onmessage = e => finish(e.data.error ? Error(e.data.error) : null, e.data);
      task.onerror = () => finish(Error('Não foi possível processar a planilha. Atualize o app e tente novamente.'));
      task.postMessage({ action, ...payload });
    });
  }
  async function open() {
    const access=window.PlanLimitService?.canUseFeature('spreadsheetImport');
    if(access?.ok===false){window.PlansUI?.openUpgradeRequiredModal('spreadsheetImport',access);return;}
    if (opened && document.querySelector('.product-spreadsheet-modal')) return;
    opened = true;
    const root = document.querySelector('#modal');
    let busy = false, catalog, service, preview, limit = 50, completed = false;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box product-spreadsheet-modal" role="dialog" aria-modal="true" aria-labelledby="product-sheet-title"><header class="modal-head"><h3 id="product-sheet-title">Importar / Exportar produtos</h3><button class="icon-btn" type="button" data-sheet-close aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="modal-body"><p data-sheet-context></p><p class="muted">Use o modelo exportado pela VECONI. A importação atualiza produtos existentes; não cria produtos. Células vazias preservam os valores atuais.</p><details class="muted"><summary>Regras desta importação</summary><p>Produtos compartilhados continuam sendo o mesmo cadastro em todos os seus espaços. SKU/EAN são identificadores; altere-os no cadastro. Totais de variações não são editados nesta V1.</p></details><div class="product-xlsx-actions"><button class="btn btn-light" type="button" data-sheet-export disabled><i data-lucide="download"></i> Exportar produtos</button><label class="btn btn-light"><i data-lucide="upload"></i> Importar planilha<input type="file" accept=".xlsx" aria-label="Selecionar planilha XLSX" data-sheet-file disabled></label></div><p data-sheet-status role="status" aria-live="polite">Confirmando produtos na nuvem…</p><p data-sheet-error role="alert" hidden></p><div data-sheet-preview></div></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-sheet-close>Cancelar</button><button class="btn btn-primary" type="button" data-sheet-confirm disabled>Confirmar importação</button></footer></section></div>`;
    const box = root.querySelector('.product-spreadsheet-modal'), q = s => box.querySelector(s), fileInput = q('[data-sheet-file]');
    const status = message => { q('[data-sheet-status]').textContent = message; };
    const error = e => { q('[data-sheet-error]').textContent = e.message || 'Não foi possível concluir a operação.'; q('[data-sheet-error]').hidden = false; };
    function controls(value) {
      busy = value;
      box.querySelectorAll('[data-sheet-close]').forEach(b => b.disabled = value);
      q('[data-sheet-export]').disabled = value || !catalog;
      fileInput.disabled = value || !catalog?.permissions.edit;
      q('[data-sheet-confirm]').disabled = value || completed || !preview?.counts.updates;
    }
    function close() {
      if (busy) return;
      opened = false; root.innerHTML = '';
      document.removeEventListener('keydown', escape);
      if (completed && window.ProdutosMobile?.isMobile()) window.ProdutosMobile.refresh();
    }
    const escape = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', escape);
    box.querySelectorAll('[data-sheet-close]').forEach(b => b.onclick = close);
    window.lucide?.createIcons();
    function renderPreview() {
      const c = preview.counts, labels = { update: 'Será atualizado', invalid: 'Linha inválida', not_found: 'Não encontrado', unchanged: 'Sem alterações' };
      const format = (key, value) => value === null ? 'não informado' : ['preco', 'custo'].includes(key) ? Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : String(value);
      q('[data-sheet-preview]').innerHTML = `<div class="product-sheet-counts">${[['Linhas',c.total],['Encontrados',c.found],['Não encontrados',c.notFound],['Inválidas',c.invalid],['Serão atualizados',c.updates]].map(([label,n])=>`<span>${label}<b>${n}</b></span>`).join('')}</div><p>Somente as ${c.updates} linhas válidas com alterações serão atualizadas. As demais serão ignoradas.</p><div class="product-sheet-rows">${preview.rows.slice(0, limit).map(row => `<article class="is-${row.status}"><b>Linha ${row.line} · ${esc(row.name || 'Sem nome')}</b><small>${labels[row.status]}</small>${row.errors.map(e=>`<p>${esc(e)}</p>`).join('')}${row.status === 'update' ? Object.entries(row.changes).map(([key,value])=>`<p>${esc(Model.columns.find(c=>c[1]===key)[0])}: ${esc(format(key,row.before[key]))} → <strong>${esc(format(key,value))}</strong></p>`).join('') : ''}</article>`).join('')}</div>${preview.rows.length > limit ? '<button type="button" class="btn btn-light" data-sheet-more>Mostrar mais linhas</button>' : ''}`;
      q('[data-sheet-more]')?.addEventListener('click', () => { limit += 50; renderPreview(); });
    }
    q('[data-sheet-export]').onclick = async () => {
      if (busy) return; controls(true); preview = null; q('[data-sheet-preview]').innerHTML = ''; q('[data-sheet-error]').hidden = true;
      try {
        catalog = await service.loadCatalog();
        status('Gerando arquivo .xlsx…');
        const table = [Model.columns.map(c=>c[0]), ...catalog.products.map(p=>{const values=Model.values(p,catalog.permissions.cost);return Model.columns.map(c=>values[c[1]]);})];
        const result = await worker('export', { table, context: catalog.scope });
        const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), a = document.createElement('a');
        a.href = url; a.download = `produtos-veconi-${catalog.scope.businessId.replace(/[^a-z0-9_-]/gi,'_')}-${new Date().toISOString().slice(0,10)}.xlsx`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),30000);
        status(`${catalog.products.length} produtos exportados. Nenhum dado foi alterado.`);
      } catch (e) { error(e); } finally { controls(false); }
    };
    fileInput.onchange = async () => {
      const file = fileInput.files[0]; if (!file || busy) return;
      controls(true); preview = null; completed = false; q('[data-sheet-preview]').innerHTML = ''; q('[data-sheet-error]').hidden = true;
      try {
        if (!/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw Error('Selecione um .xlsx de até 5 MB.');
        status('Lendo e validando toda a planilha. Nenhuma gravação será feita nesta etapa.');
        const parsed = await worker('import', { bytes: await file.arrayBuffer() });
        catalog = await service.loadCatalog();
        if (parsed.context && (parsed.context[0] !== 'VECONI_PRODUCTS_V1' || parsed.context[1] !== catalog.scope.businessId || parsed.context[2] !== catalog.scope.spaceId)) throw Error('Esta planilha foi exportada de outra empresa ou espaço. Selecione o contexto original.');
        preview = Model.preview(parsed.table, catalog.products, catalog.scope, catalog.permissions); limit = 50; renderPreview();
        status('Prévia pronta. Revise as alterações antes de confirmar. Nenhum dado foi gravado.');
        q('[data-sheet-preview]').scrollIntoView({ block: 'start' });
      } catch (e) { error(e); status('Importação não iniciada.'); } finally { fileInput.value = ''; controls(false); }
    };
    q('[data-sheet-confirm]').onclick = async () => {
      if (busy || completed || !preview?.counts.updates) return;
      controls(true); q('[data-sheet-error]').hidden = true;
      try {
        const report = await service.applyPreview(catalog, preview, (done,total)=>status(`Importando: ${done} de ${total} produtos processados…`));
        completed = true;
        const success = report.results.filter(r=>r.ok).length, failures = report.results.filter(r=>!r.ok);
        status(`Concluído: ${success} produtos atualizados; ${failures.length} falhas; ${preview.counts.total-preview.counts.updates} linhas ignoradas. ${report.refreshWarning}`);
        q('[data-sheet-preview]').innerHTML = failures.map(r=>`<article class="product-sheet-failure"><b>Linha ${r.line}</b><p>${esc(r.message)}</p></article>`).join('');
        box.querySelector('footer [data-sheet-close]').textContent = 'Fechar';
      } catch (e) { error(e); status('Nenhuma nova tentativa automática. Gere outra prévia para conferir os dados.'); completed = true; }
      finally { controls(false); }
    };
    controls(true);
    try {
      service = await import('./firebase/product-spreadsheet-service.js'); catalog = await service.loadCatalog();
      q('[data-sheet-context]').textContent = `${window.SpaceContext.selectionLabel()} · ${catalog.products.length} produtos disponíveis`;
      status(catalog.permissions.edit ? 'Escolha exportar ou selecione sua planilha para revisar.' : 'Você pode exportar. Importação exige permissão para editar produtos.');
    } catch (e) { error(e); status('Não foi possível carregar os produtos.'); }
    finally { controls(false); q('[data-sheet-export]').focus(); }
  }
  window.ProductSpreadsheetUI = { open };
})();
