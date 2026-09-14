const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");
const admin = require("../functions/node_modules/firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw Error("Execute com os emuladores Firestore e Auth.");
}
const root = process.cwd();
const screenshots = path.join(root, "artifacts", "app-intro-v1");
const projectId = "adi-festa-variations-test";
const uid = "app-intro-browser-owner";
const businessId = "app-intro-browser-business";
const email = "app-intro-browser@example.test";
const password = "AppIntroBrowser123!";
const sizes = [[320, 568], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
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
  const now = admin.firestore.Timestamp.now();
  await Promise.all([
    admin.firestore().doc(`users/${uid}`).set({ uid, email, businessId, role: "owner", active: true, name: "Intro Browser", createdAt: now }),
    admin.firestore().doc(`businesses/${businessId}`).set({ id: businessId, ownerId: uid, active: true, name: "Intro Browser", subscription: { planId: "internal", status: "active" } }),
  ]);
}
async function state(page) { return page.evaluate(() => window.VeconiTutorialManager?.getState?.() || null); }
async function geometry(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".veconi-tour-card"), spotlight = document.querySelector(".veconi-tour-spotlight");
    const c = card.getBoundingClientRect(), s = spotlight.getBoundingClientRect();
    const targetVisible = !spotlight.hidden;
    const overlap = targetVisible && Math.max(0, Math.min(c.right, s.right) - Math.max(c.left, s.left)) * Math.max(0, Math.min(c.bottom, s.bottom) - Math.max(c.top, s.top));
    return { card: { x: c.x, y: c.y, right: c.right, bottom: c.bottom }, overlap, horizontalOverflow: document.documentElement.scrollWidth - innerWidth, targetVisible };
  });
}
async function capture(page, width, name) {
  await new Promise(resolve => setTimeout(resolve, 260));
  const result = await geometry(page);
  if (result.card.x < -1 || result.card.right > width + 1 || result.card.y < -1 || result.card.bottom > (await page.evaluate(() => innerHeight)) + 1 || result.horizontalOverflow > 1 || result.overlap > 1) {
    throw Error(`Layout inválido ${width}/${name}: ${JSON.stringify(result)}`);
  }
  await page.screenshot({ path: path.join(screenshots, `${width}-${name}.png`) });
  return result;
}

