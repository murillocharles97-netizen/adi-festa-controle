// Shared by the browser preview and the trusted creation transaction.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProductSpreadsheet = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const columns = [
    ['ID VECONI', 'id'], ['SKU/código interno', 'codigo'], ['Código de barras/EAN', 'barcode'],
    ['Nome do produto', 'nome'], ['Categoria', 'categoria'], ['Custo', 'custo'],
    ['Preço de venda', 'preco'], ['Estoque atual', 'estoqueAtual'],
  ];
  const blank = v => v === undefined || v === null || typeof v === 'string' && !v.trim();
  const text = v => String(v ?? '').trim();
  const header = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function number(value) {
    if (blank(value)) return null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0 || value > 999999999 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw Error('Número inválido (use até 2 casas decimais).');
      return value;
    }
    let s = text(value).replace(/^R\$\s*/, '');
    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d+(?:[.,]\d{1,2})?$/.test(s)) s = s.replace(',', '.');
    else throw Error('Número inválido. Use 10,50 ou 10.50.');
    return number(Number(s));
  }
  function values(p, canCost = true) {
    const variable = p.productType === 'variable' || p.hasVariations === true;
    return { id: text(p.id), codigo: text(p.codigo), barcode: text(p.barcode), nome: text(p.nome), categoria: text(p.categoria),
      custo: canCost ? p.custo ?? null : null, preco: variable ? p.minPrice ?? p.preco ?? 0 : p.preco ?? 0,
      estoqueAtual: p.itemKind === 'service' || p.semControleEstoque || p.controlaEstoque === false ? null : variable ? p.totalStock ?? 0 : p.estoqueAtual ?? p.estoque ?? 0 };
  }
  function inScope(p, scope, includeInactive = false) {
    if (!p || p.deleted || p.deletedAt || !includeInactive && (p.ativo === false || p.active === false) || p.businessId && p.businessId !== scope.businessId) return false;
    const mode = p.spaceAccessMode || 'all_spaces', ids = p.allowedSpaceIds || [];
    const allows = id => mode === 'all_spaces' || ids.includes(id);
    return scope.spaceId === 'all_spaces' ? scope.allSpaces || scope.allowedSpaceIds.some(allows) : scope.allowedSpaceIds.includes(scope.spaceId) && allows(scope.spaceId);
  }
  function preview(table, products, scope, permissions = {}, mode = 'update') {
    if (!['update', 'create_update'].includes(mode)) throw Error('Modo de importação inválido.');
    if (!Array.isArray(table) || !table.length) throw Error('A planilha está vazia.');
    if (table.length > 10001) throw Error('Limite de 10.000 linhas por importação.');
    const aliases = {nome:'nome do produto', 'estoque inicial':'estoque atual'};
    const headers = table[0].map(value => aliases[header(value)] || header(value)), keys = columns.map(([label]) => headers.indexOf(header(label)));
    if (keys.some(i => i < 0) || new Set(headers).size !== headers.length || headers.length !== columns.length) throw Error('Use as 8 colunas do modelo exportado pela VECONI, sem colunas repetidas.');
    const catalog = products.filter(p => inScope(p, scope, true)), byId = new Map(catalog.map(p => [text(p.id), p]));
    const index = field => { const map = new Map(); for (const p of catalog) { const key = text(p[field]); if (key) map.set(key, [...map.get(key) || [], p]); } return map; };
    const sku = index('codigo'), ean = index('barcode');
    const rows = [];
    for (let i = 1; i < table.length; i++) {
      if (table[i].every(blank)) continue;
      const input = Object.fromEntries(columns.map(([, key], col) => [key, table[i][keys[col]]])), row = { line: i + 1, name: text(input.nome), status: 'invalid', changes: {}, before: {}, errors: [] };
      rows.push(row);
      row.codes = ['codigo', 'barcode'].filter(key => !blank(input[key])).map(key => `${key}:${text(input[key])}`);
      row.identity = !blank(input.id) ? `id:${text(input.id)}` : JSON.stringify([text(input.codigo), text(input.barcode), text(input.nome)]);
      try {
        for (const key of ['id', 'codigo', 'barcode']) if (!blank(input[key]) && typeof input[key] !== 'string') throw Error('ID, SKU e EAN devem ser células de texto para preservar zeros à esquerda.');
        for (const key of ['codigo', 'barcode']) if (!blank(input[key]) && (text(input[key]).length > 100 || /[\u0000-\u001f\u007f]/.test(input[key]))) throw Error('SKU/EAN inválido: use até 100 caracteres, sem caracteres de controle.');
        if (!blank(input.barcode) && /\s/.test(input.barcode)) throw Error('Código de barras não pode conter espaços.');
        const conflict = message => { row.conflict = true; throw Error(message); };
        const id = text(input.id); let p;
        if (id) {
          if (!/^[^/]{1,200}$/.test(id)) throw Error('ID VECONI inválido.');
          p = byId.get(id);
          if (!p && mode === 'create_update') conflict('ID VECONI desconhecido ou fora do espaço. Não será criado outro produto.');
        }
        else {
          const candidates = [!blank(input.codigo) ? sku.get(text(input.codigo)) || [] : null, !blank(input.barcode) ? ean.get(text(input.barcode)) || [] : null].filter(Boolean);
          if (!candidates.length && mode === 'update') throw Error('Informe ID VECONI, SKU ou EAN. O nome não identifica o produto.');
          if (candidates.some(list => list.length > 1)) conflict('Correspondência ambígua de SKU/EAN.');
          if (candidates.some(list => !list.length) && candidates.some(list => list.length)) conflict('SKU e EAN não correspondem ao mesmo produto.');
          if (new Set(candidates.flat().map(p => p.id)).size > 1) conflict('SKU e EAN correspondem a produtos diferentes.');
          p = candidates[0]?.[0];
        }
        if (!p && mode === 'update') { row.status = 'not_found'; row.errors.push('Produto não encontrado. O modo selecionado não cria produtos.'); continue; }
        if (!p) {
          if (scope.spaceId === 'all_spaces') throw Error('Selecione um espaço específico para criar produtos.');
          if (!scope.allowedSpaceIds.includes(scope.spaceId)) throw Error('Espaço não autorizado.');
          if (typeof input.nome !== 'string' || !text(input.nome) || text(input.nome).length > 160) throw Error('Nome obrigatório, com até 160 caracteres.');
          if (!blank(input.categoria) && (typeof input.categoria !== 'string' || text(input.categoria).length > 100)) throw Error('Categoria inválida.');
          const data = {nome:text(input.nome), codigo:text(input.codigo), barcode:text(input.barcode), categoria:text(input.categoria)};
          for (const key of ['custo', 'preco', 'estoqueAtual']) {
            if (blank(input[key])) continue; // The canonical manual builder supplies defaults.
            data[key] = number(input[key]);
            if (key === 'custo' && !permissions.cost) throw Error('Sem permissão para importar custos.');
            if (key === 'estoqueAtual' && data[key] !== 0 && !permissions.stock) throw Error('Sem permissão de estoque inicial.');
          }
          row.create = data; row.status = 'create'; continue;
        }
        if (p.ativo === false || p.active === false) conflict('Produto inativo já possui este identificador. Revise o cadastro antes de importar.');
        if (p.identifierReservation) conflict('SKU/EAN pertence a uma variação ou código alternativo. Revise o cadastro; a importação não altera variações.');
        row.id = p.id; row.name = p.nome; row.matched = true;
        row.targetIdentity = {codigo:text(p.codigo), barcode:text(p.barcode)};
        const current = values(p, permissions.cost), variable = p.productType === 'variable' || p.hasVariations;
        for (const [, key] of columns) {
          if (blank(input[key]) || key === 'id') continue;
          if (input[key] && typeof input[key] === 'object') throw Error('Célula inválida ou fórmula. Use valores simples.');
          const value = ['custo', 'preco', 'estoqueAtual'].includes(key) ? number(input[key]) : text(input[key]);
          if (key === 'custo' && !permissions.cost) throw Error('Sem permissão para importar custos.');
          if (value === current[key]) continue;
          if (['codigo', 'barcode'].includes(key)) conflict('SKU/EAN identificam o produto. Altere códigos pelo cadastro, não pela importação.');
          if (variable && ['custo', 'preco', 'estoqueAtual'].includes(key)) throw Error('Altere custo, preço e estoque nas variações, não no total do produto.');
          if (key === 'estoqueAtual' && (current.estoqueAtual === null || !permissions.stock)) throw Error('Estoque sem controle ou sem permissão de ajuste.');
          if (typeof value === 'string' && value.length > (key === 'nome' ? 160 : 100)) throw Error('Nome ou categoria excede o limite de caracteres.');
          row.changes[key] = value; row.before[key] = current[key];
        }
        row.status = Object.keys(row.changes).length ? 'update' : 'unchanged';
      } catch (error) { row.errors.push(error.message); }
    }
    // Reject every occurrence, including an otherwise-invalid duplicate: never first/last wins.
    const occurrences = new Map();
    for (const row of rows) if (row.id) occurrences.set(row.id, (occurrences.get(row.id) || 0) + 1);
    const duplicateIds = new Set([...occurrences].filter(([, count]) => count > 1).map(([id]) => id));
    const identities = new Map();
    for (const row of rows) identities.set(row.identity, (identities.get(row.identity) || 0) + 1);
    const codes = new Map();
    for (const row of rows) for (const code of row.codes) codes.set(code, (codes.get(code) || 0) + 1);
    for (const row of rows) if (duplicateIds.has(row.id) || identities.get(row.identity) > 1 || row.codes.some(code => codes.get(code) > 1)) { row.status = 'invalid'; row.conflict = true; row.errors.push('Produto ou SKU/EAN repetido na planilha. Corrija todas as ocorrências.'); }
    return { mode, rows, counts: { total: rows.length, found: rows.filter(r => r.matched).length, notFound: rows.filter(r => r.status === 'not_found').length, invalid: rows.filter(r => r.status === 'invalid').length, errors: rows.filter(r => r.status === 'invalid' && !r.conflict).length, conflicts: rows.filter(r => r.conflict).length, creates: rows.filter(r => r.status === 'create').length, updates: rows.filter(r => r.status === 'update').length, unchanged: rows.filter(r => r.status === 'unchanged').length } };
  }
  return Object.freeze({ columns, blank, number, values, inScope, preview });
});
