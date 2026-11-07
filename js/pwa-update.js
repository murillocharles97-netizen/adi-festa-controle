window.PwaUpdate = (() => {
  'use strict';
  const guidance = 'Há uma atualização da VECONI. Conclua ou salve o formulário aberto antes de continuar. As operações pendentes serão mantidas. Após atualizar, confira a versão 227 em todos os aparelhos antes de receber em contas parceladas. Não registre novamente um recebimento pendente.';
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
  return Object.freeze({offer,reload});
})();
