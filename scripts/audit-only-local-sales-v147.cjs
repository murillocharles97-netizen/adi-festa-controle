'use strict';

// Somente leitura. Cruza o diagnóstico redigido, o backup do MESMO aparelho e
// documentos do Firestore. Não reenvia vendas nem altera saldos ou estoque.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const [diagnosticPath, backupPath] = process.argv.slice(2);
if (!diagnosticPath || !backupPath) {
  process.stderr.write('Uso: node scripts/audit-only-local-sales-v147.cjs <diagnostico.json> <backup-do-mesmo-aparelho.json>\n');
  process.exit(2);
}
const diagnostic = JSON.parse(fs.readFileSync(diagnosticPath, 'utf8'));
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const businessId = String(diagnostic.businessId || '');
const projectId = String(diagnostic.projectId || '');
if (!businessId || projectId !== 'adi-festa-controle' || backup.businessId !== businessId ||
  !Array.isArray(diagnostic.saleIntegrity?.onlyLocalAfterComparison) ||
  !Array.isArray(backup.vendas) || !Array.isArray(backup.clientes))
  throw Error('Diagnóstico/backup incompatíveis ou incompletos. Nenhuma consulta foi feita.');

const globalRoot = (process.platform === 'win32'
  ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm root -g'], { encoding: 'utf8' })
  : execFileSync('npm', ['root', '-g'], { encoding: 'utf8' })).trim();
