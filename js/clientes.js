window.Clientes=(()=>{
  const normalizePhone=value=>PhoneUtils.normalizeBrazilianPhone(value);
  const baseView = () => DB.readForView?.() || DB.carregar();
  const listar = () => baseView().clientes;
  const obter = id => listar().find(c => c.id === id);
  let lastView;
  function viewData() {
    const data = baseView(), context = window.SpaceContext;
    if (!context?.scopesCustomers?.()) return data;
    const scope = context.viewScope();
    if (lastView?.data !== data || lastView.scope !== scope) lastView = { data, scope, result: context.contextualData(data, 'clients') };
    return lastView.result;
  }
  const viewClient = id => (viewData().clientes || []).find(c => c.id === id);
  const scopedScreen = () => window.Router?.atual?.() === 'clientes' && window.SpaceContext?.scopesCustomers?.();
  const unknown = reason => ({saldo:NaN,status:'unverified',debt:0,credit:0,reason});
  const spaceAccountMessage = 'O saldo tem origem em outro espaço ou origem não comprovada. Confira o Fiado da empresa antes de cobrar ou receber.';
  function accountBelongsTo(account, spaceId) {
    return Boolean(spaceId && account && account.creditCents === 0 && Array.isArray(account.entries) &&
      account.entries.every(row => row.spaceId === spaceId && Number.isSafeInteger(row.remainingCents) && row.remainingCents > 0) &&
      account.entries.reduce((sum, row) => sum + row.remainingCents, 0) === account.totalCents);
  }
  async function confirmSpaceAccount(id, scope = window.SpaceContext?.viewScope?.()) {
    const context = window.SpaceContext, space = context?.activeId?.();
    if (!space || scope !== context.viewScope() || !viewClient(id)) throw Error('O cliente ou espaço ativo mudou. Abra a conta novamente.');
    const account = await window.InstallmentCredit.refresh(id);
    if (scope !== context.viewScope() || !viewClient(id) || !accountBelongsTo(account, space)) throw Object.assign(Error(spaceAccountMessage), {code:'fiado-space-unverified'});
    return account;
  }
  function financialStatus(client, scoped = scopedScreen()) {
    if (scoped && (window.TeamAccess?.has?.('customers.receiveDebt') === false || window.OperationalReadPolicy?.restricted?.()))
      return unknown('Seu perfil não pode consultar o Fiado neste espaço.');
    const account = (window.InstallmentCredit?.confirmedAccount || window.InstallmentCredit?.account)?.(client?.id);
    if (scoped) {
      if (account && !accountBelongsTo(account, window.SpaceContext?.activeId?.())) return unknown(spaceAccountMessage);
      if (!account && (Number(client?.saldo) !== 0 || window.InstallmentCredit?.has?.(client?.id))) return unknown();
    }
    if (!account && window.InstallmentCredit?.has?.(client?.id)) return unknown();
    const saldo = account ? (account.creditCents - account.dueCents) / 100 : Math.round((Number(client?.saldo) || 0) * 100) / 100;
    return {saldo, futureCents:account?.futureCents || 0, status:saldo<0?'debt':saldo>0?'credit':'zero', debt:Math.abs(Math.min(0,saldo)),credit:Math.max(0,saldo)};
  }
  function originalAccountAction() {
    return window.Fiados?.canOpenOriginal?.()
      ? '<button type="button" class="btn btn-light" data-open-original-fiado>Consultar conta original do Fiado</button>' : '';
  }
  function unassignedMarkup() {
    const rows = viewData().unassignedCustomers || [];
    if (!rows.length) return scopedScreen() && !(viewData().clientes || []).length
      ? '<p class="muted">Nenhum vínculo de cliente foi confirmado neste espaço com os dados disponíveis. O cadastro da empresa continua acessível na seleção de clientes em Vendas.</p>' : '';
    return `<details class="card space-unassigned-customers"><summary>${rows.length} cliente(s) sem espaço confirmado</summary><p>Cadastros preservados no diretório da empresa. Uma venda ou renovação com espaço identificado permite encontrá-los aqui.</p><ul>${rows.map(client => `<li>${Utils.escapar(client.nome)}</li>`).join('')}</ul></details>`;
  }
  const allowed=key=>window.TeamAccess?window.TeamAccess.has(key)===true:!window.FirebaseSession?.user;
  const assertPermission=key=>{if(!allowed(key))throw Object.assign(Error(window.VeconiPermissionPolicy?.MESSAGE||'Você não tem permissão para realizar esta ação. Solicite ao gestor que habilite esta função em Equipe → Permissões.'),{code:'customer-edit-permission-required',permission:key});};
  const canEdit=()=>allowed('customers.edit'),canCreate=()=>allowed('customers.create');
  const assertCanEdit=()=>assertPermission('customers.edit'),assertCanCreate=()=>{assertPermission('customers.create');window.TeamAccess?.assertCustomerProtocol?.();};
  const assertCanSave=id=>id?assertCanEdit():assertCanCreate();
  const salvar=d=>{assertCanSave(d.id);if(d.id&&!obter(d.id))throw Error('Cliente não encontrado nesta sessão. Nenhum cadastro foi criado.');if(!d.id&&window.PlanLimitService)PlanLimitService.assert(PlanLimitService.canCreateClient(),'criar novos clientes');let salvo;DB.alterar(db=>{
    assertCanSave(d.id);
    const atual=db.clientes.find(c=>c.id===d.id),agora=new Date().toISOString(),telefone=d.telefone||'',normalizedPhone=normalizePhone(telefone),duplicado=db.clientes.find(c=>c.id!==d.id&&normalizedPhone&&normalizePhone(c.normalizedPhone||c.telefone)===normalizedPhone);
    if(duplicado)throw Error(`Este WhatsApp já pertence a ${duplicado.nome}.`);
    const consent=d.marketingConsent===true||d.marketingConsent==='true',previousConsent=atual?.marketingConsent===true;const campos={nome:d.nome.trim(),apelido:d.apelido||'',telefone,normalizedPhone,telefone2:d.telefone2||'',email:d.email||'',endereco:d.endereco||'',cidade:d.cidade||atual?.cidade||'',estado:d.estado||atual?.estado||'',complemento:d.complemento||'',documento:d.documento||'',observacoes:d.observacoes||'',marketingConsent:consent,marketingConsentAt:consent?(atual?.marketingConsentAt||agora):null,marketingConsentSource:consent?(d.marketingConsentSource||atual?.marketingConsentSource||'manual'):null,marketingConsentRevokedAt:previousConsent&&!consent?agora:(atual?.marketingConsentRevokedAt||null),origemCadastro:d.origemCadastro||atual?.origemCadastro||'app',portalRefToken:d.portalRefToken||atual?.portalRefToken||Utils.uuid(),ativo:d.ativo!==false,atualizadoEm:agora};
    if(atual){if(!atual.portalRefToken&&!d.portalRefToken)delete campos.portalRefToken;delete campos.ativo;Object.assign(atual,campos);salvo=atual}else{salvo={id:Utils.uuid(),...campos,totalComprado:0,quantidadeVendas:0,saldo:0,financialVersion:0,ultimaCompra:null,etiquetas:[],promessaPagamento:null,criadoEm:agora};db.clientes.push(salvo)}
  });return salvo};
  const setActive=(id,enabled)=>{assertPermission('customers.archive');if(typeof enabled!=='boolean')throw Error('Estado de cliente inválido.');return DB.alterar(db=>{assertPermission('customers.archive');const cliente=db.clientes.find(c=>c.id===id);if(!cliente)throw Error('Cliente não encontrado.');Object.assign(cliente,{ativo:enabled,active:enabled,atualizadoEm:new Date().toISOString()});if(enabled&&cliente.deletedAt)cliente.deletedAt=null})};
  const excluir=id=>setActive(id,false);
  const importar=(registros,opcoes={possuiSaldo:true})=>{assertCanCreate();assertCanEdit();if(window.FirebaseSession?.user&&opcoes.possuiSaldo&&registros.some(c=>Number(c.saldo||0)!==0))throw Object.assign(Error('A importação com saldos exige a conferência financeira autorizada. Nenhum cadastro ou saldo foi alterado.'),{code:'authorized-financial-import-required'});return DB.alterar(db=>registros.forEach(registro=>{
    assertCanCreate();assertCanEdit();
    const normalizedPhone=normalizePhone(registro.telefone),nome=String(registro.nome).trim().toLowerCase(),existente=db.clientes.find(c=>(normalizedPhone&&normalizePhone(c.normalizedPhone||c.telefone)===normalizedPhone)||String(c.nome).trim().toLowerCase()===nome),agora=new Date().toISOString();
    if(existente){existente.nome=registro.nome;if(registro.telefone){existente.telefone=registro.telefone;existente.normalizedPhone=normalizedPhone}if(registro.observacoes)existente.observacoes=registro.observacoes;if(opcoes.possuiSaldo)existente.saldo=Number(registro.saldo||0);existente.portalRefToken||=Utils.uuid();existente.atualizadoEm=agora}
    else db.clientes.push({...registro,id:registro.id||Utils.uuid(),portalRefToken:registro.portalRefToken||Utils.uuid(),normalizedPhone,saldo:Number(registro.saldo||0),atualizadoEm:registro.atualizadoEm||agora});
  }))};
  const ajustarSaldo=(clienteId,saldoNovo,motivo)=>{if(window.TeamAccess&&!window.TeamAccess.has('customers.adjustBalance'))throw Error('Você não tem permissão para ajustar saldos.');let movimento;const operationId=Utils.uuid();DB.alterar(db=>{const cliente=db.clientes.find(c=>c.id===clienteId);if(!cliente)throw Error('Cliente não encontrado');const saldoAnterior=Number(cliente.saldo||0),financialVersionAnterior=Math.max(0,Number(cliente.financialVersion||0));cliente.saldo=Number(saldoNovo);cliente.financialVersion=financialVersionAnterior+1;cliente.atualizadoEm=new Date().toISOString();movimento={id:operationId,operationId,clienteId,clienteNome:cliente.nome,tipo:'ajuste_saldo',saldoAnterior,saldoNovo:cliente.saldo,expectedFinancialVersion:financialVersionAnterior,financialVersionAfter:cliente.financialVersion,motivo:motivo||'',data:cliente.atualizadoEm,...(window.TeamAccess?.actor?.()||{})};db.movimentacoes.push(movimento)});return movimento};
  return{listar,obter,viewData,viewClient,scopedScreen,confirmSpaceAccount,accountBelongsTo,unassignedMarkup,originalAccountAction,salvar,excluir,setActive,importar,ajustarSaldo,normalizePhone,financialStatus,canEdit,canCreate,assertCanEdit,assertCanCreate,assertCanSave};
})();
