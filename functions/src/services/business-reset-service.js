'use strict';

const crypto=require('node:crypto');
const {FieldValue,Timestamp}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const policy=require('./workspace-reset-policy');
const {ROLE_PRESETS}=require('./team-access-service');
function pruneViews(profile,spaceIds){
  const removed=new Set(spaceIds),viewIds=new Set(spaceIds.map(id=>`space:${id}`));
  const customViews=(profile.customViews||[]).map(view=>({...view,financialSpaceIds:(view.financialSpaceIds||[]).filter(id=>!removed.has(id))})).filter(view=>{if(view.financialSpaceIds.length)return true;viewIds.add(view.id);return false;});
  return{customViews,favoriteViewIds:(profile.favoriteViewIds||[]).filter(id=>!viewIds.has(id)),defaultViewId:viewIds.has(profile.defaultViewId)?null:profile.defaultViewId||null,lastViewId:viewIds.has(profile.lastViewId)?null:profile.lastViewId||null};
}
const PRESERVE_ROOT=new Set(['id','slug','ownerId','active','createdAt','subscription','limits',
  'entitlement','entitlements','plan','planId','billingCustomerId','billingSubscriptionId',
  'billing','billingPayer','subscriptionStatus','securityMetadata','teamSchemaVersion',
  'sensitiveDataVersion','sensitiveDataMigratedAt','maxTeamMembers','workspaceGeneration','workspaceReset',
  'workspaceHasRealIntegratedPayments','legacyAccessDisabled','workspaceWriteId','updatedAt']);
const OPERATIONAL_ROOT=new Set(['name','legalName','document','phone','email','businessType',
  'city','state','address','receiptName','onboardingCompleted','migrationVersion','migratedAt',
  'logo','logoUrl','logoStoragePath','primaryColor','settings','preferences','paymentFeatures']);
const LOCKED=new Set(['REQUESTED','LOCKED','DELETING','VERIFYING','FAILED']);
const noReady=()=>{throw new HttpsError('failed-precondition','Restauração ainda não habilitada. As barreiras de geração precisam estar instaladas.');};