const auth = createRequire(path.join(globalRoot, 'firebase-tools', 'package.json'))('./lib/auth');
let token;
async function accessToken() {
  if (token) return token;
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw Error('Firebase CLI não está autenticado.');
  token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
  return token;
}
function decode(field) {
  if (!field || 'nullValue' in field) return null;
  if ('stringValue' in field) return field.stringValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(decode);
  if ('mapValue' in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {})
    .map(([key, value]) => [key, decode(value)]));
  return null;
}
function decodeDoc(document) {
  return { id: String(document.name || '').split('/').at(-1),
    ...Object.fromEntries(Object.entries(document.fields || {})
      .map(([key, value]) => [key, decode(value)])) };
}
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
async function getDocument(collection, id) {
  const response = await fetch(`${base}/businesses/${encodeURIComponent(businessId)}/${collection}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`Firestore ${collection}/${id}: HTTP ${response.status}`);
  return decodeDoc(await response.json());
}
async function querySales(field, value) {
  const response = await fetch(`${base}/businesses/${encodeURIComponent(businessId)}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'sales' }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: String(value) } } },
      limit: 100,
    } }),
  });
  if (!response.ok) throw Error(`Firestore sales query ${field}: HTTP ${response.status}`);
  return (await response.json()).filter((row) => row.document).map((row) => decodeDoc(row.document));
}
const cents = (value) => Math.round(Number(value || 0) * 100);
const saleTime = (sale) => Date.parse(sale.data || sale.createdAt || '') || 0;
function itemSignature(sale) {
  return JSON.stringify((sale.itens || []).map((item) => [String(item.produtoId || item.productId || ''),
    Number(item.quantidade || 0), cents(item.precoFinalUnitario ?? item.precoUnitario)]).sort());
}
function listStockMovementIds(saleId) {
  return (backup.movimentacoesEstoque || []).filter((item) => String(item.vendaId) === saleId)
    .map((item) => String(item.id));
}
function validEffect(effect, sale, operationId) {
  return effect && String(effect.operationId || '') === operationId &&
    String(effect.sourceDocumentId || effect.saleId || '') === String(sale.id) &&
    String(effect.customerId || effect.clientId || '') === String(sale.clienteId) &&
    cents(effect.balanceDelta) === -cents(sale.valorFinal ?? sale.valorTotal);
}
async function auditSale(entry) {
  const saleId = String(entry.saleId || ''), operationId = String(entry.operationId || '');
  const local = backup.vendas.find((item) => String(item.id) === saleId) || null;
  if (!local) return { saleId, operationId, localExists: false, cloudExists: null,
    classification: 'E', recommendedAction: 'Revisar: venda não encontrada no backup fornecido' };
  const clientId = String(local.clienteId || local.customerId || '');
  const localClient = backup.clientes.find((item) => String(item.id) === clientId) || null;
  const [remoteSale, effect, marker, remoteClient, sameOperation, customerSales] = await Promise.all([
    getDocument('sales', saleId), getDocument('balanceEvents', `credit_sale:${saleId}`),
    operationId ? getDocument('processedOperations', operationId) : Promise.resolve(null),
    clientId ? getDocument('clients', clientId) : Promise.resolve(null),
    operationId ? querySales('operationId', operationId) : Promise.resolve([]),
    clientId ? querySales('clienteId', clientId) : Promise.resolve([]),
  ]);
  const duplicateOperationIds = sameOperation.filter((item) => String(item.id) !== saleId).map((item) => item.id);
  const nearDuplicates = customerSales.filter((item) => String(item.id) !== saleId &&
    cents(item.valorFinal ?? item.valorTotal) === cents(local.valorFinal ?? local.valorTotal) &&
    Math.abs(saleTime(item) - saleTime(local)) <= 120000 && itemSignature(item) === itemSignature(local))
    .map((item) => item.id);
  const stockMovementIds = listStockMovementIds(saleId);
  const stockIndependent = Array.isArray(local.itens) && local.itens.length > 0 &&
    local.itens.every((item) => {
      const product = (backup.produtos || []).find((entry) => String(entry.id) === String(item.produtoId || ''));
      return item.itemKind === 'service' || product?.itemKind === 'service' ||
        product?.semControleEstoque === true || product?.controlaEstoque === false;
    });
  const laterFinancialOperations = [...(backup.vendas || []), ...(backup.pagamentos || []),
    ...(backup.movimentacoes || []).filter((item) => item.tipo === 'ajuste_saldo')]
    .filter((item) => String(item.id) !== saleId &&
      String(item.clienteId || item.customerId || '') === clientId && saleTime(item) > saleTime(local));
  const credit = local.formaPagamento === 'fiado' || local.status === 'fiado';
  const effectValid = validEffect(effect, local, operationId);
  const before = Number(local.saldoAnterior), after = Number(local.saldoAtual);
  const amount = Number(local.valorFinal ?? local.valorTotal);
  const exactSnapshot = Number.isFinite(before) && Number.isFinite(after) && Number.isFinite(amount) &&
    cents(after) === cents(before - amount);
  const selfContained = stockMovementIds.length === 0 && stockIndependent &&
    laterFinancialOperations.length === 0 &&
    !(local.appliedCampaignIds || []).length && !(local.campaignUpdates || []).length &&
    !(local.subscriptionUpdates || []).length;
  const modern = Number(local.syncPipelineVersion || 0) >= 2;
  let classification = 'E', recommendedAction = 'Revisar manualmente; não alterar saldo';
  if (local.deletedAt || local.active === false) {
    classification = 'C'; recommendedAction = 'Revisar cancelamento/estorno';
  } else if (remoteSale) {
    classification = 'B'; recommendedAction = 'Já existe pelo mesmo saleId; revisar diagnóstico desatualizado';
  } else if (duplicateOperationIds.length) {
    classification = 'B'; recommendedAction = 'Já representada por outro saleId na nuvem; não reenviar';
  } else if (nearDuplicates.length) {
    classification = 'D'; recommendedAction = 'Possível duplicata remota; revisar comprovantes';
  } else if (effect && !effectValid) {
    recommendedAction = 'Evento financeiro incompatível; revisão técnica obrigatória';
  } else if (effectValid && selfContained && exactSnapshot) {
    classification = 'A'; recommendedAction = 'Candidata a recuperar apenas documento, sem novo débito';
  } else if (!effect && !marker && credit && modern && selfContained && exactSnapshot && remoteClient &&
    cents(remoteClient.saldo) === cents(before) &&
    Number(remoteClient.financialVersion || 0) === Number(local.financialVersionAnterior || 0)) {
    classification = 'A'; recommendedAction = 'Candidata a recuperar documento e efeito em transação';
  } else if (!effect && !credit && modern && selfContained && !marker) {
    classification = 'A'; recommendedAction = 'Candidata a recuperar venda sem efeito financeiro';
  }
  return { saleId, operationId, customerId: clientId, customer: localClient?.nome || local.clienteNome || '',
    date: local.data || local.createdAt || null, amount, paymentMethod: local.formaPagamento || local.status || '',
    items: (local.itens || []).map((item) => ({ productId: item.produtoId || item.productId || '',
      name: item.nome || '', quantity: Number(item.quantidade || 0), unitPrice: Number(item.precoFinalUnitario || 0) })),
    businessId: local.businessId || businessId, spaceId: local.spaceId || '',
    createdAt: local.createdAt || null, updatedAt: local.updatedAt || local.atualizadoEm || null,
    saldoAnterior: Number.isFinite(before) ? before : null,
    saldoAtual: Number.isFinite(after) ? after : null,
    financialVersionAnterior: local.financialVersionAnterior ?? null,
    localCurrentBalance: localClient?.saldo ?? null, remoteCurrentBalance: remoteClient?.saldo ?? null,
    remoteFinancialVersion: remoteClient?.financialVersion ?? null,
    localExists: true, cloudExists: Boolean(remoteSale), financialEffectExists: Boolean(effect),
    financialEffectMatches: Boolean(effectValid), processedMarkerExists: Boolean(marker),
    remoteSaleWithSameOperation: duplicateOperationIds, possibleDuplicateSales: nearDuplicates,
    localStockMovementIds: stockMovementIds,
    laterFinancialOperationIds: laterFinancialOperations.map((item) => String(item.id)),
    localSyncConfirmedAt: local.syncConfirmedAt || null,
    localFinancialAppliedAt: local.financialAppliedAt || null,
    classification, recommendedAction };
}

async function main() {
  const entries = diagnostic.saleIntegrity.onlyLocalAfterComparison;
  const rows = [];
  for (const entry of entries) rows.push(await auditSale(entry));
  process.stdout.write(`${JSON.stringify({ mode: 'read-only', generatedAt: new Date().toISOString(),
    diagnosticGeneratedAt: diagnostic.generatedAt, backupExportedAt: backup.exportedAt,
    businessId, deviceId: diagnostic.deviceId, count: rows.length, sales: rows }, null, 2)}\n`);
}
main().catch((error) => { console.error(`[only-local-audit] ${error.message}`); process.exitCode = 1; });
