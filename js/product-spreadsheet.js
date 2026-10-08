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
  function inScope(p, scope) {
    if (!p || p.deleted || p.deletedAt || p.ativo === false || p.active === false || p.businessId && p.businessId !== scope.businessId) return false;
    const mode = p.spaceAccessMode || 'all_spaces', ids = p.allowedSpaceIds || [];
    const allows = id => mode === 'all_spaces' || ids.includes(id);
    return scope.spaceId === 'all_spaces' ? scope.allSpaces || scope.allowedSpaceIds.some(allows) : scope.allowedSpaceIds.includes(scope.spaceId) && allows(scope.spaceId);
  }
  function preview(table, products, scope, permissions = {}) {
    if (!Array.isArray(table) || !table.length) throw Error('A planilha está vazia.');
    if (table.length > 10001) throw Error('Limite de 10.000 linhas por importação.');
    const headers = table[0].map(header), keys = columns.map(([label]) => headers.indexOf(header(label)));
    if (keys.some(i => i < 0) || new Set(headers).size !== headers.length || headers.length !== columns.length) throw Error('Use as 8 colunas do modelo exportado pela VECONI, sem colunas repetidas.');
    const catalog = products.filter(p => inScope(p, scope)), byId = new Map(catalog.map(p => [text(p.id), p]));
    const index = field => { const map = new Map(); for (const p of catalog) { const key = text(p[field]); if (key) map.set(key, [...map.get(key) || [], p]); } return map; };
    const sku = index('codigo'), ean = index('barcode');
    const rows = [];
    for (let i = 1; i < table.length; i++) {
      if (table[i].every(blank)) continue;
      const input = Object.fromEntries(columns.map(([, key], col) => [key, table[i][keys[col]]])), row = { line: i + 1, name: text(input.nome), status: 'invalid', changes: {}, before: {}, errors: [] };
      rows.push(row);
      row.identity = !blank(input.id) ? `id:${text(input.id)}` : JSON.stringify([text(input.codigo), text(input.barcode), text(input.nome)]);
      try {
        for (const key of ['id', 'codigo', 'barcode']) if (!blank(input[key]) && typeof input[key] !== 'string') throw Error('ID, SKU e EAN devem ser células de texto para preservar zeros à esquerda.');
        const id = text(input.id); let p;
        if (id) p = byId.get(id);
        else {
          const candidates = [!blank(input.codigo) ? sku.get(text(input.codigo)) || [] : null, !blank(input.barcode) ? ean.get(text(input.barcode)) || [] : null].filter(Boolean);
          if (!candidates.length) throw Error('Informe ID VECONI, SKU ou EAN. O nome não identifica o produto.');
          if (candidates.some(list => list.length > 1)) throw Error('Correspondência ambígua de SKU/EAN.');
          if (candidates.some(list => !list.length) && candidates.some(list => list.length)) throw Error('SKU e EAN não correspondem ao mesmo produto.');
          if (new Set(candidates.flat().map(p => p.id)).size > 1) throw Error('SKU e EAN correspondem a produtos diferentes.');
          p = candidates[0][0];
        }
        if (!p) { row.status = 'not_found'; row.errors.push('Produto não encontrado no contexto selecionado. Não será criado.'); continue; }
        row.id = p.id; row.name = p.nome; row.matched = true;
        const current = values(p, permissions.cost), variable = p.productType === 'variable' || p.hasVariations;
        for (const [, key] of columns) {
          if (blank(input[key]) || key === 'id') continue;
          if (input[key] && typeof input[key] === 'object') throw Error('Célula inválida ou fórmula. Use valores simples.');
          const value = ['custo', 'preco', 'estoqueAtual'].includes(key) ? number(input[key]) : text(input[key]);
          if (key === 'custo' && !permissions.cost) throw Error('Sem permissão para importar custos.');
          if (value === current[key]) continue;
          if (['codigo', 'barcode'].includes(key)) throw Error('SKU/EAN identificam o produto. Altere códigos pelo cadastro, não nesta V1.');
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
    for (const row of rows) if (duplicateIds.has(row.id) || identities.get(row.identity) > 1) { row.status = 'invalid'; row.errors.push('Produto repetido na planilha. Corrija todas as ocorrências.'); }
    return { rows, counts: { total: rows.length, found: rows.filter(r => r.matched).length, notFound: rows.filter(r => r.status === 'not_found').length, invalid: rows.filter(r => r.status === 'invalid').length, updates: rows.filter(r => r.status === 'update').length, unchanged: rows.filter(r => r.status === 'unchanged').length } };
  }
  return Object.freeze({ columns, blank, number, values, inScope, preview });
});
