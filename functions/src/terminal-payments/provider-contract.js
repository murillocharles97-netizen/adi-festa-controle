'use strict';

const REQUIRED_METHODS=Object.freeze([
  'createPayment',
  'getPaymentStatus',
  'cancelPayment',
  'refundPayment',
  'handleWebhook',
  'pairTerminal',
  'listTerminals',
  'healthCheck',
]);

class TerminalPaymentProvider{
  constructor(id){
    if(!id)throw new Error('Provider presencial sem identificador.');
    this.id=id;
  }
  createPayment(){throw new Error('createPayment não implementado.');}
  getPaymentStatus(){throw new Error('getPaymentStatus não implementado.');}
  cancelPayment(){throw new Error('cancelPayment não implementado.');}
  refundPayment(){throw new Error('refundPayment não implementado.');}
  handleWebhook(){throw new Error('handleWebhook não implementado.');}
  pairTerminal(){throw new Error('pairTerminal não implementado.');}
  listTerminals(){throw new Error('listTerminals não implementado.');}
  healthCheck(){throw new Error('healthCheck não implementado.');}
}

function assertProviderContract(provider){
  if(!provider?.id)throw new Error('Provider presencial inválido.');
  for(const method of REQUIRED_METHODS)
    if(typeof provider[method]!=='function')throw new Error(`Provider ${provider.id} não implementa ${method}.`);
  return provider;
}

module.exports={REQUIRED_METHODS,TerminalPaymentProvider,assertProviderContract};
