
(() => {
  'use strict';
  const DEFAULTS = Object.freeze({ primary: '#083e43', secondary: '#eaf6f4' });
  const LOGO_LIMIT = 24576;
  const TEMPLATE = '<strong>Comprovante de venda</strong><span>Produto de exemplo <b>R$ 45,00</b></span><span>Total <b>R$ 45,00</b></span>';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const color = (value, fallback) => /^#[a-f0-9]{6}$/i.test(value || '') ? value.toLowerCase() : fallback;
  const safeLogo = value => typeof value === 'string' && value.length <= LOGO_LIMIT &&
    /^data:image\/jpeg;base64,[a-z0-9+/]+={0,2}$/i.test(value) ? value : '';

  function normalize(value = {}) {
    return {
      name: text(value?.name, 80),
      logo: safeLogo(value?.logo),
      primary: color(value?.primary, DEFAULTS.primary),
      secondary: color(value?.secondary, DEFAULTS.secondary),
      phone: text(value?.phone, 32),
      instagram: text(value?.instagram, 40),
      address: text(value?.address, 180),
    };
  }

  function context() {
    const c = window.BusinessContext?.get?.() || {};
    return c.businessId && !c.loading && !c.error && c.userProfile?.active !== false &&
      (!c.member?.status || c.member.status === 'active') && c.business?.active !== false ? c : null;
  }
  function spaces() {
    const c = context();
    return c ? (window.SpaceContext?.list?.() || []).filter(space => space.businessId === c.businessId &&
      (!space.linkedBusinessId || space.linkedBusinessId === c.businessId) && space.active !== false) : [];
  }
  function canManage() {
    const c = context();
    return Boolean(c && c.access?.canMutate !== false && c.access?.readOnly !== true &&
      window.TeamAccess?.has?.('spaces.manage'));
  }

  function resolve(record = {}, legacyName = 'VECONI') {
    const c = context();
    if (record.businessId && record.businessId !== c?.businessId ||
        c && record.workspaceGeneration != null && record.workspaceGeneration !== (c.business?.workspaceGeneration ?? 0))
      return { ...normalize(), name: 'VECONI' };
    const id = record.spaceId || record.financialSpaceId;
    // Fallback is neutral when records lack an authoritative, accessible origin.
    // Selecting a different space never changes the document's source.
    const space = id && (!record.spaceId || !record.financialSpaceId || record.spaceId === record.financialSpaceId)
      ? spaces().find(item => item.id === id) : null;
    const brand = normalize(space?.documentBranding);
    return { ...brand, name: brand.name || space?.name || text(legacyName, 140) || 'VECONI' };
  }

  const contact = brand => [brand.phone, brand.instagram, brand.address].filter(Boolean);
  const style = brand => 'style="--document-primary:' + color(brand.primary, DEFAULTS.primary) + ';--document-secondary:' + color(brand.secondary, DEFAULTS.secondary) + '"';
  function heading(brand) {
    return '<div class="document-brand-header" ' + style(brand) + '>' +
      (safeLogo(brand.logo) ? '<img src="' + esc(brand.logo) + '" alt="">' : '') +
      '<strong>' + esc(brand.name) + '</strong>' +
      contact(brand).map(value => '<small>' + esc(value) + '</small>').join('') + '</div>';
  }
  async function loadLogo(logo) {
    if (!safeLogo(logo)) return null;
    return decode(logo).catch(() => null);
  }
  async function decode(url) {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  }
  function drawHeading(ctx, brand, logo, width, top = 12) {
    const scale = width / 450;
    let y = top;
    ctx.fillStyle = brand.primary;
    ctx.fillRect(0, 0, width, 4 * scale);
    if (logo?.naturalWidth && logo.naturalHeight) {
      const ratio = Math.min(92 * scale / logo.naturalWidth, 42 * scale / logo.naturalHeight);
      const w = logo.naturalWidth * ratio, h = logo.naturalHeight * ratio;
      ctx.drawImage(logo, (width - w) / 2, y, w, h);
      y += h + 7 * scale;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#102e37';
    ctx.font = 'bold ' + (23 * scale) + 'px Arial';
    ctx.fillText(brand.name, width / 2, y + 22 * scale, width - 42 * scale);
    y += 25 * scale;
    ctx.font = (11 * scale) + 'px Arial';
    for (const line of contact(brand)) {
      y += 15 * scale;
      ctx.fillText(line, width / 2, y, width - 42 * scale);
    }
    ctx.fillStyle = brand.secondary;
    ctx.fillRect(22 * scale, y + 8 * scale, width - 44 * scale, 3 * scale);
    return y + 31 * scale;
  }

  async function encodeLogo(file) {
    if (!['image/png','image/jpeg','image/webp'].includes(file?.type) || !file.size || file.size > 4 * 1024 * 1024)
      throw Error('Escolha uma imagem PNG, JPEG ou WebP de até 4 MB.');
    const src = URL.createObjectURL(file);
    try {
      const image = await decode(src);
      const scale = Math.min(1, 280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      for (const reduction of [1, .75, .5]) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale * reduction));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale * reduction));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/jpeg', .78);
        if (safeLogo(result)) return result;
      }
      throw Error('Escolha uma imagem menor para a marca.');
    } finally { URL.revokeObjectURL(src); }
  }

  function open({ general } = {}) {
    const root = document.querySelector('#modal'), initialContext = context(), trigger = document.activeElement;
    if (!root || !initialContext) return;
    const session = window.TeamAccess?.captureSession?.();
    function current() {
      try {
        if (session) window.TeamAccess.assertSession(session);
        return context()?.businessId === initialContext.businessId && root.contains(dialog);
      } catch { return false; }
    }
    root.innerHTML = '<dialog class="modal-box space-branding" aria-labelledby="space-branding-title">' +
      '<header class="modal-head"><div><h2 id="space-branding-title">Identidade visual</h2><p>Personalize sua marca e seus documentos.</p></div>' +
      '<button class="icon-btn" type="button" data-brand-close aria-label="Fechar"><i data-lucide="x"></i></button></header>' +
      '<div class="modal-body" data-brand-content></div></dialog>';
    const dialog = root.querySelector('dialog'), body = dialog.querySelector('[data-brand-content]');
    const icons = () => window.lucide?.createIcons();
    const close = () => dialog.close();
    const lifecycle = new AbortController();
    for (const name of ['business-context-changed','firebase-session-cleared'])
      addEventListener(name, () => { if (!current()) close(); }, {signal:lifecycle.signal});
    addEventListener('hashchange', close, {signal:lifecycle.signal});
    dialog.addEventListener('close', () => {
      lifecycle.abort();
      if (root.contains(dialog)) root.replaceChildren();
      trigger?.focus();
    }, {once:true});
    dialog.querySelector('[data-brand-close]').onclick = close;
    dialog.showModal();

    function list() {
      if (!current()) return;
      const available = spaces();
      body.innerHTML = '<div class="space-branding-list">' + available.map(space => '<button type="button" class="settings-list-row" data-brand-space="' +
        esc(space.id) + '"><span class="settings-row-icon"><i data-lucide="store"></i></span><span class="settings-row-copy"><b>' +
        esc(space.name) + '</b><small>' + (space.documentBranding?.name ? esc(space.documentBranding.name) : space.documentBranding ? 'Identidade personalizada' : 'Padrão VECONI') +
        '</small></span><i data-lucide="chevron-right"></i></button>').join('') + '</div>' +
        (!available.length ? '<p class="muted">Nenhum espaço disponível.</p>' : '') +
        (general ? '<button type="button" class="btn btn-light" data-brand-general>Dados gerais da empresa</button>' : '');
      body.querySelector('[data-brand-general]')?.addEventListener('click', () => { close(); general(); });
      body.querySelectorAll('[data-brand-space]').forEach(button => button.onclick = () => edit(button.dataset.brandSpace));
      icons();
    }

    async function edit(id) {
      if (!current()) return;
      const space = spaces().find(item => item.id === id);
      if (!space) return list();
      const readOnly = !canManage();
      body.innerHTML = '<button class="btn btn-light" type="button" data-brand-back>Voltar aos espaços</button>' +
        '<p role="status">Carregando identidade…</p>';
      body.querySelector('[data-brand-back]').onclick = list;
      const loading = body.lastElementChild;
      let stored = space.documentBranding, loaded = true;
      if (window.SpaceService?.readDocumentBranding && navigator.onLine) {
        try { stored = await window.SpaceService.readDocumentBranding(id); }
        catch { loaded = false; }
      }
      if (!current() || !loading.isConnected) return;
      const field = (name, label, max, type = 'text') => '<label class="field">' + label +
        '<input name="' + name + '" maxlength="' + max + '" type="' + type + '"></label>';
      body.innerHTML = '<button class="btn btn-light" type="button" data-brand-back>Voltar aos espaços</button><h3>' + esc(space.name) + '</h3>' +
        '<div class="space-branding-editor"><form data-brand-form><fieldset ' + (readOnly || !loaded || !navigator.onLine ? 'disabled' : '') + '>' +
        field('name','Nome comercial',80) +
        '<div class="space-branding-colors">' + field('primary','Cor principal',7,'color') + field('secondary','Cor secundária',7,'color') + '</div>' +
        '<label class="field">Logotipo<input name="logoFile" type="file" accept="image/png,image/jpeg,image/webp"></label>' +
        '<button class="btn btn-light" type="button" data-brand-remove>Remover logotipo</button>' +
        field('phone','Telefone / WhatsApp (opcional)',32,'tel') + field('instagram','Instagram (opcional)',40) +
        field('address','Endereço (opcional)',180) +
        '<button class="btn btn-primary" type="submit">Salvar identidade</button></fieldset><p role="status" data-brand-feedback></p></form>' +
        '<section class="space-branding-preview" aria-label="Prévia do documento"><h4>Prévia do documento</h4><div data-brand-preview></div></section></div>';
      const form = body.querySelector('form'), feedback = body.querySelector('[data-brand-feedback]');
      let logo = normalize(stored).logo, pending = false;
      const assign = normalize(stored);
      for (const key of ['name','primary','secondary','phone','instagram','address']) form.elements[key].value = assign[key];
      form.elements.name.placeholder = space.name;
      const values = () => normalize({ ...Object.fromEntries(['name','primary','secondary','phone','instagram','address']
        .map(key => [key, form.elements[key].value])), logo });
      const preview = () => {
        const brand = values();
        body.querySelector('[data-brand-preview]').innerHTML = '<article class="document-brand-sample" ' + style(brand) + '>' +
          heading({ ...brand, name: brand.name || space.name }) + TEMPLATE + '</article>';
        form.querySelector('[data-brand-remove]').disabled = !logo;
      };
      body.querySelector('[data-brand-back]').onclick = list;
      form.oninput = event => { if (event.target !== form.elements.logoFile) preview(); };
      form.querySelector('[data-brand-remove]').onclick = () => { logo = ''; form.elements.logoFile.value = ''; preview(); };
      form.elements.logoFile.onchange = async () => {
        const file = form.elements.logoFile.files[0];
        if (!file) return;
        const submit = form.querySelector('[type=submit]');
        submit.disabled = true;
        try { const prepared = await encodeLogo(file); if (current() && form.isConnected) {logo = prepared; feedback.textContent = ''; preview();} }
        catch (e) { if (form.isConnected) feedback.textContent = e.message; }
        finally { if (form.isConnected) submit.disabled = false; }
      };
      form.onsubmit = async event => {
        event.preventDefault();
        if (pending || !current() || !canManage()) return;
        const value = values(), fields = form.querySelector('fieldset');
        pending = true;
        fields.disabled = true;
        try {
          await window.SpaceService.saveDocumentBranding(id, value);
          if (current() && form.isConnected) feedback.textContent = 'Identidade salva neste espaço.';
        } catch (e) { if (form.isConnected) feedback.textContent = e.message || 'Não foi possível salvar a identidade.'; }
        finally { if (form.isConnected) fields.disabled = false; }
        pending = false;
      };
      if (readOnly) feedback.textContent = 'Seu acesso permite consultar esta identidade.';
      else if (!loaded || !navigator.onLine) feedback.textContent = 'Conecte-se para conferir e salvar a identidade.';
      preview();
      icons();
    }
    list();
  }

  window.SpaceBranding = Object.freeze({ normalize, resolve, canManage, contact, heading, style, loadLogo, drawHeading, open });
})();
