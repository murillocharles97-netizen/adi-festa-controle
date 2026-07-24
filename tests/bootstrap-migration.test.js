const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function migrationModule(){
  const source=read('js/firebase/legacy-migration.js')
    .replace(/^export /gm,'')
    +'\n;globalThis.__migration={LEGACY_MIGRATION_VERSION,legacyMigrationCompleted,legacyMigrationPatches,runLegacyMigration,resetLegacyMigrationAttempt};';
  const logs=[];
  const sandbox={
    console:{
      info:(message,details)=>logs.push({level:'info',message,details}),
      error:(message,details)=>logs.push({level:'error',message,details})
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox,{filename:'legacy-migration.js'});
  return{...sandbox.__migration,logs};
}

(async()=>{
  {
    const migration=migrationModule();
    const writes={profile:[],business:[]};
    const profile={businessId:'adi-festa',role:'admin'};
    const business={id:'adi-festa',ownerId:'owner-1'};
    const result=await migration.runLegacyMigration({
      user:{uid:'owner-1'},profile,business,timestamp:'2026-07-23T12:00:00.000Z',
      writeProfile:async patch=>writes.profile.push({...patch}),
      writeBusiness:async patch=>writes.business.push({...patch})
    });
    assert.equal(migration.LEGACY_MIGRATION_VERSION,1);
    assert.equal(writes.profile.length,1);
    assert.equal(writes.business.length,1);
    assert.equal(result.profile.role,'owner');
    assert.equal(result.profile.uid,'owner-1');
    assert.equal(result.profile.migrationVersion,1);
    assert.equal(result.business.migrationVersion,1);
    assert.equal(result.business.subscription.planId,'internal');
    assert.equal(result.business.limits.catalogEnabled,true);

    const completed=await migration.runLegacyMigration({
      user:{uid:'owner-1'},profile:result.profile,business:result.business,
      timestamp:'2026-07-23T12:01:00.000Z',
      writeProfile:async()=>{throw Error('não deveria gravar')},
      writeBusiness:async()=>{throw Error('não deveria gravar')}
    });
    assert.equal(completed.alreadyCompleted,true);
    assert.ok(migration.logs.some(log=>log.message==='[Legacy Migration] already completed'));
  }

  {
    const migration=migrationModule();
    let releases;
    const held=new Promise(resolve=>{releases=resolve});
    let profileWrites=0,businessWrites=0;
    const args={
      user:{uid:'owner-concurrent'},profile:{businessId:'adi-festa'},business:{id:'adi-festa'},
      timestamp:'2026-07-23T12:00:00.000Z',
      writeProfile:async()=>{profileWrites++;await held},
      writeBusiness:async()=>{businessWrites++}
    };
    const first=migration.runLegacyMigration(args);
    const second=migration.runLegacyMigration(args);
    releases();
    await Promise.all([first,second]);
    assert.equal(profileWrites,1);
    assert.equal(businessWrites,1);
  }

  {
    const migration=migrationModule();
    const quota=Object.assign(new Error('quota'),{code:'resource-exhausted'});
    const args={
      user:{uid:'owner-quota'},profile:{businessId:'adi-festa'},business:{id:'adi-festa'},
      timestamp:'2026-07-23T12:00:00.000Z',
      writeProfile:async()=>{throw quota},
      writeBusiness:async()=>{}
    };
    await assert.rejects(migration.runLegacyMigration(args),error=>error.code==='resource-exhausted');
    await assert.rejects(
      migration.runLegacyMigration(args),
      error=>error.code==='migration/already-attempted'
    );
    assert.ok(migration.logs.some(log=>log.message==='[Legacy Migration] failed'&&log.details.code==='resource-exhausted'));

    let retryWrites=0;
    await migration.runLegacyMigration({...args,mode:'retry',writeProfile:async()=>{retryWrites++}});
    assert.equal(retryWrites,1);
  }

  const auth=read('js/firebase/auth.js');
  assert.match(auth,/BOOTSTRAP_TIMEOUT_MS=15000/);
  assert.match(auth,/profileSnapshot=await getDoc\(profileRef\)/);
  assert.match(auth,/automaticBootstrapAttempts/);
  assert.match(auth,/new Set\(\['unauthenticated','migrating','ready','onboarding','subscription_blocked','temporary_unavailable','permission_error','fatal_error'\]\)/);
  assert.match(auth,/Firebase atingiu temporariamente o limite de uso/);
  assert.match(auth,/finally\(\(\)=>\{/);
  assert.match(auth,/window\.LegacyMigrationAdmin=/);
  assert.match(auth,/window\.SyncFirebase\.setUser\(user,profile\)/);
  assert.ok(auth.indexOf('BusinessContext.set')<auth.indexOf('window.SyncFirebase.setUser'));
  assert.doesNotMatch(auth,/onSnapshot\(/);

  const worker=read('service-worker.js');
  assert.match(worker,/adi-festa-v43-sale-sharing/);
  assert.match(worker,/legacy-migration\.js/);

  console.log('bootstrap-migration.test.js: OK');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
