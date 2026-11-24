import './sync.js?v=2428-fluidez';
import '../sale-recovery-client.js?v=236.2';
import '../sale-recovery-ui.js?v=236.2';
import '../sale-monetary-analysis-ui.js?v=215';

let unsubscribe=null,lastState=null;
const escape=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const notify=(message,error=false)=>window.Utils?.toast?.(message,error);
const formattedTime=value=>value?new Date(value).toLocaleString('pt-BR'):'Ainda não sincronizado';
function showDuplicates(){const groups=window.BackupManager?.findDuplicates?.(window.DB.carregar())||[];document.querySelector('#modal').innerHTML=`<div class="modal-bg"><section class="modal-box modal-wide"><header class="modal-head"><h3>Verificação de duplicados</h3><button class="icon-btn close" type="button"><i data-lucide="x"></i></button></header><div class="modal-body">${groups.length?`<div class="backup-warning"><b>${groups.length} possível(is) duplicação(ões) encontrada(s).</b> Nenhum registro foi alterado.</div><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Motivo</th><th>IDs</th></tr></thead><tbody>${groups.slice(0,100).map(group=>`<tr><td>${escape(group.type)}</td><td>${escape(group.reason)}</td><td>${escape(group.ids.join(' / '))}</td></tr>`).join('')}</tbody></table></div>`:'<p>Nenhuma duplicação foi encontrada nos dados locais.</p>'}</div><footer class="modal-foot"><button class="btn btn-primary close" type="button">Fechar</button></footer></section></div>`;document.querySelectorAll('#modal .close').forEach(button=>button.onclick=()=>document.querySelector('#modal').innerHTML='');window.lucide?.createIcons()}

function settingsPanel(){
  const mobileSettings=document.querySelector('.mobile-settings-page');
  if(mobileSettings){
    if(mobileSettings.dataset.firebaseUiBound==='true')return;
    mobileSettings.dataset.firebaseUiBound='true';
    if(lastState)renderState(lastState);
    return;
  }
  const settings=document.querySelector('.settings');if(!settings||document.querySelector('#firebase-cloud-panel'))return;
  const session=window.FirebaseSession,profile=session?.profile||{},uid=session?.user?.uid||'';
  settings.insertAdjacentHTML('beforeend',`<section class="setting firebase-account"><div><b>Conta</b><div class="firebase-account-grid"><span>Nome</span><strong>${escape(profile.name||'Administrador')}</strong><span>E-mail</span><strong>${escape(session?.user?.email||'')}</strong><span>UID</span><strong>${escape(uid?`${uid.slice(0,8)}…`:'')}</strong><span>Perfil</span><strong>${profile.role==='admin'?'Administrador':escape(profile.role||'Usuário')}</strong><span>Negócio</span><strong>${escape(profile.businessId||'—')}</strong><span>Status</span><strong>${profile.active===true?'Ativo':'Inativo'}</strong></div></div><button class="btn btn-danger" id="firebase-logout" type="button">Sair da conta</button></section><section class="setting firebase-setting" id="firebase-cloud-panel"><div class="firebase-copy"><b>Nuvem</b><small>As alterações são salvas primeiro no aparelho e sincronizadas automaticamente.</small><div class="firebase-status" id="firebase-status" role="status">Preparando sincronização…</div><div class="firebase-sync-grid"><span>Última sincronização</span><strong id="firebase-last-sync">—</strong><span>Pendentes</span><strong id="firebase-pending">0</strong><span>Com erro</span><strong id="firebase-errors">0</strong><span>Migração inicial</span><strong>Concluída</strong><span>Modo atual</span><strong>Sincronização automática</strong></div><button class="firebase-details-toggle" id="firebase-details-toggle" type="button">Ver detalhes técnicos</button><dl class="firebase-details" id="firebase-details" hidden></dl></div><div class="actions firebase-actions"><button class="btn btn-dark" id="firebase-sync" type="button">Sincronizar agora</button></div></section>`);
  settings.querySelector('#firebase-cloud-panel .firebase-sync-grid')?.insertAdjacentHTML('beforeend','<span>Pendências comprovadas / somente locais</span><strong id="firebase-orphans">0</strong>');
  document.querySelector('#firebase-details').insertAdjacentHTML('afterend','<button class="btn btn-light" id="firebase-duplicates" type="button" hidden>Verificar duplicados</button>');
  document.querySelector('#firebase-sync').onclick=manualSync;
  document.querySelector('#firebase-logout').onclick=()=>window.FirebaseAuthActions?.signOut?.();
  document.querySelector('#firebase-details-toggle').onclick=event=>{const details=document.querySelector('#firebase-details');details.hidden=!details.hidden;document.querySelector('#firebase-duplicates').hidden=details.hidden;event.currentTarget.textContent=details.hidden?'Ver detalhes técnicos':'Ocultar detalhes técnicos'};
  document.querySelector('#firebase-duplicates').onclick=showDuplicates;
  if(lastState)renderState(lastState)
}

async function manualSync(){const button=document.querySelector('#cloud-panel-sync')||document.querySelector('#firebase-sync'),original=button?.textContent;if(button){button.disabled=true;button.textContent='Sincronizando…'}try{const result=await window.SyncFirebase.synchronizeNow({manualRetry:true});notify(window.SyncFirebase.describeResult?.(result)||'Não foi possível confirmar a sincronização.',!result.complete)}catch(error){notify(window.SyncFirebase.describeError?.(error)||'Não foi possível sincronizar. Veja os detalhes no painel da nuvem.',true);console.error('[SYNC ERROR]',error.syncDetail||{stage:'manual_sync',code:error.code,message:error.message})}finally{if(button){button.disabled=false;button.textContent=original}}}

function renderQueueError(item){const paths=(item.paths||[item.firestorePath]).filter(Boolean).slice(0,12);return `<article><b>${escape(item.entityType)} · ${escape(item.subtype||item.action)}</b><small>${escape(formattedTime(item.createdAt))}</small><p>${escape(item.errorCode||'erro')}: ${escape(item.errorMessage||'A operação precisa de atenção.')}</p><dl class="sync-error-metadata"><dt>Ação</dt><dd>${escape(item.action)}</dd><dt>Documento</dt><dd>${escape(item.documentId||'—')}</dd><dt>Collection/path</dt><dd>${paths.map(escape).join('<br>')}</dd><dt>Empresa da operação</dt><dd>${escape(item.businessId||'—')}</dd><dt>Empresa atual</dt><dd>${escape(item.currentBusinessId||'—')}</dd><dt>Payload / schema</dt><dd>${escape(`${item.payloadVersion||1} / ${item.schemaVersion||1}`)}</dd><dt>Usuário / perfil</dt><dd>${escape(`${item.authUid||'—'} · ${item.role||'—'}`)}</dd><dt>Origem</dt><dd>${escape(item.createdBeforeMultiTenant?'anterior à migração multiempresa':item.origin||'atual')}</dd><dt>Última tentativa</dt><dd>${escape(formattedTime(item.lastAttemptAt||item.createdAt))}</dd></dl><code>${escape(String(item.operationId||'').slice(0,10))}… · ${escape(item.origin)}</code></article>`}

