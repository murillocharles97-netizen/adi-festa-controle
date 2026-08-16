import { app } from "./firebase-config.js";
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

const storage = getStorage(app);
const businessId = () => window.BusinessContext?.getCurrentBusinessId?.() || window.FirebaseSession?.businessId || window.FirebaseSession?.profile?.businessId || "";
const scopeInfo = (scope, entityId) => {
  if (!['banner','category','product'].includes(scope)) throw Error('Tipo de imagem do catálogo inválido.');
  const plural = scope === 'category' ? 'categories' : `${scope}s`;
  return { folder: `businesses/${businessId()}/catalog/${plural}/${entityId}`, entityType: `catalog${scope[0].toUpperCase()}${scope.slice(1)}` };
};
async function safeDelete(path) { if (!path) return; try { await deleteObject(ref(storage, path)); } catch (error) { if (!String(error.code || '').includes('object-not-found')) throw error; } }
async function upload(scope, entityId, processed, old = {}) {
  if (!navigator.onLine) throw Error('Conecte-se à internet para enviar a imagem.');
  if (!window.FirebaseSession?.user) throw Error('Entre na sua conta para enviar a imagem.');
  const tenantId = businessId(); if (!tenantId) throw Error('Empresa não identificada.');
  const operationId = crypto.randomUUID(), info = scopeInfo(scope, entityId), extension = processed.extension || 'webp', mainPath = `${info.folder}/main-${operationId}.${extension}`, thumbPath = `${info.folder}/thumb-${operationId}.${extension}`, metadata = { contentType: processed.contentType, cacheControl: 'public,max-age=31536000,immutable', customMetadata: { businessId: tenantId, entityId: String(entityId), entityType: info.entityType, operationId } };
  const uploaded = [];
  try {
    const main = await uploadBytes(ref(storage, mainPath), processed.mainBlob, metadata); uploaded.push(mainPath);
    const thumb = await uploadBytes(ref(storage, thumbPath), processed.thumbBlob, metadata); uploaded.push(thumbPath);
    const [imageUrl, imageThumbUrl] = await Promise.all([getDownloadURL(main.ref), getDownloadURL(thumb.ref)]);
    const prefix = `${info.folder}/`, oldPaths = [old.imageStoragePath, old.imageThumbStoragePath].filter((path) => String(path || '').startsWith(prefix));
    await Promise.all(oldPaths.filter((path) => !uploaded.includes(path)).map(safeDelete));
    return { imageUrl, imageThumbUrl, imageStoragePath: mainPath, imageThumbStoragePath: thumbPath, imageUpdatedAt: new Date().toISOString() };
  } catch (error) {
    await Promise.all(uploaded.map((path) => safeDelete(path).catch(() => null)));
    console.error('[Catalog image upload]', { code: error.code || 'unknown', scope, entityId });
    if (error.code === 'storage/unauthorized') throw Error('Sua conta não tem permissão para enviar esta imagem.');
    throw Error('Não foi possível enviar a imagem do catálogo.');
  }
}
async function remove(scope, entityId, subject = {}) { const info = scopeInfo(scope, entityId), prefix = `${info.folder}/`, paths = [subject.imageStoragePath, subject.imageThumbStoragePath].filter((path) => String(path || '').startsWith(prefix)); await Promise.all(paths.map(safeDelete)); return { removed: paths.length }; }
window.CatalogImageStorage = { upload, remove, storage };
dispatchEvent(new CustomEvent('catalog-image-storage-ready'));
