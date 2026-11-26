'use strict';

// Entrypoint for the selective preparation deploy only. Other Functions keep their own revisions.
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {customerAccountBackfillService, applyLoadedEvent} = require('./services/customer-account-backfill-service');
const {customerBalanceAdjustmentService} = require('./services/customer-balance-adjustment-service');
const {customerAccountMigrationService} = require('./services/customer-account-migration-service');
const {customerAccountOpeningService} = require('./services/customer-account-opening-service');

initializeApp();
const db = getFirestore(), region = 'southamerica-east1';

exports.manageCustomerAccounts = onCall({region, memory: '512MiB', timeoutSeconds: 300, maxInstances: 4}, request => {
  switch (request.data?.kind) {
    case 'customer_balance_adjustment_preview': return customerBalanceAdjustmentService(db).preview(request);
    case 'customer_balance_adjustment_history': return customerBalanceAdjustmentService(db).history(request);
    case 'customer_account_migration_preview': return customerAccountMigrationService(db).preview(request);
    case 'customer_account_opening_preview': return customerAccountOpeningService(db).preview(request);
    case 'customer_account_backfill_preview':
    case 'customer_account_backfill_apply':
    case 'customer_account_backfill_catchup':
      return customerAccountBackfillService(db).handle(request);
    default: throw new HttpsError('failed-precondition', 'Operação indisponível na etapa de preparação.');
  }
});

exports.projectCustomerAccount = onDocumentCreated({
  document: 'businesses/{businessId}/balanceEvents/{eventId}', region, memory: '256MiB', timeoutSeconds: 60, maxInstances: 10, retry: true
}, event => applyLoadedEvent(db, event.params.businessId, event.params.eventId));
