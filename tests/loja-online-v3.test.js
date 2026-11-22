'use strict';
// Loja Online V3: kit puro, painel com DOM real (jsdom) e salvaguardas da loja pública.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const K = require('../js/loja/store-kit.js'), Store = require('../functions/src/shared/online-store.js');
const { JSDOM } = require('jsdom');
const money = v => K.money(v);

/* ---------- Mensagem e link do WhatsApp ---------- */
const items = [{ name: 'Bolo de pote', variant: 'Ninho com morango', quantity: 2, unitPrice: 16 }, { name: 'Brigadeiro gourmet', quantity: 1, unitPrice: 3.5 }];
test('mensagem de retirada: itens, variação, subtotal e fechamento, sem frete inventado', () => {
  const { text, subtotal } = K.orderMessage({ storeName: 'Doceria QA', items, mode: 'pickup', pickupAddress: 'Rua Fictícia, 1', customer: { name: 'Maria' }, payment: 'pix', note: 'Sem granulado' });
  assert.equal(subtotal, 35.5);
  assert.equal(text, ['Olá! Gostaria de fazer um pedido pela loja Doceria QA.', '', '🛒 *Meu pedido*', `2x Bolo de pote (Ninho com morango) — ${money(32)} (${money(16)} cada)`, `1x Brigadeiro gourmet — ${money(3.5)} (${money(3.5)} cada)`, '', `Subtotal: ${money(35.5)}`, 'Entrega: Retirada na loja', 'Local de retirada: Rua Fictícia, 1', 'Pagamento: Pix', 'Observações: Sem granulado', 'Nome: Maria', '', `*Total dos produtos: ${money(35.5)}*`, '', 'Aguardo a confirmação da disponibilidade e do pedido. Obrigado!'].join('\n'));
  assert.doesNotMatch(text, /Frete|taxa de entrega/i);
});
test('mensagem de entrega: endereço e taxa a combinar, total só dos produtos', () => {
  const { text } = K.orderMessage({ storeName: 'Doceria QA', items, mode: 'delivery', customer: { name: 'Maria', address: 'Rua QA, 2\n apto 3' } });
  assert.match(text, /Entrega: Entregar no endereço\nEndereço: Rua QA, 2 apto 3\nTaxa de entrega: a combinar/);
  assert.match(text, /\*Total dos produtos: R\$ 35,50\*\nA taxa de entrega ainda não está incluída\./);
  assert.doesNotMatch(text, /Frete: R\$|Taxa de entrega: R\$/);
});
test('“a combinar” não vira linha de pagamento; carrinho vazio é recusado; textos são limpos', () => {
  assert.doesNotMatch(K.orderMessage({ storeName: 'X', items, payment: 'entrega' }).text, /Pagamento:/);
  assert.throws(() => K.orderMessage({ storeName: 'X', items: [] }), /vazio/);
  const { text } = K.orderMessage({ storeName: 'X\u0007', items: [{ name: 'A\u0000B', quantity: 1, unitPrice: 1 }], note: 'x'.repeat(900) });
  assert.doesNotMatch(text, /[\u0000\u0007]/);assert.ok(text.includes('x'.repeat(500)) && !text.includes('x'.repeat(501)));
});
test('link direto do WhatsApp com número da loja e texto codificado (emoji, acento, quebra de linha)', () => {
  const { text } = K.orderMessage({ storeName: 'Açaí & Cia', items, mode: 'pickup' });
  const url = K.whatsappUrl('(11) 91234-5678', text), parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://api.whatsapp.com/send/');
  assert.equal(parsed.searchParams.get('phone'), '5511912345678');
  assert.equal(parsed.searchParams.get('text'), text);
  assert.ok(url.includes('%F0%9F%9B%92') && url.includes('%0A') && url.includes('%26'));
  assert.throws(() => K.whatsappUrl('', text), /WhatsApp válido/);
  assert.throws(() => K.whatsappUrl('1234', text), /WhatsApp válido/);
});
test('validação e formatação do WhatsApp do lojista', () => {
  assert.equal(K.phoneProblem(''), 'Informe o WhatsApp que vai receber os pedidos.');
  assert.match(K.phoneProblem('9123'), /DDD/);
  assert.equal(K.phoneProblem('11 91234-5678'), '');
  assert.equal(K.formatPhone('5511912345678'), '(11) 91234-5678');
  assert.equal(K.phoneDigits('(11) 3456-7890'), '551134567890');
});

