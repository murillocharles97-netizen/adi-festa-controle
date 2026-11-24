(function (root) {
  'use strict';
  // File delivery that reports what really happened. Android PWAs can fail a blob
  // download silently when the link is detached or the URL is revoked before the
  // download manager reads it, so the link is attached to the page and the URL
  // stays alive for a minute. Sharing reports completion, cancellation or error;
  // a failed share falls back to download; a failed copy falls back to manual copy.
  const KEEP_URL_MS = 60000;
  const sizeLabel = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const text = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  function env() {
    const nav = root.navigator || {}, doc = root.document || null;
    return {nav, doc, Blob: root.Blob, File: root.File, URL: root.URL, setTimeout: root.setTimeout?.bind(root) || setTimeout};
  }
  function capabilities() {
    const {nav, doc, File} = env();
    let share = false;
    try { share = typeof nav.share === 'function' && typeof nav.canShare === 'function' && typeof File === 'function' && nav.canShare({files: [new File(['{}'], 'teste.json', {type: 'application/json'})]}); } catch { share = false; }
    const anchor = doc?.createElement ? doc.createElement('a') : null;
    return {share, download: Boolean(anchor && 'download' in anchor), clipboard: typeof nav.clipboard?.writeText === 'function',
      standalone: Boolean(root.matchMedia?.('(display-mode: standalone)')?.matches || nav.standalone)};
  }
  function blobOf(content, mime) { const {Blob} = env(); return new Blob([text(content)], {type: mime || 'application/json'}); }
  function download(content, filename, mime = 'application/json') {
    const {doc, URL, setTimeout} = env();
    try {
      if (!doc?.body || !URL?.createObjectURL) throw Object.assign(Error('Este navegador não permite baixar arquivos.'), {code: 'download-unsupported'});
      const blob = blobOf(content, mime), url = URL.createObjectURL(blob), link = doc.createElement('a');
      if (!('download' in link)) { URL.revokeObjectURL?.(url); throw Object.assign(Error('Este navegador não permite baixar arquivos.'), {code: 'download-unsupported'}); }
      link.href = url; link.download = filename; link.rel = 'noopener'; link.style.display = 'none';
      doc.body.appendChild(link); link.click(); link.remove?.();
      setTimeout(() => URL.revokeObjectURL?.(url), KEEP_URL_MS);
      return {ok: true, method: 'download', confirmed: false, filename, size: blob.size,
        message: `Download de ${filename} (${sizeLabel(blob.size)}) enviado ao navegador. Confira a pasta Downloads; se não aparecer, use Compartilhar ou Copiar.`};
    } catch (error) {
      return {ok: false, method: 'download', filename, code: error.code || 'download-failed', message: `Não foi possível baixar ${filename}: ${error.message || 'erro desconhecido'}.`};
    }
  }
  async function share(content, filename, {mime = 'application/json', title = filename} = {}) {
    const {nav, File} = env();
    if (!capabilities().share) return {ok: false, method: 'share', unsupported: true, code: 'share-unsupported', message: 'O compartilhamento de arquivos não está disponível neste aparelho.'};
    try {
      const file = new File([text(content)], filename, {type: mime});
      await nav.share({files: [file], title});
      return {ok: true, method: 'share', confirmed: true, filename, size: file.size, message: `${filename} foi entregue ao aplicativo escolhido.`};
    } catch (error) {
      if (error?.name === 'AbortError') return {ok: false, method: 'share', cancelled: true, code: 'share-cancelled', message: 'Compartilhamento cancelado. Nada foi enviado.'};
      return {ok: false, method: 'share', code: error?.name || 'share-failed', message: `O compartilhamento falhou: ${error?.message || 'erro desconhecido'}.`};
    }
  }
  async function copy(value) {
    const {nav, doc} = env(), content = text(value);
    try {
      if (typeof nav.clipboard?.writeText !== 'function') throw Error('Área de transferência indisponível.');
      await nav.clipboard.writeText(content);
      return {ok: true, method: 'copy', confirmed: true, size: content.length, message: 'Copiado. Cole na conversa ou no e-mail do suporte.'};
    } catch (first) {
      try {
        if (!doc?.body || typeof doc.execCommand !== 'function') throw first;
        const area = doc.createElement('textarea');
        area.value = content; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
        doc.body.appendChild(area); area.select?.(); const done = doc.execCommand('copy'); area.remove?.();
        if (!done) throw first;
        return {ok: true, method: 'copy', confirmed: true, size: content.length, message: 'Copiado. Cole na conversa ou no e-mail do suporte.'};
      } catch {
        return {ok: false, method: 'copy', manual: true, content, code: 'copy-failed', message: 'Não foi possível copiar automaticamente. Selecione o texto abaixo e copie manualmente.'};
      }
    }
  }
  // mode: 'share' tries share, then download; 'download' downloads; 'copy' copies.
  async function deliver({content, filename, mime = 'application/json', title, mode = 'share'} = {}) {
    if (mode === 'copy') return copy(content);
    if (mode === 'share') {
      const shared = await share(content, filename, {mime, title});
      if (shared.ok || shared.cancelled) return shared;
      const downloaded = download(content, filename, mime);
      return downloaded.ok ? {...downloaded, fallbackFrom: 'share', message: `${shared.message} ${downloaded.message}`} : {...downloaded, attempts: [shared, downloaded]};
    }
    return download(content, filename, mime);
  }
  const api = Object.freeze({KEEP_URL_MS, capabilities, download, share, copy, deliver, sizeLabel});
  root.VeconiExport = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
