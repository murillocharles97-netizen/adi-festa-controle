const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");
const admin = require("../functions/node_modules/firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw Error("Execute com Auth e Firestore Emulator.");
const root = process.cwd();
const output = path.join(root, "artifacts/settings-redesign-v137");
const projectId = "adi-festa-variations-test";
const uid = "settings-v137-owner", businessId = "settings-v137-business";
const email = "settings-v137@example.test", password = "SettingsBrowser123!";
const sizes = [[320, 640], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

admin.initializeApp({ projectId });
function configSource() {
  return fs.readFileSync(path.join(root, "js/firebase/firebase-config.js"), "utf8")
    .replaceAll("adi-festa-controle", projectId)
    .replace("getAuth, setPersistence", "getAuth, connectAuthEmulator, setPersistence")
    .replace("initializeFirestore, persistentLocalCache", "initializeFirestore, connectFirestoreEmulator, persistentLocalCache")
    .replace("export const auth=getAuth(app);", "export const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});")
    .replace("export const db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});", "export const db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});connectFirestoreEmulator(db,'127.0.0.1',8080);");
}
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (pathname === "/js/firebase/firebase-config.js") return response.writeHead(200, { "Content-Type": "text/javascript" }).end(configSource());
  const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end("Not found");
  response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
});
async function seed() {
  await admin.auth().createUser({ uid, email, password });
  const old = admin.firestore.Timestamp.fromDate(new Date("2024-01-05T00:00:00Z"));
  await Promise.all([
    admin.firestore().doc(`users/${uid}`).set({ uid, email, businessId, role: "owner", active: true, name: "Conta Antiga", createdAt: old }),
    admin.firestore().doc(`businesses/${businessId}`).set({ id: businessId, ownerId: uid, active: true, name: "Loja QA", subscription: { planId: "internal", status: "active" } }),
  ]);
}
async function checkLayout(page, width) {
  return page.evaluate(expected => {
    const groups = [...document.querySelectorAll(".settings-group")];
    const rows = [...document.querySelectorAll(".settings-list-row")];
    const bounds = [document.querySelector(".settings-sync-hero"), ...groups, ...rows].map(element => {
      const rect = element.getBoundingClientRect();
      return { title: element.textContent.trim().slice(0, 30), left: rect.left, right: rect.right, height: rect.height };
    });
    const topbar = document.querySelector(".settings-topbar");
    const nav = document.querySelector(".bottom-nav");
    const last = rows.at(-1).getBoundingClientRect();
    const style = getComputedStyle(document.querySelector(".settings-mobile-v2"));
    const problems = [];
    if (groups.length !== 3 || rows.length !== 9) problems.push("estrutura");
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.push("overflow horizontal");
    if (bounds.some(item => item.left < -1 || item.right > expected + 1 || item.height < 44)) problems.push("card fora da viewport ou touch pequeno");
    if (getComputedStyle(topbar.querySelector(".local-badge")).display === "none") problems.push("nuvem oculta");
    if (innerWidth < 768 && getComputedStyle(nav).display === "none") problems.push("bottom nav oculta");
    if (style.display === "none" || last.bottom < 0) problems.push("página oculta");
    return { width: innerWidth, groups: groups.length, rows: rows.length, horizontalOverflow: document.documentElement.scrollWidth - innerWidth, headerHeight: topbar.getBoundingClientRect().height, sync: document.querySelector("[data-settings-sync-title]").textContent, navVisible: getComputedStyle(nav).display !== "none", problems, bounds };
  }, width);
}
async function clickSheet(page, selector, heading) {
  await clickRow(page, selector);
  await page.waitForFunction(expected => document.querySelector("#modal .modal-head h3")?.textContent === expected, {}, heading);
  await page.click("#modal [data-settings-close]");
}
async function clickRow(page, selector) {
  await page.evaluate(value => document.querySelector(value).scrollIntoView({ block: "center" }), selector);
  await page.click(selector);
}
async function main() {
  await seed();
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${server.address().port}/#/inicio`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("#login-form", { timeout: 30000 });
    await page.type("#login-form [name=email]", email);
    await page.type("#login-form [name=password]", password);
    await page.click("#login-submit");
    await page.waitForSelector(".operation-flow.onboarding", { timeout: 45000 });
    if (await page.evaluate(() => window.VeconiTutorialManager?.isOpen?.())) throw Error("Tutorial apareceu antes da configuração operacional.");
    await page.click(".operation-flow [data-operation-next]");
    await page.click(".operation-flow [data-operation-next]");
    await page.waitForFunction(() => window.VeconiTutorialManager?.getState?.()?.stepId === "welcome", { timeout: 45000 });
    const beforeSkip = await page.evaluate(() => window.VeconiAppIntro.getStoredVersion(window.FirebaseSession.user.uid));
    if (beforeSkip !== 0) throw Error(`Conta antiga já marcada antes de pular: ${beforeSkip}`);
    await page.screenshot({ path: path.join(output, "old-account-auto-tutorial.png") });
    await page.click('[data-tour-action="skip"]');
    await page.waitForFunction(() => !window.VeconiTutorialManager?.isOpen?.());
    const afterSkip = await page.evaluate(() => window.VeconiAppIntro.getStoredVersion(window.FirebaseSession.user.uid));
    if (afterSkip !== 1) throw Error(`Pular não gravou versão: ${afterSkip}`);
    await page.evaluate(() => window.Router.ir("configuracoes"));
    await page.waitForFunction(() => document.querySelector("[data-settings-root]")?.querySelector("[data-settings-action=tutorials]")?.onclick);
    await page.waitForFunction(() => !document.querySelector("#toasts .toast"), { timeout: 8000 });
    const layout = [];
    for (const [width, height] of sizes) {
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await page.evaluate(() => scrollTo(0, 0));
      const data = await checkLayout(page, width);
      if (data.problems.length) throw Error(`Layout ${width}: ${JSON.stringify(data)}`);
      layout.push({ width, groups: data.groups, rows: data.rows, headerHeight: data.headerHeight, horizontalOverflow: data.horizontalOverflow, sync: data.sync });
      await page.screenshot({ path: path.join(output, `${width}-settings.png`), fullPage: true });
    }
    await page.setViewport({ width: 390, height: 1250, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, "390-settings-reference-comparison.png") });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await clickSheet(page, '[data-settings-action="business"]', "Dados da empresa");
    await clickSheet(page, '[data-settings-action="whatsapp"]', "WhatsApp padrão");
    await clickSheet(page, '[data-settings-action="account"]', "Conta");
    await clickRow(page, '[data-edit-operation]');
    await page.waitForSelector(".operation-flow:not(.onboarding) [data-operation-close]");
    if (await page.evaluate(() => document.querySelectorAll(".operation-flow").length) !== 1) throw Error("Editor operacional duplicado.");
    await page.click("[data-operation-close]");
    await clickRow(page, '[data-settings-route="planos"]');
    await page.waitForFunction(() => window.Router.atual() === "planos");
    await page.evaluate(() => window.Router.ir("configuracoes"));
    await page.waitForSelector("[data-settings-sync]");
    await clickRow(page, "[data-settings-sync]");
    await page.waitForSelector("#cloud-sync-panel [data-cloud-status]");
    await page.click("#cloud-panel-details");
    await page.waitForSelector("[data-open-technical]");
    await page.click("[data-open-technical]");
    await page.waitForSelector("[data-sync-technical]");
    await page.click("[data-open-technical]");
    await page.waitForFunction(() => !document.querySelector("[data-sync-technical]"));
    await page.click("#modal .close");
    await clickRow(page, '[data-settings-action="sync"]');
    await page.waitForSelector("#cloud-sync-panel");
    await page.click("#cloud-sync-panel .close");
    await clickRow(page, '[data-settings-action="backup"]');
    await page.waitForSelector("[data-backup-export]");
    if (await page.evaluate(() => !document.querySelector("[data-backup-import]") || !document.querySelector("[data-backup-clear]"))) throw Error("Ferramentas de backup ausentes.");
    await page.click("#modal [data-settings-close]");
    await clickRow(page, '[data-settings-action="tutorials"]');
    await page.waitForSelector("[data-settings-review-intro]");
    await page.click("[data-settings-review-intro]");
    await page.waitForFunction(() => window.VeconiTutorialManager?.getState?.()?.stepId === "welcome");
    if (await page.evaluate(() => window.VeconiAppIntro.getStoredVersion(window.FirebaseSession.user.uid)) !== 1) throw Error("Rever tutorial mudou a versão.");
    await page.click('[data-tour-action="skip"]');
    await clickRow(page, "[data-settings-logout]");
    await page.waitForSelector("#confirm-account-logout");
    await page.click("[data-logout-cancel]");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.FirebaseSession?.user && document.querySelector("[data-settings-root]")), { timeout: 45000 });
    await new Promise(resolve => setTimeout(resolve, 400));
    if (await page.evaluate(() => window.VeconiTutorialManager?.isOpen?.())) throw Error("Tutorial reapareceu após reload.");
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("./service-worker.js");
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    });
    await page.setOfflineMode(true);
    await page.waitForFunction(() => document.querySelector("[data-settings-sync]")?.dataset.syncState === "offline", { timeout: 12000 });
    await page.screenshot({ path: path.join(output, "390-settings-offline.png"), fullPage: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(() => Boolean(window.FirebaseSession?.user && document.querySelector("[data-settings-root]")), { timeout: 15000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({ hash: location.hash, route: document.querySelector("#app")?.dataset.route, authGate: document.querySelector("#auth-gate")?.textContent?.slice(0, 240), session: Boolean(window.FirebaseSession?.user), sw: Boolean(navigator.serviceWorker?.controller), cssCached: Boolean(document.querySelector('link[href*="settings-redesign"]')) }));
      throw Error(`Reload autenticado offline: ${JSON.stringify({ diagnostic, pageErrors: errors })}`);
    }
    if (await page.evaluate(() => document.querySelector("[data-settings-sync]")?.dataset.syncState) !== "offline") throw Error("Status offline não persistiu após reload.");
    await page.setOfflineMode(false);
    await page.waitForFunction(() => document.querySelector("[data-settings-sync]")?.dataset.syncState !== "offline", { timeout: 15000 });
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.evaluate(() => window.Router.ir("configuracoes"));
    await page.waitForFunction(() => Boolean(document.querySelector("[data-settings-sync]")), { timeout: 10000 });
    const desktop = await checkLayout(page, 1280);
    if (desktop.problems.length || desktop.rows !== 9) throw Error(`Desktop: ${JSON.stringify(desktop)}`);
    await page.screenshot({ path: path.join(output, "1280-settings.png"), fullPage: true });
    await clickSheet(page, '[data-settings-action="tutorials"]', "Ajuda e tutoriais");
    const cloud = await admin.firestore().doc(`users/${uid}`).get();
    const pwaCache = await page.evaluate(async () => Boolean(await caches.match("./css/settings-redesign.css")));
    const result = { autoForOldAccount: true, beforeSkip, afterSkip, cloudVersion: cloud.data()?.tutorialVersions?.appIntro, layout, desktop: { rows: desktop.rows, horizontalOverflow: desktop.horizontalOverflow }, offlineReload: true, pwaCache, pageErrors: errors };
    if (result.cloudVersion !== 1 || !pwaCache || errors.length) throw Error(JSON.stringify(result));
    fs.writeFileSync(path.join(output, "browser-results.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
