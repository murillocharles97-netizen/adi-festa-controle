(function (root) {
  'use strict';
  // Read-only classification of what the Sync comparison found. It never writes,
  // repairs or hides anything: every raw difference becomes exactly one finding
  // with a plain-language reason. Only "attention" findings count as unexplained
  // differences; "explained" ones stay listed with the evidence that explains them.
  const KINDS = Object.freeze(['attention', 'blocked', 'recoverable', 'pending', 'explained']);
  const ENTITY_LABELS = Object.freeze({
    sales: 'Vendas', payments: 'Recebimentos', balanceAdjustments: 'Ajustes de saldo', clients: 'Clientes',
    products: 'Produtos', productVariants: 'Variações', saleFinancials: 'Custos de vendas',
    productFinancials: 'Custos de produtos', variantFinancials: 'Custos de variações',
    stockMovementFinancials: 'Custos de estoque', stockMovements: 'Movimentações de estoque', transaction: 'Operações',
  });
  const FINANCIAL = new Set(['sales', 'payments', 'balanceAdjustments']);
  const REASONS = Object.freeze({
    inactive_not_kept: {kind: 'explained', title: 'Cadastro inativo que só existe na nuvem', text: 'O aparelho guarda apenas cadastros ativos. Não há nada a corrigir.'},
    qa_residue: {kind: 'explained', title: 'Registro de teste antigo', text: 'Foi criado por testes de versões anteriores dentro da empresa. Não altera saldos; removê-lo exige autorização específica.'},
    legacy_without_space: {kind: 'explained', title: 'Venda antiga, de antes dos Espaços', text: 'Fica só na nuvem porque não pertence a nenhum Espaço e não entra nos saldos atuais.'},
    legacy_fixture: {kind: 'explained', title: 'Registro histórico conferido', text: 'Já foi identificado como dado de versão anterior.'},
    resolved: {kind: 'explained', title: 'Operação antiga já resolvida', text: 'Existe uma decisão registrada no servidor; ela não será reenviada.'},
    queued: {kind: 'pending', title: 'Aguardando envio', text: 'Está salvo neste aparelho e será enviado na próxima sincronização.'},
    processing: {kind: 'pending', title: 'Enviando agora', text: 'A VECONI está enviando esta operação. Espere terminar.'},
    awaiting_receipt: {kind: 'pending', title: 'Aguardando confirmação do servidor', text: 'Já foi enviada. A VECONI confere o recibo antes de considerar sincronizada.'},
    local_change_waiting: {kind: 'pending', title: 'Alteração deste aparelho aguardando envio', text: 'A diferença desaparece quando o envio for confirmado.'},
    retry_temporary: {kind: 'recoverable', action: 'retry', title: 'Falha temporária de envio', text: 'Pode ser reenviada com segurança: o servidor confere o recibo e não aplica a mesma operação duas vezes.'},
    receipt_check: {kind: 'recoverable', action: 'check_receipt', title: 'Confirmação do servidor não recebida', text: 'A VECONI pode consultar o recibo no servidor. A consulta não reenvia nem altera nada.'},
    recover_sale: {kind: 'recoverable', action: 'recover_sale', title: 'Venda só neste aparelho, recuperável', text: 'O servidor revalida cliente, saldo e itens antes de registrar, com o mesmo identificador. Uma segunda tentativa não duplica a venda.'},
    recover_local: {kind: 'recoverable', action: 'recover_local', title: 'Cadastro só neste aparelho', text: 'Pode ser publicado com o mesmo identificador; nada é duplicado.'},
    client_retained: {kind: 'blocked', action: 'open_blocked', title: 'Saldo retido por operação bloqueada', text: 'O aparelho mantém o saldo antigo deste cliente até a operação bloqueada ser decidida. Não registre outro ajuste para compensar.'},
    service_configuration_missing: {kind: 'blocked', action: 'open_sale', title: 'Serviço recusado: configuração original ausente', text: 'A nuvem recusou porque a configuração de custo do serviço ainda não existia lá. O original está guardado neste aparelho e não será reenviado nem recalculado. Escolha recuperar, conciliar sem efeitos ou manter para análise.'},
    monetary_recovery_required: {kind: 'blocked', action: 'open_sale', title: 'Total da venda diferente dos itens', text: 'A nuvem recusou porque o total não confere com os itens. O original está guardado para revisão.'},
    product_stock_review_required: {kind: 'blocked', action: 'open_blocked', title: 'Ajuste de estoque sem movimento autorizado', text: 'Confirme o estoque atual do produto para encerrar sem efeitos.'},
    payment_financial_dependency: {kind: 'blocked', action: 'open_blocked', title: 'Recebimento aguardando outra operação', text: 'Será liberado quando a operação de que depende for decidida.'},
    permission_review: {kind: 'blocked', action: 'export_recovery', title: 'Recusada por permissão', text: 'Precisa de revisão supervisionada. O arquivo de recuperação preserva o original sem reenviar.'},
    manual_review: {kind: 'blocked', action: 'open_blocked', title: 'Operação em revisão manual', text: 'Não será reenviada automaticamente. Confira os detalhes técnicos.'},
    rejected: {kind: 'blocked', action: 'open_blocked', title: 'Recusada pela nuvem', text: 'A nuvem recusou esta operação. Ela está preservada e bloqueada para reenvio.'},
    cloud_only: {kind: 'attention', action: 'refresh', title: 'Existe na nuvem e não neste aparelho', text: 'Atualize os dados da nuvem. Se continuar, exporte o relatório de divergências.'},
    inactive_client_balance: {kind: 'attention', title: 'Cliente inativo com saldo na nuvem', text: 'O cadastro está inativo, mas a nuvem registra saldo. Reative o cliente para cobrar ou regularize o saldo no Espaço correto.'},
    divergent: {kind: 'attention', title: 'Dados diferentes entre aparelho e nuvem', text: 'Nenhum envio pendente explica a diferença. Atualize da nuvem; se continuar, exporte o relatório.'},
    local_only_unqueued: {kind: 'attention', action: 'open_sale', title: 'Só neste aparelho, sem operação de envio', text: 'Não existe envio pendente que explique o registro. Revise individualmente; nada será enviado automaticamente.'},
    balance_total: {kind: 'attention', title: 'Total de saldos diferente', text: 'A soma dos saldos do aparelho difere da nuvem sem um cliente retido que explique. Compare de novo depois de atualizar.'},
  });
  const QA_ID = /^qa[-_]/i;
  const str = value => String(value ?? '');
  const money = value => Math.round(Number(value || 0) * 100) / 100;
  const reasonOf = key => REASONS[key] || REASONS.rejected;

  function blockedReason(row) {
    const reason = str(row.reviewReason);
    if (REASONS[reason]) return reason;
    if (reason === 'sync_receipt_review_required') return 'receipt_check';
    if (['sale-recovery-review-required', 'sale_recovery_review_required'].includes(reason) || row.errorCode === 'permission-denied' || row.rejectionCategory === 'permission') return 'permission_review';
    if (['manual_review', 'quarantined'].includes(row.category)) return 'manual_review';
    return 'rejected';
  }
  // Queue row (from getQueueDiagnostics) -> reason key, or null when it is history.
  function queueReason(row) {
    switch (row.category) {
      case 'resolved': case 'archived': return null;
      case 'processing': case 'preparing': return 'processing';
      case 'pending': return row.syncConfirmationPending || row.awaitingReceipt ? 'awaiting_receipt' : 'queued';
      case 'error': return row.canRetry === true && !row.replayBlocked ? 'retry_temporary' : blockedReason(row);
      case 'manual_review': case 'quarantined': return blockedReason(row);
      default: return row.activeError ? blockedReason(row) : 'queued';
    }
  }
  function saleReportReason(row) {
    if (!row) return null;
    if (row.resolved) return 'resolved';
    if (row.classification === 'A' && row.recoveryMode) return 'recover_sale';
    return null;
  }
  function build(input = {}) {
    const audit = input.audit || null, queue = Array.isArray(input.queue) ? input.queue : [],
      retained = Array.isArray(input.retained) ? input.retained : [],
      saleReport = new Map((Array.isArray(input.saleReport) ? input.saleReport : []).map(row => [str(row.saleId), row])),
      remote = typeof input.remoteById === 'function' ? input.remoteById : () => null,
      findings = [], seen = new Set(), queueByOp = new Map(queue.map(row => [str(row.operationId), row]));
    const add = (reason, fields) => {
      const base = reasonOf(reason), key = fields.key || `${reason}:${fields.entity || ''}:${fields.documentId || fields.operationId || findings.length}`;
      if (seen.has(key)) return; seen.add(key);
      findings.push({key, reason, kind: base.kind, action: base.action || null, title: base.title, text: base.text,
        entity: fields.entity || '', entityLabel: ENTITY_LABELS[fields.entity] || fields.entity || '', documentId: str(fields.documentId),
        operationId: str(fields.operationId), ...fields.extra});
    };
    const linkedOps = new Set();
    for (const [entity, item] of Object.entries(audit?.collections || {})) {
      for (const row of item.onlyLocal || []) {
        const sale = entity === 'sales' ? saleReport.get(str(row.documentId)) : null, fromSale = saleReportReason(sale);
        if (row.category === 'confirmed_legacy_fixture') { add('legacy_fixture', {entity, documentId: row.documentId, operationId: row.operationId}); continue; }
        if (row.classification === 'A' || row.classification === 'C') {
          const queued = queueByOp.get(str(row.queueOperationId)), reason = fromSale === 'resolved' ? 'resolved' : queued ? (queueReason(queued) || 'resolved') : 'queued';
          if (queued) linkedOps.add(str(queued.operationId));
          // A blocked original stays blocked even when the sale report says it could be
          // recovered: recovering is the owner's decision, offered on that row only.
          add(reason, {key: `op:${row.queueOperationId || row.documentId}`, entity, documentId: row.documentId, operationId: row.queueOperationId || row.operationId,
            extra: {recoveryMode: sale?.recoveryMode || '', amount: sale ? money(sale.amount) : null, customerId: sale?.customerId || '', saleClassification: sale?.classification || '', reasonDetail: sale?.reason || '', createdAt: queued?.createdAt || sale?.date || row.createdAt || ''}});
          continue;
        }
        if (fromSale) { add(fromSale, {entity, documentId: row.documentId, operationId: row.operationId, extra: {recoveryMode: sale.recoveryMode || '', amount: money(sale.amount), customerId: sale.customerId || '', reasonDetail: sale.reason || ''}}); continue; }
        add(FINANCIAL.has(entity) ? 'local_only_unqueued' : 'recover_local', {entity, documentId: row.documentId, operationId: row.operationId});
      }
      for (const row of item.onlyRemote || []) {
        const raw = remote(entity, row.documentId) || {}, inactive = row.active === false || raw.active === false || raw.ativo === false || row.deleted;
        if (QA_ID.test(str(row.documentId))) add('qa_residue', {entity, documentId: row.documentId});
        else if (entity === 'clients' && inactive && money(raw.saldo) !== 0) add('inactive_client_balance', {entity, documentId: row.documentId, extra: {cloudBalance: money(raw.saldo)}});
        else if (inactive) add('inactive_not_kept', {entity, documentId: row.documentId});
        else if (FINANCIAL.has(entity) && raw && Object.keys(raw).length && !raw.spaceId && !raw.financialSpaceId) add('legacy_without_space', {entity, documentId: row.documentId, extra: {createdAt: row.createdAt || ''}});
        else add('cloud_only', {entity, documentId: row.documentId, operationId: row.operationId});
      }
      for (const row of item.divergent || []) {
        const id = str(row.documentId), held = entity === 'clients' && retained.some(r => str(r.clientId) === id && r.blockedOnly);
        add(row.hasPendingLocal ? 'local_change_waiting' : held ? 'client_retained' : 'divergent', {entity, documentId: id, operationId: row.operationId, extra: {fields: (row.fields || []).slice(0, 8)}});
      }
    }
    for (const row of retained) if (row.blockedOnly && row.difference) add('client_retained', {entity: 'clients', documentId: row.clientId, extra: {localBalance: row.localBalance, cloudBalance: row.cloudBalance, difference: row.difference, operations: (row.operations || []).map(op => str(op.operationId || op))}});
    for (const row of queue) {
      if (linkedOps.has(str(row.operationId))) continue;
      const reason = queueReason(row); if (!reason) continue;
      add(reason, {key: `op:${row.operationId}`, entity: row.collection || row.entityType, documentId: row.documentId, operationId: row.operationId, extra: {createdAt: row.createdAt || '', errorCode: row.errorCode || ''}});
    }
    const balance = audit?.financial?.balanceScope;
    if (balance && balance.operationalMatches === false && !retained.some(r => r.blockedOnly && r.difference)) add('balance_total', {key: 'balance_total', entity: 'clients'});
    findings.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.entity.localeCompare(b.entity) || a.documentId.localeCompare(b.documentId));
    const counts = Object.fromEntries(KINDS.map(kind => [kind, findings.filter(f => f.kind === kind).length])),
      byReason = findings.reduce((acc, f) => (acc[f.reason] = (acc[f.reason] || 0) + 1, acc), {}),
      synced = Object.entries(audit?.collections || {}).map(([entity, item]) => ({entity, label: ENTITY_LABELS[entity] || entity, equal: (item.equal || []).length, local: item.localTotal ?? null, remote: item.remoteTotal ?? null}));
    return {schema: 1, comparedAt: audit?.generatedAt || '', compared: Boolean(audit), findings, counts, byReason, synced};
  }
  // Groups for display: same reason + entity together, with the rows kept.
  function groups(result) {
    const map = new Map();
    for (const f of result?.findings || []) {
      const k = `${f.kind}|${f.reason}|${f.entity}`;
      if (!map.has(k)) map.set(k, {kind: f.kind, reason: f.reason, entity: f.entity, entityLabel: f.entityLabel, title: f.title, text: f.text, action: f.action, rows: []});
      map.get(k).rows.push(f);
    }
    return [...map.values()];
  }
  // Support copies never carry personal data, credentials or tokens; identifiers stay.
  const PII_KEYS = /^(nome|name|clienteNome|clientName|nomeCliente|customer|customerName|apelido|nomeNormalizado|telefone|telefone2|phone|whatsapp|normalizedPhone|telefoneNormalizado|email|endereco|address|complemento|cidade|estado|cep|cpf|cnpj|documento|observacoes|observacao|notes|instagram|aniversario|birthday|portalRefToken|token|accessToken|refreshToken|idToken|apiKey|secret|password|senha|authorization|cookie|actorNameSnapshot|sellerNameSnapshot|produtoNome|variantName)$/i;
  function redact(value, depth = 0) {
    if (depth > 40) return '[profundidade]';
    if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = PII_KEYS.test(k) ? (v === null || v === undefined || v === '' ? v : '[removido]') : redact(v, depth + 1);
      return out;
    }
    if (typeof value === 'string') return value
      .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[token]')
      .replace(/AIza[\w-]{30,}/g, '[chave]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
      .replace(/(?<![\w-])\+?\d[\d ()-]{9,}\d(?![\w-])/g, '[telefone]');
    return value;
  }
  function summaryText(result, meta = {}) {
    const c = result?.counts || {}, lines = [
      `VECONI ${meta.appVersion || ''} · diagnóstico resumido`.trim(),
      `Empresa: ${meta.businessId || '—'} · gerado em ${meta.generatedAt || new Date().toISOString()}`,
      `Estado: ${meta.stateTitle || '—'}`,
      `Última sincronização confirmada pelo servidor: ${meta.lastServerConfirmation || 'não registrada neste aparelho'}`,
      `Comparação com a nuvem: ${result?.compared ? result.comparedAt : 'não feita nesta sessão'}`,
      `Exigem atenção: ${c.attention || 0} · Bloqueadas: ${c.blocked || 0} · Recuperáveis: ${c.recoverable || 0} · Aguardando envio: ${c.pending || 0} · Explicadas: ${c.explained || 0}`,
    ];
    for (const g of groups(result)) lines.push(`- [${g.kind}] ${g.title} (${g.entityLabel || 'geral'}): ${g.rows.length}`);
    return redact(lines.join('\n'));
  }
  function divergenceReport(result, meta = {}) {
    return redact({kind: 'veconi-sync-divergences', schema: 1, generatedAt: meta.generatedAt || new Date().toISOString(), appVersion: meta.appVersion || '', businessId: meta.businessId || '',
      lastServerConfirmation: meta.lastServerConfirmation || '', comparedAt: result?.comparedAt || '', counts: result?.counts || {}, byReason: result?.byReason || {},
      findings: (result?.findings || []).map(f => ({kind: f.kind, reason: f.reason, entity: f.entity, documentId: f.documentId, operationId: f.operationId, action: f.action,
        amount: f.amount ?? null, localBalance: f.localBalance ?? null, cloudBalance: f.cloudBalance ?? null, difference: f.difference ?? null, recoveryMode: f.recoveryMode || '', errorCode: f.errorCode || ''}))});
  }
  const api = Object.freeze({KINDS, REASONS, ENTITY_LABELS, build, groups, queueReason, redact, summaryText, divergenceReport});
  root.SyncFindings = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
