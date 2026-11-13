// Renovações V1 homologation: seeds fictitious businesses into LOCAL emulators and serves the
// app pointed at them. Never touches production. Usage (emulators already running):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//   node scripts/qa-renovacoes-emulator.cjs [port]
// Test-only credentials for these fictitious emulator users are defined below (QA_PASSWORD).
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") ||
    !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || ""))
  throw Error("Local emulators required; refusing production.");
const admin = require("../functions/node_modules/firebase-admin");
const PROJECT = "adi-festa-variations-test";
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const QA_PASSWORD = "LocalQaRenov123!";
const DAY = 86400000;
// São Paulo civil day (UTC-3, no DST since 2019) so "hoje" in the seed matches the app.
const atSP = (offsetDays, hour = 15) => {
  const sp = new Date(Date.now() - 3 * 3600000);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + offsetDays, hour + 3)).toISOString();
};
const BUSINESSES = {
  multi: { id: "qa-renov-multi", name: "Studio Fictício QA", plan: "premium" },
  basic: { id: "qa-renov-basic", name: "Loja Essencial QA", plan: "essential" },
  volume: { id: "qa-renov-volume", name: "Academia Volume QA", plan: "premium" },
};
const USERS = {
  owner: { email: "renov-owner@example.test", business: "multi", role: "owner" },
  manager: { email: "renov-manager@example.test", business: "multi", role: "manager" },
  seller: { email: "renov-seller@example.test", business: "multi", role: "seller" },
  basic: { email: "renov-basic@example.test", business: "basic", role: "owner" },
  volume: { email: "renov-volume@example.test", business: "volume", role: "owner" },
};
async function user(email) {
  try { return await admin.auth().getUserByEmail(email); }
  catch { return admin.auth().createUser({ email, password: QA_PASSWORD, emailVerified: true }); }
}
const sub = (bid, id, clientId, spaceId, productId, label, offset, extra = {}) => ({
  id, operationId: id, businessId: bid, spaceId, clientId, productId, variantId: null, label, status: "active",
  startedAt: atSP(offset - 30), expiresAt: atSP(offset, extra.hour ?? 15), durationValue: 1, durationUnit: "months",
  contractedPrice: extra.price ?? 180, renewalCount: extra.lastRenewedAt ? 1 : 0, lastRenewedAt: extra.lastRenewedAt ?? null,
  createdFromSaleId: `seed-${id}`, lastSaleId: `seed-${id}`, reminders: [7, 1, 0], renewalMessage: "", active: true,
  createdAt: atSP(offset - 30), updatedAt: atSP(-30), schemaVersion: 14, renewalCalendarAnchor: null, ...extra.fields,
});
async function seed() {
  const writes = [], uids = {};
  for (const [key, info] of Object.entries(USERS)) uids[key] = (await user(info.email)).uid;
  for (const [key, b] of Object.entries(BUSINESSES)) {
    const ownerKey = { multi: "owner", basic: "basic", volume: "volume" }[key], owner = uids[ownerKey];
    writes.push([`businesses/${b.id}`, { id: b.id, name: b.name, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: false, sensitiveDataVersion: 1,
      subscription: { planId: b.plan, status: "active" } }]);
    writes.push([`businesses/${b.id}/settings/default`, { id: "default", nome: b.name, businessId: b.id,
      operation: { operationMode: "physical_store", creditMode: "enabled", operationOnboardingCompleted: true, modules: { inventory: true, crm: true, creditSales: true } } }]);
  }
  for (const [key, info] of Object.entries(USERS)) {
    const bid = BUSINESSES[info.business].id;
    writes.push([`users/${uids[key]}`, { uid: uids[key], name: `QA ${key}`, email: info.email, businessId: bid, active: true,
      role: info.role === "owner" ? "owner" : info.role === "manager" ? "admin" : "cashier", tutorialVersionSeen: 999, permissions: {} }]);
  }
  const multi = BUSINESSES.multi.id, centro = `${multi}-centro`, bairro = `${multi}-bairro`;
  writes.push([`businesses/${multi}/members/${uids.manager}`, { uid: uids.manager, role: "manager", status: "active", spaceAccess: "all", allowedSpaceIds: [],
    permissions: { "customers.view": true, "customers.edit": true, "sales.create": true, "reports.view": true, "products.view": true } }]);
  writes.push([`businesses/${multi}/members/${uids.seller}`, { uid: uids.seller, role: "seller", status: "active", spaceAccess: "selected", allowedSpaceIds: [centro],
    permissions: { "customers.view": true, "customers.edit": true, "sales.create": true, "products.view": true } }]);
  const space = (id, bid, name, owner) => [`financialSpaces/${id}`, { id, name, type: "business", operationalType: "unit", businessId: bid, linkedBusinessId: bid,
    ownerUid: owner, active: true, status: "active", capabilities: { sales: true, products: true, inventory: true, finance: true } }];
  writes.push(space(centro, multi, "Loja Centro", uids.owner), space(bairro, multi, "Loja Bairro", uids.owner));
  writes.push(space(`${BUSINESSES.basic.id}-loja`, BUSINESSES.basic.id, "Loja Única", uids.basic));
  writes.push(space(`${BUSINESSES.volume.id}-loja`, BUSINESSES.volume.id, "Unidade Única", uids.volume));
  const product = (bid, id, nome, preco) => [`businesses/${bid}/products/${id}`, { id, businessId: bid, nome, preco, custo: 0, ativo: true, active: true, productType: "recurring",
    itemKind: "service", durationValue: 1, durationUnit: "months", renewalLabel: nome, renewalReminders: [7, 1, 0], semControleEstoque: true, controlaEstoque: false,
    estoqueAtual: 0, spaceAccessMode: "all_spaces", allowedSpaceIds: [], defaultSpaceId: null }];
  for (const b of Object.values(BUSINESSES)) writes.push(product(b.id, "plano-pilates", "Plano Mensal Pilates", 180), product(b.id, "plano-academia", "Academia 3x semana", 99.9));
  const client = (bid, id, nome, telefone, spaceIds) => [`businesses/${bid}/clients/${id}`, { id, businessId: bid, nome, nomeNormalizado: nome.toLowerCase(), telefone, saldo: 0,
    financialVersion: 1, ativo: true, active: true, customerSpaceIds: spaceIds, spaceId: spaceIds[0], createdAt: atSP(-60), updatedAt: atSP(-60) }];
  writes.push(
    client(multi, "c-joana", "Joana Conceição", "11988881234", [centro, bairro]),
    client(multi, "c-marcos", "Márcio Dias", "11977772211", [centro]),
    client(multi, "c-bia", "Bia Souza", "21966661010", [bairro]),
    client(multi, "c-carlos", "Carlos Prado", "31955550001", [centro]),
    client(multi, "c-ana", "Ana Ribeiro", "", [bairro]),
  );
  // Same client (Joana) holds a different plan in each space.
  for (const s of [
    sub(multi, "s-joana-centro", "c-joana", centro, "plano-pilates", "Plano Mensal Pilates", 0, { hour: 20, price: 180 }),
    sub(multi, "s-joana-bairro", "c-joana", bairro, "plano-academia", "Academia 3x semana", 3, { price: 99.9 }),
    // Second plan of the same client in the SAME space: one reminder must list both, line by line.
    sub(multi, "s-joana-centro-2", "c-joana", centro, "plano-academia", "Personal 2x semana", 1, { price: 140 }),
    sub(multi, "s-marcos-centro", "c-marcos", centro, "plano-pilates", "Plano Mensal Pilates", -5, { price: 180 }),
    sub(multi, "s-bia-bairro", "c-bia", bairro, "plano-academia", "Academia 3x semana", 12, { price: 99.9, lastRenewedAt: atSP(-4) }),
    sub(multi, "s-carlos-centro", "c-carlos", centro, "plano-pilates", "Plano Mensal Pilates", 20, { price: 180, fields: { status: "paused" } }),
    sub(multi, "s-ana-bairro", "c-ana", bairro, "plano-academia", "Academia 3x semana", 1, { price: 99.9 }),
  ]) writes.push([`businesses/${multi}/customerSubscriptions/${s.id}`, s]);
  writes.push([`businesses/${BUSINESSES.basic.id}/clients/c-basic`, client(BUSINESSES.basic.id, "c-basic", "Cliente Essencial", "11911112222", [`${BUSINESSES.basic.id}-loja`])[1]]);
  // Volume: one space, 160 active (spread over 40 days) + 70 expired, so every window pages past 50.
  const vol = BUSINESSES.volume.id, volSpace = `${vol}-loja`;
  for (let i = 0; i < 230; i++) {
    const id = `v-${String(i).padStart(3, "0")}`, expired = i >= 160, offset = expired ? -1 - (i - 160) : i % 40;
    writes.push(client(vol, `vc-${id}`, `Aluno ${String(i).padStart(3, "0")}`, `1190000${String(1000 + i)}`, [volSpace]));
    writes.push([`businesses/${vol}/customerSubscriptions/${id}`, sub(vol, id, `vc-${id}`, volSpace, "plano-academia", "Academia 3x semana", offset, { price: 100 })]);
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [key, value] of writes.slice(i, i + 400)) batch.set(db.doc(key), value);
    await batch.commit();
  }
  return { uids, count: writes.length };
}
function serve(port) {
  const root = path.resolve(__dirname, ".."), mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
  http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader("Content-Type", (mime[path.extname(file)] || "application/octet-stream") + "; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (pathname === "/service-worker.js") return res.end("self.addEventListener('install',()=>self.skipWaiting());");
    if (pathname === "/js/firebase/firebase-config.js") {
      let source = fs.readFileSync(file, "utf8").replaceAll("adi-festa-controle", PROJECT);
      source = source.replace("getAuth, setPersistence", "connectAuthEmulator, getAuth, setPersistence")
        .replace("initializeFirestore, memoryLocalCache", "connectFirestoreEmulator, initializeFirestore, memoryLocalCache")
        .replace("getFunctions, httpsCallable", "connectFunctionsEmulator, getFunctions, httpsCallable")
        .replace("export const auth=getAuth(app);", "export const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});")
        .replace("export const db=initializeFirestore(app,{localCache:memoryLocalCache()});", "export const db=initializeFirestore(app,{localCache:memoryLocalCache()});connectFirestoreEmulator(db,'127.0.0.1',8080);")
        .replace("export const functions=getFunctions(app,'southamerica-east1');", "export const functions=getFunctions(app,'southamerica-east1');connectFunctionsEmulator(functions,'127.0.0.1',5001);");
      return res.end(source);
    }
    if (pathname === "/js/firebase/sync.js") return res.end(fs.readFileSync(file, "utf8").replaceAll("adi-festa-controle", PROJECT));
    fs.createReadStream(file).pipe(res);
  }).listen(port, "127.0.0.1", () => console.log(`QA app: http://127.0.0.1:${port}/  (emulators only)`));
}
seed().then(({ count }) => { console.log(`seeded ${count} documents`); serve(Number(process.argv[2] || 5190)); })
  .catch((error) => { console.error(error); process.exit(1); });