/* ---------- Link, cores, rascunho ---------- */
test('endereço da loja sugerido a partir do nome, com reservados e limites', () => {
  assert.equal(K.slugify('Doçaria da Ana & Cia!'), 'docaria-da-ana-e-cia');
  assert.equal(K.slugify('Admin'), 'admin-loja');
  assert.equal(K.slugProblem(K.slugify('Zé')), '');
  assert.match(K.slugProblem('-ruim'), /hífen/);
  assert.match(K.slugProblem('app'), /reservado/);
  for (const s of ['docaria-da-ana-e-cia', 'admin-loja']) assert.doesNotThrow(() => Store.slug(s));
});
test('estilos prontos: texto da faixa e dos botões sempre legível', () => {
  for (const p of K.PALETTES) {
    const t = K.theme({ primaryColor: p.primary, secondaryColor: p.secondary });
    assert.ok(K.contrast(t.band, t.onBand) >= 4.5, `${p.name}: faixa`);
    assert.ok(K.contrast(t.accent, t.onAccent) >= 3, `${p.name}: botão`);
    assert.ok(K.contrast(t.accentText, '#ffffff') >= 4.5, `${p.name}: preço`);
    assert.equal(K.colorWarning({ primaryColor: p.primary, secondaryColor: p.secondary }), '');
    assert.equal(K.paletteId({ primaryColor: p.primary, secondaryColor: p.secondary }), p.id);
  }
  assert.match(K.colorWarning({ primaryColor: '#fefefe', secondaryColor: '#123456' }), /muito clara/);
  assert.equal(K.readable('#ffe066') !== '#ffe066', true);
});
test('rascunho: alterações viram exatamente o contrato atual de saveOnlineStore', () => {
  const base = K.draftFromStore({ catalogSettings: { publicName: 'Loja' }, slug: 'loja-qa', selectedProductIds: ['a'], presentation: { products: { a: { featured: true, order: 1, category: '' }, z: { featured: true } }, categories: [] } });
  const d = K.applyOps(base, [{ t: 'select', id: 'b', on: true }, { t: 'feature', id: 'b', on: true }, { t: 'select', id: 'a', on: false }, { t: 'order', ids: ['b'] }, { t: 'category', id: 'b', value: '  Doces  ' }, { t: 'categoryOrder', names: ['Doces', 'Bolos'] }, { t: 'categoryName', name: 'Doces', value: 'Docinhos' }, { t: 'setting', key: 'publicName', value: 'Nova' }]);
  assert.deepEqual(base.productIds, ['a'], 'a base confirmada não muda');
  const payload = K.savePayload(d);
  assert.deepEqual(payload.productIds, ['b']);
  assert.deepEqual(Object.keys(payload.presentation.products), ['b'], 'apresentação só dos itens selecionados');
  assert.deepEqual(payload.presentation.products.b, { featured: true, bestseller: false, order: 1, category: 'Doces' });
  assert.deepEqual(payload.presentation.categories, [{ internalName: 'Doces', publicName: 'Docinhos', active: true, order: 0 }, { internalName: 'Bolos', publicName: 'Bolos', active: true, order: 1 }]);
  assert.equal(d.presentation.products.a.featured, false, 'retirar da loja tira o destaque');
  assert.equal(payload.settings.publicName, 'Nova');
});
test('situação, preparação e diferenças para a versão publicada', () => {
  assert.equal(K.status(null), 'new');
  assert.equal(K.status({ published: false }), 'draft');
  assert.equal(K.status({ published: false, activation: { confirmedAt: 'x' } }), 'paused');
  assert.equal(K.status({ published: true }), 'published');
  const r = K.readiness({ settings: { publicName: 'Loja' }, selectedCount: 2, state: 'draft' });
  assert.deepEqual(r.steps.map(s => s.done), [true, true, false, false]);assert.equal(r.next, 'whatsapp');assert.equal(r.canPublish, true);
  const draft = K.draftFromStore({ catalogSettings: { publicName: 'Nova', contactPhone: '11 912345678' }, selectedProductIds: ['a', 'b'], presentation: { products: { a: { featured: true } } } });
  const diff = K.publishedDiff(draft, { publicSettings: { publicName: 'Velha', contactPhone: '11 912345678' }, items: [{ productId: 'a', featured: false }, { productId: 'c' }] });
  assert.deepEqual(diff, ['nome', '1 produto incluído', '1 produto retirado', 'destaques']);
});

