window.ConsignmentPdf = (() => {
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(cents / 100).replace(/\u00a0/g, ' ');
  const displayDate = value => value.split('-').reverse().join('/');
  let loading;

  function library() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    return loading ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './assets/jspdf-4.2.1.umd.min.js';
      script.onload = () => resolve(window.jspdf.jsPDF);
      script.onerror = () => {
        script.remove();
        loading = null;
        reject(Error('Não foi possível carregar o gerador de PDF.'));
      };
      document.head.append(script);
    });
  }

  async function image(source) {
    if (!source) return null;
    if (!/^(https:\/\/|blob:|data:image\/(?:png|jpeg|webp);base64,)/i.test(source)) return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = source;
    try {
      await img.decode();
      const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const factor = Math.min(28 / canvas.width, 18 / canvas.height);
      return { jpeg: canvas.toDataURL('image/jpeg', 0.88), w: canvas.width * factor, h: canvas.height * factor };
    } catch { return null; }
  }

  async function generate(delivery, logoFile, mode = 'delivery', companyName) {
    const stock = mode === 'stock', conference = mode === 'conference';
    const rows = stock ? delivery.stockAfter : conference ? delivery.items.filter(row => row.quantity > 0) : delivery.items;
    if (!Array.isArray(rows)) throw Error('O comprovante não contém o estoque completo desta data.');
    const title = stock ? 'Estoque consignado atualizado' : conference ? 'Conferência e vendas' :
      delivery.kind === 'replenishment' ? 'Reposição de consignados' : 'Entrega de consignados';
    const override = logoFile ? URL.createObjectURL(logoFile) : null;
    const source = override || delivery.company.logoUrl;
    let Pdf, logo;
    try { [Pdf, logo] = await Promise.all([library(), image(source)]); }
    finally { if (override) URL.revokeObjectURL(override); }
    const pdf = new Pdf({ unit: 'mm', format: 'a4', compress: true });
    const { company, outlet } = delivery;
    let y;
    const spacing = (content, x, width, fontSize, { bold = false } = {}) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.setFontSize(fontSize);
      const lines = pdf.splitTextToSize(content, width);
      pdf.text(lines, x, y);
      y += lines.length * (fontSize * 0.43) + 1;
    };
    function header() {
      y = 19;
      pdf.setTextColor('#083e43');
      if (logo) pdf.addImage(logo.jpeg, 'JPEG', 194 - logo.w, 13, logo.w, logo.h);
      spacing((conference ? company.name : companyName || company.name) || 'VECONI', 16, logo ? 143 : 178, 18, { bold: true });
      pdf.setTextColor('#334155');
      if (conference) {
        const companyInfo = [company.document, company.phone, company.address].filter(Boolean).join(' • ');
        if (companyInfo) spacing(companyInfo, 16, logo ? 143 : 178, 9);
      }
      y = Math.max(y + 4, logo ? 39 : 32);
      pdf.setTextColor('#083e43');
      spacing(title, 16, 178, 17, { bold: true });
      pdf.setTextColor('#334155');
      const period = conference ? displayDate(delivery.periodFrom) + ' a ' + displayDate(delivery.deliveredOn) : displayDate(delivery.deliveredOn);
      spacing(outlet.name, 16, 178, 11, { bold: true });
      spacing(period, 16, 178, 10);
      if (conference) {
        const outletInfo = [outlet.contact, outlet.phone, outlet.address].filter(Boolean).join(' • ');
        if (outletInfo) spacing(outletInfo, 16, 178, 9);
        spacing('Referência ' + delivery.id, 16, 178, 8);
      }
      y += 4;
      pdf.setFillColor('#eaf6f4');
      pdf.roundedRect(16, y - 4, 178, 8, 1, 1, 'F');
      pdf.setTextColor('#083e43').setFontSize(9).setFont('helvetica', 'bold');
      pdf.text('Produto / variação', 20, y + 1);
      for (const [name, right] of [['Qtd.', 128], ['Preço unit.', 161], ['Total', 190]])
        pdf.text(name, right, y + 1, { align: 'right' });
      y += 11;
      pdf.setTextColor('#1e293b');
    }
    header();
    for (const item of rows) {
      const name = [item.name, item.variantName, conference && item.sku].filter(Boolean).join(' • ');
      pdf.setFont('helvetica', 'normal').setFontSize(9);
      const lines = pdf.splitTextToSize(name, 101);
      const height = Math.max(8, lines.length * 4 + 4);
      if (y + height > 269) { pdf.addPage(); header(); }
      pdf.setDrawColor('#dce7e8').setLineWidth(0.2).line(16, y + height - 4, 194, y + height - 4);
      pdf.setFont('helvetica', 'normal').setFontSize(9);
      pdf.text(lines, 20, y);
      pdf.text(String(item.quantity), 128, y, { align: 'right' });
      pdf.text(money(item.unitCents), 161, y, { align: 'right' });
      pdf.text(money(item.totalCents), 190, y, { align: 'right' });
      y += height;
    }
    if (y > (conference ? 226 : 241)) {
      pdf.addPage();
      y = 22;
    }
    y += 6;
    if (!rows.length) spacing(conference ? 'Nenhum item vendido no período.' : 'Nenhum produto permaneceu neste ponto.', 16, 178, 10);
    if (conference) {
      spacing('Vendas brutas  ' + money(delivery.grossCents) + '  •  ' + delivery.units + ' un.', 16, 178, 12, { bold: true });
      spacing('Comissão (' + (delivery.commissionBps / 100).toLocaleString('pt-BR') + '%)  ' + money(delivery.commissionCents), 16, 178, 10);
      spacing('Total a receber  ' + money(delivery.netCents), 16, 178, 13, { bold: true });
      spacing(delivery.paymentAtRecording === 'paid' ? 'Recebimento confirmado no registro.' : 'Situação no registro: ' +
        (delivery.paymentAtRecording === 'pending' ? 'a receber.' : 'sem saldo a receber.'), 16, 178, 9);
    } else {
      const total = rows.reduce((sum, row) => sum + row.totalCents, 0), units = rows.reduce((sum, row) => sum + row.quantity, 0);
      pdf.setFillColor('#eaf6f4').roundedRect(16, y - 5, 178, 17, 2, 2, 'F');
      pdf.setTextColor('#334155').setFont('helvetica', 'normal').setFontSize(9);
      pdf.text('Total de peças', 21, y);
      pdf.text('Valor total consignado', 189, y, { align: 'right' });
      pdf.setTextColor('#083e43').setFont('helvetica', 'bold').setFontSize(13);
      pdf.text(String(units), 21, y + 7);
      pdf.text(money(total), 189, y + 7, { align: 'right' });
      y += 20;
      const notes = !stock ? delivery.notes?.trim() : '';
      if (notes) {
        pdf.setTextColor('#334155').setFont('helvetica', 'normal').setFontSize(9);
        for (const line of pdf.splitTextToSize('Observação: ' + notes, 178)) {
          if (y > 266) { pdf.addPage(); y = 22; }
          pdf.text(line, 16, y);
          y += 4;
        }
        y += 3;
      }
    }
    if (y > 274) { pdf.addPage(); y = 22; }
    pdf.setTextColor('#475569');
    spacing(conference ? 'Comprovante de conferência. Não substitui documento fiscal.' :
      'Comprovante de estoque consignado. Não é venda nem documento fiscal.', 16, 178, 9);
    for (let i = 1; i <= pdf.getNumberOfPages(); i++) {
      pdf.setPage(i).setFontSize(8).setTextColor('#475569');
      pdf.text(i + ' / ' + pdf.getNumberOfPages(), 194, 285, { align: 'right' });
    }
    const file = new File([pdf.output('blob')], 'consignado-' + mode + '-' + delivery.deliveredOn + '-' + delivery.id.slice(0, 8) + '.pdf', { type: 'application/pdf' });
    return { file, logoUnavailable: Boolean(source && !logo) };
  }

  function download(file) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  }

  return { generate, download, money, displayDate };
})();