const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function fiadoScopeHtml(scope,balance){
  if(!scope)return '';
  const matches=scope.operationalMatches&&!balance?.divergentCount&&!balance?.unsafeCount;
  return `<section class="sync-financial-audit"><h4>Fiado — saldo ativo e histórico</h4>${scope.operationalMatches?`<p>Saldo ativo: <strong>${escape(money(scope.remoteActiveDebt))}</strong> · equivalente no aparelho e na nuvem.</p>`:`<p>Saldo ativo no aparelho: ${escape(money(scope.localActiveDebt))} · na nuvem: ${escape(money(scope.remoteActiveDebt))}.</p><p>Diferença no saldo ativo: ${escape(money(scope.operationalDifference))}. Veja os registros antes de qualquer correção.</p>`}<p>Histórico excluído/inativo preservado na nuvem: <strong>${escape(money(scope.remoteHistoricalDebt))}</strong>.</p><p>${matches?'Sem divergência operacional no Fiado. O histórico preservado não faz parte do saldo ativo.':'O Fiado requer revisão dos registros ou do ledger; nenhum saldo foi alterado.'}</p></section>`;
}
function operationConfirmationHtml(details={}){
  const rows=[...(details.saleIntegrity?.confirmedRemotely||[]),...(details.paymentIntegrity?.confirmedRemotely||[])],pending=(details.saleIntegrity?.verificationPending?.length||0)+(details.paymentIntegrity?.verificationPending?.length||0);
  if(!rows.length&&!pending)return '';
  return `<details class="sync-data-state"><summary>Confirmação remota dos registros</summary>${rows.length?`<p>${rows.length} registro(s) encontrado(s) na nuvem sem marcador local. Não são órfãos; diferenças de conteúdo, se houver, continuam na auditoria.</p><ul>${rows.map(x=>`<li>${escape(x.saleId||x.paymentId)} · ${escape(x.category)}${x.spaceId?' · espaço '+escape(x.spaceId):''}</li>`).join('')}</ul>`:''}${pending?`<p>${pending} registro(s) com presença remota ainda não verificada para o conteúdo atual. Isso não comprova perda nem ausência na nuvem.</p>`:''}<p>Registros QA e históricos seguem o mesmo critério de confirmação, sem exceção por ID.</p></details>`;
}
function dataAuditHtml(report){
  if(!report)return '<section class="sync-data-state"><h4>Integridade</h4><p>Execute a comparação para analisar os registros.</p></section>';
  const integrity=report.integrity||{},financialAudited=report.financial?.status!=='not_audited',balance=financialAudited?report.financial?.balanceAudit:null,labels={OK:'OK',INFORMATIVO:'Informativo',ATENCAO:'Atenção',CRITICO:'Crítico'};
  const row=(label,data)=>!data||data.status==='not_audited'?`<article><b>${escape(label)}</b><span>${escape(label==='Financeiro'?'Financeiro não auditado neste perfil':'Não auditado neste perfil')}</span></article>`:`<article><b>${escape(label)}</b><span>Local: ${escape(data.local)} · Nuvem: ${escape(data.remote)}</span><span>Somente local: ${escape(data.onlyLocal)} · Ausente local ativo: ${escape(data.onlyRemote)}</span><span>Diferenças de conteúdo: ${escape(data.divergent)} · Equivalentes: ${escape(data.equal)}</span></article>`;
  const issues=(integrity.issues||[]).filter(x=>x.level!=='INFORMATIVO');
  const historical=Object.values(report.collections||{}).reduce((n,c)=>n+(c.historicalTombstones?.length||0),0);
  const representation=Object.values(report.collections||{}).reduce((n,c)=>n+(c.representationOnly?.length||0),0);
  return `<section class="sync-data-state"><h4>Integridade: ${escape(['OK','INFORMATIVO'].includes(integrity.level)?'Sem divergência operacional no escopo auditado':labels[integrity.level]||'Em análise')}</h4><p>A transferência de dados e esta auditoria têm resultados separados. Apenas coleções autorizadas neste perfil são auditadas. Nenhum reparo financeiro é aplicado aqui.</p><small>Comparado em ${escape(formattedTime(report.generatedAt))}</small><div class="sync-data-state-grid">${row('Produtos',report.products)}${row('Clientes',report.clients)}${row('Financeiro',report.financial)}</div>
    ${financialAudited?fiadoScopeHtml(report.financial?.balanceScope,balance):''}
    ${issues.length?`<div class="sync-error-list">${issues.slice(0,50).map(x=>`<article><b>${escape(labels[x.level])} · ${escape(x.entityType)} · ${escape(x.documentId||x.operationId)}</b><p>${escape(x.category)}${x.fields?.length?' — Campos: '+escape(x.fields.join(', ')):''}</p><small>${escape(x.reason||'Revise este registro. Nenhuma correção automática.')}</small></article>`).join('')}</div>`:''}
    <details><summary>Detalhes técnicos e históricos</summary><p>${historical} tombstone(s) esperado(s); ${representation} registro(s) equivalentes após normalização.</p>${financialAudited?`<p>Saldos assinados incluindo histórico — aparelho: ${escape(money(report.financial.localBalanceIncludingHistory??report.financial.localBalance))} · nuvem: ${escape(money(report.financial.remoteBalanceIncludingHistory??report.financial.remoteBalance))}. Não são a comparação do Fiado ativo.</p>`:''}
    ${(financialAudited?report.financial.balanceContributions||[]:[]).map(x=>`<p>Cliente ${escape(x.clientId)}: local ${escape(x.localBalance===null?'ausente':money(x.localBalance))}; remoto ${escape(x.remoteBalance===null?'ausente':money(x.remoteBalance))}; contribuição ${escape(money(x.difference))} (${escape(x.localBalance===null&&x.remoteDeleted?'escopo histórico excluído':x.origin)}).</p>`).join('')}
    ${report.fixtureCleanup?`<p>${escape(report.fixtureCleanup.removed?.length||0)} fixture(s) de demonstração removido(s) da lista ativa. Originais locais e histórico preservados; nenhum envio à nuvem.</p>`:''}</details>
    ${balance?`<section class="sync-financial-audit"><h4>Auditoria dos saldos confirmados — inclui histórico</h4><p>${escape(balance.divergentCount)} divergência(s) de saldo. ${escape(balance.effectBackfillCount||0)} efeito(s) histórico(s) ausente(s), com saldo já aplicado — não reaplicar saldo.</p><p>Débito incluindo histórico: ${escape(money(balance.actualOpenDebt))} · Esperado pelo último movimento: ${escape(money(balance.expectedOpenDebt))}. Esta verificação não certifica a completude de todo o histórico.</p></section>`:''}</section>`;
}
async function exportDiagnostic(){try{const report=await window.SyncFirebase.exportLocalDiagnostic();window.SyncFirebase.downloadJsonFile(report,`diagnostico-sync-${report.businessId}-${Date.now()}.json`);notify('Diagnóstico exportado sem dados pessoais completos.')}catch(error){notify(error.message||'Não foi possível exportar o diagnóstico.',true)}}
async function compareCloudData(button){const original=button.textContent;button.disabled=true;button.textContent='Comparando…';try{await window.SyncFirebase.compareDeviceWithCloud();notify('Comparação concluída. Nenhum dado local foi alterado.');openQueueDetails()}catch(error){notify(error.message||'Não foi possível comparar com a nuvem.',true);button.disabled=false;button.textContent=original}}
async function recoverLocalData(){const report=lastState?.details?.dataAudit||lastState?.dataAudit;if(!report)return notify('Compare com a nuvem antes de recuperar.',true);const count=report.products.onlyLocal+report.clients.onlyLocal;if(!count)return notify('Nenhum registro ausente para recuperar.');if(!confirm(`Serão enviados ${count} produtos, variações ou clientes ausentes. Um backup será baixado antes. Continuar?`))return;try{const result=await window.SyncFirebase.recoverMissingNonFinancial();notify(`${result.sync.sent||0} operação(ões) confirmada(s) na nuvem.${result.blocked?.length?` ${result.blocked.length} ficaram bloqueadas para revisão.`:''}`,Boolean(result.sync.errors||result.blocked?.length));openQueueDetails()}catch(error){notify(error.message||'A recuperação foi interrompida com segurança.',true)}}
async function reconcileBalances(){const audit=(lastState?.details?.dataAudit||lastState?.dataAudit)?.financial?.balanceAudit;if(!audit)return notify('Execute a comparação com a nuvem antes de reconciliar.',true);if(!audit.safeCount)return notify('Nenhuma correção financeira segura foi identificada.',Boolean(audit.unsafeCount));const summary=`Foram identificados ${audit.safeBalanceCount||0} saldo(s) e ${audit.effectBackfillCount||0} histórico(s) financeiro(s) que podem ser reconciliados com segurança. A diferença de saldo comprovada é ${money(Math.abs(audit.openDebtDifference))}. Um backup será baixado antes. Aplicar somente as correções seguras?`;if(!confirm(summary))return;try{const result=await window.SyncFirebase.reconcileFinancialBalances();notify(`${result.applied.length} cliente(s) reconciliado(s).${result.blocked.length?` ${result.blocked.length} ficaram bloqueados para revisão.`:''}`,Boolean(result.blocked.length));openQueueDetails()}catch(error){notify(error.message||'A reconciliação foi interrompida sem alterar os demais saldos.',true)}}

