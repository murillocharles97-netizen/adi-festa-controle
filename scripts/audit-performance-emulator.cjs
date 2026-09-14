const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");
const admin = require("../functions/node_modules/firebase-admin");

const root = path.resolve(process.env.APP_ROOT || process.cwd());
const route = process.env.ROUTE || "vender";
const fullApp = process.env.FULL_APP === "1";
const browserQa = process.env.BROWSER_QA === "1";
const projectId = "adi-festa-variations-test";
const uid = "performance-audit-owner";
const businessId = "performance-audit-business";
const email = "performance-audit@example.test";
const password = "PerformanceAudit123!";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw Error("Execute via firebase emulators:exec --only firestore,auth.");
}

admin.initializeApp({ projectId });

async function seed() {
  await admin.auth().createUser({ uid, email, password });
  const db = admin.firestore();
  await Promise.all([
    db.doc(`users/${uid}`).set({ uid, email, businessId, role: "owner", active: true, name: "Performance Audit" }),
    db.doc(`businesses/${businessId}`).set({ id: businessId, ownerId: uid, active: true, name: "Performance Audit", subscription: { planId: "internal", status: "active" } }),
    db.doc("financialSpaces/performance-audit-personal").set({ id: "performance-audit-personal", ownerUid: uid, type: "personal", active: true, linkedBusinessId: null, name: "Personal" }),
    db.doc("financialSpaces/performance-audit-other").set({ id: "performance-audit-other", ownerUid: uid, type: "other", active: true, linkedBusinessId: null, name: "Other" }),
    db.doc("financialSpaces/performance-audit-business").set({ id: "performance-audit-business", ownerUid: uid, type: "business", active: true, linkedBusinessId: businessId, name: "Business" }),
    db.doc(`businesses/${businessId}/products/performance-audit-product-1`).set({ id: "performance-audit-product-1", businessId, ownerId: uid, nome: "Produto A", preco: 12.5, estoqueAtual: 10, ativo: true, categoria: "Doces", updatedAt: new Date().toISOString() }),
    db.doc(`businesses/${businessId}/products/performance-audit-product-2`).set({ id: "performance-audit-product-2", businessId, ownerId: uid, nome: "Produto B", preco: 8, estoqueAtual: 4, ativo: true, categoria: "Doces", updatedAt: new Date().toISOString() }),
    db.doc(`businesses/${businessId}/clients/performance-audit-client`).set({ id: "performance-audit-client", businessId, ownerId: uid, nome: "Cliente Audit", updatedAt: new Date().toISOString() }),
  ]);
}

function configSource() {
  const source = fs.readFileSync(path.join(root, "js/firebase/firebase-config.js"), "utf8");
  return source
    .replaceAll("adi-festa-controle", projectId)
    .replace("getAuth, setPersistence", "getAuth, connectAuthEmulator, setPersistence")
    .replace("initializeFirestore, persistentLocalCache", "initializeFirestore, connectFirestoreEmulator, persistentLocalCache")
    .replace("export const auth=getAuth(app);", "export const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});")
    .replace("export const db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});", "export const db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});connectFirestoreEmulator(db,'127.0.0.1',8080);");
}

function serviceSource() {
  return fs.readFileSync(path.join(root, "js/firebase/financial-space-service.js"), "utf8")
    .replace(/\bgetDocs\(/g, "auditedGetDocs(")
    .replace("const Engine = window.FinancialEngine;", `const auditedGetDocs = async (...args) => {
  window.__financialAudit.attempted++;
  try {
    const snapshot = await getDocs(...args);
    window.__financialAudit.succeeded++;
    window.__financialAudit.documents += snapshot.size;
    return snapshot;
  } catch (error) {
    window.__financialAudit.failed++;
    window.__financialAudit.errors.push(error.code || error.message);
    throw error;
  }
};
const Engine = window.FinancialEngine;`);
}

function fixture() {
  return `<!doctype html><html><body><script>
window.FinancialEngine = {};
window.Router = { atual: () => ${JSON.stringify(route)} };
window.FirebaseSession = { businessId: ${JSON.stringify(businessId)} };
window.BusinessContext = { get: () => ({ businessId: ${JSON.stringify(businessId)} }) };
window.__financialAudit = { attempted: 0, succeeded: 0, failed: 0, documents: 0, errors: [], done: false };
</script><script type="module">
import { auth } from "/js/firebase/firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
try {
  await signInWithEmailAndPassword(auth, ${JSON.stringify(email)}, ${JSON.stringify(password)});
  await import("/js/firebase/financial-space-service.js");
  dispatchEvent(new CustomEvent("firebase-auth-ready"));
  await new Promise(resolve => setTimeout(resolve, 4000));
} catch (error) {
  window.__financialAudit.fixtureError = error.code || error.message;
} finally {
  window.__financialAudit.done = true;
}
</script></body></html>`;
}

const mime = { ".js": "text/javascript", ".html": "text/html" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (fullApp && (pathname === "/" || pathname === "/index.html")) {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8").replace("<head>", '<head><script>window.__financialAudit={attempted:0,succeeded:0,failed:0,documents:0,errors:[]};</script>');
    return response.writeHead(200, { "Content-Type": "text/html" }).end(html);
  }
  const content = pathname === "/audit-fixture.html" ? fixture()
    : pathname === "/js/firebase/firebase-config.js" ? configSource()
    : pathname === "/js/firebase/financial-space-service.js" ? serviceSource() : null;
  if (content !== null) return response.writeHead(200, { "Content-Type": mime[path.extname(pathname)] }).end(content);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end("Not found");
  response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
});

