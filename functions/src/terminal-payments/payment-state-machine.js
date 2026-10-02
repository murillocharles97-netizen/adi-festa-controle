'use strict';
// Lower-case wire values preserve existing intents. pending_confirmation = UNKNOWN.
const NEXT={created:['awaiting_terminal','processing','cancelled','error','pending_confirmation'],awaiting_terminal:['processing','cancelled','expired','pending_confirmation'],processing:['approved','declined','cancelled','expired','error','pending_confirmation'],pending_confirmation:['processing','approved','declined','cancelled','expired'],approved:[],declined:[],cancelled:[],expired:[],error:[],refunded:[]};
function assertTransition(from,to){if(from===to)return;if(!NEXT[from]?.includes(to))throw Object.assign(Error(`Transição de pagamento inválida: ${from} → ${to}`),{code:'failed-precondition'});}
module.exports={assertTransition,NEXT};
