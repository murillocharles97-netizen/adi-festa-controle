(() => {
  'use strict';

  const actions = new Set(['list','account','prepare','confirm','review','reviewLot','openingPreview','openingConfirm']);
  const app = document.getElementById('app');
  let session, permitted, launcher, dialog, frame, pending;
  let scheduled = false;

  function identity() {
    const uid = window.FirebaseSession?.user?.uid;
    const context = window.BusinessContext?.get();
    if (!uid || context?.loading || context?.error || context?.businessId !== 'adi-festa' ||
        context.business?.ownerId !== uid || context.role !== 'owner' ||
        context.member?.status !== 'active' || !Number.isSafeInteger(context.business.workspaceGeneration ?? 0)) return null;
    return {uid, businessId: context.businessId, workspaceGeneration: context.business.workspaceGeneration ?? 0};
  }

  const key = value => value && JSON.stringify(value);

  function close() {
    const opened = dialog;
    dialog = frame = null;
    if (opened?.open) opened.close();
    opened?.remove();
  }

  function reset(current) {
    close();
    launcher?.remove();
    launcher = permitted = pending = null;
    session = current;
  }

  async function call(scope, action, data) {
    if (navigator.onLine === false) throw Error('Conecte-se para consultar a Central.');
    const {businessId, workspaceGeneration} = scope;
    const response = await window.FirebaseCallable('reviewFiadoOriginEvidence', {...data, action, businessId, workspaceGeneration});
    if (key(identity()) !== key(scope)) throw Error('A sessão mudou. Abra a Central novamente.');
    return response.data;
  }

  function open() {
    if (!permitted || key(identity()) !== session || app.dataset.route !== 'clientes' || dialog) return;
    dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Central de Regularização do Fiado');
    Object.assign(dialog.style, {width:'min(100%, 1100px)', maxWidth:'100%', height:'100dvh', maxHeight:'100dvh', padding:'0', border:'0'});
    frame = document.createElement('iframe');
    frame.title = 'Central de Regularização do Fiado';
    frame.src = './central-fiado.html';
    Object.assign(frame.style, {display:'block', width:'100%', height:'100%', border:'0'});
    dialog.append(frame);
    dialog.addEventListener('close', close, {once:true});
    document.body.append(dialog);
    dialog.showModal();
  }

  function update() {
    scheduled = false;
    const scope = identity();
    const next = key(scope);
    if (next !== session) reset(next);
    if (app.dataset.route !== 'clientes') {
      close();
      launcher?.remove();
      launcher = null;
      return;
    }
    if (!scope || typeof window.FirebaseCallable !== 'function') return;
    if (!pending && !permitted) {
      pending = call(scope,'access',{}).then(result => {
        if (session !== next || pending !== attempt) return;
        permitted = result.available === true;
        if (permitted) schedule();
      }).catch(() => {});
      const attempt = pending;
      return;
    }
    if (permitted && !launcher?.isConnected) {
      launcher = document.createElement('button');
      launcher.type = 'button';
      launcher.className = 'btn btn-light';
      launcher.textContent = 'Central do Fiado';
      launcher.addEventListener('click', open);
      (app.querySelector('.client-head .head-actions') || app).prepend(launcher);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }

  window.FiadoCentralEntry = Object.freeze({
    async request(caller, action, data) {
      const scope = identity();
      if (!frame || frame.contentWindow !== caller || !permitted || key(scope) !== session || !actions.has(action))
        throw Error('A Central está indisponível nesta sessão.');
      if(action==='openingConfirm'){
        if(typeof window.SyncFirebase?.assertFiadoReceiptQueueClear!=='function')
          throw Error('Aguarde a sincronização para conferir a fila deste aparelho.');
        window.SyncFirebase.assertFiadoReceiptQueueClear(data.clientId);
      }
      const result = await call(scope, action, data);
      if (frame?.contentWindow !== caller) throw Error('A Central foi fechada.');
      return result;
    },
    close(caller) {
      if (frame?.contentWindow === caller) close();
    }
  });
  if (!app) return;
  new MutationObserver(schedule).observe(app, {childList:true, attributes:true, attributeFilter:['data-route']});
  for (const name of ['firebase-auth-ready','business-context-changed','hashchange']) addEventListener(name,schedule);
  addEventListener('firebase-session-cleared',()=>reset(null));
  addEventListener('online',()=>{if(!permitted)pending=null;schedule();});
  schedule();
})();
