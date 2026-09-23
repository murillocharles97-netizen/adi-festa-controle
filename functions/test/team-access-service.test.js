'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PERMISSIONS,ROLE_PRESETS,normalizedPermissions,hasPermission}=require('../src/services/team-access-service');

test('presets V150 mantêm financeiro, custo e lucro fora do vendedor e do estoque',()=>{
  for(const role of ['seller','stock']){
    const permissions=normalizedPermissions(role);
    assert.equal(permissions['financial.view'],false);
    assert.equal(permissions['cost.view'],false);
    assert.equal(permissions['profit.view'],false);
    assert.equal(permissions['team.manage'],false);
  }
  assert.equal(normalizedPermissions('seller')['sales.create'],true);
  assert.equal(normalizedPermissions('stock')['inventory.adjust'],true);
  assert.equal(normalizedPermissions('stock')['sales.create'],false);
});

test('permissão explícita false prevalece sobre o preset e chaves desconhecidas são descartadas',()=>{
  const permissions=normalizedPermissions('manager',{'sales.create':false,'financial.view':true,root:true});
  assert.equal(permissions['sales.create'],false);
  assert.equal(permissions['financial.view'],true);
  assert.equal('root' in permissions,false);
  assert.deepEqual(Object.keys(permissions),PERMISSIONS);
});

test('owner possui acesso total e demais cargos dependem da permissão efetiva',()=>{
  assert.equal(hasPermission({role:'owner',permissions:{}},'billing.manage'),true);
  assert.equal(hasPermission({role:'manager',permissions:{'team.manage':true}},'team.manage'),true);
  assert.equal(hasPermission({role:'seller',permissions:ROLE_PRESETS.seller},'financial.view'),false);
});
