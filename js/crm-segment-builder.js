(function (root) {
  "use strict";
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const esc = (value) => root.Utils.escapar(String(value ?? ""));
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const service = () => root.EngagementSegments;
  const data = () => root.DB.carregar();
  const norm = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const modal = () => document.querySelector("#modal");
  const close = () => { if (modal()) modal().innerHTML = ""; };
  const fieldOptions = (selected) => Object.entries(service().groups).map(([group, label]) => {
    const options = Object.entries(service().fields).filter(([key, meta]) => meta.group === group && !["balance", "balanceStatus", "product", "category"].includes(key)).map(([key, meta]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${esc(meta.label)}</option>`).join("");
    return options ? `<optgroup label="${esc(label)}">${options}</optgroup>` : "";
  }).join("");
  function entityOptions(type, selected) {
    const db = data();
    if (type.startsWith("product")) return (db.produtos || []).filter((item) => item.ativo !== false && !item.deletedAt).map((item) => `<option value="${esc(item.id)}" ${String(selected) === String(item.id) ? "selected" : ""}>${esc(item.nome || item.name || "Produto")}</option>`).join("");
    if (type.startsWith("category")) {
      const values = new Map();
      for (const product of db.produtos || []) { const id = String(product.categoryId || product.categoriaId || ""); const name = String(product.categoria || product.category || "Sem categoria"); values.set(id ? `id:${id}` : `name:${norm(name)}`, name); }
      return [...values].map(([id, name]) => `<option value="${esc(id)}" ${String(selected) === id ? "selected" : ""}>${esc(name)}</option>`).join("");
    }
    if (type.startsWith("campaign")) return (db.campanhas || []).filter((item) => !item.deletedAt).map((item) => `<option value="${esc(item.id)}" ${String(selected) === String(item.id) ? "selected" : ""}>${esc(item.name || item.nome || "Campanha")}</option>`).join("");
    return "";
  }
  const boolControl = (condition) => `<select data-segment-value aria-label="Valor"><option value="true" ${String(condition.value ?? true) === "true" ? "selected" : ""}>Sim</option><option value="false" ${String(condition.value) === "false" ? "selected" : ""}>Não</option></select>`;
  function valueControl(meta, condition) {
    if (meta.type === "boolean") return boolControl(condition);
    if (meta.type === "enum") return `<select data-segment-value aria-label="Valor">${(meta.options || []).map(([value, label]) => `<option value="${esc(value)}" ${String(condition.value) === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
    const entity = /^(product|category|campaign)/.test(meta.type);
    const needsNumber = /-(number|money|days)$/.test(meta.type);
    const subject = entity ? `<select data-segment-subject aria-label="${esc(meta.label)}"><option value="">Selecione</option>${entityOptions(meta.type, condition.subjectId || condition.value)}</select>` : "";
    if (entity && !needsNumber) return `${subject}<input type="hidden" data-segment-value value="${condition.field === "productNever" ? "true" : esc(condition.value ?? "")}">`;
    const inputmode = ["money", "number", "days"].some((type) => meta.type.includes(type)) ? "decimal" : "text";
    const input = `<input data-segment-value inputmode="${inputmode}" value="${esc(condition.value ?? "")}" placeholder="Valor" aria-label="Valor da condição">`;
    return `${subject}${input}`;
  }
  function periodControl(meta, condition) {
    if (!meta.period) return "";
    const key = condition.period?.key || condition.period || "all";
    return `<div class="crm-condition-period"><select data-segment-period aria-label="Período">${service().periods.map(([value, label]) => `<option value="${value}" ${key === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select><div data-custom-period ${key === "custom" ? "" : "hidden"}><input type="date" data-period-start value="${esc(condition.period?.start || "")}" aria-label="Início"><input type="date" data-period-end value="${esc(condition.period?.end || "")}" aria-label="Fim"></div></div>`;
  }
  function conditionRow(condition = {}, index = 0) {
    const safe = root.CRMSegmentEngineV2.normalizeCondition(condition), meta = service().fields[safe.field];
    return `<article class="crm-segment-condition" data-segment-condition data-condition-id="${esc(safe.id)}"><aside><b>${index + 1}</b><i data-lucide="grip-vertical"></i></aside><div class="crm-condition-fields"><select data-segment-field aria-label="Tipo de informação">${fieldOptions(safe.field)}</select><select data-segment-operator aria-label="Operador">${meta.operators.map((key) => `<option value="${key}" ${safe.operator === key ? "selected" : ""}>${esc(service().operators[key])}</option>`).join("")}</select>${valueControl(meta, safe)}<input data-segment-value-to inputmode="decimal" value="${esc(safe.valueTo)}" placeholder="Até" aria-label="Valor final" ${safe.operator === "between" ? "" : "hidden"}>${periodControl(meta, safe)}</div><button type="button" data-remove-condition aria-label="Remover condição">${icon("trash-2")}</button></article>`;
  }
  function read(rootElement) {
    return $$('[data-segment-condition]', rootElement).map((row) => {
      const period = $('[data-segment-period]', row);
      return root.CRMSegmentEngineV2.normalizeCondition({
        id: row.dataset.conditionId, field: $('[data-segment-field]', row).value, operator: $('[data-segment-operator]', row).value,
        subjectId: $('[data-segment-subject]', row)?.value || "", value: $('[data-segment-value]', row)?.value ?? true,
        valueTo: $('[data-segment-value-to]', row)?.value || "", period: period ? { key: period.value, start: $('[data-period-start]', row)?.value || "", end: $('[data-period-end]', row)?.value || "" } : null,
      });
    });
  }
  function bindRows(rootElement) {
    $$('[data-segment-field]', rootElement).forEach((select) => select.onchange = () => { const row = select.closest('[data-segment-condition]'), index = $$('[data-segment-condition]', rootElement).indexOf(row); row.outerHTML = conditionRow({ field: select.value }, index); bindRows(rootElement); root.lucide?.createIcons(); });
    $$('[data-segment-operator]', rootElement).forEach((select) => select.onchange = () => { $('[data-segment-value-to]', select.closest('[data-segment-condition]')).hidden = select.value !== "between"; });
    $$('[data-segment-period]', rootElement).forEach((select) => select.onchange = () => { $('[data-custom-period]', select.closest('[data-segment-condition]')).hidden = select.value !== "custom"; });
    $$('[data-remove-condition]', rootElement).forEach((button) => button.onclick = () => { if ($$('[data-segment-condition]', rootElement).length > 1) { button.closest('[data-segment-condition]').remove(); $$('[data-segment-condition] aside b', rootElement).forEach((item, index) => item.textContent = index + 1); } });
  }
  function open(options = {}) {
    const current = root.CRMDashboard.state, saved = options.segment || null, initial = saved?.conditions?.length ? saved.conditions : current.customConditions?.length ? current.customConditions : [{ field: "totalSpent", operator: "gt", value: "", period: { key: "90d" } }];
    const target = modal();
    target.innerHTML = `<div class="modal-bg crm-sheet-bg"><section class="modal-box crm-segment-builder" role="dialog" aria-modal="true" aria-labelledby="crm-builder-title"><header class="modal-head"><div><h3 id="crm-builder-title">Filtrar clientes que…</h3><p>Use somente os critérios necessários.</p></div><button type="button" class="icon-btn" data-builder-close aria-label="Fechar">${icon("x")}</button></header><div class="modal-body"><label class="crm-combination-field"><b>Combinação</b><select id="crm-builder-mode"><option value="all">Atendem a todas as condições</option><option value="any">Atendem a qualquer condição</option></select></label><div id="crm-builder-conditions">${initial.map(conditionRow).join("")}</div><button type="button" class="crm-add-condition" data-builder-add>${icon("plus")} Adicionar condição</button><label class="crm-segment-name"><b>Nome para salvar (opcional)</b><input id="crm-builder-name" value="${esc(saved?.name || "")}" placeholder="Ex.: Clientes bons que sumiram"></label><aside class="crm-preview-result" data-builder-preview>${icon("users-round")}<span><small>Prévia calculada com os dados sincronizados deste aparelho.</small><b>Toque em Atualizar prévia</b></span></aside></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-builder-refresh>Atualizar prévia</button><button type="button" class="btn btn-primary" data-builder-apply>Aplicar filtro</button></footer></section></div>`;
    const box = $('.crm-segment-builder', target); $('#crm-builder-mode', box).value = saved?.matchMode || current.customMatchMode || "all";
    bindRows(box);
    $('[data-builder-close]', box).onclick = close;
    $('[data-builder-add]', box).onclick = () => { $('#crm-builder-conditions', box).insertAdjacentHTML("beforeend", conditionRow({}, $$('[data-segment-condition]', box).length)); bindRows(box); root.lucide?.createIcons(); };
    $('[data-builder-refresh]', box).onclick = () => { const result = root.CRMDashboard.previewConditions(read(box), $('#crm-builder-mode', box).value); $('[data-builder-preview]', box).innerHTML = `${icon("users-round")}<span><small>Prévia com a projeção local sincronizada · 0 novas leituras</small><b>${result.count} cliente(s) encontrado(s)</b></span>`; root.lucide?.createIcons(); };
    $('[data-builder-apply]', box).onclick = () => { const conditions = read(box), matchMode = $('#crm-builder-mode', box).value, name = $('#crm-builder-name', box).value.trim(); const stored = name ? service().save({ id: saved?.id, name, conditions, matchMode, pinned: saved?.pinned }) : null; root.CRMDashboard.applyConditions(conditions, matchMode, stored?.name || saved?.name || "Filtro personalizado", stored?.id || null); close(); options.onApply?.(stored); };
    root.lucide?.createIcons();
  }
  function openSaved() {
    const saved = service().list();
    const target = modal();
    target.innerHTML = `<div class="modal-bg crm-sheet-bg"><section class="modal-box crm-segment-builder crm-saved-segments" role="dialog" aria-modal="true"><header class="modal-head"><div><h3>Meus segmentos</h3><p>Segmentos dinâmicos desta empresa.</p></div><button type="button" class="icon-btn" data-builder-close>${icon("x")}</button></header><div class="modal-body">${saved.map((segment) => `<article><button type="button" data-open-segment="${segment.id}"><span>${icon(segment.pinned ? "pin" : "filter")}<b>${esc(segment.name)}</b><small>${segment.conditions.length} condição(ões) · ${segment.matchMode === "any" ? "qualquer" : "todas"}</small></span></button><div><button type="button" data-pin-segment="${segment.id}" aria-label="${segment.pinned ? "Desafixar" : "Fixar"}">${icon(segment.pinned ? "pin-off" : "pin")}</button><button type="button" data-edit-segment="${segment.id}" aria-label="Editar">${icon("pencil")}</button><button type="button" data-rename-segment="${segment.id}" aria-label="Renomear">${icon("text-cursor-input")}</button><button type="button" data-copy-segment="${segment.id}" aria-label="Duplicar">${icon("copy")}</button><button type="button" data-delete-segment="${segment.id}" aria-label="Excluir">${icon("trash-2")}</button></div></article>`).join("") || `<div class="mobile-empty-state">${icon("bookmark")}<h3>Nenhum segmento salvo</h3><p>Crie um filtro e informe um nome para reutilizá-lo.</p></div>`}</div><footer class="modal-foot"><button type="button" class="btn btn-light" data-explore-segments>${icon("sparkles")} Explorar sugestões</button><button type="button" class="btn btn-primary" data-new-segment>${icon("plus")} Novo segmento</button></footer></section></div>`;
    const box = $('.crm-segment-builder', target), find = (id) => saved.find((segment) => segment.id === id);
    $('[data-builder-close]', box).onclick = close; $('[data-new-segment]', box).onclick = () => open(); $('[data-explore-segments]', box).onclick = openTemplates;
    $$('[data-open-segment]', box).forEach((button) => button.onclick = () => { root.CRMDashboard.applySavedSegment(find(button.dataset.openSegment)); close(); });
    $$('[data-edit-segment]', box).forEach((button) => button.onclick = () => open({ segment: find(button.dataset.editSegment) }));
    $$('[data-pin-segment]', box).forEach((button) => button.onclick = () => { service().togglePinned(button.dataset.pinSegment); openSaved(); });
    $$('[data-copy-segment]', box).forEach((button) => button.onclick = () => { service().duplicate(button.dataset.copySegment); openSaved(); });
    $$('[data-rename-segment]', box).forEach((button) => button.onclick = () => { const segment = find(button.dataset.renameSegment), name = prompt("Novo nome do segmento", segment.name); if (name?.trim()) { service().rename(segment.id, name); openSaved(); } });
    $$('[data-delete-segment]', box).forEach((button) => button.onclick = () => { if (confirm("Excluir este segmento salvo?")) { service().remove(button.dataset.deleteSegment); openSaved(); } });
    root.lucide?.createIcons();
  }
  function openTemplates() {
    const target = modal(), templates = service().templates || [];
    target.innerHTML = `<div class="modal-bg crm-sheet-bg"><section class="modal-box crm-segment-builder crm-segment-templates" role="dialog" aria-modal="true"><header class="modal-head"><div><h3>Explorar segmentos</h3><p>Escolha uma sugestão e adapte ao seu negócio.</p></div><button type="button" class="icon-btn" data-builder-close>${icon("x")}</button></header><div class="modal-body">${templates.map((template) => `<article><span>${icon("sparkles")}<b>${esc(template.name)}</b><small>${esc(template.description)}</small></span><button type="button" class="btn btn-light" data-use-template="${esc(template.id)}">Configurar</button></article>`).join("")}</div></section></div>`;
    const box = $('.crm-segment-builder', target);
    $('[data-builder-close]', box).onclick = close;
    $$('[data-use-template]', box).forEach((button) => button.onclick = () => { const template = templates.find((item) => item.id === button.dataset.useTemplate); open({ segment: template }); });
    root.lucide?.createIcons();
  }
  root.CRMSegmentBuilder = { open, openSaved, openTemplates, read, conditionRow };
})(window);
