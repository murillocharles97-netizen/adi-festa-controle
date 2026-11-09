window.PwaUpdate = (() => {
  'use strict';
  const guidance = 'Há uma atualização da VECONI. Conclua ou salve o formulário aberto antes de continuar. As operações pendentes serão mantidas. Após atualizar, confira se todos os aparelhos estão atualizados antes de receber em contas parceladas. Não registre novamente um recebimento pendente.';
  async function offer(worker) {
    if (!worker || !window.confirm(guidance + ' Preparar atualização agora?')) return;
    try {
      await window.DB?.flush?.();
      worker.postMessage('SKIP_WAITING');
    } catch {
      window.alert('Não foi possível confirmar a gravação local. Mantenha esta aba aberta e confira as operações pendentes antes de atualizar.');
    }
  }
  async function reload() {
    if (!window.confirm('A atualização está pronta. Conclua ou salve o formulário aberto. Recarregar agora mantendo as operações pendentes?')) return;
    try {
      await window.DB?.flush?.();
      window.location.reload();
    } catch {
      window.alert('A gravação local precisa de revisão. Mantenha esta aba aberta.');
    }
  }
  async function register() {
    const serviceWorker = navigator.serviceWorker;
    let controller = serviceWorker.controller, offered, refreshing = false;
    serviceWorker.addEventListener('controllerchange', () => {
      const next = serviceWorker.controller;
      if (!next || next === controller) return;
      const replaced = Boolean(controller);
      controller = next;
      if (replaced && !refreshing) {
        refreshing = true;
        void reload().finally(() => { refreshing = false; });
      }
    });
    const registration = await serviceWorker.register('./service-worker.js');
    const consider = worker => {
      if (!registration.active || !worker || worker.state !== 'installed' || worker === offered) return;
      offered = worker;
      void offer(worker);
    };
    const watch = () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => consider(worker));
      consider(worker);
    };
    registration.addEventListener('updatefound', watch);
    consider(registration.waiting);
    watch();
  }
  return Object.freeze({offer,reload,register});
})();
