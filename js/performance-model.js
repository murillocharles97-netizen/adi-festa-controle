(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PerformanceModel=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const DAY=86400000,DEFAULT_ZONE='America/Sao_Paulo';
  const number=v=>Number.isFinite(Number(v))?Number(v):0;
  const cents=v=>Math.round(number(v)*100);
  const date=v=>v?.toDate?v.toDate():v?.seconds!==undefined?new Date(v.seconds*1000):new Date(v);
  const formats=new Map();
  function parts(value,zone=DEFAULT_ZONE){
    if(!formats.has(zone))formats.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}));
    const d=date(value);if(!Number.isFinite(d.getTime()))return null;
    return Object.fromEntries(formats.get(zone).formatToParts(d).map(x=>[x.type,x.value]));
  }
  const day=(v,z)=>{const p=parts(v,z);return p?`${p.year}-${p.month}-${p.day}`:null;};
  const shift=(key,n)=>new Date(Date.parse(`${key}T12:00:00Z`)+n*DAY).toISOString().slice(0,10);
  function midnight(key,zone=DEFAULT_ZONE){
    const target=Date.parse(`${key}T00:00:00Z`);let value=target;
    for(let n=0;n<4;n++){const p=parts(value,zone),represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:00:00Z`);value+=target-represented;}
    return new Date(value).toISOString();
  }
  function range(period='30d',now=new Date(),custom={},zone=DEFAULT_ZONE){
    const today=day(now,zone);let end=today,start=today;
    if(/^\d+d$/.test(period))start=shift(today,1-Number(period.slice(0,-1)));
    if(period==='month')start=today.slice(0,7)+'-01';
    if(period==='previous'){end=shift(today.slice(0,7)+'-01',-1);start=end.slice(0,7)+'-01';}
    if(period==='year')start=today.slice(0,4)+'-01-01';
    if(period==='custom'){start=custom.start;end=custom.end;}
    const valid=k=>/^\d{4}-\d{2}-\d{2}$/.test(k||'')&&!Number.isNaN(Date.parse(k))&&new Date(k).toISOString().slice(0,10)===k;
    if(!valid(start)||!valid(end)||start>end)throw Error('Informe um intervalo de datas válido.');
    const days=Math.round((Date.parse(end)-Date.parse(start))/DAY)+1;
    if(days>366)throw Error('Selecione até 366 dias por análise.');
    const previousEnd=shift(start,-1),previousStart=shift(start,-days);
    return{start,end,days,previousStart,previousEnd,zone,from:midnight(previousStart,zone),to:midnight(shift(end,1),zone),granularity:days===1?'hour':days>100?'month':'day'};
  }
  const invalid=new Set(['cancelado','cancelada','cancelled','canceled','desfeito','desfeita','venda_desfeita','estornado','estornada','refunded']);
  function validSale(s){return s&&s.deleted!==true&&!s.deletedAt&&s.ativo!==false&&s.active!==false&&s.desfeita!==true&&!invalid.has(String(s.status||s.saleStatus||s.tipo||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());}
  const value=s=>number(s.valorFinal??s.valorTotal);
  function method(s){
    if(s.paymentIntentId||s.formaPagamento==='cartao_presencial')return{key:'integrated',name:'Maquininha integrada',origin:s.paymentMetadata?.provider||s.provider||'integrada',form:'Cartão'};
    const key=s.formaPagamento||(s.status==='fiado'?'fiado':'outros');
    return{key,name:({pix:'Pix',dinheiro:'Dinheiro',cartao:'Cartão manual',fiado:'Fiado'})[key]||'Outras formas',form:key};
  }
  const empty=()=>({revenue:0,cost:0,profit:0,count:0,quantity:0,missingCost:0});
  function compare(current,previous,hasPrevious){return !hasPrevious||previous===0?null:(current-previous)/Math.abs(previous)*100;}
  function build({sales=[],range:r,spaceId='all',allowedSpaceIds=null,businessId,canCost=false,canProfit=false,spaces=[]}){
    const current=empty(),previous=empty(),points=new Map(),payments=new Map(),categories=new Map(),products=new Map(),bySpace=new Map(),seen=new Set();
    const names=new Map(spaces.map(s=>[String(s.id),s.name]));
    for(let key=r.start;key<=r.end;key=shift(key,1)){
      if(r.granularity==='hour'){for(let h=0;h<24;h++)points.set(`${key}T${String(h).padStart(2,'0')}`,{key:`${key}T${String(h).padStart(2,'0')}`, ...empty()});}
      else{const bucket=r.granularity==='month'?key.slice(0,7):key;if(!points.has(bucket))points.set(bucket,{key:bucket,...empty()});}
    }
    const add=(map,key,init,amount,quantity=0)=>{const row=map.get(key)||{...init,revenue:0,quantity:0};row.revenue+=amount;row.quantity+=quantity;map.set(key,row);return row;};
    for(const s of sales){
      if(!validSale(s)||(s.businessId&&s.businessId!==businessId)||seen.has(String(s.id)))continue;
      const sid=String(s.spaceId||s.financialSpaceId||''),key=day(s.data||s.createdAt,r.zone);
      if(allowedSpaceIds&&!allowedSpaceIds.includes(sid)||spaceId!=='all'&&sid!==spaceId||!key||key<r.previousStart||key>r.end)continue;
      seen.add(String(s.id));const active=key>=r.start,total=active?current:previous,revenue=cents(value(s));
      const hasCost=s.custoTotal!==null&&s.custoTotal!==undefined,hasProfit=s.lucro!==null&&s.lucro!==undefined;
      const cost=hasCost?cents(s.custoTotal):0,profit=hasProfit?cents(s.lucro):hasCost?revenue-cost:0,items=s.itens||s.items||[],quantity=items.reduce((n,i)=>n+number(i.quantidade??i.quantity),0);
      const amounts={revenue,cost,profit,count:1,quantity,missingCost:((canCost&&!hasCost)||(canProfit&&!hasProfit&&!hasCost)||s.costResolution==='partial')?1:0};
      Object.keys(amounts).forEach(k=>total[k]+=amounts[k]);if(!active)continue;
      const p=parts(s.data||s.createdAt,r.zone),bucket=r.granularity==='hour'?`${key}T${p.hour}`:r.granularity==='month'?key.slice(0,7):key,point=points.get(bucket);
      Object.keys(amounts).forEach(k=>point[k]+=amounts[k]);
      const m=method(s);add(payments,m.key,{...m},revenue,1);
      const space=add(bySpace,sid,{id:sid,name:names.get(sid)||(sid?'Espaço arquivado / indisponível':'Sem espaço histórico'),count:0,profit:0},revenue);space.count++;space.profit+=profit;
      // Allocate sale-level discount/rounding to item weights; rankings reconcile to sale revenue.
      const weights=items.map(i=>Math.max(0,cents(i.subtotalFinal??i.valorTotal??number(i.quantidade??i.quantity)*number(i.precoFinalUnitario??i.precoUnitario??i.unitPriceSnapshot)))),sum=weights.reduce((a,b)=>a+b,0);
      let assigned=0;
      if(!items.length){add(categories,'unclassified',{name:'Sem categoria histórica'},revenue);add(products,'no-items',{name:'Venda sem itens detalhados'},revenue);}
      items.forEach((i,index)=>{
        const amount=index===items.length-1?revenue-assigned:Math.round(revenue*(sum?weights[index]/sum:1/items.length));assigned+=amount;
        const category=String(i.categoryNameSnapshot||i.categoria||'Sem categoria histórica');
        add(categories,category,{name:category},amount);
        add(products,String(i.produtoId||i.productId||i.nome||'unknown'),{name:String(i.nome||i.productNameSnapshot||'Produto histórico')},amount,number(i.quantidade??i.quantity));
      });
    }
    const finish=row=>{
      const result={...row,revenue:row.revenue/100};
      if('cost' in row){if(canCost)result.cost=row.cost/100;else delete result.cost;}
      if('profit' in row){if(canProfit)result.profit=row.profit/100;else delete result.profit;}
      if('count' in row)result.ticket=row.count?result.revenue/row.count:0;
      if(canProfit&&'profit' in result)result.margin=result.revenue?result.profit/result.revenue*100:0;
      return result;
    };
    const result={current:finish(current),previous:finish(previous),points:[...points.values()].map(finish),payments:[...payments.values()].map(finish).sort((a,b)=>b.revenue-a.revenue),categories:[...categories.values()].map(finish).sort((a,b)=>b.revenue-a.revenue),products:[...products.values()].map(finish).sort((a,b)=>b.quantity-a.quantity||b.revenue-a.revenue),spaces:[...bySpace.values()].map(finish).sort((a,b)=>b.revenue-a.revenue)};
    result.comparison={};for(const key of ['revenue','profit','ticket','count'])if(key in result.current)result.comparison[key]=compare(result.current[key],result.previous[key],result.previous.count>0&&(key!=='profit'||!current.missingCost&&!previous.missingCost));
    return result;
  }
  return{range,build,validSale,value,method,day,midnight,shift,compare};
});