function onlyLocalSalesHtml(filter={}){
  let sales=[];try{sales=window.SyncFirebase.onlyLocalSaleReport?.()||[]}catch{return ''}
  if(!sales.length)return '';
  const filtered=sales.filter(sale=>!filter.saleId&&!filter.customerId||
    (filter.saleId&&sale.saleId===filter.saleId)||(filter.customerId&&sale.customerId===filter.customerId));
  const rows=filtered.map(sale=>`<article class="sync-orphan-sale"><b>${escape(sale.customer||'Cliente não identificado')}</b><span>${escape(money(sale.amount))} · ${escape(sale.paymentMethod||'Pagamento não informado')} · ${escape(formattedTime(sale.date))}</span><small>${escape(sale.resolved?'Conciliada manualmente; protegida contra nova cobrança':sale.classification==='A'?'Recuperação possível após confirmação':'Pendência antiga exige decisão')} · status ${escape(sale.status||'não informado')}</small><div class="sync-orphan-actions"><button class="btn ${sale.resolved?'btn-light':'btn-primary'}" type="button" data-sale-detail="${escape(sale.saleId)}">${sale.resolved?'Ver conciliação':'Resolver agora'}</button></div></article>`).join('');
  return `<section class="sync-error-list sync-orphan-list"><h4>${escape(sales.length)} venda(s) deste aparelho não estão na nuvem</h4><p>Nenhuma será enviada automaticamente. Revise cliente, itens, saldo e estoque antes de recuperar.</p>${filter.customerId||filter.saleId?`<p>Mostrando ${filtered.length} operação(ões) relacionadas. <button type="button" data-sale-show-all>Ver todas</button></p>`:''}${rows||'<p>Nenhuma venda deste cliente apareceu na última comparação.</p>'}</section>`;
}
function openOnlyLocalSaleDetails(saleId,filter={}){
  const sale=(window.SyncFirebase.onlyLocalSaleReport?.()||[]).find(item=>item.saleId===saleId),root=document.querySelector('#modal');
  if(!sale)return notify('Refaça a comparação; a operação não está mais na lista.',true);
  const itemRows=(sale.items||[]).map(item=>`<li>${escape(item.name||item.productId)} · ${escape(item.quantity)} × ${escape(money(item.unitPrice))}</li>`).join('');
  const owner=['owner','admin'].includes(lastState?.details?.userRole),status=sale.resolved?'Pendência conciliada':'Existe uma pendência antiga';
  root.innerHTML=`<div class="modal-bg"><section class="modal-box modal-wide sync-diagnostics-modal legacy-resolution-sheet"><header class="modal-head"><div><small>${escape(status)}</small><h3>${escape(sale.customer||'Cliente')}</h3></div><button class="icon-btn" type="button" data-sale-back aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="modal-body"><p>${sale.resolved?'Esta operação foi conciliada e não será sincronizada novamente.':'Encontramos uma venda antiga deste cliente que não está confirmada na nuvem.'}</p><div class="legacy-resolution-summary"><span><small>Data</small><b>${escape(formattedTime(sale.date))}</b></span><span><small>Valor da pendência</small><b>${escape(money(sale.amount))}</b></span><span><small>Forma de pagamento</small><b>${escape(sale.paymentMethod||'Não informada')}</b></span><span><small>Saldo atual na nuvem</small><b>${escape(money(Math.abs(Math.min(0,Number(sale.remoteCurrentBalance||0))))) } em aberto</b></span></div>${itemRows?`<h4>Itens registrados</h4><ul>${itemRows}</ul>`:''}<p class="muted">${escape(sale.reason)}</p><details class="sync-technical-ids"><summary>Detalhes técnicos</summary><code>Venda: ${escape(sale.saleId)}</code><code>Operação: ${escape(sale.operationId)}</code></details>${sale.resolved?`<div class="backup-warning"><b>Saldo conciliado:</b> ${escape(money(Math.abs(Math.min(0,Number(sale.reconciledBalanceBefore||0)))))} → ${escape(money(Math.abs(Math.min(0,Number(sale.reconciledBalanceAfter||0)))))} em aberto.</div>`:''}</div><footer class="modal-foot"><button class="btn btn-light" type="button" data-sale-back>${filter.fromCart?'Voltar ao carrinho':'Voltar'}</button>${!sale.resolved&&owner?'<button class="btn btn-light" type="button" data-sale-reconcile>Corrigir saldo manualmente</button>':''}${!sale.resolved&&sale.classification==='A'&&owner?`<button class="btn btn-primary" type="button" data-sale-recover="${escape(sale.saleId)}">Recuperar venda original</button>`:''}</footer></section></div>`;
  root.querySelectorAll('[data-sale-back]').forEach(button=>button.onclick=()=>{
    if(filter.fromCart)root.innerHTML='';else openQueueDetails(filter);
  });
  root.querySelector('[data-sale-recover]')?.addEventListener('click',()=>recoverOnlyLocalSale(sale));
  root.querySelector('[data-sale-reconcile]')?.addEventListener('click',()=>openManualReconciliation(sale,filter));
  window.lucide?.createIcons();
}
function openManualReconciliation(sale,filter={}){
  const root=document.querySelector('#modal'),currentDebt=Math.abs(Math.min(0,Number(sale.remoteCurrentBalance||0)));
  root.innerHTML=`<div class="modal-bg"><section class="modal-box sync-diagnostics-modal legacy-resolution-sheet"><header class="modal-head"><div><small>Corrigir saldo manualmente</small><h3>${escape(sale.customer||'Cliente')}</h3></div><button class="icon-btn" type="button" data-reconcile-back aria-label="Voltar"><i data-lucide="x"></i></button></header><form data-reconciliation-form><div class="modal-body"><div class="legacy-cloud-balance"><small>Saldo atual na nuvem</small><strong>${escape(money(currentDebt))} em aberto</strong></div><label class="field"><span>Saldo correto total em aberto</span><input name="correctDebt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0,00" required><small>Informe o total que o cliente realmente deve agora, não apenas o valor desta venda.</small></label><label class="field"><span>Motivo</span><textarea name="reason" required>Operação antiga não sincronizada</textarea></label><p class="muted">Isto criará um ajuste de reconciliação auditável. Não será criada uma venda ou receita.</p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-reconcile-back>Cancelar</button><button class="btn btn-primary" type="submit">Confirmar reconciliação</button></footer></form></section></div>`;
  root.querySelectorAll('[data-reconcile-back]').forEach(button=>button.onclick=()=>openOnlyLocalSaleDetails(sale.saleId,filter));
  root.querySelector('[data-reconciliation-form]').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),debt=Number(form.elements.correctDebt.value),reason=String(form.elements.reason.value||'').trim();
    if(!Number.isFinite(debt)||debt<0)return notify('Informe o saldo correto em aberto.',true);
    const before=money(Math.abs(Math.min(0,Number(sale.remoteCurrentBalance||0)))),after=money(debt);
    if(!confirm(`O saldo de ${sale.customer} será alterado de ${before} para ${after} em aberto.\n\nA operação antiga será marcada como conciliada e não será sincronizada novamente.`))return;
    button.disabled=true;button.textContent='Conciliando…';
    try{const result=await window.SyncFirebase.reconcileOnlyLocalSaleBalance(sale.saleId,debt,reason);root.innerHTML='';window.Checkout?.resumeAfterReconciliation?.(sale.customerId);window.DesktopSales?.refreshClients?.();notify(result.idempotent?'Esta pendência já estava conciliada.':'Saldo conciliado. O carrinho foi atualizado e o fiado deste cliente está liberado.');}
    catch(error){notify(error.message||'Não foi possível confirmar a reconciliação.',true);button.disabled=false;button.textContent='Confirmar reconciliação'}
  };
  window.lucide?.createIcons();
}
async function recoverOnlyLocalSale(sale){
  if(!confirm(`Recuperar somente a venda ${sale.saleId} de ${sale.customer} (${money(sale.amount)})? A nuvem será revalidada antes de qualquer alteração; um backup será baixado.`))return;
  try{const result=await window.SyncFirebase.recoverOnlyLocalSale(sale.saleId);notify(result.idempotent?'Venda já confirmada na nuvem.':'Venda recuperada e confirmada na nuvem.');openQueueDetails({customerId:sale.customerId})}
  catch(error){notify(error.message||'A recuperação foi interrompida sem reenviar outras vendas.',true);openQueueDetails({customerId:sale.customerId})}
}
function exportOnlyLocalSales(){
  try{const sales=window.SyncFirebase.onlyLocalSaleReport();const businessId=lastState?.details?.userBusinessId||'empresa';window.SyncFirebase.downloadJsonFile({version:148,mode:'read-only',generatedAt:new Date().toISOString(),businessId,sales},`auditoria-vendas-somente-locais-${businessId}-${Date.now()}.json`);notify('Auditoria detalhada exportada. O arquivo contém dados de clientes; guarde-o com cuidado.')}
  catch(error){notify(error.message||'Compare com a nuvem antes de exportar.',true)}
}

