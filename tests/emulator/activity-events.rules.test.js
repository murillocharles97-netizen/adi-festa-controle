const test = require('node:test');
const fs = require('node:fs');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');

let env;
const projectId = 'adi-festa-variations-test';
const businessA = 'activity-business-a';
const businessB = 'activity-business-b';

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const subscription = { planId: 'internal', status: 'active' };
    await setDoc(doc(db, 'businesses', businessA), { id: businessA, ownerId: 'owner-a', active: true, subscription });
    await setDoc(doc(db, 'businesses', businessB), { id: businessB, ownerId: 'owner-b', active: true, subscription });
    await setDoc(doc(db, 'users', 'owner-a'), { uid: 'owner-a', businessId: businessA, role: 'owner', active: true });
    await setDoc(doc(db, 'users', 'owner-b'), { uid: 'owner-b', businessId: businessB, role: 'owner', active: true });
    await setDoc(doc(db, 'businesses', businessA, 'activityEvents', 'sale:sale-1'), {
      id: 'sale:sale-1', eventId: 'sale:sale-1', businessId: businessA,
      type: 'sale', entityId: 'sale-1', createdAt: new Date('2026-09-22T19:15:00Z'),
      status: 'confirmed', schemaVersion: 1,
    });
  });
});

test.after(async () => env?.cleanup());

test('membro lê o histórico do próprio business e não o de outro', async () => {
  const db = env.authenticatedContext('owner-a').firestore();
  await assertSucceeds(getDoc(doc(db, 'businesses', businessA, 'activityEvents', 'sale:sale-1')));
  await assertFails(getDoc(doc(db, 'businesses', businessB, 'activityEvents', 'sale:sale-1')));
});

test('clientes não criam nem alteram projeções canônicas', async () => {
  const db = env.authenticatedContext('owner-a').firestore();
  await assertFails(setDoc(doc(db, 'businesses', businessA, 'activityEvents', 'payment:payment-1'), {
    id: 'payment:payment-1', businessId: businessA, type: 'payment', createdAt: new Date(),
  }));
  await assertFails(updateDoc(doc(db, 'businesses', businessA, 'activityEvents', 'sale:sale-1'), { status: 'tampered' }));
});
