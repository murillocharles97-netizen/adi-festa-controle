'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/firebase/firebase-ui.js','utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
function harness(){
  const c={escape:value=>String(value??'').replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[char])),formattedTime:String,baseTechnicalDetails:()=>''};
  vm.createContext(c);
  vm.runInContext(part('function incidentArchiveHtml(','function confirmIncidentArchive('),c);
  vm.runInContext(part('function technicalDetails(','\nfunction ',source.indexOf('function technicalDetails(')+1),c);
  return c;
}
test('settings permission occurrence stays visible without retry/archive CTA or a false resolved label',()=>{
  const c=harness(),html=c.incidentArchiveHtml([{reviewState:'quarantined',reviewReason:'settings_permission_required',canArchive:false,
    operationId:'qa-settings',payloadChecksum:'fnv1a:qa',retryCount:11,diagnostic:{path:'businesses/qa/settings/default'}}]);
  assert.match(html,/Configuração preservada — envio bloqueado neste perfil/);
  assert.match(html,/businesses\/qa\/settings\/default/);assert.match(html,/Tentativas preservadas: 11/);
  assert.doesNotMatch(html,/data-archive-incident|Arquivada \/ resolvida|data-retry/);
});
test('ordinary historical quarantine and already archived evidence keep their existing presentation',()=>{
  const c=harness();assert.match(c.incidentArchiveHtml([{reviewState:'quarantined',operationId:'qa-projection'}]),/data-archive-incident/);
  const html=c.incidentArchiveHtml([{reviewState:'archived',operationId:'qa-closed',archive:{archivedBy:'qa-seller',archivedAt:'2026-10-20'}}]);
  assert.match(html,/Arquivada \/ resolvida/);assert.doesNotMatch(html,/data-archive-incident/);
});
test('technical diagnostics distinguish payload destination from the final marker and explain atomic failure',()=>{
  const html=harness().technicalDetails({syncFailure:{stage:'shared_settings_commit',service:'Firestore',collection:'settings',request:'atomic_commit',
    path:'businesses/qa/settings/default',lastObservedPath:'businesses/qa/processedOperations/qa-operation',
    pathAttribution:'payload_target_not_individual_rule_result',code:'permission-denied',message:'Denied'}});
  assert.match(html,/shared_settings_commit/);assert.match(html,/businesses\/qa\/settings\/default/);
  assert.match(html,/businesses\/qa\/processedOperations\/qa-operation/);assert.match(html,/não identifica sozinho qual Rule/);
});
test('technical paths and stages cannot inject HTML into the diagnostic',()=>{
  const html=harness().technicalDetails({syncFailure:{stage:'<img onerror=x>',path:'<script>x</script>',message:'<secret>'}});
  assert.doesNotMatch(html,/<img|<script>|<secret>/);assert.match(html,/&lt;script&gt;/);
});
