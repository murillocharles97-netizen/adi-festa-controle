'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
// Existing durable operations use colon-separated and URI-encoded identifiers
// (online-sale:<id>, campaign/client events, legacy receipts). This validates a
// SINGLE Firestore document ID, never a path or a newly generated replacement.
function operationalId(value,label='Identificador operacional'){
 if(typeof value!=='string'||!/^[-A-Za-z0-9_:.%@~]{1,700}$/.test(value)||value==='.'||value==='..')throw new HttpsError('invalid-argument',`${label} inválido.`);
 return value;
}
module.exports={operationalId};
