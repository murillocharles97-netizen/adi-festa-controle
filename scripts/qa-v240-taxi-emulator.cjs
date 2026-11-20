// V240 homologation: fictitious "Táxi" scenario in LOCAL emulators, app served against them.
// Never touches production. Usage (emulators auth+firestore+functions already running):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/qa-v240-taxi-emulator.cjs [port]
// Test-only credentials for the fictitious emulator owner: QA_EMAIL / QA_PASSWORD below.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") ||
    !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || ""))
  throw Error("Local emulators required; refusing production.");
const admin = require("../functions/node_modules/firebase-admin");
const PROJECT = "adi-festa-variations-test";
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const QA_EMAIL = "taxi-owner@example.test", QA_PASSWORD = "LocalQaTaxi240!";
const BID = "qa-taxi-biz", STORE = `business_${BID}`, TAXI = "qa-taxi-space";
const atSP = (offsetDays, hour = 15) => {
  const sp = new Date(Date.now() - 3 * 3600000);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + offsetDays, hour + 3)).toISOString();
};
async function seed() {
  let owner;
  try { owner = (await admin.auth().getUserByEmail(QA_EMAIL)).uid; }
  catch { owner = (await admin.auth().createUser({ email: QA_EMAIL, password: QA_PASSWORD, emailVerified: true })).uid; }
  const w = [];
  w.push([`businesses/${BID}`, { id: BID, name: "Empresa Fictícia QA", ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: false,
    sensitiveDataVersion: 1, subscription: { planId: "premium", status: "active" } }]);
  w.push([`businesses/${BID}/settings/default`, { id: "default", nome: "Empresa Fictícia QA", businessId: BID,
    operation: { operationMode: "physical_store", creditMode: "enabled", operationOnboardingCompleted: true, modules: { inventory: true, crm: true, creditSales: true } } }]);
  w.push([`users/${owner}`, { uid: owner, name: "QA Proprietário", email: QA_EMAIL, businessId: BID, active: true, role: "owner", tutorialVersionSeen: 999, permissions: {} }]);
  const base = { businessId: BID, ownerUid: owner, createdBy: owner, active: true, status: "active", globalSpaceSchemaVersion: 1, currency: "BRL", schemaVersion: 1,
    createdAt: atSP(-90), updatedAt: atSP(-90) };
  w.push([`financialSpaces/${STORE}`, { ...base, id: STORE, name: "Loja QA", type: "business", linkedBusinessId: BID, operationalType: "unit", isDefault: true,
    capabilities: { finance: true, sales: true, products: true, inventory: true, goals: true },
    automation: { enabled: true, linkedBusinessId: BID, activatedAt: atSP(-90), autoIncome: { sales: true, customerPayments: true, onlineOrders: true } }, autoIncomeSince: atSP(-90) }]);
  // Same shape as the audited Táxi: type "other", no linkedBusinessId, no automation, manual history.
  w.push([`financialSpaces/${TAXI}`, { ...base, id: TAXI, name: "Táxi QA", type: "other", linkedBusinessId: null, operationalType: "operation", isDefault: false,
    capabilities: { finance: true, sales: true, products: false, inventory: false, goals: true } }]);
  for (const [id, e] of [["qa-manual-corridas", { direction: "in", sourceType: "manual_income", amountCents: 450000, description: "Corridas (manual, outubro)", occurredAt: atSP(-44) }],
    ["qa-etanol", { direction: "out", sourceType: "manual_expense", amountCents: 16302, description: "Etanol (manual)", occurredAt: atSP(-40) }]])
    w.push([`financialSpaces/${TAXI}/entries/${id}`, { id, financialSpaceId: TAXI, ownerUid: owner, status: "paid", createdBy: owner, categoryId: "default_personal_car", ...e }]);
  w.push([`financialSpaces/${TAXI}/financialAccounts/qa-taxi-cash`, { id: "qa-taxi-cash", name: "Carteira Táxi QA", type: "cash", ownerUid: owner, active: true,
    accessMode: "single_space", defaultFinancialSpaceId: TAXI, accountHomeSpaceId: TAXI, currentBalanceCents: 0, openingBalanceCents: 0 }]);
  const client = (id, nome, space) => [`businesses/${BID}/clients/${id}`, { id, businessId: BID, nome, nomeNormalizado: nome.toLowerCase(), telefone: "", saldo: 0,
    financialVersion: 0, ativo: true, active: true, workspaceGeneration: 0, customerSpaceIds: [space], spaceId: space, createdAt: atSP(-1, 8), updatedAt: atSP(-1, 8) }];
  w.push(client("qa-pai", "Pai QA", TAXI), client("qa-passageiro", "Passageiro QA", TAXI), client("qa-loja", "Cliente Loja QA", STORE));
  w.push([`businesses/${BID}/products/qa-corrida`, { id: "qa-corrida", businessId: BID, nome: "Corrida QA", preco: 180, custo: 0, ativo: true, active: true,
    itemKind: "service", semControleEstoque: true, controlaEstoque: false, estoqueAtual: 0, spaceAccessMode: "selected_spaces", allowedSpaceIds: [TAXI], defaultSpaceId: TAXI }]);
  w.push([`businesses/${BID}/products/qa-balao`, { id: "qa-balao", businessId: BID, nome: "Balão QA", preco: 14, custo: 5, ativo: true, active: true,
    estoqueAtual: 50, estoque: 50, spaceAccessMode: "selected_spaces", allowedSpaceIds: [STORE], defaultSpaceId: STORE }]);
  const batch = db.batch(); for (const [k, v] of w) batch.set(db.doc(k), v); await batch.commit();
  return { owner, count: w.length };
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
seed().then(({ count }) => { console.log(`seeded ${count} documents`); serve(Number(process.argv[2] || 5240)); })
  .catch((error) => { console.error(error); process.exit(1); });
