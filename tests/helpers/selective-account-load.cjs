'use strict';

const assert = require('node:assert/strict');
const {customerAccountBackfillService} = require('../../functions/src/services/customer-account-backfill-service');

async function loadApprovedAccounts(db, businessId, uid, runId) {
  const service = customerAccountBackfillService(db, {loadScope: businessId + ':0'});
  const call = (kind, extra) => service.handle({auth: {uid}, data: {kind, businessId, workspaceGeneration: 0, ...extra}});
  let cursor = null, page = 0;
  do {
    const preview = await call('customer_account_backfill_preview', {cursor, limit: 10});
    const items = preview.items.map(row => row.approval).filter(Boolean);
    if (items.length) {
      const result = await call('customer_account_backfill_apply', {runId, pageId: 'page-' + (++page), items, confirmed: true, backupConfirmed: true});
      assert.equal(result.counts.applied, items.length);
    }
    cursor = preview.nextCursor;
  } while (cursor);
}

module.exports = {loadApprovedAccounts};
