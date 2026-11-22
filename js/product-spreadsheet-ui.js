(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const Model = window.ProductSpreadsheet;
  let opened = false;
  function worker(action, payload) {
    return new Promise((resolve, reject) => {
      const task = new Worker('./js/product-spreadsheet-worker.js?v=235'), timer = setTimeout(() => finish(Error('A planilha demorou demais para processar. Divida o arquivo ou verifique seu formato.')), 20000);
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
    let busy = false, catalog, service, preview, parsedTable, parsedBaseline = null, sheetId = '', limit = 50, completed = false;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box product-spreadsheet-modal" role="dialog" aria-modal="true" aria-labelledby="product-sheet-title"><header class="modal-head"><h3 id="product-sheet-title">Importar / Exportar produtos</h3><button class="icon-btn" type="button" data-sheet-close aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="modal-body"><p data-sheet-context></p><p class="muted">Use o modelo exportado pela VECONI. A importação atualiza produtos existentes; não cria produtos. Células vazias preservam os valores atuais.</p><details class="muted"><summary>Regras desta importação</summary><p>Produtos compartilhados continuam sendo o mesmo cadastro em todos os seus espaços. SKU/EAN são identificadores; altere-os no cadastro. Totais de variações não são editados nesta V1.</p></details><div class="product-xlsx-actions"><button class="btn btn-light" type="button" data-sheet-export disabled><i data-lucide="download"></i> Exportar produtos</button><label class="btn btn-light"><i data-lucide="upload"></i> Importar planilha<input type="file" accept=".xlsx" aria-label="Selecionar planilha XLSX" data-sheet-file disabled></label></div><p data-sheet-status role="status" aria-live="polite">Confirmando produtos na nuvem…</p><p data-sheet-error role="alert" hidden></p><div data-sheet-preview></div></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-sheet-close>Cancelar</button><button class="btn btn-primary" type="button" data-sheet-confirm disabled>Confirmar importação</button></footer></section></div>`;
    const box = root.querySelector('.product-spreadsheet-modal'), q = s => box.querySelector(s), fileInput = q('[data-sheet-file]');
    q('.muted').textContent = 'Use o modelo VECONI. Escolha atualizar ou criar e atualizar. Células vazias preservam os valores existentes; novos produtos usam os padrões do cadastro manual.';
    q('details p').textContent = 'Novos produtos serão cadastrados somente no espaço selecionado. Produtos compartilhados mantêm o cadastro único. Totais de variações continuam protegidos. Para corrigir SKU/EAN em massa, escolha o modo "Corrigir SKU/EAN de produtos existentes": ele usa somente o ID VECONI e altera apenas os códigos.';
    q('.product-xlsx-actions').insertAdjacentHTML('beforebegin', '<label class="product-sheet-mode">Modo de importação<select data-sheet-mode><option value="update">Atualizar produtos existentes</option><option value="create_update">Criar novos + atualizar existentes</option><option value="identifiers">Corrigir SKU/EAN de produtos existentes</option></select></label><p class="product-sheet-mode-hint" data-sheet-mode-hint hidden>Neste modo cada linha é identificada somente pelo ID VECONI. Apenas SKU e EAN são alterados; nome, preço, custo e estoque da planilha são ignorados. Nenhum produto é criado e nenhuma venda ou movimento de estoque é gerado.</p>');
    const modeInput = q('[data-sheet-mode]');
    const status = message => { q('[data-sheet-status]').textContent = message; };
    const error = e => { q('[data-sheet-error]').textContent = e.message || 'Não foi possível concluir a operação.'; q('[data-sheet-error]').hidden = false; };
    function controls(value) {
      busy = value;
      box.querySelectorAll('[data-sheet-close]').forEach(b => b.disabled = value);
      q('[data-sheet-export]').disabled = value || !catalog;
      fileInput.disabled = value || !catalog?.permissions.edit || catalog?.exportOnly === true;
      modeInput.disabled = value || completed || !catalog?.permissions.edit || catalog?.exportOnly === true;
      q('[data-sheet-confirm]').disabled = value || completed || !(preview?.counts.updates + preview?.counts.creates) || preview?.mode === 'identifiers' && !q('[data-sheet-ack]')?.checked;
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
      const c = preview.counts, labels = { create:'NOVO PRODUTO — será criado após confirmação', update: 'Será atualizado', invalid: 'Linha inválida / conflito', not_found: 'Não encontrado', unchanged: 'Sem alterações' };
      const format = (key, value) => value === null ? 'não informado' : ['preco', 'custo'].includes(key) ? Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : String(value);
      q('[data-sheet-preview]').innerHTML = `<div class="product-sheet-counts">${[['Linhas',c.total],['Encontrados',c.found],['A atualizar',c.updates],['Entradas',c.entries||0],['Ajustes de estoque',c.adjustments||0],['Novos a criar',c.creates],['Com erro',c.errors],['Conflitos',c.conflicts],['Não encontrados',c.notFound]].map(([label,n])=>`<span>${label}<b>${n}</b></span>`).join('')}</div><p>${c.updates} produtos serão atualizados e ${c.creates} serão criados após confirmação. Linhas com erro ou conflito não serão gravadas.</p><div class="product-sheet-rows">${preview.rows.slice(0, limit).map(row => `<article class="is-${row.status}"><b>Linha ${row.line} · ${esc(row.name || 'Sem nome')}</b><small>${labels[row.status]}${row.kinds?.length?` · ${row.kinds.map(k=>({cadastro:'atualização cadastral',entrada:'entrada de mercadorias',ajuste:'ajuste de estoque'})[k]).join(' + ')}`:''}</small>${(row.notes||[]).map(n=>`<p>${esc(n)}</p>`).join('')}${row.errors.map(e=>`<p>${esc(e)}</p>`).join('')}${['update','create'].includes(row.status) ? Object.entries(row.status === 'create' ? row.create : row.changes).map(([key,value])=>key==='entrada'?`<p>Entrada de mercadorias: +${esc(format(key,value))} (estoque ${esc(format('estoqueAtual',row.before.estoqueAtual))} → <strong>${esc(format('estoqueAtual',Number(row.before.estoqueAtual)+Number(value)))}</strong>)</p>`:`<p>${esc((Model.exportColumns||Model.columns).find(c=>c[1]===key)[0])}: ${row.status === 'create' ? 'Inicial: ' : esc(format(key,row.before[key]))+' → '}<strong>${esc(format(key,value))}</strong></p>`).join('') : ''}</article>`).join('')}</div>${preview.rows.length > limit ? '<button type="button" class="btn btn-light" data-sheet-more>Mostrar mais linhas</button>' : ''}`;
      q('[data-sheet-more]')?.addEventListener('click', () => { limit += 50; renderPreview(); });
    }
    const stateLabels = { corrected: 'Corrigido e confirmado na nuvem', unchanged: 'Sem alteração', conflict: 'Conflito — não alterado', failed: 'Falha — não alterado', pending: 'Pendente — sem confirmação do servidor' };
    const codes = c => `SKU ${esc(c?.codigo || '—')} · EAN ${esc(c?.barcode || '—')}`;
    function renderIdentifierPreview() {
      const c = preview.counts, label = { update: 'Será corrigido', unchanged: 'Sem alteração', invalid: 'Bloqueado' };
      q('[data-sheet-preview]').innerHTML = `<div class="product-sheet-counts">${[['Linhas',c.total],['Encontrados pelo ID',c.found],['A corrigir',c.updates],['Sem alteração',c.unchanged],['Com erro',c.errors],['Conflitos',c.conflicts]].map(([l,n])=>`<span>${l}<b>${n}</b></span>`).join('')}</div>
        <label class="product-sheet-ack"><input type="checkbox" data-sheet-ack> Entendi: os códigos antigos deixam de identificar o produto (leitor e busca) e ficam apenas no histórico do cadastro. Eles não viram código alternativo.</label>
        <div class="product-sheet-rows">${preview.rows.slice(0, limit).map(row => `<article class="is-${row.status === 'invalid' ? 'invalid' : row.status}"><b>Linha ${row.line} · ${esc(row.name || 'Sem nome')}</b><small>${row.id ? `ID ${esc(row.id)} · ` : ''}${label[row.status]}</small>${row.matched ? `<p>Atual: ${codes(row.before)}</p>` : ''}${row.status === 'update' ? `<p>Novo: <strong>${codes(row.next)}</strong></p>` : ''}${row.notes.map(n=>`<p>${esc(n)}</p>`).join('')}${row.errors.map(e=>`<p>${esc(e)}</p>`).join('')}</article>`).join('')}</div>${preview.rows.length > limit ? '<button type="button" class="btn btn-light" data-sheet-more>Mostrar mais linhas</button>' : ''}`;
      q('[data-sheet-more]')?.addEventListener('click', () => { limit += 50; renderIdentifierPreview(); });
      q('[data-sheet-ack]')?.addEventListener('change', () => controls(busy));
    }
    function prepare() {
      q('[data-sheet-mode-hint]').hidden = modeInput.value !== 'identifiers';
      q('[data-sheet-confirm]').textContent = modeInput.value === 'identifiers' ? 'Corrigir códigos' : 'Confirmar importação';
      if (modeInput.value === 'identifiers') { preview = Model.previewIdentifiers(parsedTable, catalog.identifierCatalog, catalog.scope); limit = 50; renderIdentifierPreview(); controls(false); return; }
      preview = Model.preview(parsedTable, catalog.matchingProducts || catalog.products, catalog.scope, catalog.permissions, modeInput.value, { baseline: parsedBaseline, entryApplied: id => service.entryApplied?.(sheetId, id) });
      if (window.ProductBrand) preview = window.ProductBrand.applySpreadsheetRule(preview);
      limit = 50; renderPreview(); controls(false);
    }
    modeInput.onchange = () => {
      if (busy || completed) return;
      q('[data-sheet-mode-hint]').hidden = modeInput.value !== 'identifiers';
      if (parsedTable) { try { prepare(); status('Modo alterado. Revise a nova prévia antes de confirmar.'); } catch(e) { preview = null; error(e); controls(false); } }
    };
    q('[data-sheet-export]').onclick = async () => {
      if (busy) return; controls(true); preview = null; parsedTable = null; q('[data-sheet-preview]').innerHTML = ''; q('[data-sheet-error]').hidden = true;
      try {
        // Read-only: fresh server data, never assigned to the import catalog.
        const exported = await service.loadCatalog({ exportOnly: true });
        status('Gerando arquivo .xlsx…');
        const columns = Model.exportColumns || Model.columns;
        const table = [columns.map(c=>c[0]), ...exported.products.map(p=>{const values=Model.values(p,exported.permissions.cost);return columns.map(c=>c[1]==='entrada'?null:values[c[1]]);})];
        const baseline = exported.products.map(p=>[p.id, Model.values(p,exported.permissions.cost).estoqueAtual]).filter(([,stock])=>typeof stock==='number');
        const result = await worker('export', { table, context: exported.scope, baseline });
        const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), a = document.createElement('a');
        a.href = url; a.download = `produtos-veconi-${exported.scope.businessId.replace(/[^a-z0-9_-]/gi,'_')}-${new Date().toISOString().slice(0,10)}.xlsx`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),30000);
        status(`${exported.products.length} produtos exportados. Nenhum dado foi alterado.`);
      } catch (e) { error(e); } finally { controls(false); }
    };
    fileInput.onchange = async () => {
      const file = fileInput.files[0]; if (!file || busy) return;
      controls(true); preview = null; parsedTable = null; completed = false; q('[data-sheet-preview]').innerHTML = ''; q('[data-sheet-error]').hidden = true;
      try {
        if (!/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw Error('Selecione um .xlsx de até 5 MB.');
        status('Lendo e validando toda a planilha. Nenhuma gravação será feita nesta etapa.');
        const parsed = await worker('import', { bytes: await file.arrayBuffer() });
        catalog = await service.loadCatalog();
        if (parsed.context && (parsed.context[0] !== 'VECONI_PRODUCTS_V1' || parsed.context[1] !== catalog.scope.businessId || parsed.context[2] !== catalog.scope.spaceId)) throw Error('Esta planilha foi exportada de outra empresa ou espaço. Selecione o contexto original.');
        parsedTable = parsed.table; parsedBaseline = parsed.baseline || null;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parsedTable)));
        sheetId = Array.from(new Uint8Array(digest).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
        try { await service.prefetchSheetEntries?.(sheetId); }
        catch { throw Error('Não foi possível conferir na nuvem as entradas já registradas desta planilha. Tente novamente com internet.'); }
        prepare();
        status('Prévia pronta. Revise as alterações antes de confirmar. Nenhum dado foi gravado.');
        q('[data-sheet-preview]').scrollIntoView({ block: 'start' });
      } catch (e) { error(e); status('Importação não iniciada.'); } finally { fileInput.value = ''; controls(false); }
    };
    q('[data-sheet-confirm]').onclick = async () => {
      if (busy || completed || !(preview?.counts.updates + preview?.counts.creates)) return;
      controls(true); q('[data-sheet-error]').hidden = true;
      if (preview.mode === 'identifiers') {
        try {
          const report = await service.applyIdentifierCorrections(catalog, preview, (done,total)=>status(`Corrigindo códigos: ${done} de ${total} produtos enviados ao servidor…`));
          completed = true;
          const byLine = new Map(report.results.map(r => [r.line, r]));
          const rows = preview.rows.map(row => byLine.get(row.line) || { line: row.line, id: row.id, before: row.before, next: row.next, ok: row.status === 'unchanged', state: row.status === 'unchanged' ? 'unchanged' : row.conflict ? 'conflict' : 'failed', message: row.errors.join(' ') });
          const n = k => rows.filter(r => r.state === k).length, pending = n('pending');
          status(pending ? `Não concluído: ${pending} linhas sem confirmação do servidor. Importe a mesma planilha de novo para conferir.` : `Concluído na nuvem: ${n('corrected')} corrigidos; ${n('unchanged')} sem alteração; ${n('conflict')} conflitos; ${n('failed')} falhas.${report.refreshed ? '' : ' Este aparelho ainda não recarregou os produtos: atualize a sincronização antes de vender.'}`);
          q('[data-sheet-preview]').innerHTML = `<div class="product-sheet-rows">${rows.map(r => `<article class="is-${r.state === 'corrected' ? 'update' : r.state === 'unchanged' ? 'unchanged' : 'invalid'}"><b>Linha ${r.line}${r.id ? ` · ID ${esc(r.id)}` : ''}</b><small>${stateLabels[r.state] || stateLabels.failed}</small>${r.state === 'corrected' ? `<p>${codes(r.before)} → <strong>${codes(r.next)}</strong></p>` : ''}${r.message ? `<p>${esc(r.message)}</p>` : ''}</article>`).join('')}</div>`;
          box.querySelector('footer [data-sheet-close]').textContent = 'Fechar';
        } catch (e) { error(e); status('Nenhum código foi alterado por esta tentativa. Gere outra prévia.'); completed = true; }
        finally { controls(false); }
        return;
      }
      try {
        const report = await service.applyPreview(catalog, preview, (done,total)=>status(`Importando: ${done} de ${total} produtos processados…`), { sheetId });
        completed = true;
        const created = report.results.filter(r=>r.ok && r.action==='create' && !r.replayed).length, updated = report.results.filter(r=>r.ok && r.action!=='create').length, failures = report.results.filter(r=>!r.ok);
        const ignored = preview.counts.total-preview.counts.updates-preview.counts.creates+report.results.filter(r=>r.replayed).length;
        const localSummary = `${created} produtos criados; ${updated} produtos atualizados; ${ignored} ignorados; ${failures.length} erros.`;
        status(`Processado neste aparelho: ${localSummary} ${report.refreshWarning}`.trim());
        // Local processing ≠ cloud: follow the import's own Sync operations until they leave the queue.
        if (report.operationIds?.length) (async () => {
          const ids = new Set(report.operationIds), total = ids.size;
          for (let i = 0; i < 900; i++) {
            const queue = window.SyncFirebase?.getQueueDiagnostics?.() || [], mine = queue.filter(item => ids.has(String(item.operationId)));
            const errors = mine.filter(item => item.category === 'error' || item.reviewRequired);
            if (errors.length) { status(`Processado neste aparelho: ${localSummary} Nuvem: ${total - mine.length} de ${total} blocos confirmados; ${errors.length} com erro — abra Sincronização para ver o motivo. Nada foi descartado.`); return; }
            if (!mine.length) { status(`Concluído na nuvem: ${localSummary} ${total} blocos sincronizados.`); return; }
            status(`Processado neste aparelho: ${localSummary} Enviando para a nuvem: ${total - mine.length} de ${total} blocos confirmados…`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        })();
        q('[data-sheet-preview]').innerHTML = failures.map(r=>`<article class="product-sheet-failure"><b>Linha ${r.line}</b><p>${esc(r.message)}</p></article>`).join('');
        box.querySelector('footer [data-sheet-close]').textContent = 'Fechar';
      } catch (e) { error(e); status('Nenhuma nova tentativa automática. Gere outra prévia para conferir os dados.'); completed = true; }
      finally { controls(false); }
    };
    controls(true);
    try {
      service = await import('./firebase/product-spreadsheet-service.js?v=2426-export'); let importBlock = null;
      try { catalog = await service.loadCatalog(); }
      catch (e) {
        // Only operations held for review (never resent automatically): export stays available, import does not.
        if (e?.code !== 'spreadsheet-queue-active') throw e;
        importBlock = e; catalog = await service.loadCatalog({ exportOnly: true });
      }
      q('[data-sheet-context]').textContent = `${window.SpaceContext.selectionLabel()} · ${catalog.products.length} produtos disponíveis`;
      status(importBlock ? 'Você pode exportar os produtos confirmados na nuvem. Importação bloqueada: há operações em revisão em Sincronização → Ver detalhes.' : catalog.permissions.edit ? 'Escolha exportar ou selecione sua planilha para revisar.' : 'Você pode exportar. Importação exige permissão para editar produtos.');
    } catch (e) { error(e); status('Não foi possível carregar os produtos.'); }
    finally { controls(false); q('[data-sheet-export]').focus(); }
  }
  window.ProductSpreadsheetUI = { open };
})();