function incidentArchiveHtml(items){
  const incidents=items.filter(item=>['quarantined','archived'].includes(item.reviewState));
  if(!incidents.length)return '';
  return `<section class="sync-error-list" aria-label="Ocorrências preservadas"><h4>Ocorrências preservadas</h4>${incidents.map(item=>{
    const settings=item.reviewReason==='settings_permission_required';
    return `<article><b>${settings?'Configuração preservada — envio bloqueado neste perfil':item.reviewState==='archived'?'Arquivada / resolvida — reenvio bloqueado':'Preservada para análise — sem tentativa ativa'}</b><p>${settings?'Este perfil não pode alterar configurações da empresa. O registro original permanece para análise, sem reenvio automático ou manual.':'Nenhuma venda, baixa de estoque ou alteração financeira é executada por este arquivamento.'}</p>${settings?`<code>${escape(item.diagnostic?.path||item.firestorePath||'settings/default')}</code>`:''}<code>${escape(item.operationId)}</code><small>Checksum: ${escape(item.payloadChecksum)} · Tentativas preservadas: ${escape(item.retryCount)}</small>${item.archive?`<p>Encerrada em ${escape(formattedTime(item.archive.archivedAt))} · responsável: ${escape(item.archive.archivedBy)}.</p>`:settings||item.canArchive===false?'':`<button class="btn btn-light" type="button" data-archive-incident="${escape(item.operationId)}">Arquivar ocorrência sem reenviar</button>`}</article>`;
  }).join('')}</section>`;
}
function confirmRejectedStockRelease(operationId,filter={}){
  const root=document.querySelector('#modal');
  root.innerHTML=`<div class="modal-bg"><section class="modal-box" role="dialog" aria-modal="true" aria-label="Liberar produto"><header class="modal-head"><h3>Liberar vendas deste produto?</h3></header><div class="modal-body"><p>A edição de estoque recusada não teve efeito na nuvem. A VECONI vai conferir isso agora, preservar o original e voltar a usar o estoque da nuvem. Nenhuma venda, recebimento ou saldo é alterado.</p><p>Outras operações pendentes deste produto continuam preservadas e seguem o fluxo normal.</p><p data-release-result role="status"></p><div class="modal-actions"><button class="btn-secondary" type="button" data-release-back>Voltar</button><button class="btn-primary" type="button" data-release-confirm>Conferir e liberar</button></div></div></section></div>`;
  const button=root.querySelector('[data-release-confirm]'),back=root.querySelector('[data-release-back]');
  back.onclick=()=>openQueueDetails(filter);
  button.onclick=async()=>{
    button.disabled=true;back.disabled=true;button.textContent='Conferindo a nuvem…';
    try{await window.SyncFirebase.resolveRejectedStockEdit(operationId);openQueueDetails(filter);notify('Produto liberado. O original foi preservado e o estoque da nuvem voltou a ser usado.');}
    catch(error){root.querySelector('[data-release-result]').textContent=error?.message||'Não foi possível conferir a nuvem. Nada foi alterado.';button.disabled=false;back.disabled=false;button.textContent='Conferir e liberar';}
  };
}
function confirmIncidentArchive(operationId,filter={}){
  const item=(window.SyncFirebase.getQueueDiagnostics?.()||[]).find(i=>i.operationId===operationId&&i.reviewState==='quarantined');
  if(!item||item.canArchive===false||item.reviewReason==='settings_permission_required')return;
  const root=document.querySelector('#modal');
  root.innerHTML=`<div class="modal-bg"><section class="modal-box" role="dialog" aria-modal="true" aria-label="Arquivar ocorrência"><header class="modal-head"><h3>Arquivar ocorrência sem reenviar?</h3></header><div class="modal-body"><p>O registro original e a auditoria serão preservados. O reenvio desta operação ficará bloqueado permanentemente.</p><p>Esta ação não executa venda nem altera estoque, Financeiro ou fiado. Não afeta outras operações.</p><code>${escape(operationId)}</code><p role="status" data-archive-result></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-archive-back>Voltar</button><button class="btn btn-primary" type="button" data-archive-confirm>Confirmar arquivamento</button></footer></section></div>`;
  const button=root.querySelector('[data-archive-confirm]'),back=root.querySelector('[data-archive-back]');
  back.onclick=()=>openQueueDetails(filter);
  button.focus();
  button.onclick=async()=>{
    button.disabled=true;back.disabled=true;button.textContent='Preservando evidência…';
    try{await window.SyncFirebase.archiveQuarantinedOperation(operationId);openQueueDetails(filter);notify('Ocorrência arquivada. Evidência preservada e reenvio bloqueado.');}
    catch(error){root.querySelector('[data-archive-result]').textContent=window.SyncFirebase.describeError?.(error)||'Não foi possível confirmar o arquivamento. O original continua preservado.';button.disabled=false;back.disabled=false;button.textContent='Confirmar arquivamento';}
  };
}
function openPaymentReview(operationId){
  const root=document.querySelector('#modal');
  root.innerHTML=`<div class="modal-bg"><section class="modal-box"><header class="modal-head"><h3>Recebimento preservado</h3><button class="icon-btn close" type="button">×</button></header><div class="modal-body"><p>Operação <code>${escape(operationId)}</code></p><p>O original permanece neste aparelho. A conferência consulta o servidor e não registra pagamento. Vendas independentes continuam disponíveis; movimentações de dívida deste cliente aguardam revisão.</p><p>O arquivo financeiro omite nomes e contatos. O original privado pode conter dados pessoais: compartilhe apenas com o suporte autorizado. Nenhuma exportação envia dados automaticamente.</p><p data-payment-result role="status"></p></div><footer class="modal-foot"><button class="btn btn-light" data-payment-export type="button">Exportar dados financeiros</button><button class="btn btn-light" data-payment-private type="button">Exportar original privado</button><button class="btn btn-primary" data-payment-review type="button">Verificar recibo no servidor</button></footer></section></div>`;
  root.querySelector('.close').onclick=()=>openQueueDetails();
  const message=root.querySelector('[data-payment-result]');let busy=false;
  const run=async task=>{if(busy)return;busy=true;for(const b of root.querySelectorAll('button'))b.disabled=true;try{await task();}catch(e){message.textContent=e.message||'Conferência indisponível. Original preservado.';}finally{busy=false;for(const b of root.querySelectorAll('button'))b.disabled=false;}};
  root.querySelector('[data-payment-export]').onclick=()=>run(async()=>{await window.SyncFirebase.exportPreservedPayment(operationId);message.textContent='Arquivo financeiro salvo no aparelho. Fila original preservada.';});
  root.querySelector('[data-payment-private]').onclick=()=>{if(window.confirm('Exportar o original com possíveis dados pessoais para suporte autorizado? O arquivo será salvo apenas no aparelho.'))run(async()=>{await window.SyncFirebase.exportPreservedPayment(operationId,{includeOriginal:true});message.textContent='Original privado salvo no aparelho. Nenhum reenvio realizado.';});};
  root.querySelector('[data-payment-review]').onclick=()=>run(async()=>{
    const receipt=await window.SyncFirebase.recognizePreservedPayment(operationId);
    if(!receipt.confirmed)throw Error('Recibo sem confirmação. A revisão manual permanece ativa.');
    message.textContent='Recibo confirmado no servidor e saldo atualizado neste aparelho. O original continua preservado.';
  });
}
// First Pages release with the service cost fix (V241). Newer rejections remain actionable.
const SERVICE_COST_FIX_PUBLISHED_AT = Date.parse('2026-11-21T03:03:17Z');
function isHistoricalServiceRejection(item) {
  return item.activeError === true && item.reviewReason === 'service_configuration_missing' &&
    item.replayBlocked === true && item.canRetry === false &&
    Date.parse(item.createdAt) < SERVICE_COST_FIX_PUBLISHED_AT;
}

