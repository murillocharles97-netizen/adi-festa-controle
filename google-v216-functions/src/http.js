'use strict';
const {AccessError}=require('./broker');
function brokerHttp(service,{endpoint,origins}){
 return async(req,res)=>{
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  const origin=req.get('Origin');
  if(!origins.includes(origin))return res.status(403).json({error:{code:'access-unavailable',message:'Acesso Google indisponível neste contexto.'}});
  res.set('Access-Control-Allow-Origin',origin);res.set('Vary','Origin');
  if(req.method==='OPTIONS')return res.set('Access-Control-Allow-Methods','POST').set('Access-Control-Allow-Headers','Content-Type').status(204).end();
  if(req.method!=='POST'||!/^application\/json(?:;|$)/i.test(req.get('Content-Type')||'')||Number(req.get('Content-Length')||0)>22000||req.get('Authorization'))return res.status(403).json({error:{code:'access-unavailable',message:'Acesso Google indisponível neste contexto.'}});
  try{
   if(JSON.stringify(req.body||{}).length>22000)throw new AccessError();
   const request={origin,data:req.body?.data||{}};
   const action=endpoint==='complete'?'complete':request.data.step;
   if(!['begin','preview','status','complete'].includes(action)||endpoint!=='complete'&&action==='complete')throw new AccessError();
   return res.status(200).json({data:await service[action](request)});
  }catch(error){
   // Never log request bodies, Google proofs, session/CSRF secrets or tokens.
   const code=error instanceof AccessError?error.code:'confirmation-pending';
   return res.status(400).json({error:{code,message:'Não foi possível concluir o acesso Google. Se já possui conta, entre pelo método usado no cadastro.'}});
  }
 };
}
module.exports={brokerHttp};
