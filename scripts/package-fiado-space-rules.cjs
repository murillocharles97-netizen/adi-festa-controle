'use strict';
// Apply only the indispensable server-owned ledger fences to the active rules.
// Never replace active production rules with the repository's historical file.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ACTIVE_SHA='b7a53cfb1317c62c46a0d3ffa3862b2a813211666a26298a28237d840fb550df';
function prepare(input,output){
 const original=fs.readFileSync(input,'utf8');assert.equal(crypto.createHash('sha256').update(original).digest('hex'),ACTIVE_SHA,'Active rules changed: recompare before packaging');
 let rules=original.replace(/\r\n/g,'\n');
 const replace=(before,after)=>{assert.equal(rules.split(before).length,2,'Unique rules anchor required');rules=rules.replace(before,after);};
 replace("&& (!('fiadoOpeningBalance' in resource.data) || !changed.hasAny([",
  "&& (!(('fiadoOpeningBalance' in resource.data) || resource.data.get('fiadoHistoryActivation', {}).get('spaceRegularization', {}).get('version', 0) == 1) || !changed.hasAny([");
 // Both the incoming and existing audit records must be protected: removing the
 // version tag must not turn a server-owned adjustment into an editable legacy row.
 for(const collection of ['balanceAdjustments','balanceEvents']){
  replace("allow create: if legacyFiadoSource(businessId, request.resource.data) && canCreateGenericDocument(businessId, '"+collection+"', documentId);",
   "allow create: if request.resource.data.get('spaceRegularizationVersion', 0) != 1 && legacyFiadoSource(businessId, request.resource.data) && canCreateGenericDocument(businessId, '"+collection+"', documentId);");
  replace("allow update: if legacyFiadoSource(businessId, resource.data) && legacyFiadoSource(businessId, request.resource.data) && canUpdateGenericDocument(businessId, '"+collection+"', documentId);",
   "allow update: if resource.data.get('spaceRegularizationVersion', 0) != 1 && request.resource.data.get('spaceRegularizationVersion', 0) != 1 && legacyFiadoSource(businessId, resource.data) && legacyFiadoSource(businessId, request.resource.data) && canUpdateGenericDocument(businessId, '"+collection+"', documentId);");
 }
 fs.writeFileSync(output,rules);return {activeSha256:ACTIVE_SHA,candidateSha256:crypto.createHash('sha256').update(rules).digest('hex'),replacements:5,readPermissionChanges:0,productionWrites:0};
}
if(require.main===module)console.log(JSON.stringify(prepare(process.argv[2],process.argv[3])));module.exports={prepare};
