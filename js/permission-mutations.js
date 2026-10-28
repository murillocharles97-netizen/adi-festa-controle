/* Prevent invalid local projections/queues. The server remains authoritative. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PermissionMutations = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const envelope = new Set(['id','businessId','ownerId','createdAt','updatedAt','atualizadoEm','updatedByUid','actorUid','actorNameSnapshot','actorRoleSnapshot','schemaVersion','version','workspaceGeneration','workspaceWriteId','operationId','idempotencyKey','action','entityType']);
  const counters = new Set(['totalComprado','quantidadeVendas','ultimaCompra','legacyBalance','legacyBalanceRemaining','campaignFinanceVersion']);
  const financial = new Set(['saldo','financialVersion','openBalance','financialRevision','financialReconciledAt']);
  const stocks = new Set(['estoqueAtual','estoque','totalStock','stock','onlineReservedStock','onlineOrderFinalizationId','hasAvailableStock']);
  const columns = {settings:'settings.manage',campaigns:'reports.view',customerMetrics:'reports.view',customerMonthlyMetrics:'reports.view',customerSegments:'reports.view',visits:'reports.view',charges:'customers.edit',messageHistory:'customers.edit',messageTemplates:'customers.edit',messageSequences:'customers.edit',clientContacts:'customers.edit',productFinancials:'cost.view',variantFinancials:'cost.view',saleFinancials:'cost.view',stockMovementFinancials:'cost.view'};
  function assertWrites(writes, access, policy) {
    const require = key => { if (!access.has(key)) throw policy.denied(key); };
    const sale = writes.find(w => w.entityType === 'sales' && w.operation === 'create');
    const cancellation = writes.find(w => w.entityType === 'sales' && w.operation === 'update' && (w.data.active === false || w.data.deletedAt || w.data.cancelledAt));
    const payment = writes.find(w => w.entityType === 'payments');
    const adjustment = writes.find(w => w.entityType === 'balanceAdjustments');
    const redemption = writes.find(w => w.entityType === 'campaignRedemptions' && w.operation === 'create');
    if (sale) require('sales.create');
    if (cancellation) require('sales.cancel');
    if (payment) require('customers.receiveDebt');
    if (adjustment) require('customers.adjustBalance');
    if (redemption) require('sales.create');
    const commercial = sale || cancellation || payment || adjustment;
    for (const w of writes) {
      access.assertWriteScope?.(w,writes);
      const fields = Object.keys(w.data || {}).filter(key => !envelope.has(key) && JSON.stringify(w.data[key]) !== JSON.stringify(w.before?.[key]));
      if (w.entityType === 'clients') {
        if (w.operation === 'create') {
          require('customers.create');
          if([...financial,...counters].some(key=>w.data[key]!=null&&w.data[key]!==0))throw policy.denied('authorized-customer-financial-event');
        }
        else {
          const metadata = fields.filter(key => !financial.has(key) && !counters.has(key));
          const status = metadata.filter(key => ['active','ativo','deletedAt'].includes(key));
          if (status.length) require('customers.archive');
          if (metadata.some(key => !status.includes(key))) require('customers.edit');
          if (!commercial && fields.some(key => financial.has(key) || counters.has(key)))
            throw policy.denied('customers.adjustBalance'); // must use the typed commercial flow, not a naked balance patch
        }
      } else if (['products','productVariants'].includes(w.entityType)) {
        if (w.operation === 'create' || fields.some(key => !stocks.has(key) && !['custo','cost'].includes(key))) require('products.edit');
        if (fields.some(key => ['custo','cost'].includes(key))) require('cost.view');
        if (w.operation !== 'create' && fields.some(key => stocks.has(key)) && !sale && !cancellation && !redemption) require('inventory.adjust');
      } else if (w.entityType === 'stockMovements') {
        if (!sale && !cancellation && !writes.some(x => x.entityType === 'campaignRedemptions')) require('inventory.adjust');
      } else if (w.entityType === 'sales') {
        if (!sale && !cancellation) throw policy.denied('sales.cancel');
      } else if (['payments','balanceAdjustments','paymentAllocations'].includes(w.entityType)) {
        require(w.entityType === 'balanceAdjustments' ? 'customers.adjustBalance' : 'customers.receiveDebt');
      } else if (['campaignProgress','campaignEvents','campaignRedemptions','rewards','customerSubscriptions','customerSubscriptionEvents'].includes(w.entityType)) {
        require(payment ? 'customers.receiveDebt' : cancellation ? 'sales.cancel' : 'sales.create');
      } else if (columns[w.entityType]) require(columns[w.entityType]);
      else throw policy.denied('server-authorized-operation');
    }
    return true;
  }
  return Object.freeze({assertWrites});
});
