window.Cobrancas=(()=>{
  const hoje=data=>data&&new Date(data).toDateString()===new Date().toDateString();
  const mensagem=c=>`Ola, ${c.nome}, tudo bem? Passando para avisar que sua conta atual na ${DB.carregar().config.nome||'nossa loja'} esta em ${Utils.dinheiro(Math.abs(Number(c.saldo||0)))}. Quando puder, me chama para acertarmos. Obrigado!`;
  const historicoCliente=clienteId=>DB.carregar().cobrancas.filter(c=>c.clienteId===clienteId).sort((a,b)=>new Date(b.data)-new Date(a.data));
  const ultimaCliente=clienteId=>historicoCliente(clienteId)[0]||null;
  const statusDaUltima=ultima=>ultima&&hoje(ultima.data)?(ultima.status==='ignorado'?'ignorado':'enviado hoje'):'pendente';
  const statusCliente=c=>statusDaUltima(ultimaCliente(c.id));
  const preparar=(filtro='naoHoje')=>{
    const {clientes,cobrancas}=DB.carregar(), historico=new Map();
    for (const registro of cobrancas) {
      const id=registro.clienteId;
      if (!historico.has(id)) historico.set(id, []);
      historico.get(id).push(registro);
    }
    const ultimas=new Map();
    for (const [id,registros] of historico)
      ultimas.set(id,registros.sort((a,b)=>new Date(b.data)-new Date(a.data))[0]);

    const lista=[];
    for (const cliente of clientes) {
      const saldo=window.Clientes?.financialStatus?.(cliente,undefined,{display:true}).saldo??Number(cliente.saldo);
      if (!(saldo<0)) continue;
      const ultima=ultimas.get(cliente.id)||null, status=statusDaUltima(ultima);
      if (filtro==='nunca'&&ultima || filtro==='naoHoje'&&status!=='pendente') continue;
      if (filtro==='acima10'&&saldo>=-10 || filtro==='acima50'&&saldo>=-50) continue;
      if (filtro==='semTelefone'&&Utils.somenteNumeros(cliente.telefone).length>=10) continue;
      lista.push({cliente,saldo,ultima,status});
    }
    return lista.sort((a,b)=>a.saldo-b.saldo);
  };
  const listar=filtro=>preparar(filtro).map(row=>row.cliente);
  const proximo=()=>listar('naoHoje').find(c=>Utils.somenteNumeros(c.telefone).length>=10);
  const registrar=(clienteId,status='enviado')=>{let cob;DB.alterar(db=>{const c=db.clientes.find(x=>x.id===clienteId);if(!c)throw Error('Cliente nao encontrado');cob={id:Utils.uuid(),clienteId:c.id,clienteNome:c.nome,valorCobrado:Math.abs(Number(c.saldo||0)),mensagem:mensagem(c),status,data:new Date().toISOString()};db.cobrancas.push(cob);db.movimentacoes.push({id:Utils.uuid(),clienteId:c.id,clienteNome:c.nome,tipo:'cobranca',valor:cob.valorCobrado,status,data:cob.data})});return cob};
  return{mensagem,historicoCliente,ultimaCliente,statusCliente,preparar,listar,proximo,registrar};
})();
