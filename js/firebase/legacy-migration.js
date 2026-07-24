export const LEGACY_MIGRATION_VERSION=1;

const automaticAttempts=new Set();
const running=new Map();
const codeOf=error=>String(error?.code||'unknown').replace('firestore/','');

export function legacyMigrationCompleted(profile={},business={},authUid=''){
  return Number(profile.migrationVersion||0)>=LEGACY_MIGRATION_VERSION
    && Number(business.migrationVersion||0)>=LEGACY_MIGRATION_VERSION
    && Boolean(profile.uid)
    && (!authUid||profile.uid===authUid)
    && profile.role==='owner'
    && business.subscription?.planId==='internal'
    && business.subscription?.status==='active';
}

export function legacyMigrationPatches(profile={},business={},timestamp){
  const profilePatch={};
  const businessPatch={};
  const uidMissing=profile.uid===undefined||profile.uid===null;
  if(!uidMissing&&profile.__authUid&&profile.uid!==profile.__authUid){
    throw Object.assign(new Error('O UID existente no perfil não pode ser substituído automaticamente.'),{
      code:'profile/uid-mismatch',
      details:{authUid:profile.__authUid,profileUid:profile.uid}
    });
  }
  if(uidMissing&&profile.__authUid)profilePatch.uid=profile.__authUid;
  if(profile.role==='admin')profilePatch.role='owner';
  if(profile.permissions===undefined)profilePatch.permissions=[];
  if(Number(profile.migrationVersion||0)<LEGACY_MIGRATION_VERSION){
    profilePatch.migrationVersion=LEGACY_MIGRATION_VERSION;
    profilePatch.migratedAt=timestamp;
  }
  if(business.slug===undefined)businessPatch.slug='adi-festa';
  if(business.onboardingCompleted===undefined)businessPatch.onboardingCompleted=true;
  if(business.businessType===undefined)businessPatch.businessType='Doceria';
  if(business.subscription===undefined)businessPatch.subscription={planId:'internal',status:'active',trialStartedAt:null,trialEndsAt:null,currentPeriodStart:null,currentPeriodEnd:null,cancelAtPeriodEnd:false,suspendedAt:null,gracePeriodEndsAt:null};
  if(business.limits===undefined)businessPatch.limits={maxUsers:999,maxProducts:999999,maxClients:999999,maxMonthlySales:999999,users:999,products:999999,clients:999999,monthlySales:999999,catalogEnabled:true,campaignsEnabled:true};
  if(Number(business.migrationVersion||0)<LEGACY_MIGRATION_VERSION){
    businessPatch.migrationVersion=LEGACY_MIGRATION_VERSION;
    businessPatch.migratedAt=timestamp;
  }
  return{profilePatch,businessPatch};
}

export async function runLegacyMigration({user,profile,business,writeProfile,writeBusiness,timestamp,mode='automatic'}){
  if(legacyMigrationCompleted(profile,business,user.uid)){
    console.info('[Legacy Migration] already completed',{migrationVersion:LEGACY_MIGRATION_VERSION});
    return{profile,business,alreadyCompleted:true,migrationVersion:LEGACY_MIGRATION_VERSION};
  }
  if(running.has(user.uid))return running.get(user.uid);
  if(mode==='automatic'&&automaticAttempts.has(user.uid)){
    throw Object.assign(new Error('A migração automática já foi tentada nesta sessão.'),{code:'migration/already-attempted'});
  }
  if(mode==='automatic')automaticAttempts.add(user.uid);
  const task=(async()=>{
    console.info('[Legacy Migration] started',{migrationVersion:LEGACY_MIGRATION_VERSION,mode});
    try{
      const {profilePatch,businessPatch}=legacyMigrationPatches({...profile,__authUid:user.uid},business,timestamp);
      if(Object.keys(profilePatch).length){
        console.info('[Legacy Migration] updating profile');
        await writeProfile(profilePatch);
        profile={...profile,...profilePatch};
      }
      if(Object.keys(businessPatch).length){
        console.info('[Legacy Migration] updating business');
        await writeBusiness(businessPatch);
        business={...business,...businessPatch};
      }
      console.info('[Legacy Migration] completed',{migrationVersion:LEGACY_MIGRATION_VERSION});
      return{profile,business,alreadyCompleted:false,migrationVersion:LEGACY_MIGRATION_VERSION};
    }catch(error){
      console.error('[Legacy Migration] failed',{code:codeOf(error),migrationVersion:LEGACY_MIGRATION_VERSION,mode});
      throw error;
    }finally{
      running.delete(user.uid);
    }
  })();
  running.set(user.uid,task);
  return task;
}

export function resetLegacyMigrationAttempt(uid){
  automaticAttempts.delete(uid);
}
