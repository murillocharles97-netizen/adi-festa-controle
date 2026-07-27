(function(){
  'use strict';
  function guard(object,method,feature,label){const original=object?.[method];if(typeof original!=='function'||original.__subscriptionGuard)return;const wrapped=function(...args){if(window.PlanLimitService)PlanLimitService.assert(PlanLimitService.canUseAction(feature),label);return original.apply(this,args)};wrapped.__subscriptionGuard=true;object[method]=wrapped}
  function install(){guard(window.Fiados,'receber','payments.receive','receber pagamentos');guard(window.Clientes,'ajustarSaldo','balance.adjust','ajustar saldo');guard(window.Produtos,'entrada','stock.adjust','adicionar estoque');guard(window.Produtos,'ajustarEstoque','stock.adjust','ajustar estoque')}
  install();addEventListener('firebase-auth-ready',install);
})();
