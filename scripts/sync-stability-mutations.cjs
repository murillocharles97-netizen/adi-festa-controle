#!/usr/bin/env node
'use strict';
// Proves the Fase 1/2 tests detect real defects: each mutation is applied to a
// source file, the tests run, and the file is restored. Every mutation MUST fail.
// Usage: node scripts/sync-stability-mutations.cjs
const fs = require('fs'), { spawnSync } = require('child_process');
const TESTS = ['tests/sync-rejection-reasons.test.js', 'tests/sync-version-identity.test.js', 'tests/sync-d3-recovery.test.cjs', 'tests/sync-automatic-recovery.test.cjs'];
const MUTATIONS = [
  ['M1 servidor não envia motivo', 'functions/src/services/operational-commit-service.js', 'throw new HttpsError(code,message,Rejection.details(message,code));', 'throw new HttpsError(code,message);'],
  ['M2 servidor muda o código padrão (quebra PWAs antigos)', 'functions/src/services/operational-commit-service.js', "const fail=(message,code='permission-denied')=>", "const fail=(message,code='failed-precondition')=>"],
  ['M3 cliente ignora o motivo e volta a decidir pelo texto', 'functions/src/shared/sync-rejection.js', "    if (item?.lastErrorReason && item.lastErrorReason !== 'unclassified') return item.lastErrorReason === reason;\n", ''],
  ['M4 cliente esquece pacotes antigos sem motivo', 'functions/src/shared/sync-rejection.js', 'return legacyMessage !== undefined && item?.lastErrorMessage === legacyMessage;', 'return false;'],
  ['M5 cliente não grava o motivo da recusa do servidor', 'js/firebase/sync.js', 'message: error?.message, details: error?.details})', 'message: error?.message})'],
  ['M6 permission-denied volta a significar "sem permissão"', 'functions/src/shared/sync-rejection.js', "    'permission-required': P,", "    'permission-required': P, 'permission-denied': P,"],
  ['M7 recusa sem motivo na tabela', 'functions/src/shared/sync-rejection.js', "    ['Alias de estoque divergente.', 'stock_alias_mismatch', S],\n", ''],
  ['M8 motivo duplicado', 'functions/src/shared/sync-rejection.js', "'stock_alias_mismatch', S]", "'stock_delta_mismatch', S]"],
  ['M9 versão fixa e desatualizada', 'js/build-info.js', 'release: "235",', 'release: "229",'],
  ['M10 Service Worker com outra versão', 'service-worker.js', "release: '235', appVersion: '235'", "release: '229', appVersion: '235'"],
  ['M11 pacote antigo regravado com a versão atual', 'js/firebase/sync.js', '            lastErrorReason: undefined, lastErrorCategory: undefined, lastErrorReasonSource: undefined,\n            ...globalThis.VeconiSyncRejection?.queueFields?.({code: errorCode(error)', '            createdByAppVersion: String(window.AdiFestaBuild?.appVersion||""),\n            lastErrorReason: undefined, lastErrorCategory: undefined, lastErrorReasonSource: undefined,\n            ...globalThis.VeconiSyncRejection?.queueFields?.({code: errorCode(error)'],
  ['M12 app mostra a versão inteira antiga', 'js/mobile-navigation.js', 'window.AdiFestaBuild?.appVersion || window.AdiFestaBuild?.release', 'window.AdiFestaBuild?.release'],
  ['M14 app sem o módulo deixa de reconhecer pacotes antigos', 'js/firebase/sync.js', "??item.lastErrorMessage==='Estoque sem movimento autorizado.')", '??false)'],
  ['M13 módulo fora do build público', 'scripts/build-public-site.cjs', ", 'sync-rejection.js']", ']'],
  ["D1 internal sem resposta volta a ser erro definitivo", "js/firebase/sync.js", "const unknownOutcomeSyncCodes = new Set(['internal','unknown','cancelled']);", "const unknownOutcomeSyncCodes = new Set([]);"],
  ["D2 internal com motivo tipado tratado como desconhecido", "js/firebase/sync.js", "  !(error?.details && typeof error.details === 'object' && typeof error.details.reason === 'string');", "  true;"],
  ["D3 servidor inacessível consome o limite de envios", "js/firebase/sync.js", "(serverUnreachable ? 0 : 1)", "1"],
  ["D4 pacote requalificado reenviado sem conferir o recibo", "js/firebase/sync.js", "reopened[at]={...reopened[at],status:'pending',syncConfirmationPending:true,", "reopened[at]={...reopened[at],status:'pending',attempts:0,"],
  ["D5 passagem não para quando o servidor está inacessível", "js/firebase/sync.js", "          serverUnreachable ||\n", "          false ||\n"],
  ["D6 espera sem teto de 5 minutos", "js/firebase/sync.js", "const CONNECTION_WAIT_DELAYS = [15000, 30000, 60000, 120000, 300000];", "const CONNECTION_WAIT_DELAYS = [15000, 30000, 60000, 120000, 300000, 900000, 3600000];"],
  ["D7 retorno da conexão não antecipa a retomada", "js/firebase/sync.js", "if (!waits || Date.parse(item.lastAttemptAt) <= connectionRestoredAt) return base;", "if (!waits) return base;"],
  ["D8 sincronização automática desiste após 5 tentativas com fila", "js/firebase/sync.js", "(syncConnectionAttempts<5||queuedWork())", "syncConnectionAttempts<5"],
  ["D9 pacotes antigos do D3 não são requalificados", "js/firebase/sync.js", "if(state.operationalProtocol?.queueRecoveryVersion===1&&untypedUnknownFailure(queued)&&", "if(false&&untypedUnknownFailure(queued)&&"],
];
let undetected = 0;
for (const [name, file, from, to] of MUTATIONS) {
  const original = fs.readFileSync(file, 'utf8'), CR = original.includes('\r\n'), lf = original.replace(/\r\n/g, '\n');
  if (lf.split(from).length !== 2) { console.log(`?? ${name}: âncora não encontrada`); undetected++; continue; }
  const mutated = lf.replace(from, () => to);
  fs.writeFileSync(file, CR ? mutated.replace(/\n/g, '\r\n') : mutated);
  try {
    const run = spawnSync(process.execPath, ['--test', ...TESTS], { encoding: 'utf8' });
    const detected = run.status !== 0;
    if (!detected) undetected++;
    console.log(`${detected ? 'detectada ' : 'NÃO DETECTADA'}  ${name}`);
  } finally { fs.writeFileSync(file, original); }
}
console.log(undetected ? `${undetected} mutação(ões) sem detecção` : `Todas as ${MUTATIONS.length} mutações foram detectadas.`);
process.exitCode = undetected ? 1 : 0;
