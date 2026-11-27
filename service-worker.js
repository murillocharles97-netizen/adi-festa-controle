const CACHE='veconi-v24214-desempenho-v1';
// Trocas V1: retain compatible server fences and ledgers when rolling back the UI.
// Shared entitlement catalog (same source consumed by Cloud Functions).
const ARQUIVOS=['./js/pwa-update.js','./functions/src/shared/fiado-account.js','./functions/src/shared/installment-plan.js','./js/installment-credit.js','./functions/src/shared/prior-sale-policy.js','./js/prior-sales.js','./css/prior-sales.css','./js/online-checkout-attempts.js','./js/online-order-finalization.js','./js/online-orders-ui.js','./functions/src/shared/online-order.js','./css/online-orders.css','./','./index.html','./catalogo.html','./404.html','./manifest.json','./css/style.css','./css/finance.css','./css/mobile.css','./css/import.css','./css/visual.css','./css/firebase.css','./css/firebase-audit.css','./css/backup.css','./css/clientes-page.css','./css/clientes-mobile.css','./css/produtos-mobile.css','./css/product-images.css','./css/produtos-desktop.css','./css/home-mobile.css','./css/checkout-mobile.css','./css/mobile-fixes.css','./css/mensagens-mobile.css','./css/visitas.css','./css/campanhas.css','./css/catalogo.css','./assets/veconi-icon-v133.svg','./assets/veconi-icon-192-v133.png','./assets/veconi-icon-512-v133.png','./assets/lucide.min.js','./js/utils.js','./js/storage.js','./js/backup.js','./js/financial-concurrency.js','./js/clientes.js','./js/product-brand.js','./js/produtos.js','./js/product-images.js','./js/campanhas.js','./js/campanhas-ui.js','./js/vendas.js','./js/fiados.js','./js/fiado-conditions.js','./js/fiado-space-regularization.js','./js/cobrancas.js','./js/mensagens.js','./js/visitas.js','./js/router.js','./js/csvImport.js','./js/recibos.js','./js/repositories.js','./js/checkout.js','./js/checkout-mobile.js','./js/clientes-page.js','./js/mensagens-mobile.js','./js/message-center-v2.js','./js/clientes-mobile.js','./js/produtos-mobile.js','./js/home-mobile.js','./js/visual-ui.js','./js/app.js','./js/catalog-portal.js','./js/catalogo-publico.js','./js/firebase/firebase-config.js','./js/firebase/business-context.js','./js/firebase/firestore-utils.js','./js/firebase/firestore-repository.js','./js/firebase/usage-monitor.js','./js/firebase/sync.js','./js/firebase/auth.js','./js/firebase/firebase-ui.js','./js/firebase/catalog-bridge.js','./js/firebase/product-image-storage.js'];
ARQUIVOS.push('./js/campaign-engine-v2.js','./js/phone.js','./css/campanhas-mobile.css','./js/campanhas-mobile.js','./css/configuracoes-mobile.css','./js/configuracoes-mobile.js','./css/barcode.css','./js/barcode.js','./assets/zxing-browser.min.js','./css/plans.css','./js/plans.js','./css/sale-completion.css','./js/firebase/legacy-migration.js','./js/firebase/profile-validation.js','./js/firebase/session-lifecycle.js','./css/crm.css','./js/crm.js','./js/crm-ui.js','./css/catalogo-admin.css','./js/catalogo-admin.js','./assets/qrcode.min.js');
ARQUIVOS.push('./functions/src/shared/flexible-service.js','./js/flexible-service-ui.js','./css/flexible-service.css');
// VECONI Fluxo V1 (visual): tema e Início. A versão do cache (CACHE) é decidida na publicação.
ARQUIVOS.push('./js/veconi-fluxo.js','./css/veconi-fluxo.css');
ARQUIVOS.push('./functions/src/shared/plan-catalog.js','./functions/src/shared/permission-policy.js','./functions/src/shared/sync-rejection.js','./js/permission-mutations.js');
ARQUIVOS.push('./js/product-variations.js','./css/product-variations.css');
ARQUIVOS.push('./js/product-spreadsheet.js','./js/product-spreadsheet-ui.js','./js/product-spreadsheet-worker.js','./js/firebase/product-spreadsheet-service.js','./css/product-spreadsheet.css','./assets/xlsx-0.20.3.full.min.js');
ARQUIVOS.push('./js/customer-subscriptions.js','./js/renewal-messages.js','./js/renovacoes.js','./css/renovacoes.css');
ARQUIVOS.push('./js/operation-mode.js','./js/customer-metrics.js','./js/crm-dashboard.js','./js/client-smart-mode.js','./js/runtime-access.js','./js/firebase/operation-settings.js?v=187','./css/crm-dashboard.css','./css/runtime-access.css');
ARQUIVOS.push('./js/desktop-dashboard.js','./css/desktop-dashboard.css');
ARQUIVOS.push('./js/desktop-sales.js','./css/desktop-sales.css','./js/desktop-settings.js','./css/desktop-settings.css');
ARQUIVOS.push('./js/build-info.js','./js/business-cache.js','./js/local-records.js','./js/message-sequence.js','./js/message-sequence-ui.js','./js/integrity.js');
ARQUIVOS.push('./js/sync-findings.js?v=24211-fiado','./js/export-center.js?v=24210-estab');
ARQUIVOS.push('./js/workspace-generation.js','./js/workspace-runtime.js');
ARQUIVOS.push('./js/workspace-writer.js','./js/firebase/workspace-firestore.js');
ARQUIVOS.push('./js/workspace-callables.js');
ARQUIVOS.push('./js/firebase/workspace-storage.js');
ARQUIVOS.push('./js/business-reset-ui.js','./css/business-reset.css');
ARQUIVOS.push('./js/sale-recovery-client.js','./js/sale-recovery-ui.js','./css/sale-recovery.css');
ARQUIVOS.push('./js/sale-monetary-analysis-client.js','./js/sale-monetary-analysis-ui.js','./css/sale-monetary-analysis.css');
ARQUIVOS.push('./js/performance-model.js','./js/performance-dashboard.js','./css/performance-dashboard.css');
ARQUIVOS.push('./js/financial-accounts-carousel.js','./css/financial-accounts-carousel.css');
ARQUIVOS.push('./js/tutorial-engine.js','./js/app-intro-tutorial.js','./css/tutorial.css');
ARQUIVOS.push('./css/settings-redesign.css');
ARQUIVOS.push('./js/runtime-diagnostics.js');
ARQUIVOS.push('./css/terminal-payments.css','./js/terminal-payments.js');
ARQUIVOS.push('./js/lifecycle-manager.js');
ARQUIVOS.push('./js/page-runtime.js');
ARQUIVOS.push('./js/client-filter-rules.js');
ARQUIVOS.push('./css/coupons.css','./js/coupons-admin.js');
ARQUIVOS.push('./css/mobile-navigation.css','./js/mobile-navigation-gesture.js','./js/mobile-navigation.js');
ARQUIVOS.push('./js/client-actions.js','./js/client-cloud-pagination.js');
ARQUIVOS.push('./js/product-actions.js','./js/product-selection.js','./css/product-selection.css');
ARQUIVOS.push('./css/crm-mobile.css','./js/crm-mobile.js');
ARQUIVOS.push('./css/design-system/tokens.css','./css/design-system/desktop.css');
ARQUIVOS.push('./css/engagement-operations.css','./js/engagement-segments.js','./js/catalog-presentation.js','./js/firebase/catalog-image-storage.js');
ARQUIVOS.push('./css/mobile-components.css');
ARQUIVOS.push('./css/activity-center.css','./js/activity-center.js');
ARQUIVOS.push('./css/crm-segment-builder.css','./js/crm-segment-engine-v2.js','./js/crm-segment-builder.js');
ARQUIVOS.push('./css/financial.css','./css/financial-credit-v2.css','./css/financial-refinement.css','./css/financial-home-v2.css','./js/financial-engine.js','./js/financial-ui.js','./js/firebase/financial-space-service.js');
ARQUIVOS.push('./css/spaces.css','./js/spaces.js','./js/firebase/space-service.js');
ARQUIVOS.push('./css/team.css','./js/team-access.js','./js/team-page.js','./js/firebase/team-service.js');
ARQUIVOS.push('./js/performance-access.js','./css/performance-access.css');
ARQUIVOS.push('./css/team-permissions.css','./js/team-permission-model.js','./js/team-permission-editor.js');
ARQUIVOS.push('./css/design-system/veconi-theme.css','./js/veconi-brand.js','./assets/veconi-symbol.svg','./assets/veconi-maskable-192-v133.png','./assets/veconi-maskable-512-v133.png','./assets/veconi-apple-touch-icon-180-v133.png','./assets/veconi-favicon-16-v133.png','./assets/veconi-favicon-32-v133.png','./assets/veconi-favicon-48-v133.png','./assets/veconi-favicon-v133.ico');
ARQUIVOS.push('./functions/src/shared/product-model.js','./functions/src/shared/product-spreadsheet.js');
ARQUIVOS.push('./js/firebase/product-import-fence.js');
ARQUIVOS.push('./functions/src/shared/online-store.js','./js/online-store-ui.js','./css/online-store.css','./css/online-store-public.css','./js/loja/store-kit.js');
ARQUIVOS.push('./js/sale-exchanges.js','./css/sale-exchanges.css','./js/exchange-credit-checkout.js','./css/exchange-credit-checkout.css','./js/exchange-economics.js');
ARQUIVOS.push('./js/sale-cancellation.js');
ARQUIVOS.push('./js/receipt-messages.js','./js/receipt-message-ui.js','./css/receipt-messages.css');
// Retired resources must not be served from the network or any older cache.
const RETIRED_STATIC_FILES = new Set([
  'kytedata.js', 'kytebalances.js', 'kytebootstrap.js',
  'saldocorrecoes.js', 'cleanupdemo.js', 'financemigration.js',
  'central-fiado.html', 'fiado-central.css', 'fiado-central-entry.js', 'fiado-central.js',
]);
function isRetiredStaticFile(url) {
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch (_) { /* Invalid URLs are not decoded. */ }
  return RETIRED_STATIC_FILES.has(pathname.replace(/\/+$/, '').split('/').pop().toLowerCase());
}
async function currentCacheMatch(request, options) {
  return (await caches.open(CACHE)).match(request, options);
}
let pinnedAssets;
function isPinnedAsset(url) {
  if (!url.searchParams.has('v')) return false;
  pinnedAssets ??= new Set(ARQUIVOS.filter(file => file.includes('?v='))
    .map(file => new URL(file, location.href).href));
  return pinnedAssets.has(url.href);
}
async function fetchPinnedAsset(request) {
  const cached = await currentCacheMatch(request).catch(() => null);
  // Do not let an unresponsive network hide an exact precached script or stylesheet.
  const controller = cached ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 2000) : null;
  try {
    const response = await fetch(request, {cache: 'no-store', signal: controller?.signal});
    if (!response.ok) return cached || response;
    await caches.open(CACHE).then(cache => cache.put(request, response.clone())).catch(() => {});
    return controller?.signal.aborted ? cached : response;
  } catch (_) {
    return cached || Response.error();
  } finally {
    clearTimeout(timeout);
  }
}
ARQUIVOS.push('./css/space-branding.css','./js/space-branding.js');
ARQUIVOS.push('./css/consignments.css','./js/consignment-ui.js','./js/consignment-pdf.js');
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ARQUIVOS.map(file => new Request(file, {cache: 'reload'}))))
));
// Do not erase previous storage: namespaces, queues and even old static caches stay intact.
// Only this release's cache is eligible for fallback. Old static caches cannot serve retired data.
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION') event.ports?.[0]?.postMessage({cache: CACHE, release: '242', appVersion: '242.14'});
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (isRetiredStaticFile(url)) {
    event.respondWith(Promise.resolve(new Response('', {status: 404, headers: {'Cache-Control': 'no-store'}})));
    return;
  }
  if (event.request.method !== 'GET') return;
  const pinnedAsset = ['script', 'style'].includes(event.request.destination) && isPinnedAsset(url);
  if (pinnedAsset) {
    event.respondWith(fetchPinnedAsset(event.request));
    return;
  }
  const networkFirst = event.request.mode === 'navigate' || ['script', 'style'].includes(event.request.destination);
  if (networkFirst) {
    event.respondWith(fetch(event.request, {cache: 'no-store'}).then(async response => {
      if (response.ok) await caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(async () => {
      const cached = await currentCacheMatch(event.request, {ignoreSearch: true});
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const page = url.pathname.includes('/catalogo/') || url.pathname.endsWith('/catalogo.html') ? './catalogo.html' : './index.html';
        return (await currentCacheMatch(page)) || Response.error();
      }
      return Response.error();
    }));
    return;
  }
  event.respondWith(currentCacheMatch(event.request).then(cached => cached || fetch(event.request).then(async response => {
    if (response.ok) await caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => Response.error())));
});

