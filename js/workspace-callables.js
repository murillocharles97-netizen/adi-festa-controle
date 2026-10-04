(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WorkspaceCallables=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  // Identity/bootstrap and VECONI subscription billing intentionally stay out.
  const operational=new Set(['getTerminalPaymentSetup','savePaymentTerminal','archivePaymentTerminal',
    'createTerminalPayment','dispatchTerminalPayment','getTerminalPaymentStatus','cancelTerminalPayment',
    'refundTerminalPayment','claimTerminalPaymentFinalization','acknowledgeTerminalPaymentSale',
    'getActiveTerminalPayment','createTeamInvite','updateTeamMember','migrateSensitiveTeamData',
    'reconcileBusinessActivityEvents','reconcileBusinessFinancialIncome','deleteUnusedFinancialAccount','deleteUnusedCreditCard','deleteWorkspaceAsset']);
  function payload(name,data,runtime){
    if(!operational.has(name)||!runtime)return data;
    const origin=runtime.capture();
    if(data?.businessId&&data.businessId!==origin.businessId)
      throw Object.assign(Error('Operação de outra empresa rejeitada.'),{code:'workspace-business-mismatch'});
    if(data?.workspaceGeneration!==undefined&&data.workspaceGeneration!==origin.workspaceGeneration)
      throw Object.assign(Error('Uma operação antiga não pode ser reenviada.'),{code:'workspace-generation-mismatch'});
    return{...data,workspaceGeneration:origin.workspaceGeneration};
  }
  return Object.freeze({payload});
});
