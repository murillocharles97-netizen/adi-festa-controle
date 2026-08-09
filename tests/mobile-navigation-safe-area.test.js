const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const gesture = require("../js/mobile-navigation-gesture.js");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const swipe = (changes = {}) => gesture.classifySwipe({
  startX: 10,
  startY: 100,
  endX: 90,
  endY: 104,
  pointerType: "touch",
  ...changes,
});

test("touch iniciado fora da edge zone não abre o menu", () => {
  assert.equal(swipe({ startX: gesture.EDGE_ZONE + 12, endX: 140 }), null);
});

test("swipe vertical ou curto não abre o menu", () => {
  assert.equal(swipe({ endX: 24, endY: 190 }), null);
  assert.equal(swipe({ endX: 10 + gesture.THRESHOLD - 1 }), null);
});

test("swipe suficiente da borda esquerda abre o menu", () => {
  assert.equal(swipe({ endX: 10 + gesture.THRESHOLD }), "open");
  assert.equal(swipe({ safeLeft: 24, startX: 40, endX: 40 + gesture.THRESHOLD }), "open");
});

test("swipe para a esquerda fecha a sidebar aberta", () => {
  assert.equal(swipe({ drawerOpen: true, startX: 220, endX: 220 - gesture.THRESHOLD }), "close");
});

test("mouse e componentes horizontais não disparam o gesto mobile", () => {
  assert.equal(swipe({ pointerType: "mouse" }), null);
  assert.equal(swipe({ horizontalOwner: true }), null);
});

test("infraestrutura global publica safe areas e preserva botão existente", () => {
  const html = read("index.html");
  const css = read("css/mobile-navigation.css");
  const navigation = read("js/mobile-navigation.js");
  const app = read("js/app.js");
  const serviceWorker = read("service-worker.js");

  assert.equal((html.match(/name="viewport"/g) || []).length, 1);
  assert.match(html, /width=device-width,initial-scale=1,viewport-fit=cover/);
  ["safe-top", "safe-bottom", "safe-left", "safe-right"].forEach((name) => {
    assert.match(css, new RegExp(`--${name}:env\\(safe-area-inset-`));
  });
  assert.match(css, /\.topbar\{[\s\S]*?padding-top:var\(--safe-top\)/);
  assert.match(css, /\.topbar \.menu-btn\{[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(css, /\.bottom-nav\{[^}]*height:var\(--mobile-bottom-safe-height\)/);
  assert.match(navigation, /if \(initialized\) return;/);
  assert.match(navigation, /bindGestures\(\)/);
  assert.match(navigation, /addEventListener\("touchstart", onTouchStart/);
  assert.match(navigation, /addEventListener\("touchmove", onTouchMove, \{ passive: false, capture: true \}\)/);
  assert.match(navigation, /Date\.now\(\) - lastTouchAt < 750/);
  assert.match(navigation, /#mobile-drawer-close["']\)\?\.addEventListener\(["']click/);
  assert.match(app, /overlay\.onclick\s*=/);
  assert.match(app, /MobileNavigation\.toggle\(\)/);
  assert.match(navigation, /\[data-swipe-client\]/);
  assert.match(navigation, /\[data-product-shell\]/);
  assert.match(navigation, /#modal > \*/);
  assert.match(serviceWorker, /adi-festa-v79-desktop-bootstrap-recovery/);
  assert.match(serviceWorker, /mobile-navigation-gesture\.js/);
});
