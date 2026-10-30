'use strict';
// A schema-1 pilot remains compatible. Commercial access requires BOTH a new
// server deployment flag and an explicit schema-2 policy; never a browser flag.
const {createHash}=require('node:crypto');
const digest=value=>createHash('sha256').update(value).digest('hex');
const commercial=p=>p?.schemaVersion===2&&p.pilotOnly===false&&p.registrationOnly===true;
function policyValid(p,projectId,now,allowCommercial){
 if(!p||p.enabled!==true||p.projectId!==projectId||!Array.isArray(p.allowedOrigins)||!p.allowedOrigins.length)return false;
 if(p.schemaVersion===1)return p.pilotOnly===true&&/^[0-9a-f]{64}$/.test(p.pilotEmailHash||'')&&Number.isSafeInteger(p.validUntil)&&p.validUntil>now;
 return allowCommercial&&commercial(p)&&p.requireNativeProbe===true&&/^[a-z0-9-]{1,64}$/.test(p.rolloutId||'')&&Number.isSafeInteger(p.signupWindowUntil)&&Number.isSafeInteger(p.signupDailyLimit)&&p.signupDailyLimit>=1&&p.signupDailyLimit<=20&&Number.isSafeInteger(p.subjectHourlyLimit)&&p.subjectHourlyLimit>=1&&p.subjectHourlyLimit<=12;
}
const modeAllowed=(p,intent,now)=>p.modes?.[intent]===true&&(intent!=='signup'||!commercial(p)||p.signupWindowUntil>now);
const subjectAllowed=(p,subHash,emailHash)=>commercial(p)||(p.pilotEmailHash===emailHash&&(!p.pilotSubHash||p.pilotSubHash===subHash));
// The first verified pilot subject is mutable only once; it is separately
// enforced and deliberately excluded from the immutable intent policy scope.
const scope=p=>digest(JSON.stringify([p.schemaVersion,p.projectId,p.pilotOnly,p.registrationOnly||false,p.rolloutId||'',p.pilotEmailHash||'',p.validUntil||0,p.signupWindowUntil||0,[...p.allowedOrigins].sort(),p.requireNativeProbe===true,p.signupDailyLimit||0,p.subjectHourlyLimit||0]));
function intentAllowed(p,i,now){
 return p?.enabled===true&&i&&i.expiresAt>=now&&p.allowedOrigins?.includes(i.origin)&&modeAllowed(p,i.intent,now)&&(i.policyScope?i.policyScope===scope(p):p.schemaVersion===1)&&(p.schemaVersion!==1||p.validUntil>now);
}
module.exports={commercial,policyValid,modeAllowed,subjectAllowed,scope,intentAllowed};
