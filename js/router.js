window.Router = (() => {
  const routes = new Set([
    'inicio', 'vender', 'clientes', 'renovacoes', 'crm', 'cobrancas',
    'produtos', 'consignados', 'equipe', 'campanhas', 'financeiro',
    'catalogo', 'pedidos', 'historico', 'relatorios', 'configuracoes', 'planos', 'cupons',
  ]);
  let lastHash, lastRoute;
  const normalize = route => route === 'fiados' ? 'clientes' : route === 'visitas' ? 'catalogo' : route;
  function atual() {
    const hash = location.hash;
    if (hash === lastHash) return lastRoute;
    const route = normalize(hash.replace('#/', '').split('?')[0]);
    lastHash = hash;
    return lastRoute = routes.has(route) ? route : 'inicio';
  }
  const ir = route => { location.hash = `#/${normalize(route)}`; };
  function iniciar(render) {
    addEventListener('hashchange', () => render(atual()));
    if (location.hash) render(atual());
    else ir('inicio');
  }
  return { atual, ir, iniciar };
})();
