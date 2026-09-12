const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readBinary = (file) => fs.readFileSync(path.join(root, file));

const expectedPngs = new Map([
  ["assets/veconi-icon-192-v133.png", 192],
  ["assets/veconi-icon-512-v133.png", 512],
  ["assets/veconi-maskable-192-v133.png", 192],
  ["assets/veconi-maskable-512-v133.png", 512],
  ["assets/veconi-apple-touch-icon-180-v133.png", 180],
  ["assets/veconi-favicon-16-v133.png", 16],
  ["assets/veconi-favicon-32-v133.png", 32],
  ["assets/veconi-favicon-48-v133.png", 48],
]);

test("manifest V133 usa somente a identidade instalável VECONI", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.id, "./index.html");
  assert.equal(manifest.name, "VECONI");
  assert.equal(manifest.short_name, "VECONI");
  assert.equal(manifest.lang, "pt-BR");
  assert.equal(manifest.start_url, "./index.html");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#07141b");
  assert.equal(manifest.background_color, "#07141b");
  assert.match(manifest.description, /VECONI.*Seu negócio mais completo/);
  assert.deepEqual(manifest.icons.map(({ purpose }) => purpose), ["any", "any", "maskable", "maskable"]);
  assert.ok(manifest.icons.every(({ src }) => /veconi-(?:icon|maskable)-\d+-v133\.png$/.test(src)));
  assert.doesNotMatch(JSON.stringify(manifest), /(?:^|[\/])(?:icon|favicon|apple-touch-icon)(?:-|\.)/i);
  assert.doesNotMatch(JSON.stringify(manifest), /Adi Festa|\bAF\b/i);
});

test("assets VECONI possuem assinatura e dimensões corretas", () => {
  for (const [file, expectedSize] of expectedPngs) {
    const image = readBinary(file);
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${file} precisa ser PNG`);
    assert.equal(image.readUInt32BE(16), expectedSize, `${file} precisa ter largura correta`);
    assert.equal(image.readUInt32BE(20), expectedSize, `${file} precisa ter altura correta`);
  }
  const ico = readBinary("assets/veconi-favicon-v133.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  assert.match(read("assets/veconi-icon-v133.svg"), /Ícone VECONI/);
});

test("metadata externa aponta para assets físicos novos e para VECONI", () => {
  const index = read("index.html"), catalog = read("catalogo.html"), notFound = read("404.html");
  for (const html of [index, catalog, notFound]) {
    assert.match(html, /<title>[^<]*VECONI[^<]*<\/title>/);
    assert.match(html, /veconi-(?:icon|favicon)[^"']*v133/);
    assert.doesNotMatch(html, /assets\/(?:icon(?:-|\.)|favicon-|apple-touch-icon-)/);
  }
  assert.match(index, /manifest\.json\?v=133-branding-pwa/);
  assert.match(index, /application-name" content="VECONI"/);
  assert.match(index, /apple-mobile-web-app-title" content="VECONI"/);
  assert.match(index, /og:title" content="VECONI — Seu negócio mais completo\./);
  assert.match(index, /twitter:title" content="VECONI — Seu negócio mais completo\./);
  assert.match(index, /veconi-apple-touch-icon-180-v133\.png/);
  assert.doesNotMatch(index, />AF<|>Adi Festa</);
});

test("service worker V134 migra apenas caches do app e preserva os assets V133", () => {
  const worker = read("service-worker.js");
  assert.match(worker, /veconi-v134-global-financial-resources/);
  assert.match(worker, /release:'134'/);
  assert.match(worker, /OBSOLETE_CACHE_PREFIXES=\['veconi-','adi-festa-'\]/);
  assert.match(worker, /OBSOLETE_CACHE_PREFIXES\.some\(prefix=>key\.startsWith\(prefix\)\)/);
  for (const file of expectedPngs.keys()) assert.match(worker, new RegExp(path.basename(file).replaceAll(".", "\\.")));
  assert.match(worker, /veconi-favicon-v133\.ico/);
  assert.doesNotMatch(worker, /'\.\/assets\/(?:icon(?:-|\.)|favicon-|apple-touch-icon-)/);
  assert.doesNotMatch(worker, /indexedDB\.(?:deleteDatabase|databases)|localStorage\.clear|sessionStorage\.clear/);
});

test("branding visível fixo não usa mais AF ou Adi Festa como marca da plataforma", () => {
  const app = read("js/app.js"), visual = read("js/visual-ui.js"), navigation = read("js/mobile-navigation.js"), catalogAdmin = read("js/catalogo-admin.js");
  assert.doesNotMatch(app, /Seu resumo rápido da Adi Festa|conta atual na Adi Festa|crédito.+na Adi Festa/);
  assert.doesNotMatch(visual, /Seu resumo rápido da Adi Festa/);
  assert.doesNotMatch(navigation, /\|\| "AF"/);
  assert.doesNotMatch(catalogAdmin, /fica fixa como Adi Festa/);
  assert.match(app, /businessReference/);
  assert.match(read("functions/src/services/mercado-pago-service.js"), /reason:`VECONI - \$\{plan\.name\}`/);
  assert.match(read("js/catalogo-publico.js"), /publicOrderNumber:`VC\$\{Date\.now\(\)/);
  assert.match(read("functions/src/index.js"), /publicOrderNumber=`VC\$\{Date\.now\(\)/);
});

test("identificadores técnicos legados permanecem compatíveis", () => {
  assert.match(read("js/firebase/firebase-config.js"), /projectId:'adi-festa-controle'/);
  assert.match(read("js/storage.js"), /LEGACY_KEY='adiFestaDB_v1'/);
  assert.match(read("js/build-info.js"), /window\.AdiFestaBuild/);
  assert.match(read(".firebaserc"), /adi-festa-controle/);
});
