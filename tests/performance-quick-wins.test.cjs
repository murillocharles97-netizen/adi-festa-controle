'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function withFormatterCounter(file, globalName, construct = args => new Intl.DateTimeFormat(...args)) {
  let instances = 0;
  const DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
    construct(_target, args) {
      instances += 1;
      return construct(args);
    },
  });
  const context = vm.createContext({ Date, Intl: { DateTimeFormat } });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { api: context[globalName], instances: () => instances };
}

const beforeMidnight = '2026-12-31T02:59:59.999Z';
const afterMidnight = '2026-12-31T03:00:00.000Z';
const beforeMidnightWithDst = '2018-12-01T01:59:59.999Z';
const afterMidnightWithDst = '2018-12-01T02:00:00.000Z';

test('Clientes cria um formatador e mantém dias e cortes de São Paulo', () => {
  const { api, instances } = withFormatterCounter('js/customer-metrics.js', 'CustomerMetricsService');
  assert.equal(api.daysBetween('inválida', null), null);
  assert.equal(instances(), 0);

  for (let n = 0; n < 4; n++) {
    assert.equal(api.daysBetween(beforeMidnight, afterMidnight), 1);
    assert.equal(api.daysBetween(beforeMidnightWithDst, afterMidnightWithDst), 1);
    const timestamp = { seconds: Date.parse(beforeMidnight) / 1000, nanoseconds: 0 };
    assert.equal(api.daysBetween(timestamp, { toDate: () => new Date(afterMidnight) }), 1);
    assert.equal(api.daysBetween(afterMidnight, beforeMidnight), 0);
    assert.equal(api.inactivityCutoff(1, afterMidnight), '2026-12-31T02:59:59.999Z');
  }
  assert.equal(instances(), 1);
});

test('CRM aplica um formatador a filtros passados e futuros e mantém o fallback', () => {
  const file = 'js/crm-segment-engine-v2.js', name = 'CRMSegmentEngineV2';
  const { api, instances } = withFormatterCounter(file, name);
  assert.equal(api.daysUntil(undefined, 'inválida'), null);
  assert.equal(instances(), 0);

  for (let n = 0; n < 4; n++) {
    assert.equal(api.daysAgo(beforeMidnight, afterMidnight), 1);
    assert.equal(api.daysAgo(beforeMidnightWithDst, afterMidnightWithDst), 1);
    assert.equal(api.daysAgo(afterMidnight, beforeMidnight), 0);
    assert.equal(api.daysUntil(beforeMidnight, afterMidnight), -1);
  }
  assert.equal(instances(), 1);

  const fallback = withFormatterCounter(file, name, () => { throw new RangeError('Fuso indisponível na fixture'); });
  assert.equal(fallback.api.daysAgo(beforeMidnight, afterMidnight), 0);
  assert.equal(fallback.api.daysAgo('2026-12-30T23:59:59Z', afterMidnight), 1);
});
