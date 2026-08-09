(function () {
  "use strict";

  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const esc = (value) => Utils.escapar(String(value ?? ""));
  const actions = [
    { id: "profile", group: "main", label: "Ver perfil", icon: "user-round" },
    { id: "sale", group: "main", label: "Nova venda", icon: "shopping-bag" },
    { id: "contact", group: "main", label: "Registrar contato", description: "Registrar ligação, visita ou mensagem", icon: "phone-call" },
    { id: "receive", group: "financial", label: "Receber pagamento", icon: "circle-dollar-sign", requiresDebt: true },
    { id: "adjust", group: "financial", label: "Ajustar saldo", description: "Adicionar ou remover valores", icon: "scale" },
    { id: "charge", group: "financial", label: "Registrar cobrança", icon: "send", requiresPhone: true },
    { id: "promise", group: "financial", label: "Promessa de pagamento", icon: "calendar-check" },
    { id: "history", group: "registration", label: "Histórico", description: "Compras, pagamentos e contatos", icon: "history" },
    { id: "edit", group: "registration", label: "Editar cliente", description: "Dados e informações do cliente", icon: "pencil" },
    { id: "delete", group: "danger", label: "Excluir cliente", description: "Remover cliente do sistema", icon: "trash-2", danger: true },
  ];
  const groupLabels = { main: "Principais", financial: "Financeiro", registration: "Cadastro", danger: "Perigo" };
  const digits = (value) => String(value || "").replace(/\D/g, "");

  function disabled(action, client) {
    return Boolean(
      (action.requiresDebt && Number(client?.saldo || 0) >= 0) ||
        (action.requiresPhone && digits(client?.telefone).length < 10),
    );
  }

  function flatMenu(client) {
    return actions
      .filter((action) => action.id !== "profile")
      .map(
        (action) =>
          `<button ${action.danger ? 'class="danger"' : ""} type="button" data-client-action="${action.id}" data-client-action-id="${esc(client.id)}" ${disabled(action, client) ? "disabled" : ""}>${icon(action.icon)} ${action.label}</button>`,
      )
      .join("");
  }

  function sheet(client) {
    const financialPrimary = window.OperationMode?.enabled?.("creditSales") !== false;
    return `<div class="client-action-overlay" data-client-action-close></div>
      <section class="client-action-sheet" role="dialog" aria-modal="true" aria-labelledby="client-action-title">
        <span class="client-action-handle" aria-hidden="true"></span>
        <header>
          <div><h2 id="client-action-title">Ações de ${esc(client.nome)}</h2>${client.telefone ? `<p>${esc(client.telefone)} ${icon("message-circle")}</p>` : '<p>Sem telefone cadastrado</p>'}</div>
          <button class="icon-btn" type="button" data-client-action-close aria-label="Fechar ações">${icon("x")}</button>
        </header>
        <div class="client-action-scroll ${financialPrimary ? "credit-mode" : "simple-mode"}">
          ${Object.keys(groupLabels)
            .map((group) => {
              const items = actions.filter((action) => action.group === group);
              return `<section class="client-action-group group-${group}"><h3>${groupLabels[group]}</h3>${items
                .map(
                  (action) =>
                    `<button type="button" ${action.danger ? 'class="danger"' : ""} data-client-action="${action.id}" data-client-action-id="${esc(client.id)}" ${disabled(action, client) ? "disabled" : ""}>${icon(action.icon)}<span><b>${action.label}</b>${action.description ? `<small>${action.description}</small>` : ""}</span></button>`,
                )
                .join("")}</section>`;
            })
            .join("")}
        </div>
      </section>`;
  }

  function close() {
    const root = document.querySelector("#modal");
    if (root?.querySelector(".client-action-sheet")) root.innerHTML = "";
  }

  async function run(action, clientId) {
    const page = window.ClientesPage;
    const client = Clientes.obter(clientId);
    if (!client) return Utils.toast("Cliente não encontrado.", true);
    close();
    if (action === "profile" || action === "history") return (window.CRMClienteUI?.open || page?.profile)?.(clientId);
    if (action === "sale") return window.Checkout?.prepareClientSale?.(clientId, "client_actions");
    if (action === "contact") return window.CRMClienteUI?.contactForm?.(clientId);
    if (action === "receive") return page?.receive?.(clientId);
    if (action === "adjust") return page?.adjust?.(clientId);
    if (action === "charge") {
      if (digits(client.telefone).length < 10) return Utils.toast("Cadastre um telefone válido para enviar a cobrança.", true);
      if (typeof window.MobileMessages?.openComposer === "function")
        return window.MobileMessages.openComposer(clientId, { type: "charge", source: "individual" });
      return page?.whatsapp?.(clientId);
    }
    if (action === "promise") return page?.promise?.(clientId);
    if (action === "edit") return page?.clientForm?.(clientId);
    if (action === "delete")
      return Modais.confirmar("cliente", () => {
        Clientes.excluir(clientId);
        page?.refresh?.();
      });
  }

  function openSheet(clientId) {
    const client = Clientes.obter(clientId);
    if (!client) return Utils.toast("Cliente não encontrado.", true);
    const root = document.querySelector("#modal");
    root.innerHTML = sheet(client);
    root.querySelectorAll("[data-client-action-close]").forEach((button) => (button.onclick = close));
    root.querySelectorAll("[data-client-action]").forEach((button) => {
      button.onclick = () => run(button.dataset.clientAction, button.dataset.clientActionId);
    });
    window.lucide?.createIcons();
    requestAnimationFrame(() => root.querySelector(".client-action-sheet")?.classList.add("open"));
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-client-action]");
    if (!trigger || trigger.closest(".client-action-sheet")) return;
    event.preventDefault();
    run(trigger.dataset.clientAction, trigger.dataset.clientActionId);
  });

  function enhanceDesktopMenus() {
    if (matchMedia("(max-width: 767px)").matches) return;
    let enhanced = false;
    document.querySelectorAll(".client-more-menu:not([data-shared-actions])").forEach((menu) => {
      const clientId = menu.dataset.menuFor;
      const client = clientId && Clientes.obter(clientId);
      if (!client) return;
      menu.dataset.sharedActions = "true";
      menu.innerHTML = flatMenu(client);
      enhanced = true;
    });
    // Lucide substitui elementos no DOM. ChamÃ¡-lo sem haver menus novos fazia
    // este MutationObserver observar a troca dos Ã­cones e iniciar outro ciclo.
    if (enhanced) window.lucide?.createIcons();
  }
  const app = document.querySelector("#app");
  let enhanceQueued = false;
  const scheduleDesktopEnhancement = () => {
    if (enhanceQueued) return;
    enhanceQueued = true;
    queueMicrotask(() => {
      enhanceQueued = false;
      enhanceDesktopMenus();
    });
  };
  if (app)
    new MutationObserver(scheduleDesktopEnhancement).observe(app, {
      childList: true,
      subtree: true,
    });
  scheduleDesktopEnhancement();

  window.ClientActions = { actions, flatMenu, openSheet, close, run };
})();
