import { app } from "./firebase-config.js";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

const storage = getStorage(app);
const businessId = () =>
  window.BusinessContext?.getCurrentBusinessId?.() ||
  window.FirebaseSession?.businessId ||
  window.FirebaseSession?.profile?.businessId ||
  "";
const uploadTask = (reference, blob, metadata, onProgress, from, to) =>
  new Promise((resolve, reject) => {
    const task = uploadBytesResumable(reference, blob, metadata);
    task.on(
      "state_changed",
      (snapshot) =>
        onProgress?.(
          Math.round(
            from +
              (snapshot.bytesTransferred / Math.max(1, snapshot.totalBytes)) *
                (to - from),
          ),
        ),
      reject,
      () => resolve(task.snapshot.ref),
    );
  });
async function safeDelete(path) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (error) {
    if (!String(error.code || "").includes("object-not-found")) throw error;
  }
}
const pathsFrom = (subject = {}) => {
  const image = subject.image && typeof subject.image === "object" ? subject.image : {};
  return [
    image.storagePath,
    image.thumbnailStoragePath,
    subject.imageStoragePath,
    subject.imageThumbStoragePath,
  ].filter(Boolean);
};
const safeEntityPaths = (subject, { productId, variantId = "" } = {}) => {
  const tenantId = businessId();
  if (!tenantId || !productId) return [];
  const prefix = variantId
    ? `businesses/${tenantId}/products/${productId}/variants/${variantId}/`
    : `businesses/${tenantId}/products/${productId}/`;
  return pathsFrom(subject).filter(
    (path) =>
      String(path).startsWith(prefix) &&
      (variantId || !String(path).slice(prefix.length).includes("/")),
  );
};
async function upload(productId, processed, options = {}) {
  if (!navigator.onLine)
    throw Error("Sem internet. Conecte-se para enviar a foto.");
  if (!window.FirebaseSession?.user)
    throw Error("Entre na sua conta para enviar a foto.");
  const tenantId = businessId();
  if (!tenantId)
    throw Error("Não foi possível identificar a empresa desta foto.");
  const variantId = String(options.variantId || ""),
    operationId = String(options.operationId || crypto.randomUUID())
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 80),
    folder = variantId
      ? `businesses/${tenantId}/products/${productId}/variants/${variantId}`
      : `businesses/${tenantId}/products/${productId}`,
    mainPath = `${folder}/main-${operationId}.${processed.extension}`,
    thumbPath = `${folder}/thumb-${operationId}.${processed.extension}`,
    customMetadata = {
      businessId: tenantId,
      productId: String(productId),
      entityType: variantId ? "productVariant" : "product",
      operationId,
      ...(variantId ? { variantId } : {}),
    },
    metadata = {
      contentType: processed.contentType,
      cacheControl: "public,max-age=31536000,immutable",
      customMetadata,
    };
  const uploadedPaths = [];
  try {
    const mainRef = await uploadTask(
        ref(storage, mainPath),
        processed.mainBlob,
        metadata,
        options.onProgress,
        0,
        72,
      );
    uploadedPaths.push(mainPath);
    const thumbRef = await uploadTask(
        ref(storage, thumbPath),
        processed.thumbBlob,
        metadata,
        options.onProgress,
        72,
        96,
      );
    uploadedPaths.push(thumbPath);
    const [imageUrl, imageThumbUrl] = await Promise.all([
        getDownloadURL(mainRef),
        getDownloadURL(thumbRef),
      ]),
      updatedAt = new Date().toISOString(),
      image = {
        storagePath: mainPath,
        url: imageUrl,
        thumbnailStoragePath: thumbPath,
        thumbnailUrl: imageThumbUrl,
        width: processed.width,
        height: processed.height,
        thumbnailWidth: processed.thumbWidth,
        thumbnailHeight: processed.thumbHeight,
        size: processed.size,
        thumbnailSize: processed.thumbSize,
        mimeType: processed.contentType,
        updatedAt,
      };
    options.onProgress?.(100);
    const currentPaths = new Set([mainPath, thumbPath]);
    for (const oldPath of new Set(
      safeEntityPaths(options.oldSubject, { productId, variantId }),
    ))
      if (!currentPaths.has(oldPath)) await safeDelete(oldPath);
    return {
      image,
      imageMode: "own",
      imagem: "",
      imageUrl,
      imageStoragePath: mainPath,
      imageThumbUrl,
      imageThumbStoragePath: thumbPath,
      imageUpdatedAt: updatedAt,
      imageUploadStatus: "uploaded",
      imageOperationId: operationId,
    };
  } catch (error) {
    await Promise.all(uploadedPaths.map((path) => safeDelete(path).catch(() => null)));
    console.error("[Product image upload]", {
      code: error.code,
      message: error.message,
      entityType: variantId ? "variation" : "product",
    });
    if (["storage/unknown", "storage/bucket-not-found"].includes(error.code))
      throw Error("O armazenamento de fotos ainda precisa ser ativado no Firebase.");
    if (error.code === "storage/unauthorized")
      throw Error("Sua conta não tem permissão para enviar esta foto.");
    if (error.code === "storage/quota-exceeded")
      throw Error("O limite temporário de imagens foi atingido. Tente novamente mais tarde.");
    throw Error("Não foi possível enviar a foto. Verifique a conexão e tente novamente.");
  }
}
async function remove(subject, scope = {}) {
  if (!navigator.onLine)
    throw Error("Conecte-se à internet para remover a foto.");
  const paths = safeEntityPaths(subject, scope);
  if (pathsFrom(subject).length && !paths.length)
    throw Error("A referência da imagem não pertence a este produto.");
  await Promise.all([...new Set(paths)].map(safeDelete));
  return true;
}
async function removeProduct(product, variants = []) {
  const productId = String(product?.id || ""),
    paths = new Set([
      ...safeEntityPaths(product, { productId }),
      ...variants.flatMap((variant) =>
        safeEntityPaths(variant, { productId, variantId: variant.id }),
      ),
    ]),
    allReferenced = [
      ...pathsFrom(product),
      ...variants.flatMap((variant) => pathsFrom(variant)),
    ];
  if (allReferenced.length && paths.size !== new Set(allReferenced).size)
    throw Error("Uma referência de imagem não pertence a este produto.");
  if (!paths.size) return { removed: 0 };
  if (!navigator.onLine)
    throw Error("Conecte-se à internet para limpar as fotos deste produto.");
  await Promise.all([...paths].map(safeDelete));
  return { removed: paths.size };
}

window.ProductImageStorage = {
  upload,
  remove,
  removeProduct,
  storage,
  pathsFrom,
  safeEntityPaths,
};
dispatchEvent(new CustomEvent("product-image-storage-ready"));