/* ---------- Painel com DOM real ---------- */
function panel({ owner = true, products = 4, store = undefined, handler, publicReader } = {}) {
  const dom = new JSDOM('<main id="app"></main>', { url: 'http://127.0.0.1/', pretendToBeVisual: true, runScripts: 'outside-only' }), w = dom.window, calls = [];
  const list = Array.from({ length: products }, (_, i) => Store.product({ id: `p${i}`, nome: `Produto ${String(i).padStart(4, '0')}`, preco: 10 + i, categoria: i % 2 ? 'Bolos' : 'Doces', estoqueAtual: i % 5, custo: 3 }));
  const base = store === undefined ? { id: 's', slug: 'loja-qa', revision: 4, published: true, activation: { confirmedAt: 'x' }, publicToken: 'qa_token_000000000000000000', checkoutEnabled: false, catalogSettings: Store.settings({ publicName: 'Loja QA', contactPhone: '(11) 91234-5678' }), selectedProductIds: ['p0'], presentation: { products: {}, categories: [] } } : store;
  const server = { store: base, pending: [] };
  Object.assign(w, { OnlineStoreModel: Store, StoreKit: K, CSS: { escape: s => String(s).replace(/["\\]/g, '\\$&') }, SpaceContext: { salesSpaces: () => [{ id: 'space-a', name: 'Espaço QA' }], salesId: () => 'space-a' }, BusinessContext: { getCurrentBusinessId: () => 'biz' }, FirebaseSession: { user: { uid: 'u' } }, WorkspaceRuntime: { capture: () => ({ workspaceGeneration: 0 }) },
    DB: { carregar: () => ({ produtos: list.map(p => ({ id: p.productId, nome: p.productName, preco: p.salePrice, categoria: p.category, custo: 3 })), variacoesProdutos: [] }) } });
  w.FirebaseCallable = async (name, data) => {
    calls.push({ name, data: JSON.parse(JSON.stringify(data)) });
    if (handler) { const r = await handler(name, data, server); if (r !== undefined) return r; }
    if (name === 'getOnlineStore') return { data: { owner, store: server.store, products: list, orders: [], orderReception: { enabled: false, canEnable: true, reason: 'paused' } } };
    if (data.revision !== (server.store?.revision || 0)) throw Object.assign(Error('A loja foi alterada em outro aparelho.'), { code: 'functions/aborted' });
    server.store = { ...server.store, revision: (server.store?.revision || 0) + 1, slug: data.slug, catalogSettings: Store.settings(data.settings), selectedProductIds: data.productIds, presentation: { ...data.presentation, banners: [] }, published: data.action === 'publish' ? data.published : server.store?.published, activation: server.store?.activation || (data.action === 'publish' ? { confirmedAt: 'now' } : null) };
    return { data: { store: server.store } };
  };
  w.FirebasePublicCatalogReader = publicReader;
  w.eval(fs.readFileSync('js/online-store-ui.js', 'utf8').replace('window.OnlineStoreUI={render,bind:()=>load()};', 'window.OnlineStoreUI={render,bind:()=>load()};window.T={state,queue,flush,toggle,star,bulk,publish,previewCatalog,goView,saveBar,mountGrid};'));
  w.document.querySelector('#app').innerHTML = w.OnlineStoreUI.render();
  return { w, T: w.T, calls, server, ready: w.OnlineStoreUI.bind(), $: s => w.document.querySelector(s) };
}
const saveText = p => p.$('[data-region="save"]').textContent;
test('ativar produto: salvo só depois da confirmação, com o contrato e a revisão atuais', async () => {
  const p = panel();await p.ready;
  p.T.toggle('p1');
  assert.match(saveText(p), /pendentes/);assert.doesNotMatch(saveText(p), /salvo/i);
  const saving = p.T.flush();assert.match(saveText(p), /Salvando/);
  await saving;
  const save = p.calls.find(c => c.name === 'saveOnlineStore');
  assert.equal(save.data.action, 'save');assert.equal(save.data.revision, 4);assert.equal(save.data.spaceId, 'space-a');
  assert.deepEqual(save.data.productIds, ['p0', 'p1']);assert.equal(save.data.settings.checkoutEnabled, false);
  assert.deepEqual(Object.keys(save.data.presentation.products).sort(), ['p0', 'p1']);
  assert.match(saveText(p), /Rascunho salvo|O cliente ainda vê a versão anterior/);
  assert.equal(p.T.state.data.store.revision, 5);
  assert.ok(p.$('.lo-pcard[data-pid="p1"]') === null || p.$('.lo-pcard[data-pid="p1"]').classList.contains('is-on'));
});
test('falha de rede: nada aparece como salvo e a alteração continua no rascunho', async () => {
  let fail = true;const p = panel({ handler: (name) => { if (name === 'saveOnlineStore' && fail) throw Object.assign(Error('Network error'), { code: 'functions/unavailable' }); } });await p.ready;
  p.T.toggle('p2');await p.T.flush();
  assert.equal(p.T.state.saveState, 'error');assert.match(saveText(p), /Não salvo/);assert.doesNotMatch(saveText(p), /Rascunho salvo/);
  assert.ok(p.T.state.draft.productIds.includes('p2'));assert.ok(!p.T.state.base.productIds.includes('p2'));
  fail = false;await p.T.flush();assert.equal(p.T.state.saveState, 'saved');assert.ok(p.T.state.base.productIds.includes('p2'));
});
test('uma edição recém-digitada entra na fila e avisa antes de sair', async () => {
  const p=panel();await p.ready;
  try{
    p.T.goView('design');
    const field=p.$('#lo-publicName');
    field.value='Loja alterada';
    field.dispatchEvent(new p.w.Event('input',{bubbles:true}));
    const leaving=()=>!p.w.dispatchEvent(new p.w.Event('beforeunload',{cancelable:true}));
    assert.match(saveText(p),/Alterações pendentes/);
    assert.equal(leaving(),true);
    assert.equal(p.calls.filter(c=>c.name==='saveOnlineStore').length,0);
    await p.T.flush();
    assert.equal(p.server.store.catalogSettings.publicName,'Loja alterada');
    assert.match(saveText(p),/Rascunho salvo/);
    assert.equal(leaving(),false);
  }finally{p.w.close();}
});
test('uma confirmação anterior não marca o texto inválido atual como salvo', async () => {
  let confirmStarted,allowConfirm;
  const started=new Promise(resolve=>{confirmStarted=resolve;});
  const release=new Promise(resolve=>{allowConfirm=resolve;});
  const p=panel({handler:async(name)=>{if(name==='saveOnlineStore'){confirmStarted();await release;}}});await p.ready;
  try{
    p.T.goView('design');
    const field=p.$('#lo-publicName');
    const enter=value=>{field.value=value;field.dispatchEvent(new p.w.Event('input',{bubbles:true}));field.dispatchEvent(new p.w.Event('change',{bubbles:true}));};
    enter('Nome válido');
    const saving=p.T.flush();
    await started;
    enter('');
    allowConfirm();
    await saving;
    assert.equal(p.server.store.catalogSettings.publicName,'Nome válido');
    assert.match(saveText(p),/Corrija o campo destacado/);
    assert.doesNotMatch(saveText(p),/Rascunho salvo/);
    assert.equal(p.w.dispatchEvent(new p.w.Event('beforeunload',{cancelable:true})),false);
  }finally{allowConfirm();p.w.close();}
});
test('salvar endereço durante outro envio só confirma após receber o endereço', async () => {
  const replies=[];
  const p=panel({handler:async(name,data)=>{
    if(name==='saveOnlineStore')await new Promise(resolve=>replies.push({slug:data.slug,resolve}));
  }});await p.ready;
  const waitFor=async fn=>{for(let i=0;i<50&&!fn();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(fn());};
  try{
    p.T.toggle('p1');
    const first=p.T.flush();
    await waitFor(()=>replies.length===1);
    p.$('[data-slug]').value='novo-endereco-qa';
    p.$('[data-act="save-slug"]').click();
    replies[0].resolve();
    await first;
    await waitFor(()=>replies.length===2||/Endereço salvo/.test(p.$('.lo-toast').textContent));
    assert.doesNotMatch(p.$('.lo-toast').textContent,/Endereço salvo/);
    assert.equal(p.server.store.slug,'loja-qa');
    assert.equal(replies[1].slug,'novo-endereco-qa');
    replies[1].resolve();
    await waitFor(()=>/Endereço salvo/.test(p.$('.lo-toast').textContent));
    assert.equal(p.server.store.slug,'novo-endereco-qa');
  }finally{replies.forEach(reply=>reply.resolve());p.w.close();}
});
test('resposta sem a alteração confirmada vira erro, nunca sucesso', async () => {
  const p = panel({ handler: (name, data, server) => { if (name === 'saveOnlineStore') { server.store = { ...server.store, revision: server.store.revision + 1 };return { data: { store: server.store } }; } } });await p.ready;
  p.T.toggle('p3');await p.T.flush();
  assert.equal(p.T.state.saveState, 'error');assert.match(p.T.state.saveError, /não confirmou/);
});
test('uma confirmação parcial de categorias não descarta a alteração local', async () => {
  const p = panel({handler: (name, data, {store}) => {
    if (name === 'saveOnlineStore') return {data:{store:{...store, revision:store.revision+1,
      catalogSettings:data.settings, selectedProductIds:data.productIds}}};
  }});
  await p.ready;
  p.T.queue({t:'categoryName',name:'Doces',value:'Doceria'});
  await p.T.flush();
  assert.match(saveText(p), /Não salvo/);
  assert.equal(p.T.state.draft.presentation.categories[0].publicName,'Doceria');
});
test('publicação duplicada e leitura pública fora de ordem não alteram a confirmação recente', async () => {
  let settleOld, settleCurrent, reads=0;
  const p = panel({ publicReader: () => new Promise(resolve => { if (++reads === 1) settleOld=resolve;else settleCurrent=resolve; }) });
  await p.ready;
  const old = p.T.state.data.store;
  p.T.toggle('p1');
  await Promise.all([p.T.publish('publish'),p.T.publish('publish')]);
  assert.equal(p.calls.filter(c=>c.data.action==='publish').length,1);
  const current=p.T.state.data.store;
  settleCurrent({businessId:current.businessId,spaceId:current.spaceId,workspaceGeneration:current.workspaceGeneration,
    revision:current.revision,active:true,items:[{productId:'p0',category:'Doces'},{productId:'p1',category:'Bolos'}],publicSettings:current.catalogSettings});
  await Promise.resolve();
  settleOld({businessId:old.businessId,spaceId:old.spaceId,workspaceGeneration:old.workspaceGeneration,
    revision:old.revision,active:true,items:[],publicSettings:old.catalogSettings});
  await Promise.resolve();
  assert.deepEqual(p.T.state.live?.items?.map(x=>x.productId),['p0','p1']);
  assert.match(saveText(p), /Publicado às/);
});
test('conflito com outro aparelho: recarrega e reaplica a alteração uma vez', async () => {
  let first = true;const p = panel({ handler: (name, data, server) => { if (name === 'saveOnlineStore' && first) { first = false;server.store = { ...server.store, revision: 9, catalogSettings: Store.settings({ publicName: 'Mudou em outro aparelho', contactPhone: '(11) 91234-5678' }) };throw Object.assign(Error('alterada'), { code: 'functions/aborted' }); } } });await p.ready;
  p.T.toggle('p1');await p.T.flush();await new Promise(r => setTimeout(r, 20));
  const saves = p.calls.filter(c => c.name === 'saveOnlineStore');
  assert.equal(saves.length, 2);assert.equal(saves[1].data.revision, 9);assert.deepEqual(saves[1].data.productIds, ['p0', 'p1']);
  assert.equal(saves[1].data.settings.publicName, 'Mudou em outro aparelho', 'não sobrescreve o que o outro aparelho salvou');
  assert.equal(p.T.state.saveState, 'saved');
});
test('somente o proprietário altera: sem chamadas e com aviso de leitura', async () => {
  const p = panel({ owner: false });await p.ready;
  p.T.toggle('p1');p.T.star('p1');await p.T.flush();
  assert.equal(p.calls.filter(c => c.name === 'saveOnlineStore').length, 0);
  assert.match(saveText(p), /Somente o proprietário/);
});
test('limite de 400 produtos na loja é respeitado antes de qualquer chamada', async () => {
  const ids = Array.from({ length: 400 }, (_, i) => `p${i}`);
  const p = panel({ products: 401, store: { id: 's', slug: 'loja-qa', revision: 1, published: false, catalogSettings: Store.settings({ publicName: 'Loja' }), selectedProductIds: ids, presentation: { products: {}, categories: [] } } });await p.ready;
  p.T.toggle('p400');assert.equal(p.T.state.ops.length, 0);
  assert.match(p.$('.lo-toast').textContent, /até 400 produtos/);
});
test('publicar espera o rascunho salvar e confirma a publicação', async () => {
  const p = panel({ store: { id: 's', slug: 'loja-qa', revision: 2, published: false, activation: null, catalogSettings: Store.settings({ publicName: 'Loja' }), selectedProductIds: ['p0'], presentation: { products: {}, categories: [] } } });await p.ready;
  p.T.toggle('p1');await p.T.publish('publish');
  const saves = p.calls.filter(c => c.name === 'saveOnlineStore').map(c => c.data);
  assert.deepEqual(saves.map(s => s.action), ['save', 'publish']);
  assert.equal(saves[1].confirmed, true);assert.equal(saves[1].published, true);assert.deepEqual(saves[1].productIds, ['p0', 'p1']);
  assert.equal(p.T.state.data.store.published, true);
  assert.match(p.$('#store-v2').textContent, /Publicada/);
});
test('2.000 produtos: monta só o primeiro lote e a busca encontra itens fora dele', async () => {
  const p = panel({ products: 2000 });await p.ready;p.T.goView('products');
  assert.equal(p.w.document.querySelectorAll('.lo-pcard').length, 36);
  const input = p.$('[data-q]');input.value = 'produto 1999';
  const t0 = performance.now();p.T.state.filter.q = input.value;p.T.mountGrid();const ms = performance.now() - t0;
  const cards = [...p.w.document.querySelectorAll('.lo-pcard')];
  assert.equal(cards.length, 1);assert.equal(cards[0].dataset.pid, 'p1999');
  assert.ok(ms < 250, `busca levou ${ms.toFixed(1)} ms`);
});
test('prévia usa o rascunho sem expor custo', async () => {
  const p = panel();await p.ready;p.T.toggle('p1');
  const c = p.T.previewCatalog();
  assert.deepEqual(c.items.map(i => i.productId), ['p0', 'p1']);
  assert.ok(!JSON.stringify(c).includes('custo'));assert.equal(c.preview, true);
});

/* ---------- Loja pública: salvaguardas estáticas ---------- */
const portal = fs.readFileSync('js/catalogo-publico.js', 'utf8'), kit = fs.readFileSync('js/loja/store-kit.js', 'utf8');
test('nenhum número de WhatsApp fixo no código da loja', () => {
  for (const src of [portal, kit, fs.readFileSync('js/online-store-ui.js', 'utf8')]) {
    assert.doesNotMatch(src, /wa\.me\/\d/);
    assert.doesNotMatch(src, /\b55\d{10,11}\b/);
    // Telefones aparecem só como exemplo em placeholder; o destino é sempre o número publicado da loja.
    for (const m of src.matchAll(/\(\d{2}\) \d{4,5}-\d{4}/g)) assert.match(src.slice(Math.max(0, m.index - 40), m.index), /placeholder|Ex\.:/, m[0]);
  }
});
test('enviar pelo WhatsApp não registra pedido, venda, pagamento nem estoque', () => {
  const click = portal.slice(portal.indexOf("const wa=t.closest('#sf-send-wa');"), portal.indexOf("const ext=t.closest('a[target=\"_blank\"]')"));
  assert.ok(click.length > 50);
  assert.doesNotMatch(click, /callable|submitOrder|attempts\(\)|setDoc|updateDoc|cart=\{\}/);
  assert.match(click, /view='sent'/);
  assert.match(portal, /Seu pedido ainda não foi confirmado/);
  assert.match(portal, /Já enviei, limpar o carrinho/);
});
test('prévia aceita mensagens só da própria origem e da janela que a embute, sem Firebase', () => {
  assert.match(portal, /event\.origin!==location\.origin\|\|event\.source!==window\.parent/);
  assert.match(portal, /if\(preview\)throw Object\.assign\(Error\('Indisponível na prévia\.'\)/);
  assert.match(portal, /if\(preview\)\{event\.preventDefault\(\);previewMessage\(m\.text\);return;\}/);
});
test('loja pública só mostra o documento publicado e trata loja pausada', () => {
  assert.match(portal, /if\(data\.active!==true\)throw Object\.assign\(publicCatalogError\('paused'/);
  assert.doesNotMatch(portal, /collection\(|getDocs|onlineStores|catalogOrders/);
});
test('WhatsApp preserva emojis inteiros no limite de texto e o URI continua válido', () => {
  const input={storeName:'Doces & cia 🧁',items:[{quantity:1,name:'á'.repeat(159)+'🍫',unitPrice:4.2}],
    note:'x'.repeat(498)+'🍓',customer:{name:'Ana & João'},mode:'pickup'};
  const order=K.orderMessage(input);
  const href=new URL(K.whatsappUrl('11900000000',order.text));
  assert.equal(href.searchParams.get('text'),order.text);
  assert.match(order.text,/🍓/);
  assert.match(order.text,/Ana & João/);
  assert.doesNotMatch(order.text,/\uD83C(?:$|[^\uDC00-\uDFFF])/u);
});
test('link do WhatsApp considera o tamanho codificado e preserva o resumo integral', () => {
  const phone='11900000000', chat=K.whatsappChatUrl(phone);
  const room=4000-K.whatsappUrl(phone,'').length;
  assert.equal(K.whatsappUrl(phone,'a'.repeat(room)).length,4000);
  assert.equal(K.whatsappUrl(phone,'a'.repeat(room+1)),'');
  assert.equal(K.whatsappUrl(phone,'🍓'.repeat(400)),'');
  assert.equal(new URL(chat).search,'');
  const variant='Á'.repeat(120)+' 🍓 & Ninho';
  const order=K.orderMessage({storeName:'Loja QA',mode:'pickup',note:'Café & bolo? 🍰',
    items:Array.from({length:400},(_,i)=>({name:'Item '+(i+1),variant,quantity:2,unitPrice:2.25}))});
  assert.equal(K.whatsappUrl(phone,order.text),'');
  assert.equal(order.text.split('\n').filter(r=>r.startsWith('2x ')).length,400);
  assert.ok(order.text.includes(`2x Item 400 (${variant}) — R$ 4,50`));
  assert.match(order.text,/Café & bolo\? 🍰/);
  assert.equal(order.subtotal,1800);
});
test('cores intermediárias personalizadas mantêm o contraste do texto', () => {
  for(const color of ['#777777','#808080']){
    assert.ok(K.contrast(color,K.onColor(color))>=4.5);
  }
});
