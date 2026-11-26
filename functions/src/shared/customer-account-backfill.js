'use strict';
// Conta por Espaço — Fase 2: classificação da carga inicial de cada cliente.
// A carga parte da conta da Fase 1 (projeção comprovada ou soma dos eventos) e decide,
// sem inventar origem, se a conta já está pronta por Espaço ou se precisa de uma
// decisão do proprietário. Uma regra de atribuição só vale quando o proprietário a
// aprova explicitamente no pedido.
const Account = require('./customer-account');

const STATUS = Object.freeze({
  READY: 'ready',                         // dívida por Espaço comprovada ou sem saldo
  READY_BY_RULE: 'ready_by_rule',         // total comprovado; Espaço definido por regra aprovada
  NEEDS_ATTRIBUTION: 'needs_attribution', // total comprovado; falta decidir o Espaço de parte da dívida
  NEEDS_OPENING: 'needs_opening',         // os eventos não explicam o saldo cadastral
  NEEDS_REVIEW: 'needs_review',           // o histórico não pôde ser lido com segurança (limites, auditoria)
});
const RULES = Object.freeze({
  // Cliente ligado a um único Espaço, sem dívida em outro: a parte sem Espaço vai para ele.
  SINGLE_LINKED_SPACE: 'single_linked_space',
  // A parte sem Espaço vai para o Espaço indicado pelo proprietário no pedido.
  FALLBACK_SPACE: 'fallback_space',
  // Conta antiga com dívida em vários Espaços: aceita a divisão que a projeção calcula
  // hoje (recebimentos sem Espaço abatem a dívida mais antiga) como ponto de partida.
  ACCEPT_HISTORY_SPLIT: 'accept_history_split',
});
const linkedSpaces = client => [...new Set([...(client?.customerSpaceIds || []), ...(client?.customerSpaceIds?.length ? [] : [client?.spaceId])].filter(Boolean))];
const nonZero = spaces => Object.keys(spaces || {}).filter(id => spaces[id] !== 0);

function moveUnattributed(account, spaceId) {
  if (!account.unattributedCents) return account;
  const spaces = {...account.spaces, [spaceId]: (account.spaces[spaceId] || 0) + account.unattributedCents};
  return {...account, spaces: Object.fromEntries(Object.entries(spaces).filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b))), unattributedCents: 0};
}

// Classifies one customer. `account` comes from Account.fromProjection/fromEvents.
// `split` is how the per-Space values were obtained: 'scoped' (the history proves each
// Space), 'history_fifo' (unscoped projection: payments without Space consume the
// oldest debt) or 'events' (sum of the events by their own Space).
function classify({account, client, split, rules = [], fallbackSpaceId = null}) {
  const approved = new Set(rules), applied = [];
  const unexplained = account.baseline?.unexplainedCents || 0;
  if (unexplained !== 0) return {status: STATUS.NEEDS_OPENING, account, rules: applied, reason: 'saldo-sem-eventos'};
  if (account.debtCents === 0 && !nonZero(account.spaces).length && !account.unattributedCents) return {status: STATUS.READY, account, rules: applied, reason: 'sem-saldo'};
  if (split === 'scoped') return {status: STATUS.READY, account, rules: applied, reason: 'comprovada-por-espaco'};
  let next = account;
  const linked = linkedSpaces(client), spaces = () => nonZero(next.spaces);
  if (next.unattributedCents && approved.has(RULES.SINGLE_LINKED_SPACE) && linked.length === 1 && spaces().every(s => s === linked[0])) {
    next = moveUnattributed(next, linked[0]); applied.push(RULES.SINGLE_LINKED_SPACE);
  }
  if (next.unattributedCents && approved.has(RULES.FALLBACK_SPACE) && fallbackSpaceId) {
    next = moveUnattributed(next, fallbackSpaceId); applied.push(RULES.FALLBACK_SPACE);
  }
  if (next.unattributedCents) return {status: STATUS.NEEDS_ATTRIBUTION, account: next, rules: applied, reason: 'divida-sem-espaco'};
  // A FIFO split across several Spaces is a calculation, not an attribution decision.
  if (split === 'history_fifo' && spaces().length > 1) {
    if (!approved.has(RULES.ACCEPT_HISTORY_SPLIT)) return {status: STATUS.NEEDS_ATTRIBUTION, account: next, rules: applied, reason: 'divisao-entre-espacos-calculada'};
    applied.push(RULES.ACCEPT_HISTORY_SPLIT);
  }
  return {status: applied.length ? STATUS.READY_BY_RULE : STATUS.READY, account: next, rules: applied, reason: applied.length ? 'regra-aprovada' : 'um-espaco-pelo-historico'};
}
// Same values and same baseline cut: nothing to write.
function sameAccount(a, b) {
  if (!a || !b) return false;
  const pick = x => JSON.stringify([x.schemaVersion, x.workspaceGeneration, x.debtCents, x.spaces, x.unattributedCents, x.baseline?.cut || null, x.baseline?.unexplainedCents || 0, x.status || null]);
  return pick(a) === pick(b);
}
const validRules = rules => Array.isArray(rules) && rules.length <= 3 && rules.every(r => Object.values(RULES).includes(r)) && new Set(rules).size === rules.length;
module.exports = {STATUS, RULES, classify, sameAccount, validRules, linkedSpaces, Account};
