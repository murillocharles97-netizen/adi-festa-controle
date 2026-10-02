'use strict';
const {SimulatorProvider}=require('./simulator-provider');
const MOCK_CAPABILITIES=Object.freeze({supportsCredit:true,supportsDebit:true,supportsPix:false,supportsInstallments:false,maxInstallments:1,supportsRefund:false,supportsCancellation:true,supportsRemotePayment:true});
class MockPaymentProvider extends SimulatorProvider{
 constructor(){super();this.id='mock';}
 async dispatchPayment(context){if(!context.scenario||context.scenario==='manual')return{status:'processing'};if(context.scenario==='network_error')throw Object.assign(Error('Simulated network failure'),{code:'simulated_network_error'});return super.dispatchPayment(context);}
 async pairTerminal(context){return{...await super.pairTerminal(context),model:'VECONI TEST ONLY',capabilities:{...MOCK_CAPABILITIES}};}
 async refundPayment(){throw Object.assign(Error('Pagamento integrado requer estorno. Estorno não implementado nesta V1.'),{code:'failed-precondition'});}
}
module.exports={MockPaymentProvider,MOCK_CAPABILITIES};
