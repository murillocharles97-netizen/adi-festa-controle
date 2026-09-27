(function () {
  'use strict';
  if (window.MessageSequenceUI) return;
  const $ = selector => document.querySelector(selector), esc = value => Utils.escapar(String(value ?? ''));
  const engine = () => window.MessageSequence;
  let opening = false, checking = false, draftTimer = null, syncNotice = '';
  const root = () => $('#modal');
  const close = () => { root().innerHTML = ''; };
  const error = problem => Utils.toast(engine().friendly(problem), true);
  const terminal = seq => ['FINISHED', 'CANCELLED'].includes(seq.status);
  const scopeMatches = seq => DB.getBusinessId() === seq.businessId && (window.TeamAccess?.actor?.().actorUid || window.FirebaseSession?.user?.uid) === seq.actorUid;
  function sheet(html, className = 'message-confirm-sheet') {
    root().innerHTML = `<div class="message-overlay" data-sequence-layer><section class="${className}" role="dialog" aria-modal="true">${html}</section></div>`;
    if (!root().querySelector('[data-sequence-sync-note]')) root().querySelector('section').insertAdjacentHTML('beforeend', '<p data-sequence-sync-note role="status"></p>');
    root().querySelector('[data-sequence-sync-note]').textContent = syncNotice;
  }
  function action(selector, callback) {
    const button = $(selector); if (!button) return;
    button.onclick = async () => {
      if (button.disabled) return; button.disabled = true;
      try { await callback(); } catch (problem) { error(problem); }
      finally { if (button.isConnected) button.disabled = false; }
    };
  }
  function finished(seq) {
    sheet(`<h2>${seq.status === 'CANCELLED' ? 'Sequência encerrada' : 'Envio finalizado'}</h2><p>${seq.confirmedCount} enviados · ${seq.skippedCount} pulados · ${seq.selectedCustomerIds.length - seq.currentIndex} restantes</p><button class="btn btn-primary" data-finish-done>Concluir</button>`, 'message-finish-sheet');
    action('[data-finish-done]', async () => { close(); await MobileMessages.openCenter(); });
  }
  async function start(input) {
    if (opening) return; opening = true;
    try {
      const result = await engine().start(input);
      if (result.resumed) return offer(result.sequence);
      Utils.toast(`Sequência preparada · 1 de ${result.sequence.selectedCustomerIds.length}`);
      await composer(result.sequence);
    } catch (problem) { error(problem); } finally { opening = false; }
  }
  function offer(seq) {
    if (!scopeMatches(seq)) return;
    if (seq.status === 'AWAITING_CONFIRMATION') return returned(seq);
    sheet(`<h2>Você possui uma sequência em andamento.</h2><p>${seq.currentIndex} de ${seq.selectedCustomerIds.length} concluídos</p><button class="btn btn-primary" data-sequence-resume>Continuar</button><button class="btn btn-light" data-sequence-end>Encerrar sequência</button>`);
    action('[data-sequence-resume]', () => composer(seq));
    action('[data-sequence-end]', async () => finished(await engine().cancel(seq)));
  }
  async function resume({ explicit = false } = {}) {
    if (checking || document.visibilityState === 'hidden' || !Mensagens.canSend()) return false;
    checking = true;
    try {
      const seq = await engine().active();
      if (!seq) return false;
      if (!explicit && !root().querySelector('[data-sequence-layer]') && root().children.length) return false;
      if (explicit) offer(seq);
      else if (seq.status === 'AWAITING_CONFIRMATION' && !root().querySelector('[data-sequence-open]')) returned(seq);
      return true;
    } catch (problem) { if (explicit) error(problem); return false; }
    finally { checking = false; engine().flush(); }
  }
  const templates = type => {
    // Reading templates must not create defaults through DB.alterar (full DB save).
    const saved = (DB.carregar().messageTemplates || []).filter(item => item.active !== false && item.type === type);
    return [...saved, ...Mensagens.DEFAULTS.filter(item => item.type === type && !saved.some(savedItem => savedItem.id === item.id))];
  };
  const defaultTemplate = type => templates(type).find(item => item.isDefault) || templates(type)[0];
  async function currentClient(seq, baseMessage, force = false) {
    const local = Clientes.obter(seq.currentCustomerId);
    if (!local) throw Error('Cliente não encontrado. Pule este contato para continuar.');
    if (seq.type === 'charge' || /{{\s*saldo\s*}}/i.test(baseMessage)) {
      const result = await Mensagens.refreshCanonicalClient(seq.currentCustomerId, { persistProjection: false, force });
      if (seq.type === 'charge' && Number(result.saldo) >= 0) throw Error('Este cliente não possui saldo em aberto. Pule este contato para continuar.');
      return result;
    }
    return local;
  }
  async function composer(seq) {
    if (!scopeMatches(seq)) return;
    if (terminal(seq)) return finished(seq);
    if (seq.status === 'AWAITING_CONFIRMATION') return returned(seq);
    console.info('[SEQUENCE] current index', seq.currentIndex);
    let client, problem;
    try { client = await currentClient(seq, seq.baseMessage); } catch (caught) { problem = caught.message; }
    if (!scopeMatches(seq)) return;
    const choices = templates(seq.type), local = client || Clientes.obter(seq.currentCustomerId);
    const valid = client && Mensagens.validPhone(client);
    sheet(`<header><div><small>Enviando para ${seq.currentIndex + 1} de ${seq.selectedCustomerIds.length}</small><h2>${esc({ charge: 'Cobrança', campaign: 'Campanha', notice: 'Aviso', custom: 'Mensagem livre' }[seq.type])}</h2></div><button type="button" data-sequence-close aria-label="Fechar">×</button></header><div class="message-sheet-scroll"><section class="message-client-summary"><div><h3>${esc(local?.nome || 'Cliente indisponível')}</h3><p>${esc(local?.telefone)}</p></div>${seq.type === 'charge' && client ? `<strong>${Utils.dinheiro(Math.abs(client.saldo))}<small>em aberto</small></strong>` : ''}</section><p>${seq.confirmedCount} enviados · ${seq.skippedCount} pulados</p><label class="message-model-field">Modelo<select id="sequence-template">${choices.map(item => `<option value="${esc(item.id)}" ${item.id === seq.templateId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><label class="message-text-field">Mensagem<textarea id="sequence-text" rows="9" maxlength="4000">${esc(seq.baseMessage)}</textarea></label><div class="message-variables">${['nome', 'primeiro_nome', 'saldo', 'nome_negocio', 'pix', 'data_atual'].map(name => `<button type="button" data-sequence-variable="${name}">{{${name}}}</button>`).join('')}</div><section class="message-preview"><header>Pré-visualização</header><p id="sequence-preview">${client ? esc(Mensagens.resolve(seq.baseMessage, client)) : ''}</p></section>${problem || !valid ? `<p class="message-phone-error">${esc(problem || 'Telefone inválido — Pular')}</p>` : ''}<p data-sequence-sync-note></p></div><footer><button class="btn btn-light" data-sequence-skip>Pular</button><button class="btn btn-light" data-sequence-end>Encerrar</button><button class="btn btn-whatsapp" id="sequence-send" ${valid && !problem ? '' : 'disabled'}>Enviar no WhatsApp</button></footer>`, 'individual-message-sheet');
    let current = seq, editing = Promise.resolve();
    const textarea = $('#sequence-text'), select = $('#sequence-template');
    const saveDraft = () => {
      clearTimeout(draftTimer);
      editing = editing.then(async () => { current = await engine().edit(current, { baseMessage: textarea.value, templateId: select.value }); });
      return editing;
    };
    const preview = () => { if (client) $('#sequence-preview').textContent = Mensagens.resolve(textarea.value, client); clearTimeout(draftTimer); draftTimer = setTimeout(() => saveDraft().catch(error), 250); };
    textarea.oninput = preview;
    select.onchange = () => { textarea.value = choices.find(item => item.id === select.value)?.content || ''; preview(); };
    root().querySelectorAll('[data-sequence-variable]').forEach(button => button.onclick = () => { textarea.setRangeText(`{{${button.dataset.sequenceVariable}}}`, textarea.selectionStart, textarea.selectionEnd, 'end'); preview(); });
    action('[data-sequence-close]', async () => { await saveDraft(); close(); });
    action('[data-sequence-skip]', async () => { await saveDraft(); await composer(await engine().advance(current, 'SKIPPED')); });
    action('[data-sequence-end]', async () => { await saveDraft(); finished(await engine().cancel(current)); });
    action('#sequence-send', async () => {
      await saveDraft();
      const latest = await currentClient(current, textarea.value, true);
      const finalMessage = Mensagens.resolve(textarea.value, latest);
      if (!finalMessage) throw Error('Digite uma mensagem.');
      // Commit before showing the external-navigation button. Its click remains synchronous.
      const prepared = await engine().prepare(current, { clientId: latest.id, clientName: latest.nome, phone: Mensagens.normalizedPhone(latest),
        amountAtSend: Math.abs(Number(latest.saldo)), finalMessage, baseMessage: textarea.value, templateId: select.value });
      if (prepared.openingTabId !== engine().tabId || prepared.currentIndex !== current.currentIndex) return offer(prepared);
      sheet(`<h2>Continuar para WhatsApp?</h2><p>${esc(latest.nome)}</p><p>Ao voltar, confirme se enviou a mensagem.</p><button class="btn btn-light" data-sequence-open-cancel>Cancelar</button><button class="btn btn-whatsapp" data-sequence-open>Continuar para WhatsApp</button>`);
      action('[data-sequence-open-cancel]', async () => composer(await engine().unprepare(prepared)));
      const button = $('[data-sequence-open]');
      button.onclick = () => {
        if (button.disabled || !scopeMatches(prepared) || !Mensagens.canSend()) return;
        button.disabled = true;
        if (prepared.type === 'charge' && Date.now() - Date.parse(prepared.current.preparedAt) > 120000) {
          Utils.toast('Vamos atualizar o saldo antes de abrir a cobrança.');
          engine().unprepare(prepared).then(composer).catch(error); return;
        }
        const opened = Mensagens.openWhatsApp(Mensagens.whatsappUrl({ telefone: prepared.current.phone }, prepared.current.finalMessage), { mobile: matchMedia('(max-width:767px)').matches });
        if (!opened.opened) { button.disabled = false; return Utils.toast('O navegador bloqueou o WhatsApp. Permita a abertura e tente novamente.', true); }
        console.info('[SEQUENCE] whatsapp opened');
        // Also render now: returning works even if Android omits lifecycle events.
        returned(prepared);
      };
    });
    console.info('[SEQUENCE] customer prepared');
  }
  function returned(seq) {
    if (!scopeMatches(seq) || !seq.current) return;
    if (root().querySelector('[data-sequence-return]')?.dataset.sequenceReturn === `${seq.id}:${seq.revision}`) return;
    console.info('[SEQUENCE] waiting for next');
    sheet(`<h2 data-sequence-return="${esc(seq.id)}:${seq.revision}">Deu certo o envio para ${esc(seq.current.clientName)}?</h2><p>${seq.currentIndex + 1} de ${seq.selectedCustomerIds.length}</p><small>Confirme somente se você enviou a mensagem no WhatsApp.</small><button class="btn btn-primary" data-sequence-confirm>Sim, enviado</button><button class="btn btn-light" data-sequence-skip>Pular</button><button class="btn btn-light" data-sequence-reopen>Abrir WhatsApp novamente</button><button class="btn btn-light" data-sequence-end>Encerrar sequência</button>`, 'message-return-sheet');
    action('[data-sequence-confirm]', async () => { const next = await engine().advance(seq, 'CONFIRMED'); close(); await composer(next); });
    action('[data-sequence-skip]', async () => { const next = await engine().advance(seq, 'SKIPPED'); close(); await composer(next); });
    action('[data-sequence-end]', async () => finished(await engine().cancel(seq)));
    $('[data-sequence-reopen]').onclick = () => {
      if (!scopeMatches(seq) || !Mensagens.canSend()) return;
      const opened = Mensagens.openWhatsApp(Mensagens.whatsappUrl({ telefone: seq.current.phone }, seq.current.finalMessage), { mobile: matchMedia('(max-width:767px)').matches });
      if (!opened.opened) Utils.toast('O navegador bloqueou a abertura do WhatsApp.', true);
    };
  }
  let timer;
  const scheduleResume = () => { clearTimeout(timer); timer = setTimeout(() => resume(), 180); };
  // One coalesced check; no listeners are attached by renders or individual steps.
  window.AppLifecycle?.onResume?.(scheduleResume);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleResume(); });
  addEventListener('pageshow', scheduleResume);
  addEventListener('focus', scheduleResume);
  addEventListener('firebase-auth-ready', scheduleResume);
  addEventListener('message-sequence-sync', event => {
    syncNotice = event.detail.pending ? 'Envio confirmado neste aparelho. O registro aguarda sincronização.' : '';
    const note = $('[data-sequence-sync-note]');
    if (note) note.textContent = syncNotice;
  });
  window.MessageSequenceUI = Object.freeze({ start, resume, composer, templates, defaultTemplate });
})();
