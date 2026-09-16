const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  buildDefaultSpace,
  explicitGlobalFieldIssues,
  globalPatch,
  normalizedGlobalFields,
  patchWrite,
  same,
} = require("../scripts/migrate-global-spaces-v139.cjs");

const legacy = (id, value) => ({ id, value });

test("migração de espaço é aditiva, determinística e idempotente", () => {
  const original = legacy("business_adi-festa", {
    id: "business_adi-festa",
    name: "Adi Festa",
    type: "business",
    linkedBusinessId: "adi-festa",
    ownerUid: "owner-a",
    active: true,
    automation: { enabled: true },
  }), first = globalPatch(original);
  assert.deepEqual(first.fields, {
    businessId: "adi-festa",
    operationalType: "unit",
    status: "active",
    capabilities: { finance: true, sales: true, products: true, inventory: true, goals: true },
    isDefault: true,
    globalSpaceSchemaVersion: 1,
  });
  assert.equal(Object.hasOwn(first.patch, "type"), false);
  assert.equal(Object.hasOwn(first.patch, "linkedBusinessId"), false);
  assert.deepEqual(globalPatch(legacy(original.id, { ...original.value, ...first.patch })).patch, {});
  assert.deepEqual(original.value.automation, { enabled: true });
});

test("espaço pessoal legado não recebe empresa nem vendas por inferência", () => {
  const fields = normalizedGlobalFields(legacy("casa", {
    id: "casa", name: "Casa", type: "personal", linkedBusinessId: null, ownerUid: "owner-a", active: true,
  }));
  assert.equal(fields.businessId, null);
  assert.equal(fields.operationalType, "personal");
  assert.deepEqual(fields.capabilities, { finance: true, sales: false, products: false, inventory: false, goals: false });
});

test("configuração global explícita é preservada", () => {
  const fields = normalizedGlobalFields(legacy("iptv", {
    id: "iptv", type: "other", ownerUid: "owner-a", active: true,
    businessId: "adi-festa", operationalType: "operation",
    capabilities: { finance: true, sales: true, products: true, inventory: false, goals: true },
    isDefault: false, status: "active", globalSpaceSchemaVersion: 1,
  }));
  assert.equal(fields.businessId, "adi-festa");
  assert.equal(fields.operationalType, "operation");
  assert.equal(fields.capabilities.sales, true);
  assert.equal(fields.capabilities.inventory, false);
});

test("promoção preserva capabilities adicionais e compara mapas sem depender da ordem", () => {
  const original = legacy("business_adi-festa", {
    id: "business_adi-festa", type: "business", linkedBusinessId: "adi-festa", ownerUid: "owner-a", active: true,
    capabilities: { sales: true, customGuard: { mode: "strict" }, finance: false },
  }), first = globalPatch(original);
  assert.deepEqual(first.fields.capabilities, {
    sales: true,
    customGuard: { mode: "strict" },
    finance: false,
    products: true,
    inventory: true,
    goals: true,
  });
  assert.equal(same({ finance: false, sales: true }, { sales: true, finance: false }), true);
  assert.deepEqual(globalPatch(legacy(original.id, { ...original.value, ...first.patch })).patch, {});
});

test("patch preserva valores Firestore desconhecidos dentro de capabilities", () => {
  const document = {
    name: "projects/test/databases/(default)/documents/financialSpaces/business_adi-festa",
    updateTime: "2026-09-15T12:00:00.000Z",
    fields: {
      capabilities: { mapValue: { fields: {
        finance: { booleanValue: false },
        customReference: { referenceValue: "projects/test/databases/(default)/documents/config/custom" },
      } } },
    },
  }, write = patchWrite(document, { capabilities: {
    finance: false, sales: true, products: true, inventory: true, goals: true, customReference: null,
  } });
  assert.deepEqual(write.update.fields.capabilities.mapValue.fields.customReference,
    document.fields.capabilities.mapValue.fields.customReference);
  assert.deepEqual(write.update.fields.capabilities.mapValue.fields.sales, { booleanValue: true });
  assert.deepEqual(write.currentDocument, { updateTime: document.updateTime });
});

test("businessId vazio não impede o vínculo legado inequívoco", () => {
  const fields = normalizedGlobalFields(legacy("business_adi-festa", {
    id: "business_adi-festa", type: "business", businessId: "   ", linkedBusinessId: "adi-festa", ownerUid: "owner-a", active: true,
  }));
  assert.equal(fields.businessId, "adi-festa");
});

test("campos globais explícitos malformados bloqueiam normalização destrutiva", () => {
  assert.deepEqual(explicitGlobalFieldIssues({ capabilities: { sales: "true" } }), [
    { reason: "invalid-capability-flag", field: "capabilities.sales", value: "true" },
  ]);
  assert.deepEqual(explicitGlobalFieldIssues({ capabilities: null }), [
    { reason: "invalid-capabilities-map", field: "capabilities", value: null },
  ]);
  assert.deepEqual(explicitGlobalFieldIssues({
    operationalType: "future-type", status: "paused", isDefault: "yes", globalSpaceSchemaVersion: "1",
  }).map((issue) => issue.reason), [
    "invalid-operational-type", "invalid-global-status", "invalid-default-flag", "invalid-global-schema-version",
  ]);
  assert.deepEqual(explicitGlobalFieldIssues({
    operationalType: "operation", status: "active", isDefault: false, globalSpaceSchemaVersion: 1,
    capabilities: { finance: true, customGuard: "preserved" },
  }), []);
});

test("default novo mantém o contrato financeiro e usa ID business_{businessId}", () => {
  const created = buildDefaultSpace({ id: "business-a", value: { ownerId: "owner-a", name: "Loja A" } }, "2026-09-15T12:00:00.000Z");
  assert.equal(created.id, "business_business-a");
  assert.equal(created.type, "business");
  assert.equal(created.linkedBusinessId, "business-a");
  assert.equal(created.businessId, "business-a");
  assert.equal(created.automation.enabled, true);
  assert.equal(created.capabilities.sales, true);
});

test("serviço e migrador não fazem N+1, delete, move ou backfill de venda/produto", () => {
  const service = fs.readFileSync("js/firebase/space-service.js", "utf8"), migration = fs.readFileSync("scripts/migrate-global-spaces-v139.cjs", "utf8"),
    dryRunGuard = migration.indexOf("if (!execute)"), dataCommit = migration.indexOf("if (dataWrites.length) await commit(dataWrites)");
  assert.equal((service.match(/getDocs\(query\(/g) || []).length, 2);
  assert.match(service, /where\("linkedBusinessId", "==", context\.businessId\)/);
  assert.match(service, /where\("ownerUid", "==", context\.uid\)/);
  assert.match(service, /Context\.setAdapter\(adapter\)/);
  assert.doesNotMatch(service, /deleteDoc|collectionGroup/);
  assert.match(migration, /currentDocument: \{ updateTime: document\.updateTime \}/);
  assert.match(migration, /currentDocument: \{ exists: false \}/);
  assert.match(migration, /reservedSpaceIds = new Set\(\['all', 'all_spaces'\]\)/);
  assert.notEqual(dryRunGuard, -1);
  assert.notEqual(dataCommit, -1);
  assert.ok(dryRunGuard < dataCommit);
  assert.doesNotMatch(migration, /delete:/);
  assert.doesNotMatch(migration, /listDocuments\(`?businesses\/\$\{[^}]+\}\/sales/);
  assert.doesNotMatch(migration, /listDocuments\(`?businesses\/\$\{[^}]+\}\/products/);
});
