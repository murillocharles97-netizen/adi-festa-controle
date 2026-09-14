(() => {
  "use strict";

  const ID = "appIntro";
  const VERSION = 1;
  const key = (uid) => `veconi:tutorialVersions:${uid}`;
  let syncing = false;
  let localFallback = new Map();
  let pendingAuto = false;

  function read(uid) {
    if (!uid) return 0;
    try {
      const stored = JSON.parse(localStorage.getItem(key(uid)) || "{}");
      return Math.max(0, Number(stored?.[ID]) || 0);
    } catch { return localFallback.get(uid) || 0; }
  }
  function write(uid, version) {
    if (!uid) return;
    const value = Math.max(read(uid), version);
    localFallback.set(uid, value);
    try { localStorage.setItem(key(uid), JSON.stringify({ [ID]: value })); } catch { /* memória mantém a sessão funcional */ }
  }
  function remoteVersion(session) {
    return Math.max(0, Number(session?.profile?.tutorialVersions?.[ID]) || 0);
  }
  function reconcile(session) {
    const uid = session?.user?.uid;
    if (!uid) return 0;
    const version = Math.max(read(uid), remoteVersion(session));
    write(uid, version);
    return version;
  }
  function eligible(session) {
    if (!session?.user?.uid || !session.profile) return false;
    return reconcile(session) < VERSION;
  }
  async function sync() {
    const session = window.FirebaseSession;
    const uid = session?.user?.uid;
    if (!uid || !navigator.onLine || syncing || read(uid) <= remoteVersion(session)) return;
    const action = window.FirebaseAuthActions?.updateTutorialVersion;
    if (!action) return;
    syncing = true;
    try { await action(ID, read(uid)); }
    catch (error) { console.warn("[Tutorial] Preferência será sincronizada depois.", error?.code || error?.message); }
    finally { syncing = false; }
  }
  function mark() {
    const uid = window.FirebaseSession?.user?.uid;
    if (!uid) return;
    pendingAuto = false;
    write(uid, VERSION);
    void sync();
  }

  window.VeconiTutorialManager.register({
    id: ID,
    version: VERSION,
    steps: [
      { id: "welcome", kind: "welcome", title: "Bem-vindo à VECONI 👋", description: "Gerencie vendas, clientes, estoque, financeiro e relacionamento em um só lugar.", note: "Leva menos de 1 minuto para conhecer o básico." },
      { id: "main-menu", target: () => matchMedia("(max-width: 767px)").matches ? ["main-menu", "sidebar-navigation"] : ["sidebar-navigation", "main-menu"], position: "bottom", title: "Tudo começa por aqui", description: "Use o menu para acessar áreas como Financeiro, CRM, vendas online, histórico, configurações e outros recursos da VECONI." },
      { id: "daily-navigation", target: "bottom-navigation", position: "top", title: "Seu dia a dia fica aqui", description: "Acesse rapidamente Início, Vender, Novo cliente, Clientes e Produtos." },
      { id: "module-guides", title: "Aprenda conforme usa", description: "Na primeira vez que você entrar em algumas áreas, a VECONI poderá mostrar um guia rápido daquele módulo.", note: "Você poderá pular ou rever os tutoriais quando quiser." },
      { id: "complete", kind: "complete", title: "Tudo pronto ✨", description: "Explore a VECONI no seu ritmo." },
    ],
    onComplete: mark,
    onSkip: mark,
  });

  function open({ manual = false } = {}) {
    const session = window.FirebaseSession;
    if (!session?.user?.uid || !document.querySelector("#auth-gate")?.hidden || !document.querySelector("#app")?.children.length || document.querySelector(".operation-flow")) return false;
    if (!manual && !eligible(session)) return false;
    return window.VeconiTutorialManager.open(ID, { manual });
  }
  function tryAutoOpen() {
    if (!pendingAuto) return;
    if (!eligible(window.FirebaseSession)) { pendingAuto = false; return; }
    if (window.OperationMode?.get?.().operationOnboardingCompleted === false) return;
    if (document.querySelector("#modal")?.children.length || document.querySelector(".operation-flow")) return;
    if (open()) pendingAuto = false;
  }
  function scheduleAuto() { if (pendingAuto) setTimeout(tryAutoOpen, 120); }
  addEventListener("firebase-ui-mounted", () => {
    const session = window.FirebaseSession;
    if (!session?.user?.uid) return;
    reconcile(session);
    void sync();
    pendingAuto = eligible(session);
    scheduleAuto();
  });
  addEventListener("operation-settings-changed", scheduleAuto);
  addEventListener("hashchange", scheduleAuto);
  addEventListener("online", () => { void sync(); });
  addEventListener("firebase-session-cleared", () => {
    window.VeconiTutorialManager.close("abandoned");
    pendingAuto = false;
  });

  window.VeconiAppIntro = Object.freeze({ open, eligible, version: VERSION, getStoredVersion: read, sync });
})();
