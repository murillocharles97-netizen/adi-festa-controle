window.CSVImport=(()=>{
  const normalizar=valor=>String(valor??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const aliases={
    nome:['nome','cliente','nomedocliente'],
    telefone:['telefone','celular','whatsapp','telefoneprincipal'],
    telefone2:['telefone2','celular2','whatsapp2','telefonesecondario'],
    email:['email','correioeletronico'],
    endereco:['endereco','logradouro'],
    complemento:['complemento'],
    documento:['ndoc','nrodoc','numerodoc','documento','cpfcnpj'],
    observacoes:['observacoes','observacao','notas'],
    totalComprado:['valordevendas','totalcomprado','valortotal','valorvendido'],
    quantidadeVendas:['quantidadevendas','qtdvendas','vendas'],
    saldo:['saldo','saldoatual'],
    criadoEm:['datacriacao','datadecriacao','criadoem']
  };
  const parseLinha=linha=>{const colunas=[];let valor='',aspas=false;for(let i=0;i<linha.length;i++){const char=linha[i];if(char==='"'){if(aspas&&linha[i+1]==='"'){valor+='"';i++}else aspas=!aspas}else if(char===','&&!aspas){colunas.push(valor.trim());valor=''}else valor+=char}colunas.push(valor.trim());return colunas};
  const numeroBR=valor=>{let texto=String(valor??'').trim().replace(/\s|R\$/gi,'');if(!texto)return 0;const negativoParenteses=/^\(.*\)$/.test(texto);texto=texto.replace(/[()]/g,'');if(texto.includes(','))texto=texto.replace(/\./g,'').replace(',','.');texto=texto.replace(/[^0-9+\-.]/g,'');const numero=Number(texto);return Number.isFinite(numero)?(negativoParenteses?-Math.abs(numero):numero):0};
  const inteiro=valor=>{const numero=numeroBR(valor);return Number.isFinite(numero)?Math.trunc(numero):0};
  const dataImportada=valor=>{const texto=String(valor||'').trim();if(!texto)return new Date().toISOString();const br=texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);if(br){const data=new Date(`${br[3]}-${br[2].padStart(2,'0')}-${br[1].padStart(2,'0')}T12:00:00`);if(!Number.isNaN(data.getTime()))return data.toISOString()}const data=new Date(texto);return Number.isNaN(data.getTime())?texto:data.toISOString()};
  const mapearCabecalhos=cabecalhos=>{const normalizados=cabecalhos.map(normalizar),mapa={};Object.entries(aliases).forEach(([campo,nomes])=>{mapa[campo]=normalizados.findIndex(h=>nomes.includes(h))});return mapa};
  const ler=texto=>{let linhas=String(texto||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim());if(linhas[0]?.trim().toLowerCase().startsWith('sep='))linhas=linhas.slice(1);if(linhas.length<2)throw Error('O CSV não possui clientes');const cabecalhos=parseLinha(linhas[0]),mapa=mapearCabecalhos(cabecalhos);if(mapa.nome<0)throw Error('A coluna de nome não foi encontrada');const obter=(linha,campo)=>mapa[campo]>=0?(linha[mapa[campo]]??''):'';const possuiSaldo=mapa.saldo>=0,clientes=linhas.slice(1).map(parseLinha).filter(l=>String(obter(l,'nome')).trim()).map(l=>{const agora=new Date().toISOString();return{id:Utils.uuid(),nome:String(obter(l,'nome')).trim(),telefone:String(obter(l,'telefone')).trim(),telefone2:String(obter(l,'telefone2')).trim(),email:String(obter(l,'email')).trim(),endereco:String(obter(l,'endereco')).trim(),complemento:String(obter(l,'complemento')).trim(),documento:String(obter(l,'documento')).trim(),observacoes:String(obter(l,'observacoes')).trim(),saldo:possuiSaldo?numeroBR(obter(l,'saldo')):0,totalComprado:0,quantidadeVendas:0,ultimaCompra:null,ativo:true,criadoEm:dataImportada(obter(l,'criadoEm')),atualizadoEm:agora}});return{clientes,cabecalhos,mapa,possuiSaldo}};
  const semDuplicados=clientes=>{const telefones=new Set(),nomes=new Set();return clientes.filter(c=>{const telefone=Utils.somenteNumeros(c.telefone),nome=normalizar(c.nome);if((telefone&&telefones.has(telefone))||nomes.has(nome))return false;if(telefone)telefones.add(telefone);nomes.add(nome);return true})};
  const resumir=clientes=>({clientes:clientes.length,telefones:clientes.filter(c=>Utils.somenteNumeros(c.telefone)).length,devedores:clientes.filter(c=>Number(c.saldo)<0).length,totalEmAberto:clientes.filter(c=>Number(c.saldo)<0).reduce((s,c)=>s+Math.abs(Number(c.saldo)),0),creditores:clientes.filter(c=>Number(c.saldo)>0).length});
  return{ler,semDuplicados,resumir,normalizar,numeroBR};
})();
