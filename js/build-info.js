(() => {
  "use strict";

  const readMeta = (name) =>
      document.querySelector(`meta[name="${name}"]`)?.content?.trim() || "",
    rawCommit = readMeta("adi-festa-build"),
    rawTime = readMeta("adi-festa-build-time"),
    validCommit = /^[0-9a-f]{7,40}$/i.test(rawCommit),
    validTime = rawTime && !rawTime.includes("{{") && !Number.isNaN(Date.parse(rawTime)),
    commit = validCommit ? rawCommit : "local",
    shortCommit = validCommit ? rawCommit.slice(0, 7) : "local",
    builtAt = validTime ? rawTime : new Date(document.lastModified).toISOString();

  // Fase 2 — three distinct versions:
  // - appVersion: the real release shown to people and support ("233.2").
  // - release: its integer major, sent as clientRelease (the server contract gates
  //   on >=202 / >=227). It must equal the major of appVersion (enforced by test).
  // - syncProtocolVersion / operation format: owned by sync.js (protocol 1,
  //   payloadVersion 4, schemaVersion 3) and never changed retroactively.
  // Bump APP_VERSION (and the service-worker CACHE/GET_VERSION) in every release;
  // tests/sync-version-identity.test.js fails when they disagree.
  const APP_VERSION = "242.14.1";
  window.AdiFestaBuild = Object.freeze({
    commit,
    shortCommit,
    builtAt,
    appVersion: APP_VERSION,
    release: "242", // = APP_VERSION major; literal kept for existing release checks
    installmentCreationPaused: false,
    hotfix: "conta-por-espaco-v24213",
    billingCheckoutPaused: false,
    priorSalesPaused: false,
    performanceViewsPaused: false,
    receiptCreationPaused: false,
    receiptSharingPaused: false,
    receiptSyncHintsPaused: false,
    syncResolvedStatusPaused: false,
    monetaryAnalysisIntakePaused: false,
    monetaryRecoveryReady: true,
    permissionsV2EditingPaused: false,
  });

  if (!window.__adiFestaBuildLogged) {
    window.__adiFestaBuildLogged = true;
    console.info(`[VECONI] Build ${shortCommit} carregado`);
  }
})();