function syncPanelView(state = {}, entries = state.details?.queueErrors || []) {
  const historical = entries.filter(isHistoricalServiceRejection);
  const errors = Math.max(0, Number(state.errors || 0) - historical.length);
  const pending = Number(state.pending || 0);
  const failure = state.syncFailure || state.details?.syncFailure;
  const historicalFailure = failure && ['server_operational_commit', 'Queue operation'].includes(failure.stage) &&
    historical.some(item => item.operationId === failure.operationId &&
      item.businessId === failure.businessId &&
      String(failure.code || '').replace(/^functions\//, '') === item.errorCode);
  const historyOnly = historical.length > 0 && !errors &&
    (!failure || historicalFailure) && !state.queueDiagnosticWarning && !(Number(state.orphanOperations) > 0) &&
    !(state.status === 'error' && !historicalFailure && !String(state.message || '').startsWith('Sincronização incompleta:'));
  const historyMessage = historical.length === 1
    ? '1 operação histórica bloqueada para conferência.'
    : historical.length + ' operações históricas bloqueadas para conferência.';
  const historicalStatus = historyOnly && state.status === 'error';
  let status = state.status;
  let message = state.message;
  if (historicalStatus) {
    status = 'history';
    message = (pending ? pending + ' operação(ões) aguardando envio. ' : 'Nenhuma operação pendente de envio. ') + historyMessage;
  } else if (errors && String(message || '').startsWith('Sincronização incompleta:')) {
    message = errors + ' erro(s) que exigem atenção · ' + pending + ' pendência(s) de envio.';
  }
  return {historical, errors, pending, status, message, historyMessage, historicalStatus};
}
window.VeconiSyncPanelView = syncPanelView;

// Sync overview: the screen opens with one plain-language state and the checks behind
// it. "Tudo confirmado" needs this session's read-only comparison, never just an
// empty queue. Actions appear only when they can actually run.
const shortTime=value=>{const date=new Date(value||'');return value&&!Number.isNaN(date.getTime())?date.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';};
const plural=(count,one,many)=>count+' '+(count===1?one:many);
const balanceText=value=>value===null||value===undefined?'não lido nesta sessão':Number(value)<0?money(-Number(value))+' em aberto':Number(value)>0?money(value)+' de crédito':'zerado';
function readRetainedBalances(comparison){
  try{return window.SyncFirebase?.retainedClientBalances?.()||comparison?.retainedBalances||[];}catch{return comparison?.retainedBalances||[];}
}
function syncOverview(state={},items=[],view=syncPanelView(state,items)){
  const details=state.details||{},audit=details.dataAudit||state.dataAudit||null,comparison=details.comparison||state.comparison||null,
    integrity=state.integrityStatus||details.integrityStatus||'not_checked',
    waiting=Number(view.pending||0)+Number(state.processing||0)+Number(state.preparing||0),
    review=items.filter(item=>['error','manual_review','quarantined'].includes(item.category)).length,
    blocked=readRetainedBalances(comparison).filter(row=>row.blockedOnly),retained=blocked.filter(row=>row.difference),
    unread=blocked.some(row=>row.difference===null),
    collections=Object.values(audit?.collections||{}),sum=pick=>collections.reduce((total,item)=>total+pick(item),0),
    onlyLocal=sum(item=>(item.onlyLocal||[]).filter(row=>row.classification==='B'&&row.category!=='confirmed_legacy_fixture').length),
    onlyRemote=sum(item=>item.onlyRemote?.length||0),divergent=sum(item=>item.divergent?.length||0),
    balance=audit?.financial?.balanceScope,compared=integrity==='completed'&&Boolean(audit),
    differences=compared?onlyLocal+onlyRemote+divergent+(balance&&!balance.operationalMatches&&!retained.length?1:0):0,
    updating=state.status==='syncing'||integrity==='checking'||state.remoteReadRefresh?.status==='reading',
    when=shortTime(audit?.generatedAt);
  const key=updating?'updating':waiting?'unconfirmed':differences||retained.length?'differences':review?'review':compared?'confirmed':'unconfirmed';
  const copy={
    updating:['Atualizando dados','A VECONI está enviando ou conferindo informações. Espere terminar antes de decidir qualquer correção.'],
    differences:['Diferenças encontradas','O aparelho e a nuvem não coincidem em alguns registros ou saldos. Nada foi corrigido automaticamente; confira os detalhes abaixo.'],
    review:['Operações antigas precisando de revisão',plural(review,'operação foi recusada pela nuvem e está bloqueada','operações foram recusadas pela nuvem e estão bloqueadas')+', sem reenvio. Os originais continuam neste aparelho para conferência.'],
    confirmed:['Tudo confirmado','Nada aguarda envio e a comparação'+(when?' de '+when:'')+' não encontrou diferenças.'],
    unconfirmed:['Dados do aparelho ainda não confirmados na nuvem',waiting
      ?plural(waiting,'alteração deste aparelho ainda não foi confirmada','alterações deste aparelho ainda não foram confirmadas')+' pela nuvem. Elas continuam salvas aqui.'
      :integrity==='failed'?'A comparação com a nuvem não terminou. Os dados continuam salvos neste aparelho; tente comparar de novo.'
      :'Nada aguarda envio, mas a comparação com a nuvem ainda não foi feita nesta sessão. Use Comparar com a nuvem para confirmar.'],
  }[key];
  const checks=[
    {label:'Envio deste aparelho',value:waiting?plural(waiting,'alteração aguardando','alterações aguardando'):'Nada aguardando envio',tone:waiting?'warn':'ok'},
    {label:'Operações antigas',value:review?plural(review,'bloqueada para revisão','bloqueadas para revisão'):'Nenhuma bloqueada',tone:review?'warn':'ok'},
    {label:'Comparação com a nuvem',value:integrity==='checking'?'Em andamento':compared?(differences?plural(differences,'diferença encontrada','diferenças encontradas'):'Registros iguais'+(when?' em '+when:'')):integrity==='failed'?'Não terminou':'Ainda não feita nesta sessão',
      tone:integrity==='checking'?'info':compared?(differences?'warn':'ok'):integrity==='failed'?'warn':'muted'},
    {label:'Saldos de clientes',value:retained.length?plural(retained.length,'cliente com saldo retido','clientes com saldo retido'):unread?'Compare com a nuvem para conferir':'Nenhum saldo retido',
      tone:retained.length?'warn':unread?'muted':'ok'},
  ];
  return {key,title:copy[0],text:copy[1],checks,waiting,review,differences,retained,compared,integrity};
}
function syncActionRow(attribute,label,description,primary=false){
  return '<div class="sync-action"><button class="btn '+(primary?'btn-primary':'btn-light')+'" type="button" '+attribute+'>'+escape(label)+'</button><p>'+escape(description)+'</p></div>';
}
function syncOverviewHtml(overview){
  const actions=[];
  if(navigator.onLine!==false)actions.push(syncActionRow('data-compare-cloud','Comparar com a nuvem','Lê a nuvem e confere registro por registro. Não altera nada.',!overview.compared&&!overview.waiting));
  if(overview.review)actions.push(syncActionRow('data-open-blocked','Consultar operações bloqueadas','Mostra cada operação recusada, o erro original e o que ficou preservado.'));
  actions.push(syncActionRow('data-export-diagnostic','Exportar diagnóstico técnico','Salva no aparelho um arquivo técnico para o suporte, sem os dados completos dos clientes.'));
  actions.push('<div data-recovery-export-slot><p class="sync-action-note">Conferindo se há vendas originais elegíveis para recuperação…</p></div>');
  return '<section class="sync-overview is-'+escape(overview.key)+'" aria-labelledby="sync-overview-title"><h4 id="sync-overview-title">'+escape(overview.title)+'</h4><p>'+escape(overview.text)+'</p>'+
    '<dl class="sync-overview-checks">'+overview.checks.map(check=>'<div class="is-'+escape(check.tone)+'"><dt>'+escape(check.label)+'</dt><dd>'+escape(check.value)+'</dd></div>').join('')+'</dl>'+
    '<div class="sync-actions" role="group" aria-label="Ações disponíveis">'+actions.join('')+'</div></section>';
}
function recoveryExportActionHtml(count){
  if(count===null)return syncActionRow('data-export-recovery','Exportar originais para recuperação supervisionada','Abre a lista de vendas originais retidas que podem ir para o suporte autorizado.');
  if(count>0)return syncActionRow('data-export-recovery','Exportar originais para recuperação supervisionada',plural(count,'venda original retida pode ir','vendas originais retidas podem ir')+' para o suporte autorizado em arquivo protegido. Nada é reenviado.');
  return '<div class="sync-action is-unavailable"><b>Exportar originais para recuperação supervisionada</b><p>Indisponível nesta conta e aparelho: não há venda original retida por falta de permissão. Esse arquivo não é uma cópia geral dos dados; para isso, use Exportar diagnóstico técnico.</p></div>';
}
async function fillRecoveryExportSlot(slot){
  const api=window.SaleRecoveryExport;
  if(typeof api?.candidateCount!=='function'){slot.innerHTML=recoveryExportActionHtml(null);return;}
  try{const count=await api.candidateCount();if(slot.isConnected)slot.innerHTML=recoveryExportActionHtml(Number(count)||0);}
  catch{if(slot.isConnected)slot.innerHTML='<p class="sync-action-note">Não foi possível conferir agora se há vendas originais elegíveis. Nada foi alterado.</p>';}
}
function countComparisonHtml(comparison,scope){
  if(!comparison)return '';
  const local=comparison.local||{},remote=comparison.remote||{},basis=comparison.basis||{},rows=[],
    audited=name=>!comparison.scope?.collections||comparison.scope.collections.includes(name),
    plain=(label,device,cloud)=>'<article class="is-warn"><b>'+escape(label)+'</b><p>Neste aparelho: '+escape(device)+'. Na nuvem: '+escape(cloud)+'.</p></article>';
  for(const [name,label,device,cloud] of [['clients','Clientes',local.clientes,remote.clients],['products','Produtos',local.produtos,remote.products]])
    if(audited(name)&&device!==cloud)rows.push(plain(label,device,cloud));
  for(const [name,label,device,cloud] of [['sales','Vendas',local.vendas,remote.sales],['payments','Pagamentos',local.pagamentos,remote.payments]]){
    if(!audited(name))continue;
    const part=basis[name];
    if(!part){if(device!==cloud)rows.push(plain(label,device,cloud));continue;}
    const cloudComparable=part.remoteComparable??cloud,same=part.comparable===cloudComparable,
      aside=[part.archivedLegacyFiado?part.archivedLegacyFiado+' do Fiado antigo encerrado':'',part.heldByQueue?plural(part.heldByQueue,'retida na fila deste aparelho','retidas na fila deste aparelho'):''].filter(Boolean);
    rows.push('<article class="is-'+(same?'ok':'warn')+'"><b>'+escape(label)+'</b><p>Guardadas neste aparelho: '+escape(part.total)+(aside.length?'. Ficam fora da comparação '+escape(aside.join(' e ')):'')+'.</p>'+
      '<p>Comparáveis: '+escape(part.comparable)+' no aparelho e '+escape(cloudComparable)+' na nuvem'+(part.remoteArchivedLegacyFiado?', sem '+escape(part.remoteArchivedLegacyFiado)+' do Fiado antigo encerrado':'')+'. '+(same?'Iguais.':'Diferentes: compare registro por registro antes de qualquer correção.')+'</p></article>');
  }
  const localDebt=scope?.localActiveDebt??local.fiado,remoteDebt=scope?.remoteActiveDebt??remote.fiado,retained=Number(comparison.retainedDebtDifference||0);
  if(comparison.scope?.financialAudited!==false&&Math.abs(Number(localDebt||0)-Number(remoteDebt||0))>=0.01)
    rows.push('<article class="is-warn"><b>Fiado ativo</b><p>Neste aparelho: '+escape(money(localDebt))+'. Na nuvem: '+escape(money(remoteDebt))+'.</p>'+(retained?'<p>'+escape(money(Math.abs(retained)))+' dessa diferença vem de saldo de cliente retido neste aparelho, explicado abaixo.</p>':'')+'</article>');
  return '<section class="sync-data-state sync-count-comparison"><h4>Contagens do aparelho e da nuvem</h4><p>O aparelho guarda histórico que a nuvem não lista mais, como o Fiado antigo encerrado, e operações retidas na fila. Por isso os totais guardados não indicam perda: compare os números comparáveis.</p>'+rows.join('')+'</section>';
}
function retainedBalancesHtml(rows=[]){
  if(!rows.length)return '';
  return '<section class="sync-data-state sync-retained-balances" aria-label="Saldos retidos neste aparelho"><h4>Saldo de cliente retido neste aparelho</h4>'+
    '<p>Enquanto uma operação bloqueada do cliente não for revisada, este aparelho mantém o saldo local dele e não aplica o saldo da nuvem. O valor da nuvem já inclui o que o servidor confirmou, como regularizações e recebimentos. Não registre outro ajuste para compensar.</p>'+
    rows.map(row=>'<article><b>'+escape(row.clientName||'Cliente '+String(row.clientId).slice(0,8))+'</b><p>Neste aparelho: '+escape(balanceText(row.localBalance))+'. Na nuvem: '+escape(balanceText(row.cloudBalance))+'.</p><small>'+
      escape(plural(row.operations.length,'operação bloqueada','operações bloqueadas')+(row.operations[0]?.createdAt?', desde '+shortTime(row.operations[0].createdAt):'')+'. Nenhuma correção automática.')+'</small></article>').join('')+'</section>';
}

function openQueueDetails(filter={}){
  const state=window.SyncFirebase.refreshQueueStatus?.()||lastState||{},details=state.details||{},items=window.SyncFirebase.getQueueDiagnostics?.()||[],view=syncPanelView(state,items),errors=items.filter(item=>!isHistoricalServiceRejection(item)&&(item.activeError===true||item.activeError===undefined&&item.status==='error'&&!item.reviewRequired)),processing=items.filter(item=>item.status==='syncing').length,root=document.querySelector('#modal'),overview=syncOverview(state,items,view);
  root.innerHTML=`<div class="modal-bg viewport-modal"><section class="modal-box modal-wide sync-diagnostics-modal sync-queue-panel viewport-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-queue-title"><header class="modal-head"><h3 id="sync-queue-title">Sincronização dos dados</h3><button class="icon-btn close" type="button" aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="modal-body viewport-scroll">${syncOverviewHtml(overview)}<details class="sync-technical-summary"><summary>Detalhes técnicos da fila</summary><div class="firebase-sync-grid"><span>Pendências enviáveis</span><strong>${escape(view.pending)}</strong><span>Erros que exigem atenção</span><strong>${escape(view.errors)}</strong><span>Histórico bloqueado</span><strong>${view.historical.length}</strong><span>Processando</span><strong>${escape(processing)}</strong><span>Última tentativa</span><strong>${escape(formattedTime(details.lastAttemptAt))}</strong><span>Última sincronização completa</span><strong>${escape(formattedTime(details.lastCompleteSyncAt||state.lastSync))}</strong><span>Listener remoto</span><strong>${details.listenerConnected?'Ativo':'Inativo'}</strong><span>BusinessId</span><strong>${escape(details.userBusinessId||'—')}</strong><span>Build</span><strong>${escape(window.AdiFestaBuild?.shortCommit||'local')}</strong><span>Projeto</span><strong>${escape(details.projectId||'—')}</strong></div></details><section class="sync-error-list sync-active-errors"><h4>Erros que exigem atenção</h4>${errors.length?errors.slice(0,50).map(item=>`<article><b>${escape(item.entityType)} · ${escape(item.action)}</b><small>${escape(formattedTime(item.createdAt))}</small><p>${escape(item.errorCode||'erro')}: ${escape(item.errorMessage||'A operação precisa de atenção.')}</p><code>${escape(item.operationId.slice(0,10))}… · ${escape(item.origin)}</code></article>`).join(''):'<p>Nenhum erro ativo exige atenção na fila.</p>'}</section></div><footer class="modal-foot"><button class="btn btn-light close" type="button">Fechar</button><button class="btn btn-light" type="button" data-open-technical>Ver diagnóstico técnico</button><button class="btn btn-primary" type="button" data-retry-all disabled>Nenhuma operação enviável</button></footer></section></div>`;
  if (view.historical.length) {
    root.querySelector('.sync-error-list').insertAdjacentHTML('beforebegin',
      '<details class="sync-data-state sync-blocked-history"><summary>Histórico bloqueado · ' + view.historical.length +
      '</summary><p>Reenvio bloqueado. Os registros, erros e evidências originais continuam neste aparelho.</p>' +
      (view.historical.some(item => item.reviewReason === 'service_configuration_missing')
        ? '<p>Vendas de serviço recusadas antes de qualquer gravação: a nuvem não registrou essas vendas, nem baixa de estoque, saldo ou receita delas. O reenvio fica bloqueado para não recalcular o custo com a configuração atual. Recuperar com o custo original ou encerrar sem efeitos depende de decisão do responsável.</p>'
        : '') +
      '<div class="sync-error-list">' +
      view.historical.map(renderQueueError).join('') + '</div></details>');
  }
  root.querySelector('.sync-diagnostics-modal .firebase-sync-grid')?.insertAdjacentHTML('beforeend',`<span>Pendências comprovadas / somente locais</span><strong>${escape(state.orphanOperations||0)}</strong>`);
  root.querySelector('.modal-body')?.insertAdjacentHTML('beforeend',operationConfirmationHtml(details));
  const errorSection=root.querySelector('.sync-active-errors');if(errorSection&&errors.length)errorSection.innerHTML=`<h4>Erros que exigem atenção</h4>${errors.slice(0,50).map(renderQueueError).join('')}`;
  if(errors.some(item=>item.reviewReason==='product_stock_review_required')){
    const releases=errors.filter(item=>item.reviewReason==='product_stock_review_required').map(item=>`<button class="btn-primary" type="button" data-release-stock="${escape(item.operationId)}">Liberar vendas deste produto</button>`).join('');
    errorSection?.insertAdjacentHTML('afterbegin',`<p class="backup-warning" role="status">Uma edição tentou alterar o estoque sem registrar um movimento e foi recusada pela nuvem, sem nenhum efeito. O proprietário pode liberar o produto: a VECONI confere a nuvem, preserva o original e volta a usar o estoque da nuvem. Depois, use Comparar com a nuvem e confira o estoque físico; se necessário, use Ajustar estoque.</p>${window.BusinessContext?.get?.()?.role==='owner'?releases:''}`);
    root.querySelectorAll('[data-release-stock]').forEach(button=>button.onclick=()=>confirmRejectedStockRelease(button.dataset.releaseStock));
  }
  if(errors.some(item=>item.reviewReason==='sync_receipt_review_required'))
    errorSection?.insertAdjacentHTML('afterbegin','<p class="backup-warning" role="status">Confira o resultado desta operação na nuvem antes de registrar outra. A tentativa original continua salva neste aparelho.</p>');
  if(errors.some(item=>item.reviewState==='verification_failed'))errorSection?.insertAdjacentHTML('afterbegin','<p class="backup-warning" role="alert">Há confirmação inválida ou divergente. Os erros originais foram preservados e o reenvio permanece bloqueado. É necessário conferir o recibo e a identidade da operação.</p>');
  const resolved=items.filter(item=>item.reviewState==='resolved'),manual=items.filter(item=>item.reviewState==='manual_review');
  const grid=root.querySelector('.firebase-sync-grid');
  if(grid){for(const span of grid.querySelectorAll('span')){if(span.textContent==='Pendentes')span.textContent='Pendências enviáveis';if(span.textContent==='Com erro')span.textContent='Erros ativos';}grid.insertAdjacentHTML('beforeend',`<span>Revisões manuais</span><strong>${manual.length}</strong><span>Arquivados/resolvidos</span><strong>${items.filter(i=>['archived','resolved'].includes(i.reviewState)).length}</strong>`);}
  root.querySelector('h3').textContent='Sincronização dos dados';
  if(resolved.length)errorSection?.insertAdjacentHTML('beforebegin',`<section role="status"><b>${resolved.length} ocorrências resolvidas preservadas para auditoria.</b><p>Reenvio bloqueado. Fila e payloads originais preservados.</p>${resolved.map(i=>`<details><summary>${escape(i.operationId)}</summary><p>${escape(i.resolution.status)} · ${escape(formattedTime(i.resolution.resolvedAt))}<br>Registro confirmado: ${escape(i.resolution.paymentId||i.resolution.linkedSaleId||i.resolution.saleId||'Nenhum — encerrado sem efeitos')}</p><p>Erro original preservado: ${escape(i.errorCode)} · ${escape(i.errorMessage)}<br>Tentativas originais: ${escape(i.retryCount)}<br>Checksum original: <code>${escape(i.payloadChecksum)}</code></p></details>`).join('')}</section>`);
  if(manual.length)errorSection?.insertAdjacentHTML('beforebegin','<p role="status">Revisão manual — confirmação pendente. Nenhum reenvio automático será realizado.</p>');
  const held=items.filter(item=>item.reviewRequired),quarantined=held.filter(item=>item.reviewState==='quarantined'),retainedSales=held.filter(item=>item.reviewState==='manual_review'&&!item.paymentReview&&!item.paymentDependency&&item.reviewReason!=='product_stock_dependency');
  if(held.some(item=>item.reviewReason==='product_stock_dependency'))errorSection?.insertAdjacentHTML('beforebegin','<p role="status">Há operações aguardando a conferência do estoque do mesmo produto. Operações de outros produtos podem continuar.</p>');
  const receipts=held.filter(item=>item.paymentReview);
  if(receipts.length)errorSection?.insertAdjacentHTML('beforebegin',`<section class="backup-warning"><h4>Recebimentos preservados para revisão</h4><p>Sem reenvio automático. Somente movimentações financeiramente dependentes ficam bloqueadas.</p>${receipts.map(item=>`<article><code>${escape(item.operationId)}</code><p>${escape(item.errorMessage)}</p><button type="button" class="btn btn-light" data-payment-open="${escape(item.operationId)}">Exportar ou conferir original</button></article>`).join('')}</section>`);
  if(held.some(item=>item.paymentDependency))errorSection?.insertAdjacentHTML('beforebegin','<p role="status">Há movimentações de dívida aguardando revisão de um recebimento do mesmo cliente. Outras vendas independentes podem sincronizar.</p>');
  root.querySelectorAll('[data-payment-open]').forEach(button=>button.onclick=()=>openPaymentReview(button.dataset.paymentOpen));
  errorSection?.insertAdjacentHTML('beforebegin',incidentArchiveHtml(items));
  root.querySelectorAll('[data-archive-incident]').forEach(button=>button.onclick=()=>confirmIncidentArchive(button.dataset.archiveIncident,filter));
  if(quarantined.length)errorSection?.insertAdjacentHTML('beforebegin',`<section class="backup-warning" role="status"><b>${quarantined.length} operação(ões) em quarentena</b><p>Registro preservado para análise. Envio e alteração automática estão bloqueados, inclusive ao sincronizar manualmente.</p></section>`);
  if(retainedSales.length)errorSection?.insertAdjacentHTML('beforebegin',`<section class="backup-warning" role="status"><b>${retainedSales.length} venda(s) preservada(s) — aguardando revisão</b><p>O reenvio dessas operações está bloqueado, inclusive na sincronização manual. Seus registros e erros originais foram mantidos neste aparelho para evitar baixa ou receita duplicada.</p></section>`);
  const dataAudit=details.dataAudit||state.dataAudit||null,scope=dataAudit?.financial?.balanceScope;
  const comparison=details.comparison||state.comparison;
  // Raw totals measure different universes; show comparable numbers and retained balances.
  errorSection?.insertAdjacentHTML('beforebegin',countComparisonHtml(comparison,scope)+retainedBalancesHtml(overview.retained));
  errorSection?.insertAdjacentHTML('beforebegin',dataAuditHtml(dataAudit));
  if(dataAudit?.collections?.sales?.onlyLocal?.length)
    errorSection?.insertAdjacentHTML('beforebegin',onlyLocalSalesHtml(filter));
  const footer=root.querySelector('.modal-foot');
  // Compare, diagnostic and recovery export live in the overview actions, each with its purpose.
  if(dataAudit?.products?.onlyLocal||dataAudit?.clients?.onlyLocal)footer.insertAdjacentHTML('afterbegin','<button class="btn btn-primary" type="button" data-recover-local>Recuperar dados locais ausentes</button>');
  if(dataAudit?.collections?.sales?.onlyLocal?.length)footer.insertAdjacentHTML('afterbegin','<button class="btn btn-light" type="button" data-export-only-local>Exportar auditoria das vendas</button>');
  // V157 audit is read-only. No bulk financial repair CTA for historical effects.
  const canRefresh=dataAudit&&state.queueTotal===0&&!Object.values(dataAudit.collections||{}).some(item=>item.onlyLocal?.length||item.divergent?.length);
  if(canRefresh)footer.insertAdjacentHTML('afterbegin','<button class="btn btn-light" type="button" data-refresh-server>Atualizar deste servidor</button>');
  root.querySelectorAll('.close').forEach(button=>button.onclick=()=>root.innerHTML='');
  root.querySelector('[data-open-technical]').onclick=event=>{const panel=document.querySelector('.desktop-technical-details'),mobile=document.querySelector('#firebase-details');if(panel||mobile){root.innerHTML='';if(panel)panel.open=true;if(mobile)mobile.hidden=false;return}const existing=root.querySelector('[data-sync-technical]');if(existing){existing.remove();event.currentTarget.textContent='Ver diagnóstico técnico';return}root.querySelector('.modal-body').insertAdjacentHTML('afterbegin',`<details data-sync-technical open><summary>Diagnóstico técnico</summary><dl class="firebase-sync-grid">${technicalDetails({...state.details,lastSyncAt:state.lastSync})}</dl></details>`);event.currentTarget.textContent='Ocultar diagnóstico técnico'};
  const retryAll=root.querySelector('[data-retry-all]');
  if(items.some(item=>item.canRetry===true)){retryAll.disabled=false;retryAll.textContent=errors.some(item=>item.canRetry)?'Reprocessar erros elegíveis':'Sincronizar pendentes';retryAll.onclick=async()=>{await manualSync();openQueueDetails(filter)}}
  else{retryAll.disabled=true;retryAll.textContent=view.errors?'Reenvio bloqueado — conferir evidências':manual.length?'Aguardando revisão':'Nenhuma operação enviável';retryAll.onclick=null;}
  root.querySelector('[data-export-diagnostic]').onclick=exportDiagnostic;
  const compareButton=root.querySelector('[data-compare-cloud]');if(compareButton)compareButton.onclick=event=>compareCloudData(event.currentTarget);
  root.querySelector('[data-open-blocked]')?.addEventListener('click',()=>{const target=root.querySelector('.sync-blocked-history')||root.querySelector('.sync-active-errors');if(!target)return;if(target.tagName==='DETAILS')target.open=true;target.scrollIntoView?.({block:'start'});(target.querySelector('summary')||target).focus?.();});
  const recoverySlot=root.querySelector('[data-recovery-export-slot]');if(recoverySlot)void fillRecoveryExportSlot(recoverySlot);
  root.querySelector('[data-export-only-local]')?.addEventListener('click',exportOnlyLocalSales);
  root.querySelector('[data-sale-show-all]')?.addEventListener('click',()=>openQueueDetails());
  root.querySelectorAll('[data-sale-detail]').forEach(button=>button.onclick=()=>openOnlyLocalSaleDetails(button.dataset.saleDetail,filter));
  root.querySelectorAll('[data-sale-recover]').forEach(button=>button.onclick=()=>{const sale=(window.SyncFirebase.onlyLocalSaleReport?.()||[]).find(item=>item.saleId===button.dataset.saleRecover);if(sale)recoverOnlyLocalSale(sale)});
  root.querySelector('[data-recover-local]')?.addEventListener('click',recoverLocalData);
  root.querySelector('[data-reconcile-balances]')?.addEventListener('click',reconcileBalances);
  root.querySelector('[data-refresh-server]')?.addEventListener('click',async()=>{try{await window.SyncFirebase.refreshSafelyFromServer();notify('Dados deste servidor atualizados com segurança.');openQueueDetails()}catch(error){notify(error.message||'Não foi possível atualizar deste servidor.',true)}});
  window.lucide?.createIcons();
}
function ensureDetailsButton(){
  const syncButton=document.querySelector('#firebase-sync');
  if(!syncButton||document.querySelector('[data-sync-details]'))return;
  const button=document.createElement('button');
  button.type='button';button.className='btn btn-light';button.dataset.syncDetails='true';button.innerHTML='<i data-lucide="list-tree"></i> Ver detalhes';button.onclick=openQueueDetails;
  syncButton.insertAdjacentElement('afterend',button);window.lucide?.createIcons();
}

function baseTechnicalDetails(d){const build=window.AdiFestaBuild||{},uid=d.uid?`${String(d.uid).slice(0,6)}…${String(d.uid).slice(-4)}`:'—',common=`<dt>Projeto Firebase</dt><dd>${escape(d.projectId||'—')}</dd><dt>BusinessId atual</dt><dd>${escape(d.userBusinessId||'—')}</dd><dt>UID abreviado</dt><dd>${escape(uid)}</dd><dt>Última sincronização</dt><dd>${escape(formattedTime(d.lastSyncAt))}</dd><dt>Itens pendentes</dt><dd>${escape(d.pendingOperations??0)}</dd><dt>Schema</dt><dd>${escape(d.schemaVersion??3)}</dd><dt>Versão do app</dt><dd>${escape(build.appVersion||build.release||'—')}</dd><dt>Build</dt><dd>${escape(build.shortCommit||'local')}</dd><dt>Data do build</dt><dd>${escape(build.builtAt?formattedTime(build.builtAt):'—')}</dd>`;if(document.querySelector('.mobile-settings-page'))return `${common}<dt>Migration Version</dt><dd>${escape(window.FirebaseBootstrap?.details?.migrationVersion??'—')}</dd><dt>Perfil</dt><dd>${escape(`${d.userRole||'—'} · ${d.userActive?'ativo':'inativo'}`)}</dd><dt>Listener da empresa</dt><dd>${d.listenerConnected?'ativo':'inativo'}</dd><dt>Cache hidratado</dt><dd>${d.hydrated?'sim':'não'}</dd><dt>Último erro</dt><dd>${escape(d.lastErrorCode?`${d.lastErrorCode}: ${d.lastErrorMessage}`:'nenhum')}</dd>`;return `${common}<dt>Banco</dt><dd>${escape(d.databaseId)}</dd><dt>Perfil</dt><dd>${escape(`${d.userRole||'—'} · ${d.userActive?'ativo':'inativo'}`)}</dd><dt>Negócio localizado</dt><dd>${d.businessDocumentExists?'sim':'não'}</dd><dt>Listener da empresa</dt><dd>${d.listenerConnected?'ativo':'inativo'}</dd><dt>Cache hidratado</dt><dd>${d.hydrated?'sim':'não'}</dd><dt>Leituras nesta sessão</dt><dd>${escape(d.sessionReads??0)}</dd><dt>Gravações nesta sessão</dt><dd>${escape(d.sessionWrites??0)}</dd><dt>Consultas nesta sessão</dt><dd>${escape(d.sessionQueries??0)}</dd><dt>Último erro</dt><dd>${escape(d.lastErrorCode?`${d.lastErrorCode}: ${d.lastErrorMessage}`:'nenhum')}</dd>`}
function technicalDetails(d){
  const failure=d.syncFailure,audit=d.integrityFailure;
  return baseTechnicalDetails(d)+`<dt>Canal autorizado de Sync</dt><dd>${d.operationalProtocol?.status==='verified'?'Protocolo 1 confirmado nesta sessão (V202+)':'Ainda não confirmado nesta sessão'}</dd><dt>Verificação de integridade</dt><dd>${escape(({not_checked:'Não verificado — auditoria separada',checking:'Em andamento',completed:'Concluída',failed:'Não concluída; não invalida a transferência de dados'})[d.integrityStatus]||'Não verificado')}</dd>`+
    [failure,audit].filter(Boolean).map(item=>`<dt>Etapa / serviço</dt><dd>${escape(item.stage)} · ${escape(item.service||'aplicativo')}</dd><dt>Coleção / consulta</dt><dd>${escape(item.collection||'—')} · ${escape(item.request||'—')}</dd><dt>Documento / destino</dt><dd>${escape(item.path||'Transação com múltiplos destinos; documento negado não individualizado.')}</dd>${item.pathAttribution==='payload_target_not_individual_rule_result'?'<dt>Identificação do erro</dt><dd>Falha no commit atômico. O destino do pacote não identifica sozinho qual Rule rejeitou a transação.</dd>':''}${item.lastObservedPath?`<dt>Último caminho observado / preparado</dt><dd>${escape(item.lastObservedPath)}</dd>`:''}<dt>Erro técnico</dt><dd>${escape(item.code)}: ${escape(item.message)}</dd>`).join('');
}

const setText=(element,value)=>{const text=String(value??'');if(element&&element.textContent!==text)element.textContent=text};
const setHtml=(element,value)=>{if(element&&element.innerHTML!==value)element.innerHTML=value};
function recoveryCounters(state){
  const panel=document.querySelector('#cloud-sync-panel');if(!panel)return;
  const grid=panel.querySelector('.firebase-sync-grid');
  if(grid&&!panel.querySelector('[data-cloud-manual]'))grid.insertAdjacentHTML('beforeend','<span>Histórico bloqueado</span><strong data-cloud-history></strong><span>Revisões manuais</span><strong data-cloud-manual></strong><span>Arquivados/resolvidos</span><strong data-cloud-resolved></strong>');
  for(const label of grid?.querySelectorAll('span')||[]){if(label.textContent==='Pendências')label.textContent='Pendências enviáveis';if(label.textContent==='Erros')label.textContent='Erros que exigem atenção';}
  const view=syncPanelView(state);
  setText(panel.querySelector('[data-cloud-history]'),view.historical.length);
  setText(panel.querySelector('[data-cloud-pending]'),view.pending);
  setText(panel.querySelector('[data-cloud-manual]'),state.manualReviewPending||0);
  setText(panel.querySelector('[data-cloud-resolved]'),state.archivedOccurrences||0);
}
function renderState(state){lastState=state;window.SyncFirebaseState=state;const view=syncPanelView(state),last=formattedTime(state.lastSync),status=document.querySelector('#firebase-status');if(status){const className=`firebase-status is-${view.status}`;if(status.className!==className)status.className=className;setText(status,view.message);setText(document.querySelector('#firebase-last-sync'),last);setText(document.querySelector('#firebase-pending'),state.pending);setText(document.querySelector('#firebase-errors'),view.errors);setText(document.querySelector('#firebase-orphans'),state.orphanOperations||0);setText(document.querySelector('#mobile-sync-pending'),state.pending);setText(document.querySelector('#mobile-sync-last'),last)}setHtml(document.querySelector('#firebase-details'),technicalDetails({...state.details,lastSyncAt:state.lastSync}));const modal=document.querySelector('#cloud-sync-panel');if(modal){setText(modal.querySelector('[data-cloud-status]'),view.message);setText(modal.querySelector('[data-cloud-last]'),last);setText(modal.querySelector('[data-cloud-pending]'),state.pending);setText(modal.querySelector('[data-cloud-errors]'),view.errors);setText(modal.querySelector('[data-cloud-orphans]'),state.orphanOperations||0);const icon=modal.querySelector('.cloud-panel-icon');if(icon)icon.className='cloud-panel-icon is-'+view.status;}recoveryCounters(state)}

function openHeaderPanel(){
  const state=window.SyncFirebase.refreshQueueStatus?.()||lastState;if(!state)return;
  const view=syncPanelView(state),financial=state.details?.dataAudit?.financial;
  document.querySelector('#modal').innerHTML=`<div class="modal-bg viewport-modal"><section class="modal-box cloud-panel sync-queue-panel viewport-dialog" id="cloud-sync-panel" role="dialog" aria-modal="true" aria-labelledby="cloud-sync-title"><header class="modal-head"><h3 id="cloud-sync-title">Sincronização</h3><button class="icon-btn close" type="button" aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="modal-body viewport-scroll"><div class="cloud-panel-icon is-${escape(view.status)}"><i data-lucide="cloud"></i></div><h3 data-cloud-status>${escape(view.message)}</h3><div class="firebase-sync-grid"><span>Conexão</span><strong>${navigator.onLine?'Online':'Offline'}</strong><span>Última sincronização</span><strong data-cloud-last>${escape(formattedTime(state.lastSync))}</strong><span>Pendências</span><strong data-cloud-pending>${view.pending}</strong><span>Erros</span><strong data-cloud-errors>${view.errors}</strong><span>Pendências comprovadas / somente locais</span><strong data-cloud-orphans>${escape(state.orphanOperations||0)}</strong></div>${fiadoScopeHtml(financial?.balanceScope,financial?.balanceAudit)}${operationConfirmationHtml(state.details)}</div><footer class="modal-foot"><button class="btn btn-light close" type="button">Fechar</button><button class="btn btn-light" id="cloud-panel-details" type="button">Ver detalhes</button><button class="btn btn-primary" id="cloud-panel-sync" type="button">Sincronizar agora</button></footer></section></div>`;
  recoveryCounters(state);
  document.querySelectorAll('#cloud-sync-panel .close').forEach(button=>button.onclick=()=>document.querySelector('#modal').innerHTML='');document.querySelector('#cloud-panel-details').onclick=openQueueDetails;document.querySelector('#cloud-panel-sync').onclick=manualSync;window.lucide?.createIcons();
}

function bindHeader(){const badge=document.querySelector('.local-badge');if(!badge||badge.dataset.cloudPanelBound)return;badge.dataset.cloudPanelBound='true';badge.onclick=openHeaderPanel;badge.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();openHeaderPanel()}}}
function mount(){bindHeader();if(location.hash.includes('configuracoes'))queueMicrotask(()=>{settingsPanel();ensureDetailsButton();if(lastState)renderState(lastState)})}
addEventListener('resolve-sale-conflict',async event=>{const filter={customerId:String(event.detail?.customerId||''),saleId:String(event.detail?.saleId||''),fromCart:true};try{await window.SyncFirebase.compareDeviceWithCloud();const sale=(window.SyncFirebase.onlyLocalSaleReport?.()||[]).find(item=>item.saleId===filter.saleId)||(window.SyncFirebase.onlyLocalSaleReport?.()||[]).find(item=>item.customerId===filter.customerId&&!item.resolved);if(sale)openOnlyLocalSaleDetails(sale.saleId,filter);else openQueueDetails(filter)}catch(error){notify(error.message||'Não foi possível comparar com a nuvem. O carrinho foi preservado.',true);openQueueDetails(filter)}});
addEventListener('hashchange',mount);addEventListener('firebase-auth-ready',()=>{unsubscribe?.();unsubscribe=window.SyncFirebase.subscribe(renderState);mount()});new MutationObserver(mount).observe(document.querySelector('main')||document.body,{childList:true,subtree:true});mount();
