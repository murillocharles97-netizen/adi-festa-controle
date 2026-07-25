const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('ações principais mobile são contextuais', () => {
  const source = read('js/barcode.js');
  assert.match(source, /vender:\{icon:'scan-barcode',label:'Escanear',action:'scan-sale'\}/);
  assert.match(source, /clientes:\{icon:'plus',label:'Novo cliente',action:'new-client'\}/);
  assert.match(source, /produtos:\{icon:'scan-barcode',label:'Ler código',action:'scan-product'\}/);
  assert.match(source, /campanhas:\{icon:'megaphone',label:'Nova campanha',action:'new-campaign'\}/);
});

test('scanners duplicados não são exibidos nas buscas mobile', () => {
  const products = read('js/produtos-mobile.js');
  const checkoutCss = read('css/checkout-mobile.css');
  assert.doesNotMatch(products, /<button data-scan-product/);
  assert.match(checkoutCss, /\.pos-search-wrap \[data-scan-sale\]\{display:none!important\}/);
});

test('campanhas usam percentual pt-BR e uma única ação de criação', () => {
  const campaigns = read('js/campanhas-mobile.js');
  assert.match(campaigns, /toLocaleString\('pt-BR'/);
  assert.match(campaigns, /Taxa de conversão/);
  assert.doesNotMatch(campaigns, /class="mobile-campaign-fab"/);
  assert.match(campaigns, /dataset\.primaryAction === 'new-campaign'/);
});

test('correções responsivas protegem cabeçalho e buscas estreitas', () => {
  const globalCss = read('css/mobile-fixes.css');
  const clientsCss = read('css/clientes-mobile.css');
  const campaignsCss = read('css/campanhas-mobile.css');
  assert.match(globalCss, /grid-template-columns:44px minmax\(0,1fr\) 44px 42px/);
  assert.match(globalCss, /\.topbar \.local-badge\{display:grid!important/);
  assert.match(clientsCss, /grid-template-columns:minmax\(0,1fr\) 48px 48px/);
  assert.match(campaignsCss, /flex: 0 0 164px/);
});

console.log('mobile-layout-polish.test.js: OK');
