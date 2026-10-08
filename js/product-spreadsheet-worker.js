/* XLSX is lazy and local. Parsing is isolated so a corrupt file cannot freeze the UI. */
importScripts('../assets/xlsx-0.20.3.full.min.js');
self.onmessage = event => {
  try {
    const { action, table, context, bytes } = event.data;
    if (action === 'export') {
      const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(table);
      sheet['!cols'] = [38, 24, 24, 42, 24, 16, 18, 18].map(wch => ({ wch }));
      sheet['!autofilter'] = { ref: sheet['!ref'] };
      for (let r = 1; r < table.length; r++) for (let c = 0; c < 8; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.z = c < 5 ? '@' : c === 7 ? '0.##' : '"R$" #,##0.00';
      }
      XLSX.utils.book_append_sheet(book, sheet, 'Produtos');
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['VECONI_PRODUCTS_V1', context.businessId, context.spaceId]]), 'Contexto');
      const result = XLSX.write(book, { bookType: 'xlsx', type: 'array', compression: true });
      self.postMessage({ bytes: result }, [result]);
    } else {
      const signature = new Uint8Array(bytes);
      if (signature[0] !== 80 || signature[1] !== 75) throw Error('O arquivo não é um .xlsx válido.');
      const book = XLSX.read(bytes, { type: 'array', cellFormula: true, cellHTML: false, sheetRows: 10002 });
      const sheet = book.Sheets.Produtos || (book.SheetNames.length === 1 ? book.Sheets[book.SheetNames[0]] : null);
      if (!sheet || !sheet['!ref']) throw Error('A aba Produtos está ausente ou vazia.');
      const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
      if (range.e.r > 10000 || range.e.c > 7) throw Error('Use até 10.000 linhas e as 8 colunas do modelo VECONI.');
      const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
      for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith('!') && (cell.f || cell.t === 'e' || cell.t === 'b')) {
        const { r, c } = XLSX.utils.decode_cell(address); (table[r] ||= [])[c] = { invalid: true };
      }
      const metadata = book.Sheets.Contexto ? XLSX.utils.sheet_to_json(book.Sheets.Contexto, { header: 1, raw: true })[0] : null;
      self.postMessage({ table, context: metadata });
    }
  } catch (error) { self.postMessage({ error: error.message || 'Não foi possível ler esta planilha.' }); }
};
