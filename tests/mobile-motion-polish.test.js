const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, ".."),
  read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("tokens e utilitários de movimento são centrais e acessíveis", () => {
  const css = read("css/mobile-motion.css"), js = read("js/mobile-motion.js");
  assert.match(css, /--motion-fast:150ms/);
  assert.match(css, /--motion-flight:330ms/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(js, /function flip/);
  assert.match(js, /function fly/);
  assert.match(js, /function counter/);
  assert.match(js, /dataset\.motionFlight/);
});

test("Produtos preserva preferência local e usa FLIP sem Firestore", () => {
  const source = read("js/produtos-mobile.js");
  assert.match(source, /localStorage\.setItem\("productViewMode"/);
  assert.match(source, /MobileMotion\.capture/);
  assert.match(source, /MobileMotion\.flip/);
  assert.doesNotMatch(source, /getDocs|onSnapshot|firebase\.firestore/);
});

test("Vender usa imagem oficial, contador e primeiro fly-to-cart", () => {
  const checkout = read("js/checkout.js"), mobile = read("js/checkout-mobile.js"), css = read("css/checkout-mobile.css");
  assert.match(checkout, /ProductImages\?\.markup/);
  assert.match(checkout, /sale-item-added/);
  assert.match(checkout, /first:\s*before === 0/);
  assert.match(checkout, /rebuildSoldIndex\(\)/);
  assert.match(mobile, /MobileMotion\?\.fly/);
  assert.match(mobile, /if\(event\.detail\?\.first\)/);
  assert.match(css, /scroll-snap-type:x proximity/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(mobile, /onSnapshot|getDocs/);
});

test("Service worker e HTML incluem o pacote de movimento", () => {
  const html = read("index.html");
  assert.match(html, /mobile-motion\.css/);
  assert.match(html, /mobile-motion\.js/);
  assert.match(html, /checkout\.js\?v=90/);
  assert.match(html, /produtos-mobile\.js\?v=90/);
});
