export const LEGACY_MIGRATION_VERSION=1;

const automaticAttempts=new Set();
const running=new Map();
const codeOf=error=>String(error?.code||'unknown').replace('firestore/','');

export function legacyMigrationCompleted(profile={},business={}){
  return Number(profile.migrationVersion||0)>=LEGACY_MIGRATION_VERSION
    && Number(business.migrationVersion||0)>=LEGACY_MIGRATION_VERSION;
}

export function legacyMigrationPatches(profile={},business={},timestamp){
  const profilePatch={};
  const businessPatch={};
  if(!profile.uid&&profile.__authUid)profilePatch.uid=profile.__authUid;
  if(profile.role==='admin')profilePatch.role='owner';
  if(!Array.isArray(profile.permissions))profilePatch.permissions=[];
  if(Number(profile.migrationVersion||0)<LEGACY_MIGRATION_VERSION){
    profilePatch.migrationVersion=LEGACY_MIGRATION_VERSION;
    profilePatch.migratedAt=timestamp;
  }
  if(!business.slug)businessPatch.slug='adi-festa';
  if(business.onboardingCompleted!==true)businessPatch.onboardingCompleted=true;
  if(!business.businessType)businessPatch.businessType='Doceria';
  if(!business.subscription)businessPatch.subscription={planId:'internal',status:'active',trialStartedAt:null,trialEndsAt:null,currentPeriodStart:null,currentPeriodEnd:null,cancelAtPeriodEnd:false,suspendedAt:null,gracePeriodEndsAt:null};
  if(!business.limits)businessPatch.limits={maxUsers:999,maxProducts:999999,maxClients:999999,maxMonthlySales:999999,users:999,products:999999,clients:999999,monthlySales:999999,catalogEnabled:true,campaignsEnabled:true};
  if(Number(business.migrationVersion||0)<LEGACY_MIGRATION_VERSION){
    businessPatch.migrationVersion=LEGACY_MIGRATION_VERSION;
    businessPatch.migratedAt=timestamp;
  }
  return{profilePatch,businessPatch};
}

export async function runLegacyMigration({user,profile,business,writeProfile,writeBusiness,timestamp,mode='automatic'}){
  if(legacyMigrationCompleted(profile,business)){
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
