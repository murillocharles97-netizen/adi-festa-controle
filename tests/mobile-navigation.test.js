const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8");
const index = read("index.html");
const css = read("css/mobile-navigation.css");
const script = read("js/mobile-navigation.js");
const manifest = JSON.parse(read("manifest.json"));
const worker = read("service-worker.js");

test("drawer mobile não duplica a navegação principal do rodapé", () => {
  const mobile = index.match(/<nav class="mobile-sidebar-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.ok(mobile);
  for (const route of ["inicio", "vender", "clientes", "produtos"])
    assert.doesNotMatch(mobile, new RegExp(`data-route="${route}"`));
  for (const route of ["crm", "campanhas", "catalogo", "pedidos", "historico", "relatorios", "configuracoes", "planos"])
    assert.match(mobile, new RegExp(`data-route="${route}"`));
  assert.match(index, /class="desktop-sidebar-nav"/);
  assert.match(index, /data-mobile-route="inicio"/);
  assert.match(index, /data-mobile-route="produtos"/);
});

test("grupos mobile são acessíveis e preservam rotas existentes", () => {
  assert.match(index, /aria-controls="mobile-nav-crm"/);
  assert.match(index, /aria-controls="mobile-nav-online"/);
  assert.match(index, /aria-controls="mobile-nav-history"/);
  assert.match(script, /GROUP_ROUTES/);
  assert.match(script, /aria-expanded/);
  assert.match(script, /adiFestaDrawer/);
  assert.match(script, /data-mobile-orders-count/);
  assert.doesNotMatch(script, /getDocs|onSnapshot|FirebaseCallable/);
});

test("PWA standalone e navegação respeitam safe areas oficiais", () => {
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.display_override, ["standalone"]);
  assert.match(index, /viewport-fit=cover/);
  for (const inset of ["top", "bottom", "left", "right"])
    assert.match(css, new RegExp(`safe-area-inset-${inset}`));
  assert.match(css, /100dvh/);
  assert.doesNotMatch(manifest.display_override.join(" "), /fullscreen/);
  assert.match(worker, /mobile-navigation\.css/);
  assert.match(worker, /mobile-navigation\.js/);
});
