const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'../js/firebase/profile-validation.js'),'utf8')
  .replace(/^export /gm,'')
  +'\n;globalThis.__profileValidation={normalizeProfileEmail,abbreviateTechnicalId,profileValidationInfo,validateAuthenticatedProfile,validateAuthenticatedBusiness};';
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'profile-validation.js'});
const validation=sandbox.__profileValidation;

const authUser={uid:'owner-auth-123456789',email:' Dono@AdiFesta.com '};
const legacyProfile={email:'dono@adifesta.com',businessId:'adi-festa',active:true,role:'admin'};
const legacyBusiness={id:'adi-festa',ownerId:authUser.uid,active:true};

{
  const result=validation.validateAuthenticatedProfile({
    authUser,
    profileSnapshotId:authUser.uid,
    profile:legacyProfile
  });
  assert.equal(result.isLegacyAdiFestaOwnerCandidate,true);
  assert.equal(result.needsLegacyMigration,true);
}

{
  const result=validation.validateAuthenticatedBusiness({
    authUser,
    profile:legacyProfile,
    businessId:'adi-festa',
    business:legacyBusiness
  });
  assert.equal(result.isLegacyAdiFestaOwner,true);
  assert.equal(result.needsLegacyMigration,true);
}

assert.throws(
  ()=>validation.validateAuthenticatedProfile({
    authUser,
    profileSnapshotId:authUser.uid,
    profile:{...legacyProfile,uid:'another-auth-uid'}
  }),
  error=>error.code==='profile/uid-mismatch'
);

assert.throws(
  ()=>validation.validateAuthenticatedProfile({
    authUser,
    profileSnapshotId:authUser.uid,
    profile:{...legacyProfile,email:'outra@conta.com'}
  }),
  error=>error.code==='profile/email-mismatch'
);

assert.throws(
  ()=>validation.validateAuthenticatedProfile({
    authUser,
    profileSnapshotId:authUser.uid,
    profile:{...legacyProfile,active:false}
  }),
  error=>error.code==='profile/inactive'
);

assert.throws(
  ()=>validation.validateAuthenticatedBusiness({
    authUser,
    profile:legacyProfile,
    businessId:'adi-festa',
    business:{...legacyBusiness,ownerId:'another-owner'}
  }),
  error=>error.code==='business/owner-mismatch'
);

assert.throws(
  ()=>validation.validateAuthenticatedBusiness({
    authUser,
    profile:legacyProfile,
    businessId:'adi-festa',
    business:{...legacyBusiness,subscription:{planId:'trial',status:'trial'}}
  }),
  error=>error.code==='business/subscription-mismatch'
);

{
  const info=validation.profileValidationInfo({authUser,profileSnapshotId:authUser.uid,profile:legacyProfile});
  assert.equal(info.profileHasUid,false);
  assert.equal(info.uidMatches,true);
  assert.equal(info.emailMatches,true);
  assert.equal(info.businessId,'adi-festa');
  assert.equal(info.role,'admin');
}

assert.equal(validation.abbreviateTechnicalId('1234567890abcdefgh'),'123456…efgh');
console.log('profile-validation.test.js: OK');
