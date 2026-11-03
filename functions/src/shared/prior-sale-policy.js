(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PriorSalePolicy=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const TIME_ZONE='America/Sao_Paulo',DAY=86400000;
  function parts(value){const p=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));return Object.fromEntries(p.map(x=>[x.type,x.value]));}
  function day(value){const p=parts(value);return `${p.year}-${p.month}-${p.day}`;}
  function fromLocal(date,time){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}(:\d{2})?$/.test(time))throw Error('Informe uma data e um horário válidos.');const input=date+'T'+time.padEnd(8,':00'),target=Date.parse(input+'Z');if(!Number.isFinite(target))throw Error('Data inválida.');let guess=target;for(let n=0;n<3;n++){const p=parts(guess),local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);guess+=target-local;}const p=parts(guess),actual=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;if(actual!==input)throw Error('Data ou horário inexistente.');return new Date(guess).toISOString();}
  function validate(intent,now=new Date()){
    const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
    if(!date(intent.occurredAt)||Date.parse(intent.occurredAt)>+now)throw Error('A data comercial deve ser válida e nunca futura.');
    const age=(Date.parse(day(now)+'T00:00:00Z')-Date.parse(day(intent.occurredAt)+'T00:00:00Z'))/DAY;
    if(age<0||age>7)throw Error('Venda anterior permite apenas os últimos sete dias no horário de Brasília.');
    if(typeof intent.reason!=='string'||intent.reason.trim().length<8||intent.reason.length>500)throw Error('Informe o motivo do lançamento, com 8 a 500 caracteres.');
    if(!['pix','dinheiro','cartao','fiado'].includes(intent.paymentMethod))throw Error('Use pagamento externo já recebido ou Fiado. Cobranças integradas não são permitidas.');
    if(intent.paymentMethod!=='fiado'){
      if(!date(intent.paidAt)||Date.parse(intent.paidAt)>+now||Date.parse(intent.paidAt)<Date.parse(intent.occurredAt))throw Error('Informe quando o pagamento externo foi efetivamente recebido, entre a venda e agora.');
    }else if(intent.paidAt!=null)throw Error('Fiado não pode declarar pagamento recebido.');
    return{commercialDate:day(intent.occurredAt),timeZone:TIME_ZONE};
  }
  return{TIME_ZONE,day,fromLocal,validate};
});
