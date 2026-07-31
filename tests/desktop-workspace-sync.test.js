const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, ".."),
  read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("PDV e Configurações desktop são isolados do mobile e não consultam Firebase", () => {
  const sales = read("js/desktop-sales.js"),
    settings = read("js/desktop-settings.js"),
    salesCss = read("css/desktop-sales.css"),
    settingsCss = read("css/desktop-settings.css"),
    app = read("js/app.js"),
    index = read("index.html");

  assert.match(sales, /matchMedia\("\(min-width:768px\)"\)/);
  assert.match(settings, /matchMedia\("\(min-width:768px\)"\)/);
  assert.doesNotMatch(
    `${sales}\n${settings}`,
    /getDocs|onSnapshot|collection\(/,
  );
  assert.match(salesCss, /^@media \(min-width: 768px\)/);
  assert.match(settingsCss, /^@media \(min-width: 768px\)/);
  assert.doesNotMatch(`${salesCss}\n${settingsCss}`, /max-width:\s*767px/);
  assert.match(
    app,
    /ConfiguracoesMobile\?\.isMobile\(\)[\s\S]*ConfiguracoesMobile\.render\(\)/,
  );
  assert.match(app, /DesktopSales\.render/);
  assert.match(app, /DesktopSettings\.render/);
  assert.match(index, /desktop-sales\.js/);
  assert.match(index, /desktop-settings\.js/);
});

test("sincronização usa um único sinal por empresa e puxa só coleções alteradas", () => {
  const sync = read("js/firebase/sync.js"),
    repository = read("js/firebase/firestore-repository.js"),
    app = read("js/app.js");

  assert.match(sync, /REALTIME_NAMES\s*=\s*new Set\(\)/);
  assert.match(sync, /syncSignalRepository\.subscribeById\(\s*"last-sync"/);
  assert.match(sync, /changedCollections/);
  assert.match(
    sync,
    /pullCloudCollections\(\{ force: true, names: cloudNames \}\)/,
  );
  assert.match(sync, /sourceSessionId:\s*syncSessionId/);
  assert.match(sync, /refreshBusinessContext\(\)/);
  assert.match(sync, /refreshUserContext\(\)/);
  assert.match(repository, /subscribeById\(id, callback, onError\)/);
  assert.doesNotMatch(sync, /setInterval\(/);
  assert.match(app, /DesktopSales\?\.refreshProducts/);
  assert.match(app, /DesktopSales\?\.refreshClients/);
});
