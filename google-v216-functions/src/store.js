'use strict';
const {AccessError,hash}=require('./broker');
const {commercial,intentAllowed,subjectAllowed}=require('./policy');
function registrationStore(db){
 const control=db.doc('googleRegistrationControl/active'),intents=db.collection('googleRegistrationIntents'),bindings=db.collection('googleRegistrationBindings'),receipts=db.collection('googleRegistrationReceipts'),limits=db.collection('googleRegistrationLimits');
 const fail=()=>{throw new AccessError();};
 return{
  policy:async()=>(await control.get()).data(),
  getIntent:async id=>(await intents.doc(id).get()).data(),
  getBinding:async id=>(await bindings.doc(id).get()).data(),
  receipt:async id=>(await receipts.doc(id).get()).data(),
  createIntent:(i,limit)=>db.runTransaction(async tx=>{
   const global=limits.doc('global_'+limit.hour),session=limits.doc('s_'+limit.session+'_'+limit.hour);
   const [g,s,p]=await Promise.all([tx.get(global),tx.get(session),tx.get(control)]);
   if(!intentAllowed(p.data(),i,i.createdAt)||(g.data()?.count||0)>=limit.globalLimit||(s.data()?.count||0)>=limit.sessionLimit)fail();
   tx.set(global,{count:(g.data()?.count||0)+1,hour:limit.hour});tx.set(session,{count:(s.data()?.count||0)+1,hour:limit.hour});tx.create(intents.doc(i.id),i);
  }),
  select:(id,g)=>db.runTransaction(async tx=>{
   const ref=intents.doc(id),[snap,policy]=await Promise.all([tx.get(ref),tx.get(control)]),i=snap.data(),p=policy.data();
   if(!i||!['pending','prepared'].includes(i.status)||!intentAllowed(p,i,g.at)||!subjectAllowed(p,g.subHash,g.emailHash)||i.googleSubHash&&i.googleSubHash!==g.subHash)fail();
   const subject=limits.doc('subject_'+g.subHash+'_'+Math.floor(g.at/3600000)),count=await tx.get(subject);
   if(commercial(p)&&!i.googleSubHash&&(count.data()?.count||0)>=p.subjectHourlyLimit)fail();
   if(commercial(p)&&!i.googleSubHash)tx.set(subject,{count:(count.data()?.count||0)+1,hour:Math.floor(g.at/3600000)});
   if(!commercial(p)&&!p.pilotSubHash)tx.update(control,{pilotSubHash:g.subHash});
   tx.update(ref,{status:'prepared',googleSubHash:g.subHash,googleEmail:g.email,nativeProbePassed:g.nativeProbePassed===true,nativeProbeAt:g.nativeProbeAt||null});
  }),
  claim:id=>db.runTransaction(async tx=>{const ref=intents.doc(id),snap=await tx.get(ref);if(snap.data()?.status!=='prepared')return false;tx.update(ref,{status:'processing'});return true;}),
  reserve:(id,plan,context)=>db.runTransaction(async tx=>{
   const ref=bindings.doc(id),day=limits.doc('signup_'+Math.floor(context.at/86400000));
   const [snap,ps,is,ds]=await Promise.all([tx.get(ref),tx.get(control),tx.get(intents.doc(context.intentId)),tx.get(day)]),p=ps.data(),i=is.data();
   if(!intentAllowed(p,i,context.at)||i.status!=='processing'||i.intent!=='signup'||i.googleSubHash!==id||!subjectAllowed(p,id,hash(plan.email)))fail();
   if(snap.exists){const b=snap.data();if(b.origin!==plan.origin||b.email!==plan.email)fail();return b;}
   // A reservation consumes the daily quota once, even on conflict or a lost
   // response. New challenges for that subject reuse the original reservation.
   if(commercial(p)&&(ds.data()?.count||0)>=p.signupDailyLimit)fail();
   if(commercial(p))tx.set(day,{count:(ds.data()?.count||0)+1,day:Math.floor(context.at/86400000)});
   const b={...plan,status:'reserved'};tx.create(ref,b);return b;
  }),
  conflict:(intentId,id)=>db.runTransaction(async tx=>{const b=bindings.doc(id),i=intents.doc(intentId);await Promise.all([tx.get(b),tx.get(i)]);tx.update(b,{status:'conflict'});tx.update(i,{status:'conflict'});}),
  activate:(id,value)=>db.runTransaction(async tx=>{const ref=bindings.doc(id),[snap,policy,is]=await Promise.all([tx.get(ref),tx.get(control),tx.get(intents.doc(value.intentId))]);const b=snap.data(),p=policy.data();if(!b||b.status!=='reserved'||b.uid!==value.uid||b.email!==value.email||!intentAllowed(p,is.data(),value.at)||!subjectAllowed(p,id,hash(b.email)))fail();tx.update(ref,{status:'active',activatedAt:value.at});}),
  completeOnce:(id,receipt)=>db.runTransaction(async tx=>{
   const i=intents.doc(id),r=receipts.doc(id),[is,rs,ps,bs]=await Promise.all([tx.get(i),tx.get(r),tx.get(control),tx.get(bindings.doc(receipt.subHash))]),p=ps.data(),b=bs.data();
   if(is.data()?.status!=='processing'||is.data()?.googleSubHash!==receipt.subHash||rs.exists||!intentAllowed(p,is.data(),receipt.at)||b?.status!=='active'||b.uid!==receipt.uid||!subjectAllowed(p,receipt.subHash,hash(b.email)))fail();
   tx.create(r,receipt);tx.update(i,{status:'completed',completedAt:receipt.at,uid:receipt.uid,tokenGrantConsumed:true});
  }),
 };
}
module.exports={registrationStore};
