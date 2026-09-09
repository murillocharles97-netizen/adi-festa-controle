const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('manifesto publica a identidade e todos os ícones VECONI', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.name, 'VECONI');
  assert.equal(manifest.short_name, 'VECONI');
  assert.equal(manifest.theme_color, '#07141b');
  const expectedDimensions = new Map([['icon-192.png',192],['icon-512.png',512],['icon-maskable-192.png',192],['icon-maskable-512.png',512],['apple-touch-icon-180.png',180],['favicon-16.png',16],['favicon-32.png',32],['favicon-48.png',48]]);
  for (const [file, expectedSize] of expectedDimensions) {
    assert.ok(fs.statSync(path.join(root, 'assets', file)).size > 500, `${file} precisa existir e conter imagem`);
    const image = fs.readFileSync(path.join(root, 'assets', file));
    assert.equal(image.readUInt32BE(16), expectedSize, `${file} precisa ter largura correta`);
    assert.equal(image.readUInt32BE(20), expectedSize, `${file} precisa ter altura correta`);
  }
  assert.deepEqual(manifest.icons.map(icon => icon.purpose), ['any','any','maskable','maskable']);
});

test('design system centraliza tokens, primitives e estados acessíveis', () => {
  const css = read('css/design-system/veconi-theme.css');
  for (const token of ['--veconi-primary: #16cdbb','--veconi-cyan: #22e2d5','--veconi-ink: #101b2d','--veconi-bg: #f5f7fa','--veconi-danger: #e34855','--veconi-radius-card: 18px']) assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const primitive of ['.v-card','.v-button','.v-input','.v-chip','.v-tabs','.v-badge','.v-icon-button','.v-modal','.v-sheet','.v-empty-state']) assert.match(css, new RegExp(primitive.replace('.', '\\.')));
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /env\(safe-area-inset/);
});

test('shell identifica VECONI sem renomear o negócio Adi Festa', () => {
  const html = read('index.html');
  assert.match(html, /<title>VECONI<\/title>/);
  assert.match(html, /data-veconi-logo="horizontal"/);
  assert.match(html, /data-mobile-business-name data-business-name>Adi Festa/);
  assert.match(html, /veconi-theme\.css\?v=123/);
  assert.match(html, /apple-touch-icon-180\.png/);
  assert.doesNotMatch(html, /apple-mobile-web-app-title" content="Adi Festa"/);
});

test('login, planos e catálogo usam a marca da plataforma nos pontos corretos', () => {
  assert.match(read('js/firebase/auth.js'), /brandMarkup/);
  assert.doesNotMatch(read('js/firebase/auth.js'), /auth-logo">AF/);
  const context = read('js/firebase/business-context.js');
  for (const plan of ['VECONI Essencial','VECONI Profissional','VECONI Premium']) assert.match(context, new RegExp(plan));
  assert.match(read('js/catalogo-publico.js'), /Criado com <b>VECONI<\/b>/);
  assert.match(read('js/catalogo-publico.js'), /catalog\.publicName\|\|catalog\.businessName/);
  assert.match(read('functions/src/services/mercado-pago-service.js'), /reason:`VECONI - \$\{plan\.name\}`/);
});

test('service worker v123 troca o cache e inclui os assets da nova marca', () => {
  const worker = read('service-worker.js');
  assert.match(worker, /veconi-v123-visual-system-v2/);
  assert.match(worker, /release:'123'/);
  for (const asset of ['veconi-theme.css','veconi-brand.js','veconi-symbol.svg','icon-maskable-512.png','apple-touch-icon-180.png','favicon-32.png']) assert.match(worker, new RegExp(asset.replace('.', '\\.')));
});

test('fixture do screenshot gate cobre todos os módulos pedidos', () => {
  const fixture = read('tests/veconi-visual-system.fixture.html');
  for (const screen of ['login','inicio','vender','produtos','clientes','crm','campanhas','financeiro','cartoes','historico','catalogo','pedidos','planos','configuracoes','drawer']) assert.match(fixture, new RegExp(screen));
  assert.match(fixture, /document\.documentElement\.dataset\.ready='true'/);
});
