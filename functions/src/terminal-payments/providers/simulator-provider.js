'use strict';

const crypto=require('node:crypto');
const {TerminalPaymentProvider}=require('../provider-contract');

const SCENARIOS=new Set(['approved','declined','timeout','error','cancelled']);
const CAPABILITIES=Object.freeze({
  supportsCredit:true,
  supportsDebit:true,
  supportsPix:false,
  supportsInstallments:true,
  maxInstallments:12,
  supportsRefund:true,
  supportsCancellation:true,
  supportsRemotePayment:true,
});

class SimulatorProvider extends TerminalPaymentProvider{
  constructor(){super('simulator');}
  async createPayment({intent}){
    return{
      status:'awaiting_terminal',
      providerPaymentId:`sim_pay_${intent.id}`,
      providerOrderId:`sim_order_${crypto.createHash('sha1').update(intent.id).digest('hex').slice(0,18)}`,
    };
  }
  async getPaymentStatus({intent}){return{status:intent.status};}
  async dispatchPayment({scenario='approved'}){
    if(!SCENARIOS.has(scenario))throw Object.assign(new Error('Cenário do simulador inválido.'),{code:'invalid-simulator-scenario'});
    if(scenario==='approved')return{status:'approved',approvedAt:new Date().toISOString()};
    if(scenario==='declined')return{status:'declined',failureReason:'simulated_decline'};
    if(scenario==='timeout')return{status:'pending_confirmation',failureReason:'simulated_timeout'};
    if(scenario==='cancelled')return{status:'cancelled',failureReason:'simulated_customer_cancel'};
    return{status:'error',failureReason:'simulated_provider_error'};
  }
  async cancelPayment(){return{status:'cancelled'};}
  async refundPayment(){return{status:'refunded',refundedAt:new Date().toISOString()};}
  async handleWebhook({event}){return event||{};}
  async pairTerminal({nickname}){
    return{externalTerminalId:`sim_${crypto.randomUUID()}`,model:'VECONI Simulator',serial:null,nickname,capabilities:{...CAPABILITIES}};
  }
  async listTerminals(){return[];}
  async healthCheck(){return{ok:true,status:'available'};}
}

module.exports={SimulatorProvider,SIMULATOR_CAPABILITIES:CAPABILITIES,SIMULATOR_SCENARIOS:SCENARIOS};