// Callables remain feature-gated until all production writers/Rules are validated.
// No Auth API and no billing mutation capability are passed to this service.
function businessResetService(db,{bucket,assertInfrastructureReady=noReady,autoDispatch=false,now=()=>Date.now(),fault=async()=>{}}={}){
  const company=id=>db.doc(`businesses/${policy.validId(id,'Empresa')}`);
  const jobRef=(id,operationId)=>company(id).collection('workspaceResetJobs').doc(policy.validId(operationId,'Operação'));
  async function documents(query){
    const rows=[];let last;
    do{let page=query.limit(200);if(last)page=page.startAfter(last);const snapshot=await page.get();rows.push(...snapshot.docs);last=snapshot.size===200?snapshot.docs.at(-1):null;}while(last);
    return rows;
  }
  async function owner(request){
    const id=policy.validId(request.data?.businessId,'Empresa'),uid=request.auth?.uid;
    if(!uid)throw new HttpsError('unauthenticated','Entre novamente para continuar.');
    const ref=company(id),[business,member]=await Promise.all([ref.get(),ref.collection('members').doc(uid).get()]);
    policy.assertResetOwner({uid,business:business.data(),member:member.data(),confirmation:request.data?.confirmation,authTime:request.auth?.token?.auth_time,now:now()});
    return{id,uid,ref,business:business.data(),member:member.data()};
  }
  async function preflight(context){
    if(!context.business.subscription?.planId||!context.business.subscription?.status)
      throw new HttpsError('failed-precondition','Confirme o plano e a assinatura antes de restaurar os dados.',{reason:'subscription-preservation-unconfirmed'});
    const collections=await context.ref.listCollections();
    for(const collection of collections)policy.classifyCollection(collection.id);
    for(const key of Object.keys(context.business))if(!PRESERVE_ROOT.has(key)&&!OPERATIONAL_ROOT.has(key))
      throw new HttpsError('failed-precondition','Um campo empresarial precisa ser classificado antes da restauração.',{reason:'unclassified-business-field',field:key});
    for(const name of ['paymentTerminals','paymentProviderConfigs','paymentIntents','paymentReceivables']){
      const rows=await documents(context.ref.collection(name));policy.assertMockOnly(rows.map(row=>row.data()));
    }
    const sales=await documents(context.ref.collection('sales'));
    policy.assertMockOnly(sales.map(row=>row.data()).filter(row=>row.paymentIntentId||row.formaPagamento==='cartao_presencial').map(row=>({provider:row.paymentMetadata?.provider||row.provider})));
    const spaces=new Map();
    for(const field of ['businessId','linkedBusinessId'])for(const row of await documents(db.collection('financialSpaces').where(field,'==',context.id))){
      if(!policy.belongsToWorkspace(row.data(),context.id))throw new HttpsError('failed-precondition','Há um espaço com vínculos conflitantes. Revise antes de restaurar.',{reason:'conflicting-space-scope'});
      spaces.set(row.id,row);
    }
    // Shared resources/transfers cannot be destroyed on behalf of just one side.
    for(const space of spaces.values())for(const name of ['financialAccounts','creditCards'])for(const row of await documents(space.ref.collection(name))){
      const data=row.data(),ids=data.allowedFinancialSpaceIds||data.allowedSpaceIds||[];
      if(data.spaceAccess==='all_spaces'||data.accessMode==='all_spaces'||ids.some(id=>!spaces.has(id)))
        throw new HttpsError('failed-precondition','Uma conta ou cartão pode ser compartilhado com outros espaços. Revise esse vínculo antes de restaurar.',{reason:'shared-financial-resource'});
    }
    // A commerce entry may have changed a personal/shared bank balance. Deleting
    // that evidence without unwinding the external account is not a simple reset.
    for(const space of spaces.values())for(const name of ['entries','creditCardInvoicePayments','creditCardPurchases'])for(const row of await documents(space.ref.collection(name))){
      const data=row.data(),externalHomes=['financialAccountHomeSpaceId','creditCardHomeSpaceId','cardHomeSpaceId'].map(key=>data[key]).filter(Boolean);
      if(externalHomes.some(id=>!spaces.has(id)))throw new HttpsError('failed-precondition','Há operações vinculadas a uma conta ou cartão fora desta empresa. O reset simples foi bloqueado.',{reason:'external-financial-evidence'});
    }
    const transfers=new Map();
    for(const field of ['businessId','linkedBusinessId'])for(const row of await documents(db.collection('financialTransfers').where(field,'==',context.id)))transfers.set(row.id,row);
    for(const spaceId of spaces.keys())for(const field of ['fromSpaceId','toSpaceId','sourceSpaceId','targetSpaceId'])
      for(const row of await documents(db.collection('financialTransfers').where(field,'==',spaceId)))transfers.set(row.id,row);
    for(const row of transfers.values()){
      const data=row.data(),ids=['fromSpaceId','toSpaceId','sourceSpaceId','targetSpaceId'].map(key=>data[key]).filter(Boolean);
      if(ids.some(id=>!spaces.has(id)))throw new HttpsError('failed-precondition','Há transferência entre esta empresa e outro espaço. O reset simples foi bloqueado.',{reason:'cross-workspace-transfer'});
    }
    const external=[];
    for(const name of ['publicCatalogs','teamInviteTokens','memberships','onboarding'])
      for(const row of await documents(db.collection(name).where('businessId','==',context.id))){
        if(name==='memberships'&&row.data().uid===context.uid)continue;
        external.push(row.ref.path);
      }
    // A deleted catalog parent can still have orders/sessions beneath it. Use
    // explicit business-owned token references; never enumerate another tenant.
    const tokens=new Set();
    for(const name of ['visits','settings'])for(const row of await documents(context.ref.collection(name))){
      const value=row.data();for(const token of [value.publicToken,value.catalogSettings?.publicToken,value.config?.catalogSettings?.publicToken])if(token)tokens.add(policy.validId(token,'Catálogo'));
    }
    for(const token of tokens){
      const ref=db.doc(`publicCatalogs/${token}`),snapshot=await ref.get();
      if(snapshot.exists&&snapshot.data().businessId!==context.id)throw new HttpsError('failed-precondition','Referência de catálogo pertence a outro ambiente.',{reason:'conflicting-catalog-scope'});
      if(!snapshot.exists)await assertOrphanScope(ref,context.id);
      external.push(ref.path);
    }
    const profileUids=new Set([context.uid,...[...spaces.values()].map(row=>row.data().ownerUid).filter(Boolean)]);
    for(const row of await documents(context.ref.collection('members')))profileUids.add(row.id);
    for(const field of ['businessId','previousBusinessId'])for(const row of await documents(db.collection('users').where(field,'==',context.id)))profileUids.add(row.id);
    return{spaceIds:[...spaces.keys()],externalPaths:[...new Set([...external,...[...transfers.values()].map(row=>row.ref.path)])],profileUids:[...profileUids]};
  }
  async function assertOrphanScope(parent,businessId){
    // A user-editable token reference alone cannot authorize recursive Admin
    // deletion. Without the parent, every surviving document must prove scope.
    for(const collection of await parent.listCollections())for(const ref of await collection.listDocuments()){
      const row=await ref.get();
      if(row.exists&&row.data().businessId!==businessId)
        throw new HttpsError('failed-precondition','O vínculo de um catálogo histórico precisa ser verificado antes da restauração.',{reason:'unverified-orphan-catalog-scope'});
      await assertOrphanScope(ref,businessId);
    }
  }
  async function request(request){
    await assertInfrastructureReady();
    const context=await owner(request),operationId=policy.validId(request.data?.resetOperationId,'Operação'),ref=jobRef(context.id,operationId);
    const prior=await ref.get();
    if(prior.exists)return{job:prior.data(),reused:true};
    if(context.business.workspaceReset&&LOCKED.has(context.business.workspaceReset.status))
      throw new HttpsError('failed-precondition','Existe uma restauração pendente. Retome a mesma operação.',{reason:'reset-already-active',operationId:context.business.workspaceReset.operationId});
    const scope=await preflight(context);
    const job=await db.runTransaction(async tx=>{
      const [fresh,member,existing]=await Promise.all([tx.get(context.ref),tx.get(context.ref.collection('members').doc(context.uid)),tx.get(ref)]);
      if(existing.exists)return existing.data();
      const data=fresh.data();policy.assertResetOwner({uid:context.uid,business:data,member:member.data(),confirmation:'RESETAR',authTime:request.auth.token.auth_time,now:now()});
      if(data.workspaceReset&&LOCKED.has(data.workspaceReset.status))throw new HttpsError('failed-precondition','Restauração já em andamento.');
      if(policy.generation(data.workspaceGeneration??0)!==policy.generation(context.business.workspaceGeneration??0))throw new HttpsError('failed-precondition','A configuração empresarial mudou. Reabra a confirmação.');
      const resetGeneration=policy.generation(policy.generation(data.workspaceGeneration??0)+1);
      const value={id:operationId,businessId:context.id,ownerUid:context.uid,status:'REQUESTED',resetGeneration,scope,autoDispatch,counts:{documents:0,files:0},requestEpoch:1,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()};
      tx.create(ref,value);
      tx.update(context.ref,{workspaceGeneration:resetGeneration,legacyAccessDisabled:true,workspaceReset:{operationId,status:'REQUESTED'},updatedAt:FieldValue.serverTimestamp()});
      return value;
    });
    return{job,reused:false};
  }
  async function retry(request){
    await assertInfrastructureReady();const context=await owner(request),ref=jobRef(context.id,request.data?.resetOperationId);
    return db.runTransaction(async tx=>{
      const [snapshot,business]=await Promise.all([tx.get(ref),tx.get(context.ref)]),job=snapshot.data();
      if(!job||job.ownerUid!==context.uid||business.data()?.workspaceReset?.operationId!==ref.id)throw new HttpsError('permission-denied','Operação de restauração inválida.');
      if(job.status==='COMPLETED')return{job,reused:true};
      if(job.leaseUntil?.toMillis()>now())return{job,reused:true};
      tx.update(ref,{status:'FAILED',requestEpoch:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()});
      tx.update(context.ref,{'workspaceReset.status':'FAILED'});return{job:{...job,status:'FAILED'},reused:true};
    });
  }
  async function run(businessId,operationId){
    await assertInfrastructureReady();if(!bucket)throw Error('Storage backend required');
    const businessRef=company(businessId),ref=jobRef(businessId,operationId),leaseId=crypto.randomUUID();
    const job=await db.runTransaction(async tx=>{
      const [snapshot,business]=await Promise.all([tx.get(ref),tx.get(businessRef)]),job=snapshot.data();
      if(!job||job.status==='COMPLETED')return null;
      if(job.leaseUntil?.toMillis()>now())throw new HttpsError('aborted','Restauração já está sendo processada.');
      if(business.data()?.workspaceReset?.operationId!==operationId||business.data()?.workspaceGeneration!==job.resetGeneration)throw new HttpsError('failed-precondition','Geração ou lock divergente.');
      tx.update(ref,{status:'LOCKED',leaseId,leaseUntil:Timestamp.fromMillis(now()+120000),updatedAt:FieldValue.serverTimestamp()});
      tx.update(businessRef,{'workspaceReset.status':'LOCKED'});return job;
    });
    if(!job)return{completed:true,reused:true};
    async function commit(action,{release=false}={}){
      return db.runTransaction(async tx=>{
        const [snapshot,business]=await Promise.all([tx.get(ref),tx.get(businessRef)]),fresh=snapshot.data();
        if(fresh?.leaseId!==leaseId||business.data()?.workspaceGeneration!==job.resetGeneration||business.data()?.workspaceReset?.operationId!==operationId)
          throw new HttpsError('aborted','A execução foi substituída por uma retomada.');
        const result=await action(tx,fresh,business.data());
        tx.update(ref,{leaseUntil:Timestamp.fromMillis(release?now():now()+120000),updatedAt:FieldValue.serverTimestamp()});return result;
      });
    }
    async function stage(status){await commit(tx=>{tx.update(ref,{status});tx.update(businessRef,{'workspaceReset.status':status});});await fault(status);}
    async function assertExternalOwner(tx,root,targetSnapshot=null){
      if(!root)return;
      const snapshot=await tx.get(root),value=snapshot.data();
      const kind=root.path.split('/')[0];
      const transferOwned=kind==='financialTransfers'&&(!value?.businessId||value.businessId===businessId)&&(!value?.linkedBusinessId||value.linkedBusinessId===businessId)&&['fromSpaceId','toSpaceId','sourceSpaceId','targetSpaceId'].some(key=>value?.[key])
        && ['fromSpaceId','toSpaceId','sourceSpaceId','targetSpaceId'].filter(key=>value?.[key]).every(key=>job.scope.spaceIds.includes(value[key]));
      if(snapshot.exists&&!(policy.belongsToWorkspace(value,businessId)||transferOwned))
        throw new HttpsError('failed-precondition','O vínculo de um recurso mudou. A restauração foi interrompida.',{reason:'external-scope-changed'});
      if(!snapshot.exists&&targetSnapshot?.exists&&targetSnapshot.data().businessId!==businessId)
        throw new HttpsError('failed-precondition','Recurso histórico sem vínculo comprovado.',{reason:'external-scope-unconfirmed'});
    }
    async function eraseDocument(target,externalRoot=null){
      for(const collection of await target.listCollections())await eraseCollection(collection,undefined,externalRoot);
      await commit(async tx=>{
        const snapshot=await tx.get(target);if(!snapshot.exists)return;
        await assertExternalOwner(tx,externalRoot,snapshot);
        tx.delete(target);tx.update(ref,{'counts.documents':FieldValue.increment(1)});
      });
      await fault('DOCUMENT_DELETED');
    }
    async function eraseCollection(collection,keepId,externalRoot=null){
      // listDocuments includes missing ancestor documents with subcollections.
      for(const target of await collection.listDocuments())if(target.id!==keepId)await eraseDocument(target,externalRoot);
    }
    try{
      const current=(await businessRef.get()).data();
      const freshScope=await preflight({id:businessId,uid:job.ownerUid,ref:businessRef,business:current});
      // Include anything created just before the lock; persist path metadata, never content.
      const scope={spaceIds:[...new Set([...job.scope.spaceIds,...freshScope.spaceIds])],externalPaths:[...new Set([...job.scope.externalPaths,...freshScope.externalPaths])],profileUids:[...new Set([...(job.scope.profileUids||[]),...freshScope.profileUids])]};
      job.scope=scope;
      await commit(tx=>tx.update(ref,{scope}));
      await stage('DELETING');
      for(const uid of scope.profileUids){
        await commit(async tx=>{
          const userRef=db.doc(`users/${uid}`),viewRef=db.doc(`financialViewProfiles/${uid}`);
          const [user,views]=await Promise.all([tx.get(userRef),tx.get(viewRef)]);
          if(views.exists){const next=pruneViews(views.data(),scope.spaceIds);if(Object.keys(next).some(key=>JSON.stringify(next[key])!==JSON.stringify(views.data()[key]??null)))tx.update(viewRef,{...next,profileRevision:Number(views.data().profileRevision||0)+1,updatedAt:FieldValue.serverTimestamp()});}
          if(uid===job.ownerUid||!user.exists)return;
          const profile=user.data(),patch={};
          if(profile.businessId===businessId)for(const key of ['businessId','role','permissions','allowedSpaceIds','spaceAccess'])patch[key]=FieldValue.delete();
          if(profile.previousBusinessId===businessId)patch.previousBusinessId=FieldValue.delete();
          if(Object.keys(patch).length)tx.update(userRef,{...patch,updatedAt:FieldValue.serverTimestamp()});
        });
      }
      for(const collection of await businessRef.listCollections()){
        const kind=policy.classifyCollection(collection.id);
        if(kind==='delete-operational')await eraseCollection(collection);
        if(kind==='preserve-owner-only'){
          await eraseCollection(collection,job.ownerUid);
          for(const child of await collection.doc(job.ownerUid).listCollections())await eraseCollection(child);
        }
      }
      for(const path of scope.externalPaths)await eraseDocument(db.doc(path),db.doc(path));
      // Storage must be cleared before removing space parents needed by path discovery.
      for(const prefix of policy.storagePrefixes(businessId,scope.spaceIds)){
        let pageToken;
        do{
          const [files,next]=await bucket.getFiles({prefix,versions:true,autoPaginate:false,maxResults:100,pageToken});
          for(const file of files){
            if(!file.name.startsWith(prefix))throw Error('Storage prefix mismatch');
            const objectGeneration=file.metadata?.generation;
            if(!objectGeneration)throw Error('Storage object generation required');
            await commit(async tx=>{
              if(prefix.startsWith('financialSpaces/')){
                const parent=db.doc(prefix.slice(0,-1));
                await assertExternalOwner(tx,parent);
                if(!(await tx.get(parent)).exists)throw new HttpsError('failed-precondition','Arquivo sem espaço de origem comprovado.',{reason:'storage-scope-unconfirmed'});
              }
            }); // Recheck worker lease and scope before the external operation.
            // Never delete a newer object uploaded to the same path after a resume.
            await bucket.file(file.name,{generation:objectGeneration,preconditionOpts:{ifGenerationMatch:objectGeneration}}).delete({ignoreNotFound:true});
            await commit(tx=>tx.update(ref,{'counts.files':FieldValue.increment(1)}));
          }
          pageToken=next?.pageToken;
        }while(pageToken);
      }
      for(const id of scope.spaceIds)await eraseDocument(db.doc(`financialSpaces/${id}`),db.doc(`financialSpaces/${id}`));
      await stage('VERIFYING');
      for(const collection of await businessRef.listCollections()){
        const kind=policy.classifyCollection(collection.id),refs=await collection.listDocuments();
        if(kind==='delete-operational'&&refs.length)throw Error('Operational collection not empty');
        if(kind==='preserve-owner-only'&&refs.some(item=>item.id!==job.ownerUid))throw Error('Additional members remain');
      }
      for(const path of [...scope.externalPaths,...scope.spaceIds.map(id=>`financialSpaces/${id}`)]){
        const target=db.doc(path);if((await target.get()).exists||(await target.listCollections()).length)throw Error('External operational records remain');
      }
      for(const prefix of policy.storagePrefixes(businessId,scope.spaceIds))if((await bucket.getFiles({prefix,versions:true,autoPaginate:false,maxResults:1}))[0].length)throw Error('Operational Storage not empty');
      await commit(async(tx,fresh,business)=>{
        const ownerRef=businessRef.collection('members').doc(job.ownerUid),member=await tx.get(ownerRef);
        if(business.ownerId!==job.ownerUid||member.data()?.role!=='owner'||member.data()?.status!=='active'||!business.subscription?.planId||!business.subscription?.status)throw Error('Owner or subscription preservation check failed');
        const patch={name:'Minha empresa',onboardingCompleted:true,updatedAt:FieldValue.serverTimestamp(),'workspaceReset.status':'COMPLETED'};
        for(const key of OPERATIONAL_ROOT)if(!['name','onboardingCompleted'].includes(key)&&key in business)patch[key]=FieldValue.delete();
        tx.update(businessRef,patch);
        tx.set(ownerRef,{uid:job.ownerUid,name:member.data().name||'',email:member.data().email||'',role:'owner',status:'active',spaceAccess:'all',allowedSpaceIds:[],permissions:ROLE_PRESETS.owner,schemaVersion:1,updatedAt:FieldValue.serverTimestamp()});
        tx.update(ref,{status:'COMPLETED',completedAt:FieldValue.serverTimestamp(),scope:FieldValue.delete(),leaseId:FieldValue.delete(),failureCode:FieldValue.delete()});
      });
      return{completed:true,generation:job.resetGeneration};
    }catch(error){
      try{await commit(tx=>{tx.update(ref,{status:'FAILED',failureCode:String(error.code||'reset-step-failed').slice(0,80)});tx.update(businessRef,{'workspaceReset.status':'FAILED'});},{release:true});}
      catch(lockError){console.error('[BUSINESS RESET] failure state not persisted',{businessId,operationId,code:lockError.code||'unknown'});}
      throw error;
    }
  }
  return{request,retry,run,preflight};
}
module.exports={businessResetService,PRESERVE_ROOT,OPERATIONAL_ROOT};
