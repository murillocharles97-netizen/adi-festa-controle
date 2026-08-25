const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8");

test("PDV desktop V2 usa o checkout único sem tocar o renderer mobile", () => {
  const app = read("js/app.js"),
    checkout = read("js/checkout.js"),
    desktop = read("js/desktop-sales.js"),
    css = read("css/desktop-sales.css");

  assert.match(app, /DesktopSales\?\.isDesktop\?\.\(\)[\s\S]*Checkout\?\.view/);
  assert.match(app, /Checkout\?\.bindDesktop/);
  assert.match(checkout, /DesktopSales\.render/);
  assert.match(checkout, /DesktopSales\.cartHTML/);
  assert.match(checkout, /productType === "recurring"/);
  assert.match(checkout, /Repositories\.saleRepository\(\)\.create/);
  assert.match(checkout, /appliedCampaignIds/);
  assert.match(desktop, /recentProducts/);
  assert.match(desktop, /ProductImages\?\.markup/);
  assert.match(desktop, /desktop-sale-brand/);
  assert.match(desktop, /F2/);
  assert.match(desktop, /F4/);
  assert.match(desktop, /F8/);
  assert.doesNotMatch(desktop, /getDocs|onSnapshot|collection\(/);
  assert.match(css, /^@media \(min-width: 768px\)/);
  assert.doesNotMatch(css, /!important/);
});

test("PDV desktop V2 mantém estoque, variações e painel sticky responsivo", () => {
  const desktop = read("js/desktop-sales.js"),
    css = read("css/desktop-sales.css"),
    fixture = read("tests/desktop-shell-content.fixture.html");

  assert.match(desktop, /getProductStockStatus/);
  assert.match(desktop, /ProductVariations\?\.isVariable/);
  assert.match(desktop, /data-cart-step/);
  assert.match(desktop, /desktop-discount-trigger/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.7fr\) minmax\(370px,\s*1fr\)/);
  assert.match(css, /position:\s*sticky/);
  for (const width of [1280, 1040, 900])
    assert.match(css, new RegExp(`max-width: ${width}px`));
  assert.match(fixture, /customer-subscriptions\.js/);
  assert.match(fixture, /checkout\.js/);
});
