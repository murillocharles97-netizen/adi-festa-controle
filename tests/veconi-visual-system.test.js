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
  const expectedDimensions = new Map([['veconi-icon-192-v133.png',192],['veconi-icon-512-v133.png',512],['veconi-maskable-192-v133.png',192],['veconi-maskable-512-v133.png',512],['veconi-apple-touch-icon-180-v133.png',180],['veconi-favicon-16-v133.png',16],['veconi-favicon-32-v133.png',32],['veconi-favicon-48-v133.png',48]]);
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
  for (const token of ['--veconi-primary: #16cdbb','--veconi-cyan: #22e2d5','--veconi-ink: #101b2d','--veconi-bg: #f5f7fa','--veconi-danger: #c0262d','--veconi-radius-card: 16px']) assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // DS v2: every text token meets WCAG AA (4.5:1) on white, and the turquoise button keeps dark text.
  const value = name => css.match(new RegExp(`${name}: (#[0-9a-f]{6});`, 'i'))?.[1];
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const name of ['--veconi-text','--veconi-text-secondary','--veconi-text-muted','--veconi-success','--veconi-warning','--veconi-danger','--veconi-info','--veconi-action']) {
    assert.ok(value(name), name);
    assert.ok(ratio(value(name), '#ffffff') >= 4.5, `${name} ${ratio(value(name), '#ffffff').toFixed(2)}:1`);
  }
  assert.ok(ratio(value('--veconi-on-primary'), value('--veconi-primary')) >= 4.5);
  assert.ok(ratio(value('--veconi-on-primary'), value('--veconi-primary-hover')) >= 4.5);
  assert.match(css, /\.btn-primary:hover[^}]*color: var\(--veconi-on-primary\)/);
  for (const primitive of ['.v-card','.v-button','.v-input','.v-chip','.v-tabs','.v-badge','.v-icon-button','.v-modal','.v-sheet','.v-empty-state']) assert.match(css, new RegExp(primitive.replace('.', '\\.')));
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /env\(safe-area-inset/);
});

test('shell identifica VECONI sem fixar um negócio legado antes da hidratação', () => {
  const html = read('index.html');
  assert.match(html, /<title>VECONI<\/title>/);
  assert.match(html, /data-veconi-logo="horizontal"/);
  assert.match(html, /data-mobile-business-name data-business-name>Seu negócio/);
  assert.match(html, /veconi-theme\.css\?v=2311-ds2/);
  assert.match(html, /veconi-apple-touch-icon-180-v133\.png/);
  assert.doesNotMatch(html, /apple-mobile-web-app-title" content="Adi Festa"/);
});

test('login, planos e catálogo usam a marca da plataforma nos pontos corretos', () => {
  assert.match(read('js/firebase/auth.js'), /brandMarkup/);
  assert.doesNotMatch(read('js/firebase/auth.js'), /auth-logo">AF/);
  const catalog = require('../functions/src/shared/plan-catalog');
  assert.deepEqual(Object.values(catalog.plans).map(plan=>plan.name), ['Essencial','Gestão','Pro']);
  assert.match(read('js/catalogo-publico.js'), /Criado com <b>VECONI<\/b>/);
  assert.match(read('js/catalogo-publico.js'), /catalog\.publicName\|\|catalog\.businessName/);
  assert.match(read('functions/src/services/mercado-pago-service.js'), /reason:`VECONI - \$\{plan\.name\}`/);
});

test('service worker troca o cache, mantém os recursos de marca e retira a Central do precache', () => {
  const worker = read('service-worker.js');
  assert.match(worker, /const CACHE='veconi-v2311-legacy-product-spaces-v1'/);
  assert.match(worker, /financial-refinement\.css/);
  assert.match(worker, /release:\s*'229'/);
  for (const asset of ['veconi-theme.css','veconi-brand.js','veconi-symbol.svg','veconi-maskable-512-v133.png','veconi-apple-touch-icon-180-v133.png','veconi-favicon-32-v133.png']) assert.match(worker, new RegExp(asset.replace('.', '\\.')));
  assert.match(worker, /\.\/assets\/fonts\/inter-latin-wght-normal\.woff2/);
  assert.doesNotMatch(worker, /\.\/(?:central-fiado\.html|css\/fiado-central\.css|js\/fiado-central(?:-entry)?\.js)/);
});

test('fixture do screenshot gate cobre todos os módulos pedidos', () => {
  const fixture = read('tests/veconi-visual-system.fixture.html');
  for (const screen of ['login','inicio','vender','produtos','clientes','crm','campanhas','financeiro','cartoes','historico','catalogo','pedidos','planos','configuracoes','drawer']) assert.match(fixture, new RegExp(screen));
  assert.match(fixture, /document\.documentElement\.dataset\.ready='true'/);
});
