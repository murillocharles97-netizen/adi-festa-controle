window.Cobrancas=(()=>{
  const hoje=data=>data&&new Date(data).toDateString()===new Date().toDateString();
  const mensagem=c=>`Ola, ${c.nome}, tudo bem? Passando para avisar que sua conta atual na Adi Festa esta em ${Utils.dinheiro(Math.abs(Number(c.saldo||0)))}. Quando puder, me chama para acertarmos. Obrigado!`;
  const historicoCliente=clienteId=>DB.carregar().cobrancas.filter(c=>c.clienteId===clienteId).sort((a,b)=>new Date(b.data)-new Date(a.data));
  const ultimaCliente=clienteId=>historicoCliente(clienteId)[0]||null;
  const statusCliente=c=>{const u=ultimaCliente(c.id);return u&&hoje(u.data)?(u.status==='ignorado'?'ignorado':'enviado hoje'):'pendente'};
  const listar=(filtro='naoHoje')=>{
    let clientes=DB.carregar().clientes.filter(c=>Number(c.saldo)<0).sort((a,b)=>Number(a.saldo)-Number(b.saldo));
    if(filtro==='nunca')clientes=clientes.filter(c=>!ultimaCliente(c.id));
    if(filtro==='naoHoje')clientes=clientes.filter(c=>!hoje(ultimaCliente(c.id)?.data));
    if(filtro==='acima10')clientes=clientes.filter(c=>Math.abs(Number(c.saldo))>10);
    if(filtro==='acima50')clientes=clientes.filter(c=>Math.abs(Number(c.saldo))>50);
    if(filtro==='semTelefone')clientes=clientes.filter(c=>Utils.somenteNumeros(c.telefone).length<10);
    return clientes;
  };
  const proximo=()=>listar('naoHoje').find(c=>Utils.somenteNumeros(c.telefone).length>=10);
  const registrar=(clienteId,status='enviado')=>{let cob;DB.alterar(db=>{const c=db.clientes.find(x=>x.id===clienteId);if(!c)throw Error('Cliente nao encontrado');cob={id:Utils.uuid(),clienteId:c.id,clienteNome:c.nome,valorCobrado:Math.abs(Number(c.saldo||0)),mensagem:mensagem(c),status,data:new Date().toISOString()};db.cobrancas.push(cob);db.movimentacoes.push({id:Utils.uuid(),clienteId:c.id,clienteNome:c.nome,tipo:'cobranca',valor:cob.valorCobrado,status,data:cob.data})});return cob};
  return{mensagem,historicoCliente,ultimaCliente,statusCliente,listar,proximo,registrar};
})();