ARQUIVOS.push("./js/sale-money.js");

ARQUIVOS.push("./js/sale-monetary-recovery-ui.js");

ARQUIVOS.push("./js/auth-loading.js","./js/google-registration-ui.js","./js/firebase/google-auth.js","./js/google-identity-picker.js","./js/google-registration-client.js","./js/google-registration-release.js","./js/google-registration-dialog.js","./css/auth-loading.css","./css/google-auth.css","./assets/google-g.svg");

ARQUIVOS.push('./functions/src/shared/operational-privacy-policy.js','./js/operational-read-policy.js');
ARQUIVOS.push('./assets/fonts/inter-latin-wght-normal.woff2');
ARQUIVOS.push('./js/clientes-mobile.js?v=24212-saldo','./js/customer-metrics.js?v=2422','./js/crm-segment-engine-v2.js?v=2422');
ARQUIVOS.push('./js/build-info.js?v=24214-perf','./js/business-cache.js?v=24214-perf','./js/product-brand.js?v=2427-marca','./js/produtos.js?v=2427-marca','./js/product-images.js?v=2427-marca','./js/produtos-mobile.js?v=2427-marca','./js/configuracoes-mobile.js?v=2427-marca','./js/product-variations.js?v=2427-marca','./js/product-spreadsheet-ui.js?v=2427-marca','./js/firebase/auth.js?v=24213-conta','./js/firebase/firebase-ui.js?v=24213-conta','./js/firebase/sync.js?v=24213-conta','./js/firebase/product-spreadsheet-service.js?v=2426-export','./js/app.js?v=24214-perf','./js/barcode.js?v=2423','./js/checkout.js?v=2423','./js/checkout-mobile.js?v=2423','./js/desktop-sales.js?v=2423','./css/checkout-mobile.css?v=2423');
ARQUIVOS.push('./js/clientes.js?v=24213-conta','./js/clientes-page.js?v=24213-conta','./css/clientes-page.css?v=2428-fluidez','./css/clientes-mobile.css?v=24212-saldo','./js/client-cloud-pagination.js?v=2428-fluidez','./js/client-smart-mode.js?v=2428-fluidez','./js/installment-credit.js?v=24213-conta','./js/fiados.js?v=24213-conta');
ARQUIVOS.push('./css/firebase.css?v=24210-estab','./js/fiado-space-regularization.js?v=2429-sync','./js/mobile-navigation.js?v=2429-sync','./js/sale-recovery-ui.js?v=24210-estab','./js/recibos.js?v=24210-estab');
ARQUIVOS.push('./js/customer-space-accounts.js?v=24213-conta','./js/firebase/customer-accounts-reader.js?v=24213-conta');
ARQUIVOS.push('./css/storefront-art.css?v=2425','./assets/storefront-courier.webp','./assets/storefront-models.webp');
ARQUIVOS.push('./css/online-store.css?v=2425','./css/catalogo.css?v=2425','./js/loja/store-kit.js?v=2425','./js/online-store-ui.js?v=2425','./js/firebase/catalog-bridge.js?v=300','./js/catalogo-publico.js?v=2425');

ARQUIVOS.push('./css/online-orders.css?v=2425','./js/online-orders-ui.js?v=2425');

ARQUIVOS.push('./js/client-actions.js?v=24213-conta');

ARQUIVOS.push('./js/cobrancas.js?v=24214-perf');
