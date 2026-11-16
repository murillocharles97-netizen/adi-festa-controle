'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const fail = message => { throw new HttpsError('failed-precondition', message); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const mul = (units, cents) => {
  const total = units * cents;
  if (!count(total)) fail('Valor em consignação acima do limite.');
  return total;
};

function lots(row) {
  if (!row) return [];
  const quantity = row.quantity, items = row.priceLots ?? (quantity ? [{ quantity, unitCents: row.unitCents }] : []);
  if (!count(quantity) || !Array.isArray(items) || items.some(x => !count(x?.quantity) || !count(x?.unitCents)) ||
    items.reduce((sum, x) => sum + x.quantity, 0) !== quantity || new Set(items.map(x => x.unitCents)).size !== items.length)
    fail('O saldo de preço e quantidade do ponto precisa de conferência.');
  return items.filter(x => x.quantity > 0);
}

function flatten(rows) {
  const values = rows.flatMap(row => lots(row).map(lot => ({
    id: row.id + '_' + lot.unitCents, stockId: row.id, productId: row.productId, variantId: row.variantId ?? null,
    name: row.name, variantName: row.variantName || '', sku: row.sku || '', imageUrl: row.imageUrl || '',
    unitCents: lot.unitCents, quantity: lot.quantity, totalCents: mul(lot.quantity, lot.unitCents),
  })));
  if (values.length > 400) fail('O ponto pode manter até 400 linhas de produto e preço.');
  return values.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}

function total(rows) {
  const sum = rows.reduce((n, row) => n + row.totalCents, 0);
  if (!count(sum)) fail('Valor em consignação acima do limite.');
  return sum;
}

function conference(rows, counted, commissionBps) {
  if (!Array.isArray(counted) || counted.length !== rows.length || !rows.length ||
    new Set(counted.map(row => row?.id)).size !== rows.length)
    fail('Preencha a contagem de todos os produtos.');
  const input = new Map(counted.map(row => [row.id, row]));
  const items = rows.map(row => {
    const current = input.get(row.id);
    if (!current) fail('O estoque do ponto mudou. Abra a conferência novamente.');
    const { found, returns, loss, damaged } = current;
    if (![found, returns, loss, damaged].every(count) || found + returns + loss + damaged > row.quantity)
      fail('A contagem e as ocorrências ultrapassam o saldo de ' + row.name + '.');
    const quantity = row.quantity - found - returns - loss - damaged;
    return { ...row, before: row.quantity, found, returns, loss, damaged, quantity, totalCents: mul(quantity, row.unitCents) };
  });
  const grossCents = total(items), units = items.reduce((sum, row) => sum + row.quantity, 0);
  const commissionCents = Number((BigInt(grossCents) * BigInt(commissionBps) + 5000n) / 10000n);
  return { items, grossCents, units, commissionCents, netCents: grossCents - commissionCents };
}

module.exports = { lots, flatten, total, conference, count };
