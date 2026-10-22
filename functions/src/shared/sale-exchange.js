'use strict';
// Integer cents, original line indexes and cumulative quantities are canonical.
const fail = message => { throw new Error(message); };
const cents = value => { const n = Number(value); if (!Number.isFinite(n) || n < 0) fail('Valor inválido.'); return Math.round(n * 100); };
const quantity = n => { if (!Number.isSafeInteger(n) || n < 1 || n > 999) fail('Quantidade inválida.'); return n; };
function planExchange(sale, input, returned = {}, catalog = []) {
  if (!sale || !['pago','paid','concluido','completed'].includes(sale.status) || sale.deletedAt || sale.reversedAt || sale.active === false)
    fail('A V1 aceita somente vendas pagas e ativas. Fiado exige uma política específica.');
  if (!sale.spaceId || !Array.isArray(sale.itens) || !sale.itens.length) fail('Venda sem espaço ou itens verificáveis.');
  if (sale.source==='exchange_credit_checkout'||sale.exchangeCreditUsedCents) fail('Troca de venda paga com crédito exige política específica e está bloqueada nesta V1.');
  if (!['dinheiro','pix','cartao','pago'].includes(sale.formaPagamento) || sale.onlineOrderId || sale.catalogOrderId || sale.paymentIntentId || sale.paymentMetadata)
    fail('A V1 aceita vendas manuais pagas; pagamentos integrados e pedidos online exigem fluxo específico.');
  if (!input.reason || input.reason.trim().length < 3 || input.reason.length > 500) fail('Informe o motivo da troca.');
  if (!Array.isArray(input.returns) || !input.returns.length || input.returns.length > 40 || !Array.isArray(input.replacements) || !input.replacements.length || input.replacements.length > 40) fail('Selecione itens devolvidos e novos.');
  const lines = sale.itens.map(i => ({ ...i, qty: quantity(i.quantidade), unit: cents(i.precoFinalUnitario ?? i.precoUnitario ?? i.preco) }));
  const sum = lines.reduce((n,i) => n + i.qty*i.unit,0);
  if (sum !== cents(sale.valorFinal ?? sale.valorTotal)) fail('Desconto ou valor histórico não alocado nos itens. Revisão necessária.');
  const seen = new Set();
  const returns = input.returns.map(r => {
    if (!Number.isSafeInteger(r.line) || !lines[r.line] || seen.has(r.line) || typeof r.restock !== 'boolean') fail('Item devolvido inválido ou repetido.');
    seen.add(r.line); const i=lines[r.line], q=quantity(r.quantity), used=returned[r.line]||0;
    if (!Number.isSafeInteger(used) || used<0 || q+used>i.qty) fail('Quantidade excede o restante disponível para troca.');
    return {line:r.line,productId:i.produtoId,variantId:i.variantId||null,name:i.nome||i.produtoNome||i.produtoId,variantName:i.variantName||'',quantity:q,restock:r.restock,unitCents:i.unit,totalCents:q*i.unit};
  });
  seen.clear();
  const replacements=input.replacements.map(r=>{
    const key=`${r.productId}:${r.variantId||''}`, p=catalog.find(x=>x.productId===r.productId&&(x.variantId||null)===(r.variantId||null));
    if (!p || seen.has(key)) fail('Produto novo indisponível ou repetido.'); seen.add(key);
    const q=quantity(r.quantity),unit=cents(p.price);
    return {productId:r.productId,variantId:r.variantId||null,name:p.name,variantName:p.variantName||'',quantity:q,unitCents:unit,totalCents:q*unit};
  });
  const returnCents=returns.reduce((n,i)=>n+i.totalCents,0),newCents=replacements.reduce((n,i)=>n+i.totalCents,0),differenceCents=newCents-returnCents;
  if (differenceCents>0&&!['dinheiro','pix','cartao'].includes(input.paymentMethod)) fail('Confirme o recebimento manual da diferença.');
  if (differenceCents<0&&!sale.clienteId) fail('Crédito de troca exige cliente identificado na venda original.');
  return {returns,replacements,returnCents,newCents,differenceCents,creditCents:Math.max(0,-differenceCents),receivedCents:Math.max(0,differenceCents),paymentMethod:differenceCents>0?input.paymentMethod:null,reason:input.reason.trim()};
}
module.exports={planExchange,cents};
