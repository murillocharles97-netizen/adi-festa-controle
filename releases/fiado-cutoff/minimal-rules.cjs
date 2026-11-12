'use strict';
// Builds selective.rules = ACTIVE production Rules + cutoff-only AND guards.
// v2 of the Codex generator (cutoff-release/minimal-rules.cjs): same anchors and
// semantics, cheaper guards. v1 pushed ordinary sale batches past the Rules
// 1000-expression limit (PERMISSION_DENIED on sales create/update).
// Usage: node minimal-rules.cjs [--pad N]  (--pad only for headroom measurement)
const fs=require('fs'),assert=require('node:assert/strict');
const original=fs.readFileSync(__dirname+'/production-active.rules','utf8').replace(/\r\n/g,'\n');
const padIndex=process.argv.indexOf('--pad'),pad=padIndex>0?Number(process.argv[padIndex+1]):0;
let rules=original;const edits=[];
function replace(a,b){assert.equal(rules.split(a).length,2,a);rules=rules.replace(a,b);edits.push([a,b]);}
const helpers=`    // Confirmed Fiado openings are server-only; legacy accounts keep existing grants.
    // Keep these cheap: sale batches already run close to the 1000-expression limit.
    function noFiadoCut(businessId, id) {
      return !(id is string) || id == ''
        || !exists(/databases/$(database)/documents/businesses/$(businessId)/fiadoOpeningBalances/$(id));
    }
    function legacyFiadoSource(businessId, data) {
      return !('fiadoOpeningHash' in data)
        && noFiadoCut(businessId, data.get('clienteId', null))
        && noFiadoCut(businessId, data.get('clientId', null))
        && noFiadoCut(businessId, data.get('customerId', null));
    }
    function fiadoClientCreateSafe(data) {
      return !data.keys().hasAny(['fiadoOpeningBalance','fiadoHistoryVersion','fiadoHistoryActivation']);
    }
    // The client marker is written in the same server transaction as
    // fiadoOpeningBalances/{id}; clients cannot be deleted and browsers cannot
    // add/remove the marker, so it stands in for exists() here.
    function fiadoClientUpdateSafe() {
      let changed = request.resource.data.diff(resource.data).affectedKeys();
      return !changed.hasAny(['fiadoOpeningBalance','fiadoHistoryVersion','fiadoHistoryActivation'])
        && (!('fiadoOpeningBalance' in resource.data) || !changed.hasAny([
          'saldo','financialVersion','openBalance','financialRevision','financialReconciledAt',
          'legacyBalance','legacyBalanceRemaining','campaignFinanceVersion','hasInstallmentFiado'
        ]));
    }
    // Sales reference the account only through clienteId (server contract).
    function fiadoSaleWriteSafe(businessId, data) {
      return !('fiadoOpeningHash' in data)
        && ((data.get('formaPagamento','') != 'fiado' && data.get('status','') != 'fiado')
          || noFiadoCut(businessId, data.get('clienteId', null)));
    }
    // Sale updates: production legacy-maintenance updates have room for ~2 more
    // checks before the 1000-expression limit (measured in the Emulator). The
    // cut account reads only server-stamped sources and its client balance is
    // fenced above, so the browser must only be unable to edit, add or remove
    // the stamp. Archived sales stay as editable as before the cutoff and do not
    // reach the new account.
    function fiadoSaleUpdateSafe() {
      return !('fiadoOpeningHash' in resource.data) && !('fiadoOpeningHash' in request.resource.data);
    }
`;
replace('    function canUpdateGenericDocument(',helpers+'    function canUpdateGenericDocument(');
replace("allow create: if browserClientWritesAllowed(businessId) && canCreateGenericDocument(businessId, 'clients', documentId);","allow create: if fiadoClientCreateSafe(request.resource.data) && browserClientWritesAllowed(businessId) && canCreateGenericDocument(businessId, 'clients', documentId);");
replace("allow update: if browserClientWritesAllowed(businessId) && canUpdateGenericDocument(businessId, 'clients', documentId);","allow update: if fiadoClientUpdateSafe() && browserClientWritesAllowed(businessId) && canUpdateGenericDocument(businessId, 'clients', documentId);");
replace('      match /financialIncomeRoutes/{documentId} {',"      match /fiadoOpeningBalances/{clientId} {\n        allow read, write: if false;\n      }\n      match /financialIncomeRoutes/{documentId} {");
const padding=pad?Array.from({length:pad},()=>'1 == 1').join(' && ')+' && ':'';
replace("allow create: if !request.resource.data.keys().hasAny(['installmentPlan'])","allow create: if "+padding+"fiadoSaleWriteSafe(businessId, request.resource.data) && !request.resource.data.keys().hasAny(['installmentPlan'])");
replace("allow update: if !resource.data.keys().hasAny(['installmentPlan'])","allow update: if fiadoSaleUpdateSafe() && !resource.data.keys().hasAny(['installmentPlan'])");
for(const collection of ['payments','balanceAdjustments','balanceEvents']){
 const start=rules.indexOf('      match /'+collection+'/{'),end=rules.indexOf('\n      match /',start+1),block=rules.slice(start,end);
 const revised=block.replace('allow create: if ','allow create: if legacyFiadoSource(businessId, request.resource.data) && ')
  .replace('allow update: if ','allow update: if legacyFiadoSource(businessId, resource.data) && legacyFiadoSource(businessId, request.resource.data) && ');
 assert.notEqual(revised,block,collection);replace(block,revised);
}
replace("allow create: if canWriteCollection(businessId, 'paymentAllocations')","allow create: if legacyFiadoSource(businessId, request.resource.data) && canWriteCollection(businessId, 'paymentAllocations')");
let restored=rules;for(const [a,b]of [...edits].reverse())restored=restored.replace(b,a);assert.equal(restored,original);
const out=process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:__dirname+'/selective.rules';
fs.writeFileSync(out,rules);
if(!pad)fs.writeFileSync(__dirname+'/rules-edits.json',JSON.stringify(edits));
console.log(JSON.stringify({target:'production Rules plus cutoff-only AND guards',edits:edits.length,pad,inverseExactlyMatchesProduction:true,out}));
