'use strict';

function requiredText(value,pattern,message){
  const text=String(value||'').trim();
  if(!pattern.test(text))throw Object.assign(Error(message),{code:'invalid-card-payment-data'});
  return text;
}

function normalizeManualCardPayment(input={}){
  const token=requiredText(input.token,/^[A-Za-z0-9_-]{16,512}$/,'Token do cartão inválido.'),paymentMethodId=requiredText(input.payment_method_id||input.paymentMethodId,/^[A-Za-z0-9_-]{2,40}$/,'Meio de pagamento do cartão inválido.'),installments=Number(input.installments),issuerRaw=String(input.issuer_id||input.issuerId||'').trim(),identification=input.payer?.identification||input.identification||{},type=String(identification.type||'').trim().toUpperCase(),number=String(identification.number||'').replace(/\D/g,'');
  if(!Number.isInteger(installments)||installments<1||installments>24)throw Object.assign(Error('Parcelamento do cartão inválido.'),{code:'invalid-card-payment-data'});
  if(issuerRaw&&!/^[A-Za-z0-9_-]{1,40}$/.test(issuerRaw))throw Object.assign(Error('Emissor do cartão inválido.'),{code:'invalid-card-payment-data'});
  const payer={};
  if(type||number){
    if(!/^[A-Z]{2,12}$/.test(type)||!/^[0-9]{5,24}$/.test(number))throw Object.assign(Error('Documento do pagador inválido.'),{code:'invalid-card-payment-data'});
    payer.identification={type,number};
  }
  return{token,paymentMethodId,installments,issuerId:issuerRaw||null,payer};
}

module.exports={normalizeManualCardPayment};