async function main() {
  await seed();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    if (fullApp) {
      await page.goto(`http://127.0.0.1:${server.address().port}/#/vender`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("#login-form", { timeout: 30000 });
      await page.type("#login-form [name=email]", email);
      await page.type("#login-form [name=password]", password);
      const loginStart = await page.evaluate(() => performance.now());
      await page.click("#login-submit");
      await page.waitForFunction(() => Boolean(window.FirebaseSession?.user && document.querySelector("#app")?.textContent?.includes("Produto")), { timeout: 45000 });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const result = await page.evaluate((loginStart) => ({
        loginToSellingMs: Math.round(performance.now() - loginStart),
        route: window.Router?.atual?.(),
        productsVisible: document.querySelector("#app")?.textContent?.includes("Produto A"),
        clientCount: window.DB?.carregar?.().clientes?.length ?? null,
        usage: window.FirebaseUsageMonitor?.snapshot?.(),
        financialAudit: window.__financialAudit || null,
      }), loginStart);
      if (browserQa) {
        await page.type("#product-search", "Produto A");
        await page.waitForFunction(() => [...document.querySelectorAll(".desktop-sale-product")].filter((item) => !item.hidden).length === 1);
        await page.click("#clear-product-search");
        await page.click('[data-add="performance-audit-product-1"] .desktop-sale-add');
        await page.click('[data-add="performance-audit-product-2"] .desktop-sale-add');
        await page.click('[data-add="performance-audit-product-1"] .desktop-sale-add');
        await page.waitForFunction(() => window.Checkout?.cartCount?.() === 3);
        await page.click("#desktop-continue-sale");
        await page.waitForFunction(() => !document.querySelector("#desktop-checkout-fields").hidden);
        await page.click("#finish-sale");
        await page.waitForFunction(() => window.DB?.carregar?.().vendas?.length >= 1, { timeout: 15000 });
        result.saleCompleted = await page.evaluate(() => ({ sales: DB.carregar().vendas.length, cart: window.Checkout?.cartCount?.() }));
        await page.evaluate(() => window.Router.ir("inicio"));
        await page.waitForFunction(() => window.Router?.atual?.() === "inicio");
        await page.evaluate(() => window.Router.ir("clientes"));
        await page.waitForFunction(() => window.Router?.atual?.() === "clientes");
        await page.evaluate(() => window.Router.ir("produtos"));
        await page.waitForFunction(() => window.Router?.atual?.() === "produtos");
        await page.evaluate(() => window.Router.ir("financeiro"));
        await page.waitForFunction(() => Boolean(window.FinanceiroUI && window.FinancialSpaceService), { timeout: 30000 });
        result.financeLoaded = await page.evaluate(() => ({ route: window.Router.atual(), scripts: performance.getEntriesByType("resource").filter((item) => /financial-(engine|ui|space-service)\.js/.test(item.name)).length }));
        await page.setOfflineMode(true);
        await page.evaluate(() => window.Router.ir("vender"));
        await page.waitForFunction(() => window.Router?.atual?.() === "vender" && document.querySelector("#app")?.textContent?.includes("Produto A"));
        result.offlineSellingVisible = true;
        await page.setOfflineMode(false);
        await page.evaluate(() => window.FirebaseAuthActions.signOut(true));
        await page.waitForSelector("#login-form", { timeout: 15000 });
        result.logout = await page.evaluate(() => ({ loginVisible: Boolean(document.querySelector("#login-form")), activeListeners: window.FirebaseUsageMonitor?.snapshot?.().activeListeners }));
        if (result.logout.activeListeners !== 0) throw Error(`Listeners após logout: ${result.logout.activeListeners}`);
      }
      console.log(JSON.stringify({ root, route, fullApp, browserQa, result, pageErrors }, null, 2));
    } else {
      await page.goto(`http://127.0.0.1:${server.address().port}/audit-fixture.html`, { waitUntil: "load", timeout: 45000 });
      await page.waitForFunction(() => window.__financialAudit.done, { timeout: 30000 });
      const result = await page.evaluate(() => window.__financialAudit);
      if (result.fixtureError || pageErrors.length) throw Error(JSON.stringify({ result, pageErrors }));
      console.log(JSON.stringify({ root, route, ...result }, null, 2));
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
