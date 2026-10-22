'use strict';

const fail=message=>{throw new Error(message);};
const integer=(value,label,{min=0,max=100000000}={})=>{
  if(!Number.isSafeInteger(value)||value<min||value>max)fail(`${label} inválido.`);
  return value;
};
function salePlan(input,catalog,credits){
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>40)fail('Selecione de 1 a 40 itens.');
  if(input.discount||input.discountCents||input.campaignId||input.appliedCampaignIds?.length||input.paymentIntentId||input.fiado)fail('Crédito de troca exige venda manual sem desconto, campanha, integração ou Fiado nesta V1.');
  if(input.paymentMethod&&!['dinheiro','pix','cartao'].includes(input.paymentMethod))fail('Fiado e pagamentos integrados não são permitidos com crédito de troca nesta V1.');
  const seen=new Set(),items=input.items.map(item=>{
    const key=`${item.productId}:${item.variantId||''}`,product=catalog.find(p=>p.productId===item.productId&&(p.variantId||null)===(item.variantId||null));
    if(!product||seen.has(key))fail('Produto inexistente ou repetido.');seen.add(key);
    const quantity=integer(item.quantity,'Quantidade',{min:1,max:999}),unitCents=integer(product.priceCents,'Preço',{min:1});
    return {productId:product.productId,variantId:product.variantId||null,name:product.name,variantName:product.variantName||'',quantity,unitCents,totalCents:quantity*unitCents};
  });
  const grossCents=integer(items.reduce((sum,i)=>sum+i.totalCents,0),'Total',{min:1}),creditUsedCents=integer(input.creditCents,'Crédito utilizado',{min:1,max:grossCents});
  const availableCents=credits.reduce((sum,c)=>sum+integer(c.remainingCents,'Saldo de crédito'),0);
  if(creditUsedCents>availableCents)fail('Crédito disponível insuficiente. Revise antes de confirmar.');
  const cashReceivedCents=grossCents-creditUsedCents;
  if(cashReceivedCents&&!['dinheiro','pix','cartao'].includes(input.paymentMethod))fail('Confirme o recebimento manual do complemento. Fiado não é permitido.');
  let remaining=creditUsedCents;
  const allocations=[];
  for(const credit of credits){if(!remaining)break;const amountCents=Math.min(remaining,credit.remainingCents);if(amountCents){allocations.push({creditId:credit.id,amountCents});remaining-=amountCents;}}
  if(allocations.length>100)fail('Muitos créditos pequenos para uma única venda; use um valor parcial.');
  return {items,grossCents,creditUsedCents,cashReceivedCents,paymentMethod:cashReceivedCents?input.paymentMethod:null,allocations};
}
module.exports={salePlan,integer};
