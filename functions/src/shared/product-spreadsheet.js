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
  // Optional column (sheets with the 8 original columns keep working). "Entrada" ADDS
  // received goods; "Estoque atual" is an ADJUSTMENT to an absolute quantity.
  const optional = [['Entrada de mercadorias', 'entrada']];
  const exportColumns = [...columns, ...optional];
  const blank = v => v === undefined || v === null || typeof v === 'string' && !v.trim();
  const text = v => String(v ?? '').trim();
  // Canonical identifier, the SAME rule as the barcode reader (js/barcode.js): NFKC,
  // no invisible/format/control characters; EAN also without any whitespace. Only used
  // to COMPARE; stored codes are never rewritten. Leading zeros are kept.
  const INVISIBLE = /[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/gu;
  const canonical = (kind, v) => { const c = String(v ?? '').normalize('NFKC').replace(INVISIBLE, ''); return kind === 'barcode' ? c.replace(/\s+/g, '') : c.replace(/\s+/g, ' ').trim(); };
  const assertCleanCode = (kind, v) => { if (text(v).length > 100 || canonical(kind, v) !== text(v)) throw Error(kind === 'barcode' ? 'EAN inválido: use até 100 caracteres, sem espaços nem caracteres invisíveis. Digite o código novamente.' : 'SKU inválido: use até 100 caracteres, sem caracteres invisíveis nem espaços repetidos. Digite o código novamente.'); };
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
  function preview(table, products, scope, permissions = {}, mode = 'update', options = {}) {
    // Stock exported with the sheet (Contexto tab). Unchanged cells never overwrite sales made after the export.
    const baseline = options.baseline && typeof options.baseline === 'object' ? options.baseline : null;
    if (!['update', 'create_update'].includes(mode)) throw Error('Modo de importação inválido.');
    if (!Array.isArray(table) || !table.length) throw Error('A planilha está vazia.');
    if (table.length > 10001) throw Error('Limite de 10.000 linhas por importação.');
    const aliases = {nome:'nome do produto', 'estoque inicial':'estoque atual'};
    const headers = table[0].map(value => aliases[header(value)] || header(value));
    const present = [...columns, ...optional.filter(([label]) => headers.includes(header(label)))], keys = present.map(([label]) => headers.indexOf(header(label)));
    if (keys.some(i => i < 0) || new Set(headers).size !== headers.length || headers.filter(h => h).length !== present.length) throw Error('Use as colunas do modelo exportado pela VECONI (8 obrigatórias e "Entrada de mercadorias" opcional), sem colunas repetidas.');
    const catalog = products.filter(p => inScope(p, scope, true)), byId = new Map(catalog.map(p => [text(p.id), p]));
    const index = field => { const map = new Map(); for (const p of catalog) { const key = canonical(field, p[field]); if (key) map.set(key, [...map.get(key) || [], p]); } return map; };
    const sku = index('codigo'), ean = index('barcode');
    const rows = [];
    for (let i = 1; i < table.length; i++) {
      if (table[i].every(blank)) continue;
      const input = Object.fromEntries(present.map(([, key], col) => [key, table[i][keys[col]]])), row = { line: i + 1, name: text(input.nome), status: 'invalid', changes: {}, before: {}, errors: [] };
      rows.push(row);
      row.codes = ['codigo', 'barcode'].filter(key => !blank(input[key])).map(key => `${key}:${canonical(key, input[key])}`);
      row.identity = !blank(input.id) ? `id:${text(input.id)}` : JSON.stringify([text(input.codigo), text(input.barcode), text(input.nome)]);
      try {
        for (const key of ['id', 'codigo', 'barcode']) if (!blank(input[key]) && typeof input[key] !== 'string') throw Error('ID, SKU e EAN devem ser células de texto para preservar zeros à esquerda.');
        for (const key of ['codigo', 'barcode']) if (!blank(input[key]) && (text(input[key]).length > 100 || canonical(key, input[key]) !== text(input[key]) && !catalog.some(p => text(p[key]) === text(input[key])))) throw Error('SKU/EAN inválido: use até 100 caracteres, sem caracteres de controle.');
        if (!blank(input.barcode) && /\s/.test(input.barcode)) throw Error('Código de barras não pode conter espaços.');
        const conflict = message => { row.conflict = true; throw Error(message); };
        const id = text(input.id); let p;
        if (id) {
          if (!/^[^/]{1,200}$/.test(id)) throw Error('ID VECONI inválido.');
          p = byId.get(id);
          if (!p && mode === 'create_update') conflict('ID VECONI desconhecido ou fora do espaço. Não será criado outro produto.');
        }
        else {
          const candidates = [!blank(input.codigo) ? sku.get(canonical('codigo', input.codigo)) || [] : null, !blank(input.barcode) ? ean.get(canonical('barcode', input.barcode)) || [] : null].filter(Boolean);
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
          if (blank(input.estoqueAtual) && !blank(input.entrada)) input.estoqueAtual = input.entrada;
          else if (!blank(input.entrada) && number(input.entrada) !== 0) throw Error('Produto novo: informe a quantidade em "Estoque atual" ou em "Entrada", não nas duas.');
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
        for (const [, key] of present) {
          if (blank(input[key]) || key === 'id') continue;
          if (key === 'entrada') {
            const quantity = number(input.entrada);
            if (quantity === 0) continue;
            if (!(quantity > 0)) throw Error('Entrada de mercadorias deve ser uma quantidade positiva.');
            if (variable) throw Error('Dê entrada nas variações, não no total do produto.');
            if (current.estoqueAtual === null || !permissions.stock) throw Error('Estoque sem controle ou sem permissão para entrada.');
            if (scope.spaceId === 'all_spaces') throw Error('Selecione um espaço específico para dar entrada em mercadorias.');
            if (typeof options.entryApplied === 'function' && options.entryApplied(p.id)) { row.notes = [...(row.notes || []), 'Entrada desta planilha já registrada; não será somada de novo.']; continue; }
            row.changes.entrada = quantity; row.before.estoqueAtual = current.estoqueAtual; continue;
          }
          if (input[key] && typeof input[key] === 'object') throw Error('Célula inválida ou fórmula. Use valores simples.');
          const value = ['custo', 'preco', 'estoqueAtual'].includes(key) ? number(input[key]) : text(input[key]);
          if (key === 'custo' && !permissions.cost) throw Error('Sem permissão para importar custos.');
          if (value === current[key]) continue;
          if (['codigo', 'barcode'].includes(key)) conflict('SKU/EAN identificam o produto. Para corrigir códigos em massa, use o modo "Corrigir SKU/EAN de produtos existentes" (com o ID VECONI) ou altere pelo cadastro.');
          if (variable && ['custo', 'preco', 'estoqueAtual'].includes(key)) throw Error('Altere custo, preço e estoque nas variações, não no total do produto.');
          if (key === 'estoqueAtual' && (current.estoqueAtual === null || !permissions.stock)) throw Error('Estoque sem controle ou sem permissão de ajuste.');
          if (key === 'estoqueAtual' && baseline && Object.hasOwn(baseline, p.id)) {
            const exported = number(baseline[p.id]);
            if (value === exported) continue; // not edited: sales/entries since the export are preserved
            if (current.estoqueAtual !== exported) conflict('O estoque mudou desde a exportação (vendas ou entradas). Use "Entrada de mercadorias" ou exporte de novo para ajustar.');
          }
          if (key === 'estoqueAtual' && scope.spaceId === 'all_spaces') throw Error('Selecione um espaço específico para ajustar estoque.');
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
    for (const row of rows) if (row.status === 'update') row.kinds = [
      ...(Object.keys(row.changes).some(k => ['nome', 'categoria', 'custo', 'preco'].includes(k)) ? ['cadastro'] : []),
      ...(Object.hasOwn(row.changes, 'entrada') ? ['entrada'] : []),
      ...(Object.hasOwn(row.changes, 'estoqueAtual') ? ['ajuste'] : [])];
    if (rows.some(row => Object.hasOwn(row.changes, 'entrada') && Object.hasOwn(row.changes, 'estoqueAtual')))
      for (const row of rows) if (Object.hasOwn(row.changes, 'entrada') && Object.hasOwn(row.changes, 'estoqueAtual')) { row.status = 'invalid'; row.errors.push('Use "Entrada" ou altere "Estoque atual", não os dois na mesma linha.'); }
    return { mode, rows, counts: { total: rows.length, entries: rows.filter(r => r.status === 'update' && r.kinds?.includes('entrada')).length, adjustments: rows.filter(r => r.status === 'update' && r.kinds?.includes('ajuste')).length, found: rows.filter(r => r.matched).length, notFound: rows.filter(r => r.status === 'not_found').length, invalid: rows.filter(r => r.status === 'invalid').length, errors: rows.filter(r => r.status === 'invalid' && !r.conflict).length, conflicts: rows.filter(r => r.conflict).length, creates: rows.filter(r => r.status === 'create').length, updates: rows.filter(r => r.status === 'update').length, unchanged: rows.filter(r => r.status === 'unchanged').length } };
  }
  // Explicit "Corrigir SKU/EAN" mode. Identity is ONLY the ID VECONI (never changes).
  // Codes are compared against the WHOLE company (other spaces, inactive products,
  // variations and alternate barcodes): a code must never point to two records.
  // Only SKU/EAN are read; price, cost, stock and name columns are ignored here.
  const identifierKeys = ['codigo', 'barcode'];
  const identifierLabels = { codigo: 'SKU', barcode: 'EAN' };
  function identifierOwners(kind, value, selfId, catalog, visible = () => true) {
    const owners = [], target = canonical(kind, value), same = code => !!target && canonical(kind, code) === target;
    const label = p => visible(p) ? `“${text(p.nome) || 'Sem nome'}” (ID ${text(p.id)})` : 'um produto de outro espaço';
    for (const p of catalog.products || []) {
      if (!p || p.deleted || p.deletedAt || text(p.id) === selfId) continue;
      const inactive = p.ativo === false || p.active === false ? ' (inativo)' : '';
      if (same(kind === 'codigo' ? p.codigo : p.barcode)) owners.push(label(p) + (visible(p) ? inactive : ''));
      if (kind === 'barcode' && (Array.isArray(p.alternateBarcodes) ? p.alternateBarcodes : []).some(same)) owners.push(`código alternativo de ${label(p)}`);
    }
    const parents = new Map((catalog.products || []).map(p => [text(p?.id), p]));
    for (const v of catalog.variants || []) {
      if (!v || v.deleted || v.deletedAt) continue;
      const own = text(v.parentProductId) === selfId ? ' deste produto' : '', parent = parents.get(text(v.parentProductId));
      if (same(kind === 'codigo' ? v.sku || v.codigo : v.barcode)) owners.push(parent && visible(parent) ? `variação${own} ${text(v.displayName) || text(v.id)}` : 'uma variação de produto de outro espaço');
    }
    return owners;
  }
  function previewIdentifiers(table, catalog, scope, { visible = p => inScope(p, scope, true) } = {}) {
    if (!Array.isArray(table) || !table.length) throw Error('A planilha está vazia.');
    if (table.length > 10001) throw Error('Limite de 10.000 linhas por importação.');
    const headers = table[0].map(header), need = columns.slice(0, 3);
    const keys = need.map(([label]) => headers.indexOf(header(label)));
    if (keys.some(i => i < 0) || need.some(([label]) => headers.filter(h => h === header(label)).length > 1)) throw Error('Para corrigir códigos, use a planilha exportada pela VECONI com as colunas "ID VECONI", "SKU/código interno" e "Código de barras/EAN".');
    const nameCol = headers.indexOf(header('Nome do produto'));
    const byId = new Map((catalog.products || []).filter(p => p && !p.deleted && !p.deletedAt).map(p => [text(p.id), p]));
    const rows = [];
    for (let i = 1; i < table.length; i++) {
      const cells = table[i] || [];
      if (cells.every(blank)) continue;
      const input = { id: cells[keys[0]], codigo: cells[keys[1]], barcode: cells[keys[2]] };
      const row = { line: i + 1, name: nameCol >= 0 ? text(cells[nameCol]) : '', status: 'invalid', before: {}, next: {}, changed: [], errors: [], notes: [] };
      rows.push(row);
      const conflict = message => { row.conflict = true; throw Error(message); };
      try {
        for (const key of ['id', 'codigo', 'barcode']) if (!blank(input[key]) && typeof input[key] !== 'string') throw Error('ID, SKU e EAN devem ser células de texto para preservar zeros à esquerda.');
        const id = text(input.id);
        if (!id) throw Error('Informe o ID VECONI. Sem o ID a linha não é corrigida e nenhum produto é criado.');
        if (!/^[^/]{1,200}$/.test(id)) throw Error('ID VECONI inválido.');
        const p = byId.get(id);
        if (!p || p.businessId && p.businessId !== scope.businessId || !inScope(p, scope, true)) throw Error('ID VECONI não encontrado nesta empresa/espaço. Nenhum produto será criado.');
        row.id = id; row.name = text(p.nome) || row.name; row.matched = true;
        row.before = { codigo: text(p.codigo), barcode: text(p.barcode) };
        if (p.ativo === false || p.active === false) conflict('Produto inativo. Reative no cadastro antes de corrigir os códigos.');
        for (const key of identifierKeys) {
          if (blank(input[key])) { row.next[key] = row.before[key]; continue; } // blank keeps the current code
          const value = text(input[key]);
          if (value !== row.before[key]) assertCleanCode(key, input[key]); // existing codes are never rewritten automatically
          row.next[key] = value;
        }
        row.changed = identifierKeys.filter(key => row.next[key] !== row.before[key]);
        for (const key of identifierKeys) {
          const value = row.next[key];
          if (!value) continue;
          const owners = identifierOwners(key, value, id, catalog, visible);
          if (!owners.length) continue;
          if (row.changed.includes(key)) conflict(`Novo ${identifierLabels[key]} ${value} já é usado por ${owners.join(', ')}. Corrija o outro cadastro primeiro (uma troca entre produtos exige duas importações).`);
          row.notes.push(`Atenção: o ${identifierLabels[key]} atual também está em ${owners.join(', ')}. Corrija o outro produto pelo ID dele.`);
        }
        row.status = row.changed.length ? 'update' : 'unchanged';
      } catch (error) { row.errors.push(error.message); }
    }
    const count = (list, keyOf) => { const map = new Map(); for (const row of list) { const key = keyOf(row); if (key) map.set(key, (map.get(key) || 0) + 1); } return map; };
    const ids = count(rows, row => row.id);
    for (const row of rows) if (row.id && ids.get(row.id) > 1) { row.status = 'invalid'; row.conflict = true; row.errors.push('O mesmo ID VECONI aparece em mais de uma linha. Deixe uma única linha por produto.'); }
    for (const key of identifierKeys) {
      const finals = count(rows.filter(row => row.id && ids.get(row.id) === 1), row => canonical(key, row.next[key]));
      for (const row of rows) if (row.status === 'update' && row.changed.includes(key) && finals.get(canonical(key, row.next[key])) > 1) { row.status = 'invalid'; row.conflict = true; row.errors.push(`O novo ${identifierLabels[key]} ${row.next[key]} foi informado para mais de um produto nesta planilha.`); }
    }
    return { mode: 'identifiers', rows, counts: { total: rows.length, found: rows.filter(r => r.matched).length, updates: rows.filter(r => r.status === 'update').length, unchanged: rows.filter(r => r.status === 'unchanged').length, conflicts: rows.filter(r => r.conflict).length, errors: rows.filter(r => r.status === 'invalid' && !r.conflict).length, invalid: rows.filter(r => r.status === 'invalid').length, notFound: 0, creates: 0 } };
  }
  return Object.freeze({ columns, exportColumns, optional, blank, number, values, inScope, preview, previewIdentifiers, identifierOwners, canonical, assertCleanCode });
});
