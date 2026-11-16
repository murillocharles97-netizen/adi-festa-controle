// Stable rejection reasons for operational Sync (Fase 1 — identificação correta dos erros).
// Shared verbatim by Cloud Functions (require) and the PWA (window.VeconiSyncRejection).
//
// Compatibility contract:
// - The server keeps the SAME HttpsError code and the SAME message it always sent,
//   so PWAs that still classify by code/text behave exactly as before.
// - It only ADDS `details: {reason, category, rejectionSchema}`; old clients ignore it.
// - New clients decide by `reason`; text is used only for packets rejected before
//   the server sent reasons (source: 'legacy_message'), never for new decisions.
// - Reasons are permanent identifiers: never rename or reuse one. Add new ones.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VeconiSyncRejection = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const SCHEMA = 1;
  // Category = what kind of problem it is (drives explanation and recovery).
  const CATEGORIES = Object.freeze({
    authentication: 'Sessão expirada ou ausente',
    permission: 'Falta de permissão',
    stock_conflict: 'Conflito de estoque',
    data_conflict: 'Inconsistência de dados',
    malformed: 'Pacote inválido',
    version: 'Versão incompatível',
    review_required: 'Revisão obrigatória',
    workspace: 'Empresa, espaço ou geração',
    duplicate: 'Operação repetida',
    feature_disabled: 'Recurso pausado ou fora do plano',
    connection: 'Falha de conexão',
    dependency_pending: 'Dependência pendente',
    local: 'Verificação local do aparelho',
    unclassified: 'Não classificado',
  });
  const P = 'permission', S = 'stock_conflict', D = 'data_conflict', M = 'malformed', V = 'version',
    R = 'review_required', W = 'workspace', U = 'duplicate', F = 'feature_disabled', A = 'authentication';
  // [exact server message, reason, category]. Messages are matched only to label
  // packets; they never change codes, texts or decisions on the server.
  const MESSAGES = [
    ['Entre na sua conta.', 'auth_required', A],
    // Real authorization failures.
    ['Origem da operação não autorizada.', 'operation_origin_mismatch', P],
    ['Sem permissão para editar produto.', 'products_edit_required', P],
    ['Sem autorização para revisar este recebimento.', 'payment_review_permission_required', P],
    ['Sem acesso operacional.', 'operational_access_required', P],
    ['Sem acesso ao comprovante do recebimento.', 'payment_receipt_access_required', P],
    ['Permissão financeira operacional ausente.', 'finance_permission_required', P],
    ['Permissão de venda/cancelamento ausente.', 'sales_permission_required', P],
    ['Espaço não autorizado.', 'space_not_authorized', P],
    ['Produto fora dos espaços autorizados.', 'product_space_not_authorized', P],
    ['Nenhum espaço autorizado para este produto.', 'product_without_authorized_space', P],
    ['Não é permitido ampliar o vínculo do produto para espaços não autorizados.', 'product_space_widening_denied', P],
    ['Ajuste de estoque não autorizado.', 'inventory_adjust_required', P],
    ['Autoria de um evento novo deve corresponder à sessão autenticada.', 'event_author_mismatch', P],
    ['Autoria original deve ser preservada.', 'original_author_rewrite', P],
    ['Comprovante fora da sessão autorizada.', 'receipt_outside_session', P],
    ['A confirmação do saldo é exclusiva da Central.', 'balance_confirmation_central_only', P],
    ['Você não tem permissão para realizar esta ação. Solicite ao gestor que habilite esta função em Equipe → Permissões.', 'customer_permission_required', P],
    // Workspace / business / generation / plan.
    ['Vínculo empresarial obrigatório.', 'business_membership_required', W],
    ['Vínculo de espaço inválido.', 'space_link_invalid', W],
    ['Vínculo ativo obrigatório.', 'active_membership_required', W],
    ['Plano ou geração sem acesso de escrita.', 'workspace_not_writable', W],
    ['Produto de outra empresa/geração.', 'product_other_workspace', W],
    ['Produto de outro espaço ou com vínculo ambíguo.', 'product_space_ambiguous', W],
    ['Documento de outra empresa/geração.', 'document_other_workspace', W],
    ['Gravação fora da empresa.', 'write_outside_business', W],
    ['Leitura fora da empresa.', 'read_outside_business', W],
    ['Destino de outra empresa.', 'target_other_business', W],
    ['Vendas não habilitadas neste espaço.', 'space_sales_disabled', W],
    ['Estoque não habilitado neste espaço.', 'space_inventory_disabled', W],
    ['Origem inicial sem estoque/produtos habilitados.', 'initial_stock_space_disabled', W],
    ['Recurso não incluído no plano.', 'plan_feature_missing', F],
    // Stock.
    ['Estoque sem movimento autorizado.', 'stock_without_movement', S],
    ['Estoque deve ser alterado pelo delta autorizado.', 'stock_delta_mismatch', S],
    ['Estoque insuficiente ou reservado.', 'stock_insufficient', S],
    ['Estoque inicial inválido.', 'initial_stock_invalid', S],
    ['Estoque histórico ausente exige revisão de origem; nenhuma entrada inicial será inventada.', 'historical_stock_origin_review', S],
    ['Estoque de variação inválido.', 'variant_stock_invalid', S],
    ['Alias de estoque divergente.', 'stock_alias_mismatch', S],
    ['Aliases do estoque inicial divergentes.', 'initial_stock_alias_mismatch', S],
    ['Agregado das variações divergente.', 'variant_aggregate_mismatch', S],
    ['Resumo do produto não corresponde às variações.', 'variant_summary_mismatch', S],
    ['Disponibilidade não corresponde às variações canônicas.', 'variant_availability_mismatch', S],
    ['Disponibilidade exige o movimento autorizado do produto.', 'availability_without_movement', S],
    ['Movimento de estoque inválido.', 'stock_movement_invalid', S],
    ['Movimento incompatível com a venda.', 'stock_movement_sale_mismatch', S],
    ['Movimento de outra venda.', 'stock_movement_other_sale', S], // only in the deployed 00017 package
    ['Movimentos não correspondem integralmente à operação.', 'stock_movements_incomplete', S],
    ['Movimento não corresponde ao resgate autorizado.', 'stock_movement_redemption_mismatch', S],
    ['Entrada inicial já existe.', 'initial_stock_exists', S],
    ['Selecione o espaço para registrar a entrada inicial.', 'initial_stock_space_required', S],
    ['Limite seguro de variações excedido.', 'variant_limit_exceeded', S],
    // Data / financial consistency (the server state disagrees with the packet).
    ['Cliente não confirmado.', 'customer_not_found', D],
    ['Total não corresponde aos itens.', 'sale_total_mismatch', D],
    ['Saldo/versão não correspondem a um efeito financeiro autorizado.', 'balance_version_mismatch', D],
    ['Saldo histórico não pode ser reescrito pela venda.', 'historical_balance_rewrite', D],
    ['Evento financeiro obrigatório ausente.', 'financial_event_missing', D],
    ['Evento financeiro não corresponde ao efeito autorizado.', 'financial_event_mismatch', D],
    ['Evento financeiro existente não pode ser reescrito.', 'financial_event_rewrite', D],
    ['Evento canônico é imutável.', 'canonical_event_immutable', D],
    ['Movimento financeiro ausente.', 'financial_movement_missing', D],
    ['Contador não corresponde à venda.', 'sale_counter_mismatch', D],
    ['Cadastro não pode criar saldo.', 'customer_create_balance', D],
    ['Cadastro não pode criar projeções comerciais ou financeiras.', 'customer_create_projection', D],
    ['Cadastro não pode alterar projeções comerciais.', 'customer_update_projection', D],
    ['Projeções históricas devem permanecer preservadas.', 'historical_projection_rewrite', D],
    ['Venda financeira ausente.', 'financial_sale_missing', D],
    ['Venda de outra operação.', 'sale_other_operation', D],
    ['Venda auxiliar não autorizada.', 'auxiliary_sale_unlinked', D],
    ['Venda já possui devolução/movimento divergente.', 'sale_return_mismatch', D],
    ['Venda já cancelada.', 'sale_already_cancelled', D],
    ['Venda já recebeu pagamento; use conciliação.', 'sale_already_paid', D],
    ['Venda histórica é imutável; não existe ação comercial autorizada.', 'historical_sale_immutable', D],
    ['Venda nova não pode forjar cancelamento ou recebimento anterior.', 'sale_forged_history', D],
    ['Cancelamento não pode reescrever a venda.', 'cancellation_rewrites_sale', D],
    ['Transição de cancelamento inválida.', 'cancellation_transition_invalid', D],
    ['Recebimento não pode editar a venda.', 'payment_edits_sale', D],
    ['Recebimento não pode alocar venda de outro espaço.', 'payment_other_space_sale', D],
    ['Recebimento aloca mais que o valor confirmado.', 'payment_over_allocation', D],
    ['Recebimento parcelado exige alocação exata à venda autorizada.', 'installment_payment_allocation', D],
    ['Valor do recebimento parcelado divergente.', 'installment_payment_amount', D],
    ['Parcela histórica do recebimento divergente.', 'installment_history_mismatch', D],
    ['Ordem/alocação de vencimentos divergente.', 'installment_order_mismatch', D],
    ['Conta parcelada não encontrada.', 'installment_account_missing', D],
    ['Alocação de recebimento inválida.', 'payment_allocation_invalid', D],
    ['Alocação contábil não corresponde ao exigível.', 'payment_allocation_due_mismatch', D],
    ['Delta de alocação inválido.', 'allocation_delta_invalid', D],
    ['Origem ou caixa do recebimento inválido.', 'payment_origin_invalid', D],
    ['Um recebimento aplicado nunca pode ser reescrito por resolução de conflito.', 'applied_payment_rewrite', D],
    ['Um recibo comercial exige o evento comercial correspondente.', 'commercial_receipt_without_event', D],
    ['A resolução preserva a origem do recebimento.', 'resolution_payment_origin', D],
    ['Confirmação de conflito não corresponde ao novo recebimento.', 'conflict_confirmation_mismatch', D],
    ['Somente o conflito não aplicado pode ser encerrado sem efeitos.', 'conflict_close_applied', D],
    ['Baixas originais não comprovadas.', 'original_writeoffs_unproven', D],
    ['Pagamento integrado não confirmado.', 'integrated_payment_unconfirmed', D],
    ['Pedido online não autorizado ou itens/modalidade diferentes da conclusão canônica.', 'online_order_mismatch', D],
    ['Modalidade Fiado inconsistente.', 'fiado_mode_mismatch', D],
    ['Fiado exige cliente.', 'fiado_customer_required', D],
    ['Autoria ou status da venda inválidos.', 'sale_author_or_status_invalid', D],
    ['Mais de um efeito primário na operação.', 'multiple_primary_effects', D],
    ['Tipo da operação não corresponde ao efeito comercial.', 'operation_kind_mismatch', D],
    ['Resgate exige operação própria e identificador original.', 'redemption_operation_required', D],
    ['Preço negativo.', 'negative_price', D],
    ['Variação obrigatória.', 'variant_required', D],
    ['Variação não pode mudar de produto.', 'variant_product_change', D],
    ['Variação inválida.', 'variant_invalid', D],
    ['Variação de outro produto.', 'variant_other_product', D],
    ['Documento canônico não pode ser fornecido pelo cliente.', 'canonical_document_from_client', D],
    ['Documento atual de outra origem.', 'document_other_origin', D],
    ['Versão do histórico é exclusiva do servidor.', 'history_version_server_only', D],
    ['Ativação do histórico é exclusiva do servidor.', 'history_activation_server_only', D],
    ['Recebimento/ajuste inconsistente.', 'payment_adjustment_inconsistent', D],
    ['Operação financeira deve pertencer a uma única conta.', 'financial_operation_multi_account', D],
    ['Cliente com crédito exige apuração específica antes do parcelamento.', 'customer_credit_before_installments', D],
    ['Ajuste não pode quitar parcelas contratuais ou criar obrigação futura sem prova.', 'adjustment_unproven_installments', D],
    ['Venda anterior ao corte não pode ser lançada na conta nova.', 'sale_before_cutoff', D],
    ['Operação anterior ao corte não pode alterar a conta nova.', 'operation_before_cutoff', D],
    ['Marcador canônico ausente.', 'canonical_marker_missing', D],
    ['A revisão mudou. Consulte novamente; nenhum recebimento foi reaplicado.', 'review_changed', D],
    ['A campanha ou renovação mudou; revise a operação preservada antes de continuar.', 'engagement_changed', D],
    ['Recebimento roteado inválido.', 'routed_payment_invalid', D],
    ['Histórico de Fiado excede limite da transação.', 'fiado_history_limit', D],
    // Malformed packets.
    ['Valor inválido.', 'amount_invalid', M],
    ['Quantidade inválida.', 'quantity_invalid', M],
    ['Itens inválidos.', 'items_invalid', M],
    ['Identificação do conteúdo inválida.', 'content_id_invalid', M],
    ['Gravação inválida.', 'write_invalid', M],
    ['Documento repetido.', 'document_repeated', M],
    ['Envelope de operação inválido.', 'operation_envelope_invalid', M],
    ['Envelope de recebimento parcelado inconsistente.', 'installment_envelope_invalid', M],
    ['Operação excede o limite seguro.', 'operation_too_large', M],
    // Version / contract.
    ['Atualize a VECONI antes de sincronizar. A fila original foi preservada.', 'sync_update_required', V],
    ['Atualize o contrato de recebimento histórico. A operação original foi preservada.', 'payment_history_contract_update', V],
    ['Atualize o aplicativo antes de alterar uma conta com histórico comprovado. A operação foi preservada.', 'history_account_update_required', V],
    ['Atualize o saldo exigível e preserve o recebimento original para revisão.', 'due_balance_refresh_required', V],
    ['A venda pertence a uma versão anterior da conta. Atualize antes de criar novo Fiado.', 'account_version_outdated', V],
    ['Use o recebimento verificado do espaço para esta conta. A operação original foi preservada.', 'space_verified_payment_required', V],
    ['Use o cancelamento canônico com motivo para vendas antigas.', 'canonical_cancellation_required', V],
    ['Atalho restrito à última venda. Use o cancelamento canônico.', 'last_sale_shortcut_only', V],
    ['Original rejeitado completo e versão compatível são obrigatórios.', 'recovery_original_required', V],
    // Review holds (preserved, never auto-replayed).
    ['Operação preservada para revisão; replay bloqueado.', 'operation_review_hold', R],
    ['Operação com rejeição permanente exige revisão explícita; o envelope original foi preservado.', 'permanent_rejection_review', R],
    ['Operação arquivada/em revisão; replay bloqueado.', 'operation_archived_hold', R],
    ['O recebimento anterior precisa ser conferido. O original foi preservado.', 'previous_payment_review', R],
    ['O recebimento anterior precisa ser conferido antes de outra tentativa.', 'previous_payment_review_retry', R],
    ['Recibo legado exige revisão; nenhum efeito foi reaplicado.', 'legacy_receipt_review', R],
    ['Existe evidência de recuperação sem recibo canônico completo; revisão individual obrigatória.', 'incomplete_recovery_evidence', R],
    ['Venda histórica já recebida exige revisão individual.', 'historical_paid_sale_review', R],
    ['Venda com revisão/troca/crédito exige fluxo dedicado.', 'sale_dedicated_flow_required', R],
    ['Venda anterior exige revisão online e confirmação do proprietário.', 'prior_sale_owner_review', R],
    ['Venda Fiado histórica sem espaço exige recebimento pelo proprietário em um espaço válido.', 'historical_fiado_space_review', R],
    ['Recebimento sem espaço exige revisão; não presumir o espaço atual.', 'payment_without_space_review', R],
    ['Conflito sem espaço exige revisão administrativa.', 'conflict_without_space_review', R],
    ['Confirme explicitamente a revisão atual antes de recuperar.', 'recovery_confirmation_required', R],
    // Duplicates.
    ['Venda existente não pode ser sobrescrita.', 'sale_exists', U],
    ['Recibo de outra origem ou conteúdo.', 'receipt_other_content', U],
    // Paused / disabled features.
    ['Novas ativações do histórico estão pausadas.', 'history_activation_paused', F],
    ['Novos crediários estão pausados.', 'installments_paused', F],
    ['A operação exige atualização ou revisão antes de continuar.', 'domain_update_or_review', V],
  ];
  // Dynamic messages (suffix varies) — matched by prefix.
  const PREFIXES = [
    ['Coleção/ação não autorizada: ', 'collection_action_not_authorized', P],
    ['Recebimento não pode reescrever a origem da venda (', 'payment_rewrites_sale_origin', D],
  ];
  const REASON = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  const byMessage = new Map(MESSAGES.map(([message, reason, category]) => [message, { reason, category }]));
  const byReason = new Map();
  for (const [, reason, category] of [...MESSAGES, ...PREFIXES]) byReason.set(reason, category);
  // Fallback when only the code is known (never claims "permission" for permission-denied:
  // 105 of 158 server rejections used that code by default for non-permission causes).
  const CODE_CATEGORY = {
    unauthenticated: A, 'invalid-argument': M, 'already-exists': U,
    'resource-exhausted': 'connection', unavailable: 'connection', 'deadline-exceeded': 'connection',
    'network-request-failed': 'connection', aborted: 'connection', internal: 'connection',
    'sync-update-required': V, 'legacy-payload-unsupported': V,
    'sale-stock-review-required': 'dependency_pending', 'customer-payment-review-required': 'dependency_pending',
    'sale-recovery-review-required': R, 'sync-receipt-review-required': R, 'sync-retry-exhausted': R,
    'queue-operation-archived': R, 'queue-owner-mismatch': 'local', 'local-operation-missing': 'local',
    'local-storage-quota': 'local', 'customer-edit-permission-required': P, 'settings-permission-required': P,
    'permission-required': P,
  };
  function normalizeCode(code) { return String(code || '').replace(/^(?:functions|firestore)\//, ''); }
  // Server side: label a rejection by its message (single source of truth here).
  function classify(message, code) {
    const text = String(message || ''), hit = byMessage.get(text) ||
      PREFIXES.filter(([prefix]) => text.startsWith(prefix)).map(([, reason, category]) => ({ reason, category }))[0];
    if (hit) return { ...hit };
    const normalized = normalizeCode(code);
    return { reason: 'unclassified', category: CODE_CATEGORY[normalized] || 'unclassified' };
  }
  function details(message, code, extra) {
    const base = classify(message, code);
    return { ...(extra && typeof extra === 'object' ? extra : {}), reason: extra?.reason && REASON.test(extra.reason) ? extra.reason : base.reason,
      category: base.category, rejectionSchema: SCHEMA };
  }
  // Client side: read what a callable error (or a stored queue item) says.
  // Order: typed server reason → client-side code → legacy text (old packets only).
  function describe({ code, message, details: info } = {}) {
    const normalized = normalizeCode(code);
    if (info && typeof info === 'object' && typeof info.reason === 'string' && REASON.test(info.reason)) {
      const category = CATEGORIES[info.category] ? info.category : byReason.get(info.reason) || CODE_CATEGORY[normalized] || 'unclassified';
      return { reason: info.reason, category, source: 'server' };
    }
    if (CODE_CATEGORY[normalized] && !['permission-denied', 'failed-precondition', 'invalid-argument', 'already-exists'].includes(normalized))
      return { reason: normalized.replace(/-/g, '_'), category: CODE_CATEGORY[normalized], source: 'client' };
    const legacy = classify(message, code);
    return { reason: legacy.reason, category: legacy.category, source: legacy.reason === 'unclassified' ? 'unknown' : 'legacy_message' };
  }
  function isReason(item, reason, legacyMessage) {
    // Prefer the stored typed reason; fall back to the exact legacy text ONLY when
    // the packet was rejected before the server sent reasons.
    if (item?.lastErrorReason && item.lastErrorReason !== 'unclassified') return item.lastErrorReason === reason;
    return legacyMessage !== undefined && item?.lastErrorMessage === legacyMessage;
  }
  function label(category) { return CATEGORIES[category] || CATEGORIES.unclassified; }
  // PWA queue helpers (used by js/firebase/sync.js through globalThis.VeconiSyncRejection).
  // Fields stored on a queue item after a failed attempt.
  function queueFields(input) {
    const described = describe(input || {});
    const typed = input?.details && typeof input.details.reason === 'string' && REASON.test(input.details.reason);
    if (!typed && described.source === 'unknown') return { lastErrorReason: 'unclassified', lastErrorCategory: described.category, lastErrorReasonSource: 'unknown' };
    return { lastErrorReason: described.reason.slice(0, 64), lastErrorCategory: described.category, lastErrorReasonSource: described.source };
  }
  // What a stored queue item says (packets from before reasons are labelled from text, for display only).
  function ofItem(item) {
    if (!item || (!item.lastErrorCode && !item.lastErrorMessage)) return null;
    if (item.lastErrorReason && item.lastErrorReason !== 'unclassified')
      return { reason: item.lastErrorReason, category: CATEGORIES[item.lastErrorCategory] ? item.lastErrorCategory : byReason.get(item.lastErrorReason) || 'unclassified', source: item.lastErrorReasonSource || 'server' };
    return describe({ code: item.lastErrorCode, message: item.lastErrorMessage });
  }
  function diagnosticFields(item, reviewReason) {
    const r = ofItem(item); if (!r) return {};
    return { rejectionReason: r.reason, rejectionCategory: reviewReason === 'payment_financial_dependency' ? 'dependency_pending' : r.category, rejectionSource: r.source };
  }
  function countByCategory(items) {
    return (items || []).reduce((counts, item) => { const c = ofItem(item)?.category || 'unclassified'; counts[c] = (counts[c] || 0) + 1; return counts; }, {});
  }
  return Object.freeze({ SCHEMA, CATEGORIES, MESSAGES, PREFIXES, classify, details, describe, isReason, label, categoryOf: reason => byReason.get(reason) || null,
    queueFields, ofItem, diagnosticFields, countByCategory });
});
