'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { JSDOM } = require('jsdom');

test('owner selects explicit spaces on a legacy product; stale or unauthorized choices cannot write', async () => {
  const dom = new JSDOM('<div id="modal"></div>', { url: 'https://qa.example.invalid', runScripts: 'outside-only' });
  const w = dom.window;
  const product = { id: 'old', businessId: 'tenant-a', nome: 'Produto antigo', preco: 15, custo: 2, estoqueAtual: 3 };
  const original = structuredClone(product);
  const context = { businessId: 'tenant-a', role: 'owner', spaceAccess: 'all', business: { ownerId: 'owner-a', active: true } };
  let writes = 0, lastToast = '', session = 'session-a', hasInlineCost = false;
  Object.assign(w, {
    FirebaseSession: { user: { uid: 'owner-a' }, businessId: 'tenant-a' },
    BusinessContext: { get: () => context },
    TeamAccess: {
      has: permission => permission === 'products.edit',
      captureSession: () => session,
      assertSession: token => assert.equal(token, session),
    },
    Produtos: { obter: id => id === product.id ? product : null },
    FirestoreRepositories: { products: { getProductStatusFromServer: async () => ({ ...original, hasInlineCost }) } },
    DB: {
      __firebaseSyncWrapped: true,
      getBusinessId: () => 'tenant-a',
      carregar: () => ({ config: {} }),
      alterar: apply => { apply({ produtos: [product] }); writes++; },
      flush: async () => {},
    },
    Modais: { fechar: () => w.document.querySelector('#modal').replaceChildren() },
    Utils: { toast: message => { lastToast = message; } },
  });
  w.eval(fs.readFileSync('js/spaces.js', 'utf8'));
  const spaces = w.SpaceContext;
  const shop = (id, tenant = 'tenant-a', status = 'active') =>
    ({ id, name: id, type: 'business', businessId: tenant, status, capabilities: { sales: true } });
  spaces.setSpaces([shop('shop-a'), shop('shop-b'), shop('foreign', 'tenant-b'), shop('archived', 'tenant-a', 'archived')]);
  assert.equal(spaces.canReviewProductSpaces({ ...product, businessId: 'tenant-b' }), false);
  assert.equal(spaces.canReviewProductSpaces({ ...product, workspaceGeneration: 9 }), false);
  assert.equal(spaces.canReviewProductSpaces({ ...product, allowedSpaceIds: [] }), false);
  context.role = 'seller';
  assert.equal(spaces.canReviewProductSpaces(product), false);
  context.role = 'owner';
  assert.equal(spaces.canReviewProductSpaces(product), true);

  spaces.reviewProductSpaces('old');
  const form = w.document.querySelector('form');
  const inputs = [...form.querySelectorAll('input[name="spaceId"]')];
  assert.deepEqual(inputs.map(input => input.value).sort(), ['shop-a', 'shop-b']);
  assert.equal(inputs.some(input => input.checked), false);
  const submit = () => form.onsubmit({ currentTarget: form, preventDefault() {} });
  await submit();
  assert.equal(writes, 0);
  inputs[0].checked = true;
  inputs[0].value = 'foreign';
  await submit();
  assert.equal(writes, 0);
  inputs[0].value = 'shop-a';
  session = 'other-session';
  await submit();
  assert.equal(writes, 0);
  session = 'session-a';
  hasInlineCost = true;
  await submit();
  assert.equal(writes, 0);
  assert.match(lastToast, /custo no cadastro antigo/);
  hasInlineCost = false;
  inputs[1].checked = true;
  await submit();
  assert.equal(writes, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(product)), {
    ...original, spaceAccessMode: 'selected_spaces', allowedSpaceIds: ['shop-a', 'shop-b'],
    defaultSpaceId: 'shop-a', spaceScopeVersion: 1,
  });
  assert.match(lastToast, /após a sincronização/);
  assert.equal(spaces.canReviewProductSpaces(product), false);
  dom.window.close();
});
