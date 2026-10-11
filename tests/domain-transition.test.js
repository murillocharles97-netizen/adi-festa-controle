const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const bases = ['https://veconi.app.br/', 'https://murillocharles97-netizen.github.io/adi-festa-controle/'];

test('novos checkouts retornam ao domínio oficial sem depender de barra final', () => {
  const source = read('functions/src/index.js');
  assert.match(source, /default:'https:\/\/veconi\.app\.br'/);
  assert.ok(source.includes("backUrl=new URL('#/planos',APP_URL.value()).href"));
  assert.doesNotMatch(source, /murillocharles97-netizen\.github\.io/);
  for (const base of ['https://veconi.app.br', 'https://veconi.app.br/']) {
    assert.equal(new URL('#/planos', base).href, 'https://veconi.app.br/#/planos');
  }
});

for (const base of bases) {
  test(`HTML, manifest e precache permanecem dentro da base ${base}`, () => {
    const refs = [];
    for (const html of ['index.html', 'catalogo.html']) {
      const source = read(html);
      assert.doesNotMatch(source, /<base\b/i);
      for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        if (/^(?:https?:|data:|#)/.test(match[1])) continue;
        refs.push(new URL(match[1], base));
      }
    }
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(new URL(manifest.scope, base).href, base);
    assert.equal(new URL(manifest.start_url, base).href, base + 'index.html');
    refs.push(...manifest.icons.map(icon => new URL(icon.src, base)));
    const context = vm.createContext({self: {addEventListener() {}}});
    vm.runInContext(read('service-worker.js'), context);
    refs.push(...vm.runInContext('ARQUIVOS', context).map(file => new URL(file, base)));
    for (const url of refs) {
      assert.ok(url.href.startsWith(base), `URL escapou da base: ${url}`);
      const relative = decodeURIComponent(url.pathname.slice(new URL(base).pathname.length));
      assert.ok(fs.existsSync(path.join(root, relative || 'index.html')), `Asset ausente: ${relative}`);
    }
  });

  test(`catálogo legado e rotas hash preservam a base ${base}`, () => {
    const location = new URL('catalogo/token-de-teste?origem=link', base);
    let target;
    location.replace = value => { target = new URL(value, location).href; };
    vm.runInNewContext(read('404.html').match(/<script>([\s\S]*?)<\/script>/)[1], {location});
    assert.equal(target, base + 'catalogo.html?v=token-de-teste&origem=link');
    const routeLocation = new URL('?teamInvite=fixture#/planos', base);
    const context = {window: {}, location: routeLocation, addEventListener() {}};
    vm.runInNewContext(read('js/router.js'), context);
    assert.equal(context.window.Router.atual(), 'planos');
    context.window.Router.ir('financeiro');
    assert.equal(routeLocation.href, base + '?teamInvite=fixture#/financeiro');
  });
}

test('metadata usa o domínio oficial sem impor base ou redirect de hostname', () => {
  const index = read('index.html');
  assert.match(index, /property="og:url" content="https:\/\/veconi\.app\.br\/"/);
  assert.doesNotMatch(index, /murillocharles97-netizen\.github\.io/);
  assert.doesNotMatch(read('js/router.js') + read('404.html'), /veconi\.app\.br|github\.io/);
  assert.match(read('js/app.js'), /register\("\.\/service-worker\.js"\)/);
  assert.match(read('js/catalogo-publico.js'), /register\('\.\/service-worker\.js'\)/);
});
