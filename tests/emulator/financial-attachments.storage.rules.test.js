const test = require("node:test");
const fs = require("node:fs");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc } = require("firebase/firestore");
const { ref, uploadBytes, getMetadata } = require("firebase/storage");

let env;
const projectId = "adi-festa-variations-test", businessId = "financial-storage";
test.before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") }, storage: { rules: fs.readFileSync("storage.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "businesses", businessId), { id: businessId, ownerId: "owner", active: true, subscription: { planId: "internal", status: "active" } });
    await setDoc(doc(db, "users", "owner"), { uid: "owner", businessId, role: "owner", active: true });
    await setDoc(doc(db, "users", "outsider"), { uid: "outsider", businessId: "other", role: "owner", active: true });
    await setDoc(doc(db, "financialSpaces", "space"), { id: "space", name: "Empresa", type: "business", linkedBusinessId: businessId, ownerUid: "owner", active: true });
    await setDoc(doc(db, "financialSpaces", "space", "entries", "entry"), { id: "entry", financialSpaceId: "space" });
  });
});
test.after(async () => env?.cleanup());

const metadata = (contentType = "application/pdf") => ({ contentType, customMetadata: { financialSpaceId: "space", entryId: "entry", ownerUid: "owner", operationId: "proof", entityType: "financialAttachment" } });
test("aceita imagem/PDF somente no lançamento autorizado", async () => {
  const storage = env.authenticatedContext("owner").storage(), proof = ref(storage, "financialSpaces/space/entries/entry/proof.pdf");
  await assertSucceeds(uploadBytes(proof, new Uint8Array([1, 2, 3]), metadata()));
  await assertSucceeds(getMetadata(proof));
});
test("nega tenant diferente, metadata divergente e executável", async () => {
  const outsider = env.authenticatedContext("outsider").storage(), owner = env.authenticatedContext("owner").storage();
  await assertFails(uploadBytes(ref(outsider, "financialSpaces/space/entries/entry/proof.pdf"), new Uint8Array([1]), metadata()));
  await assertFails(uploadBytes(ref(owner, "financialSpaces/space/entries/entry/wrong.pdf"), new Uint8Array([1]), { ...metadata(), customMetadata: { ...metadata().customMetadata, entryId: "wrong" } }));
  await assertFails(uploadBytes(ref(owner, "financialSpaces/space/entries/entry/file.exe"), new Uint8Array([1]), metadata("application/octet-stream")));
});
