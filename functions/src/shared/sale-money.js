(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SaleMoney=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const POLICY='unit4-total-cent-v1';
  const fail=()=>{throw new Error('Confira quantidades e preços: use até quatro casas decimais no preço e seis na quantidade. Nenhuma venda foi registrada.');};
  function scaled(value,places){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail();
    const match=String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);if(!match)fail();
    const fraction=match[2]||'',exponent=Number(match[3]||0),shift=places+exponent-fraction.length;
    if(Math.abs(shift)>24)fail();
    let n=BigInt(match[1]+fraction);
    if(shift>=0)n*=10n**BigInt(shift);
    else{const divisor=10n**BigInt(-shift);if(n%divisor)fail();n/=divisor;}
    if(n>BigInt(Number.MAX_SAFE_INTEGER))fail();return n;
  }
  const safe=n=>{if(n<0n||n>BigInt(Number.MAX_SAFE_INTEGER))fail();return Number(n);};
  const round=(n,d)=>(n+d/2n)/d;
  function summarize(items){
    if(!Array.isArray(items)||!items.length||items.length>200)fail();
    const divisor=100000000n;
    const raw=items.map((item,index)=>{
      const q=scaled(item.quantidade??item.quantity,6),u=scaled(item.precoFinalUnitario??item.precoUnitario??item.unitPriceSnapshot,4);
      if(!q||q>1000000n*1000000n)fail();
      return{index,raw:q*u,unit4:safe(u),quantity6:safe(q)};
    });
    const sum=raw.reduce((n,i)=>n+i.raw,0n),totalCents=safe(round(sum,divisor));
    const lines=raw.map(i=>({index:i.index,unit4:i.unit4,quantity6:i.quantity6,totalCents:safe(i.raw/divisor)}));
    let remaining=totalCents-lines.reduce((n,i)=>n+i.totalCents,0);
    // Stable largest-remainder allocation. Line cents always add to sale cents.
    const order=[...raw].sort((a,b)=>{const x=a.raw%divisor,y=b.raw%divisor;return x===y?a.index-b.index:x>y?-1:1;});
    for(let i=0;i<remaining;i++)lines[order[i].index].totalCents++;
    return{policy:POLICY,totalCents,lines};
  }
  function assertSale(sale){
    if(sale.monetaryPolicy!==POLICY)throw Error('Política monetária desconhecida.');
    const result=summarize(sale.itens),declared=safe(scaled(sale.valorFinal??sale.valorTotal,2));
    if(result.totalCents!==declared)throw Error('Total não corresponde aos itens.');
    if(sale.valorTotal!==undefined&&safe(scaled(sale.valorTotal,2))!==declared)throw Error('Totais monetários divergentes.');
    for(const line of result.lines){const item=sale.itens[line.index];if(item.subtotalFinal!==undefined&&safe(scaled(item.subtotalFinal,2))!==line.totalCents)throw Error('Subtotal não corresponde à alocação monetária.');}
    return result;
  }
  function canonicalItems(items){const result=summarize(items);return{...result,items:items.map((item,n)=>({...item,precoFinalUnitario:result.lines[n].unit4/10000,subtotalFinal:result.lines[n].totalCents/100}))};}
  return{POLICY,summarize,assertSale,canonicalItems};
});