async function main() {
  await seed();
  fs.mkdirSync(screenshots, { recursive: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const results = [];
    await page.setViewport({ width: 320, height: 568, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
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
    for (const [width, height] of sizes) {
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      if (width !== 320) {
        await page.evaluate(() => window.VeconiAppIntro.open({ manual: true }));
        await page.waitForFunction(() => window.VeconiTutorialManager?.getState?.()?.stepId === "welcome");
      }
      const steps = ["welcome", "main-menu", "daily-navigation", "module-guides", "complete"];
      for (const step of steps) {
        if ((await state(page))?.stepId !== step) throw Error(`Passo inesperado em ${width}: ${JSON.stringify(await state(page))}`);
        const layout = await capture(page, width, step);
        results.push({ width, step, ...layout });
        if (step === "complete") break;
        await page.click(`[data-tour-action="${step === "module-guides" ? "finish" : "next"}"]`);
      }
      await page.click('[data-tour-action="close"]');
      await page.waitForFunction(() => !window.VeconiTutorialManager?.isOpen?.());
      await new Promise(resolve => setTimeout(resolve, 150));
      await page.evaluate(() => window.Router.ir("configuracoes"));
      await page.waitForFunction(() => window.Router.atual() === "configuracoes");
      await page.waitForFunction(() => Boolean(document.querySelector('[data-settings-action="tutorials"]')?.onclick));
      await page.click('[data-settings-action="tutorials"]');
      await page.waitForSelector('[data-settings-review-intro]', { timeout: 3000 }).catch(async error => {
        throw Error(`${error.message}; diagnóstico: ${JSON.stringify(await page.evaluate(() => { const button = document.querySelector('[data-settings-action="tutorials"]'), r=button?.getBoundingClientRect(); return { route: window.Router?.atual?.(), modal: document.querySelector('#modal')?.innerHTML?.slice(0, 500), rect: r ? {x:r.x,y:r.y,width:r.width,height:r.height} : null, hit: r ? document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.outerHTML?.slice(0, 180) : null }; }))}; pageErrors: ${JSON.stringify(errors)}`);
      });
      await new Promise(resolve => setTimeout(resolve, 350));
      await page.screenshot({ path: path.join(screenshots, `${width}-settings-help.png`) });
      if (width === 320) {
        await page.click('[data-settings-review-intro]');
        await page.waitForFunction(() => window.VeconiTutorialManager?.getState?.()?.stepId === 'welcome');
        await page.click('[data-tour-action="skip"]');
        await page.waitForFunction(() => !window.VeconiTutorialManager?.isOpen?.());
        await new Promise(resolve => setTimeout(resolve, 200));
      } else await page.click('[data-settings-close]');
      if (width !== 430) await page.evaluate(() => window.Router.ir("inicio"));
    }
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.evaluate(() => window.Router.ir("inicio"));
    await page.waitForFunction(() => document.querySelector('#app')?.dataset.route === 'inicio');
    await page.evaluate(() => window.VeconiAppIntro.open({ manual: true }));
    for (const step of ["welcome", "main-menu", "daily-navigation", "module-guides", "complete"]) {
      await page.waitForFunction(expected => window.VeconiTutorialManager?.getState?.()?.stepId === expected, {}, step);
      await capture(page, 1280, step);
      if (step === "complete") break;
      if (step === "main-menu") {
        await page.click('[data-tour-action="back"]');
        await page.waitForFunction(() => window.VeconiTutorialManager?.getState?.()?.stepId === 'welcome');
        await page.click('[data-tour-action="next"]');
      }
      await page.click(`[data-tour-action="${step === "module-guides" ? "finish" : "next"}"]`);
    }
    await page.click('[data-tour-action="close"]');
    await page.waitForFunction(() => !window.VeconiTutorialManager?.isOpen?.());
    await new Promise(resolve => setTimeout(resolve, 200));
    await page.evaluate(() => window.Router.ir("configuracoes"));
    await page.waitForFunction(() => Boolean(document.querySelector('[data-open-app-intro]')));
    await page.screenshot({ path: path.join(screenshots, "1280-settings-help.png") });
    await page.click('[data-open-app-intro]');
    await page.waitForFunction(() => window.VeconiTutorialManager?.getState?.()?.stepId === 'welcome');
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !window.VeconiTutorialManager?.isOpen?.());
    await new Promise(resolve => setTimeout(resolve, 200));
    await page.evaluate(() => window.VeconiAppIntro.open({ manual: true }));
    await page.waitForFunction(() => window.VeconiTutorialManager?.isOpen?.());
    const beforeBack = await page.evaluate(() => location.hash);
    await page.goBack();
    await page.waitForFunction(() => !window.VeconiTutorialManager?.isOpen?.());
    if (await page.evaluate(() => location.hash) !== beforeBack) throw Error("Voltar alterou a rota durante o tutorial.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.FirebaseSession?.user && document.querySelector('#app')?.children.length), { timeout: 45000 });
    await new Promise(resolve => setTimeout(resolve, 450));
    if (await page.evaluate(() => window.VeconiTutorialManager?.isOpen?.())) throw Error("Tutorial reapareceu após reload.");
    await page.evaluate(() => window.VeconiAppIntro.open({ manual: true }));
    await page.click('[data-tour-action="next"]');
    await page.click('[data-tour-action="next"]');
    await page.evaluate(() => document.querySelector('[data-tour="bottom-navigation"]').removeAttribute('data-tour'));
    await page.evaluate(() => window.VeconiTutorialManager.back());
    await page.evaluate(() => window.VeconiTutorialManager.next());
    await page.waitForFunction(() => document.querySelector('.veconi-tour-root')?.classList.contains('is-centered'));
    await page.evaluate(() => window.VeconiTutorialManager.close('abandoned'));
    await new Promise(resolve => setTimeout(resolve, 200));
    await page.setOfflineMode(true);
    await page.evaluate(() => window.VeconiAppIntro.open({ manual: true }));
    await page.waitForFunction(() => window.VeconiTutorialManager?.getState?.()?.stepId === 'welcome');
    for (const action of ['next', 'next', 'next', 'finish']) await page.click(`[data-tour-action="${action}"]`);
    await page.waitForFunction(() => window.VeconiTutorialManager?.getState?.()?.stepId === 'complete');
    await page.click('[data-tour-action="close"]');
    await page.setOfflineMode(false);
    const cloud = await admin.firestore().doc(`users/${uid}`).get();
    const final = { screenshots: sizes.length * 6 + 6, cloudVersion: cloud.data()?.tutorialVersions?.appIntro || 0, pageErrors: errors, results };
    if (final.cloudVersion !== 1 || errors.length) throw Error(JSON.stringify(final));
    console.log(JSON.stringify(final, null, 2));
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
