'use strict';

const {TerminalPaymentProvider}=require('../provider-contract');

class CieloProvider extends TerminalPaymentProvider{
  constructor(){super('cielo');}
  unavailable(){throw Object.assign(new Error('A Cielo ainda não foi configurada para este ambiente.'),{code:'provider-not-configured'});}
  createPayment(){return this.unavailable();}
  getPaymentStatus(){return this.unavailable();}
  cancelPayment(){return this.unavailable();}
  refundPayment(){return this.unavailable();}
  handleWebhook(){return this.unavailable();}
  pairTerminal(){return this.unavailable();}
  listTerminals(){return this.unavailable();}
  healthCheck(){return{ok:false,status:'not_configured'};}
}

module.exports={CieloProvider};
