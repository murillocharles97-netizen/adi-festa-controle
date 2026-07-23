window.Clientes=(()=>{
  const normalizePhone=value=>PhoneUtils.normalizeBrazilianPhone(value);
  const listar=()=>DB.carregar().clientes;
  const obter=id=>listar().find(c=>c.id===id);
  const salvar=d=>{let salvo;DB.alterar(db=>{
    const atual=db.clientes.find(c=>c.id===d.id),agora=new Date().toISOString(),telefone=d.telefone||'',normalizedPhone=normalizePhone(telefone),duplicado=db.clientes.find(c=>c.id!==d.id&&normalizedPhone&&normalizePhone(c.normalizedPhone||c.telefone)===normalizedPhone);
    if(duplicado)throw Error(`Este WhatsApp já pertence a ${duplicado.nome}.`);
    const campos={nome:d.nome.trim(),apelido:d.apelido||'',telefone,normalizedPhone,telefone2:d.telefone2||'',email:d.email||'',endereco:d.endereco||'',complemento:d.complemento||'',documento:d.documento||'',observacoes:d.observacoes||'',origemCadastro:d.origemCadastro||atual?.origemCadastro||'app',portalRefToken:d.portalRefToken||atual?.portalRefToken||Utils.uuid(),ativo:d.ativo!==false,atualizadoEm:agora};
    if(atual){Object.assign(atual,campos);salvo=atual}else{salvo={id:Utils.uuid(),...campos,totalComprado:0,quantidadeVendas:0,saldo:0,ultimaCompra:null,etiquetas:[],promessaPagamento:null,criadoEm:agora};db.clientes.push(salvo)}
  });return salvo};
  const excluir=id=>DB.alterar(db=>{const cliente=db.clientes.find(c=>c.id===id);db.vendas.filter(v=>v.clienteId===id).forEach(v=>v.clienteNome||=cliente?.nome);db.clientes=db.clientes.filter(c=>c.id!==id)});
  const importar=(registros,opcoes={possuiSaldo:true})=>DB.alterar(db=>registros.forEach(registro=>{
    const normalizedPhone=normalizePhone(registro.telefone),nome=String(registro.nome).trim().toLowerCase(),existente=db.clientes.find(c=>(normalizedPhone&&normalizePhone(c.normalizedPhone||c.telefone)===normalizedPhone)||String(c.nome).trim().toLowerCase()===nome),agora=new Date().toISOString();
    if(existente){existente.nome=registro.nome;if(registro.telefone){existente.telefone=registro.telefone;existente.normalizedPhone=normalizedPhone}if(registro.observacoes)existente.observacoes=registro.observacoes;if(opcoes.possuiSaldo)existente.saldo=Number(registro.saldo||0);existente.portalRefToken||=Utils.uuid();existente.atualizadoEm=agora}
    else db.clientes.push({...registro,id:registro.id||Utils.uuid(),portalRefToken:registro.portalRefToken||Utils.uuid(),normalizedPhone,saldo:Number(registro.saldo||0),atualizadoEm:registro.atualizadoEm||agora});
  }));
  const ajustarSaldo=(clienteId,saldoNovo,motivo)=>{let movimento;const operationId=Utils.uuid();DB.alterar(db=>{const cliente=db.clientes.find(c=>c.id===clienteId);if(!cliente)throw Error('Cliente não encontrado');const saldoAnterior=Number(cliente.saldo||0);cliente.saldo=Number(saldoNovo);cliente.atualizadoEm=new Date().toISOString();movimento={id:operationId,operationId,clienteId,clienteNome:cliente.nome,tipo:'ajuste_saldo',saldoAnterior,saldoNovo:cliente.saldo,motivo:motivo||'',data:cliente.atualizadoEm};db.movimentacoes.push(movimento)});return movimento};
  return{listar,obter,salvar,excluir,importar,ajustarSaldo,normalizePhone};
})();
