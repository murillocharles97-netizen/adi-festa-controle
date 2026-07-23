(function(){
  'use strict';
  function normalizeBrazilianPhone(value){
    let digits=String(value||'').replace(/\D/g,'');
    if(digits.startsWith('00'))digits=digits.slice(2);
    if(!digits.startsWith('55')&&digits.length>=10&&digits.length<=12)digits=`55${digits}`;
    return digits;
  }
  function isValidBrazilianPhone(value){return /^55\d{10,12}$/.test(normalizeBrazilianPhone(value))}
  function formatBrazilianPhone(value){const full=normalizeBrazilianPhone(value),local=full.startsWith('55')?full.slice(2):full;if(local.length<10)return local;const ddd=local.slice(0,2),number=local.slice(2),split=Math.max(4,number.length-4);return `(${ddd}) ${number.slice(0,split)}-${number.slice(split)}`}
  function maskPhone(value){const last=normalizeBrazilianPhone(value).slice(-5);return last?`•••••-${last}`:'•••••'}
  window.PhoneUtils={normalizeBrazilianPhone,isValidBrazilianPhone,formatBrazilianPhone,maskPhone};
  window.normalizeBrazilianPhone=normalizeBrazilianPhone;
})();
