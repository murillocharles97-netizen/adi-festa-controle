const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const auth=fs.readFileSync('js/firebase/auth.js','utf8'),service=fs.readFileSync('functions/src/services/onboarding-service.js','utf8'),rules=fs.readFileSync('firestore.rules','utf8');

test('rascunho é preservado entre Auth e conclusão e removido somente após sucesso',()=>{
  assert.match(auth,/localStorage\.setItem\(pendingKey\(result\.user\.uid\)/);
  assert.match(auth,/await provisionBusinessAccount\(result\.user,d\);\s*localStorage\.removeItem/);
  assert.match(auth,/currentStep:3,updatedAt:new Date\(\)\.toISOString\(\)/);
});

test('retomada não pede nova senha nem cria outro usuário Auth',()=>{
  const start=auth.indexOf('function resumeOnboarding'),end=auth.indexOf('function unauthorized',start),resume=auth.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.doesNotMatch(resume,/password|createUserWithEmailAndPassword/);
  assert.match(resume,/provisionBusinessAccount\(user,saved\)/);
  assert.match(auth,/FirebaseCallable\('completeBusinessOnboarding'/);
  assert.match(auth,/Este e-mail já possui uma conta\. Entre com sua senha para continuar/);
});

test('backend deriva empresa do Auth e preserva trial existente',()=>{
  assert.match(service,/businessId=`biz_\$\{authUid\}`/);
  assert.match(service,/business\.subscription\?\.trialStartedAt\|\|membership\.trialStartedAt/);
  assert.match(service,/existingSubscription=business\.subscription\|\|\{\}/);
  assert.match(service,/subscription=existingSubscription\.planId&&existingSubscription\.status/);
  assert.doesNotMatch(service,/input\.uid/);
});

test('cliente não cria perfil nem empresa diretamente',()=>{
  assert.match(rules,/match \/users\/\{uid\}[\s\S]*?allow create: if false/);
  assert.match(rules,/match \/businesses\/\{businessId\}[\s\S]*?allow create: if false/);
});
