'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve('qa-artifacts/performance');
const read = name => JSON.parse(fs.readFileSync(path.join(output, name), 'utf8'));
const datasets = [read('selling-before.json'), read('selling-after.json')];
const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const volumeName = { small:'Pequena', medium:'Média', large:'Grande' };
const phaseName = {
  'primeira-abertura':'Primeira abertura',
  'segunda-abertura':'Segunda abertura',
  'primeira-interacao':'Foco no campo após abrir',
  'busca-com-resultado':'Busca com resultado',
  'busca-sem-resultado':'Busca sem resultado',
  'rolagem-e-proximo-lote':'Rolagem e acesso aos itens seguintes',
  'busca-codigo-fora-do-lote':'Busca por código',
  'selecionar-e-incluir':'Selecionar e incluir',
  'abrir-checkout':'Abrir o carrinho',
  'remover-do-carrinho':'Remover do carrinho',
  'finalizacao-ficticia':'Finalizar até recibo e flush',
};
const range = (values) => {
  const sorted = [...values].sort((a,b)=>a-b);
  const middle = (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2;
  return { middle, print:format.format(middle)+' ('+format.format(sorted[0])+'–'+format.format(sorted.at(-1))+')' };
};
const change = (before,after) =>
  before ? new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1,signDisplay:'exceptZero'}).format((after/before-1)*100)+'%' : '—';
function table(header, rows) {
  for (const row of [header,header.map(()=> '---'),...rows]) console.log('| '+row.join(' | ')+' |');
}
function pick(rows,mobile,theme,volume) {
  const selected = rows.filter(r=>r.mobile===mobile&&r.theme===theme&&r.volume===volume);
  assert.equal(selected.length,3,JSON.stringify({mobile,theme,volume}));
  for(const row of selected) assert.equal(row.fault,undefined,JSON.stringify(row));
  return selected;
}
function compare(group,phase,metric) {
  const [before,after] = group.map(set=>range(set.map(r=>metric(r.samples.find(sample=>sample.phase===phase)))));
  return [before.print,after.print,change(before.middle,after.middle)];
}
const details=[], summary=[];
for(const mobile of [false,true]) for(const theme of ['light','dark']) for(const volume of Object.keys(volumeName)){
  const tag=(mobile?'Mobile':'Desktop')+' '+(theme==='light'?'claro':'escuro');
  const group=datasets.map(rows=>pick(rows,mobile,theme,volume));
  const name=volumeName[volume];
  for(const phase of Object.keys(phaseName)) details.push([tag,name,phaseName[phase],...compare(group,phase,s=>s.ms)]);
  for(const [metric,select] of [
    ['Cartões',s=>s.cards],['Nós em #app',s=>s.nodes],['Script CDP (ms)',s=>s.ScriptDurationMs],
    ['Estilo + layout CDP (ms)',s=>s.RecalcStyleDurationMs+s.LayoutDurationMs],
    ['Tarefa mais longa (ms)',s=>Math.max(0,...s.long)],['Quantidade de tarefas ≥50 ms',s=>s.long.length],
  ]) summary.push([tag,name,metric,...compare(group,'primeira-abertura',select)]);
}
console.log('# VECONI — Benchmarks de Vender\n');
console.log('Três repetições por célula em cada versão. Mediana (mínimo–máximo). Valores em ms, salvo cartões, nós e contagem. A rolagem da base pequena alcança o último cartão. Nas demais, a base V242.2 rola até o cartão 72, já montado, e a candidata inclui solicitar e pintar a próxima leva.\n');
table(['Perfil','Base','Operação','V242.2','Candidata','Variação'], details);
console.log('\n## Custo da primeira abertura\n');
table(['Perfil','Base','Métrica','V242.2','Candidata','Variação'], summary);
