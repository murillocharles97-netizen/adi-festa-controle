(() => {
  "use strict";

  const mq = matchMedia("(min-width:768px)"),
    icon = (name) => `<i data-lucide="${name}"></i>`,
    esc = (value) => Utils.escapar(value ?? ""),
    planNames = {
      internal: "Plano interno",
      trial: "Teste grátis",
      essential: "Essencial",
      professional: "Profissional",
      premium: "Premium",
    },
    roleNames = {
      owner: "Proprietário",
      admin: "Administrador",
      manager: "Gerente",
      cashier: "Operador",
      viewer: "Consulta",
      platform_admin: "Administrador da plataforma",
    };

  const formatTime = (value) =>
    value ? new Date(value).toLocaleString("pt-BR") : "Ainda não sincronizado";

  function card(iconName, title, subtitle, body, className = "") {
    return `<article class="desktop-settings-card ${className}"><header><span>${icon(iconName)}</span><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div></header>${body}</article>`;
  }

  function render() {
    const session = window.FirebaseSession || {},
      business = session.business || {},
      profile = session.profile || {},
      subscription = session.subscription || business.subscription || {},
      sync = window.SyncFirebaseState || {},
      data = DB.carregar(),
      config = data.config || {},
      operation = window.OperationMode?.get?.() || {},
      mode = window.OperationMode?.MODES?.[operation.operationMode] || {},
      credit = window.OperationMode?.CREDIT_MODES?.[operation.creditMode] || {},
      businessName = business.name || config.nome || "Meu negócio",
      plan =
        planNames[subscription.planId] || subscription.planId || "Plano atual";

    return `<section class="desktop-settings settings" data-desktop-settings>
      <div class="desktop-settings-grid">
        ${card("building-2", "Empresa", "Informações da sua empresa e dados cadastrais.", `<dl><dt>Nome fantasia</dt><dd>${esc(businessName)}</dd><dt>Documento</dt><dd>${esc(business.document || business.cnpj || config.documento || "Não informado")}</dd><dt>Segmento</dt><dd>${esc(business.businessType || config.segmento || "Não informado")}</dd><dt>Telefone</dt><dd>${esc(business.phone || config.telefone || "Não informado")}</dd></dl><button class="btn btn-light" type="button" data-desktop-edit-business>Editar empresa</button>`)}
        ${card("gem", "Plano e assinatura", "Gerencie seu plano e veja o que está incluso.", `<div class="desktop-settings-highlight"><span>${icon("gem")}</span><div><b>${esc(plan)}</b><small>${subscription.status === "active" ? "Conta ativa" : esc(subscription.status || "Status não informado")}</small></div></div><button class="btn btn-light" type="button" data-go="planos">Ver detalhes do plano</button>`)}
        ${card(mode.icon || "store", "Modelo de operação", "Como sua empresa trabalha no dia a dia.", `<div class="desktop-operation-summary"><small>Modelo atual</small><b>${esc(mode.label || "Não definido")}</b><p>${esc(mode.description || "")}</p>${credit.label ? `<span>${icon("check")} ${esc(credit.label)}</span>` : ""}</div><button class="btn btn-light" type="button" data-edit-operation>Alterar modelo</button>`)}
        ${card("cloud", "Backup e dados", "Backup, restauração e sincronização.", `<dl><dt>Última sincronização</dt><dd id="firebase-last-sync">${esc(formatTime(sync.lastSync))}</dd><dt>Status</dt><dd><span class="desktop-sync-status"><i></i><b id="firebase-status">${esc(sync.message || "Preparando sincronização…")}</b></span></dd><dt>Pendências</dt><dd><span id="firebase-pending">${Number(sync.pending || 0)}</span> · <span id="firebase-errors">${Number(sync.errors || 0)}</span> erro(s)</dd></dl><div class="desktop-settings-actions"><button class="btn btn-light" type="button" id="export">${icon("download")} Fazer backup agora</button><label class="btn btn-light">${icon("upload")} Importar backup<input type="file" id="import" accept="application/json" hidden></label><button class="btn btn-light" type="button" id="firebase-sync">${icon("refresh-cw")} Sincronizar</button></div>`, "desktop-settings-backup")}
        ${card("puzzle", "Integrações", "Conecte ferramentas e serviços.", `<ul class="desktop-integration-list"><li>${icon("message-circle")}<span>WhatsApp</span><b>Conectado</b></li><li>${icon("credit-card")}<span>Mercado Pago</span><b>${business.mercadoPagoConnected ? "Conectado" : "Disponível"}</b></li><li>${icon("printer")}<span>Impressora</span><em>Não conectado</em></li></ul><button class="btn btn-light" type="button" data-settings-placeholder="Integrações">Gerenciar integrações</button>`)}
        ${card("bell", "Notificações", "Configure alertas e avisos do sistema.", `<ul class="desktop-integration-list"><li>${icon("package-search")}<span>Estoque baixo</span><b>Ativado</b></li><li>${icon("badge-dollar-sign")}<span>Vendas e recebimentos</span><b>Ativado</b></li><li>${icon("megaphone")}<span>Campanhas e fidelidade</span><b>Ativado</b></li></ul><button class="btn btn-light" type="button" data-settings-placeholder="Notificações">Configurar notificações</button>`)}
        ${card("user-round", "Conta", "Gerencie seu acesso e segurança.", `<dl><dt>Usuário</dt><dd>${esc(profile.name || "Administrador")}</dd><dt>E-mail</dt><dd>${esc(session.user?.email || profile.email || "")}</dd><dt>Perfil</dt><dd>${esc(roleNames[profile.role] || profile.role || "Usuário")}</dd><dt>Acesso</dt><dd>${profile.active === false ? "Inativo" : "Ativo"}</dd></dl><div class="desktop-settings-actions"><button class="btn btn-light" type="button" data-desktop-edit-profile>Meus dados</button><button class="btn btn-light" type="button" data-desktop-reset-password>Trocar senha</button><button class="desktop-settings-logout" type="button" data-settings-logout>${icon("log-out")} Sair</button></div>`)}
        ${card("ellipsis", "Outros", "Outras ações importantes.", `<ul class="desktop-settings-other"><li><button type="button" data-settings-placeholder="Preferências">${icon("sliders-horizontal")} Preferências do sistema</button></li><li><button type="button" id="desktop-clear-cache">${icon("eraser")} Limpar cache local</button></li><li><button type="button" data-settings-placeholder="Ferramentas">${icon("wrench")} Ferramentas</button></li></ul><button class="btn btn-light" type="button" id="clear-device">Limpar dados deste aparelho</button>`)}
        ${card("settings", "Detalhes técnicos", "Identifique a versão e o ambiente deste aparelho.", `<details class="desktop-technical-details"><summary>Mostrar diagnóstico</summary><dl class="firebase-details" id="firebase-details"></dl></details>`, "desktop-settings-technical")}
      </div>
      <section id="firebase-cloud-panel" hidden aria-hidden="true"></section>
    </section>`;
  }

  function modal(content) {
    const root = document.querySelector("#modal");
    root.innerHTML = `<div class="modal-bg"><section class="modal-box">${content}</section></div>`;
    window.lucide?.createIcons();
    return root;
  }

  const close = () => {
    const root = document.querySelector("#modal");
    if (root) root.innerHTML = "";
  };

  function editBusiness() {
    const business = window.FirebaseSession?.business || {},
      config = DB.carregar().config,
      root = modal(
        `<header class="modal-head"><h3>Editar empresa</h3><button class="icon-btn" type="button" data-close>${icon("x")}</button></header><form id="desktop-business-form"><div class="modal-body"><div class="field"><label>Nome do negócio</label><input name="name" required value="${esc(business.name || config.nome || "")}"></div><div class="field"><label>Telefone</label><input name="phone" inputmode="tel" value="${esc(business.phone || config.telefone || "")}"></div><div class="field"><label>Tipo do comércio</label><input name="businessType" value="${esc(business.businessType || "")}"></div></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-close>Cancelar</button><button class="btn btn-primary">Salvar alterações</button></footer></form>`,
      );
    root
      .querySelectorAll("[data-close]")
      .forEach((button) => (button.onclick = close));
    root.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        await window.FirebaseAuthActions.updateBusiness(
          Object.fromEntries(new FormData(event.currentTarget)),
        );
        close();
        Utils.toast("Dados da empresa atualizados.");
        dispatchEvent(new Event("hashchange"));
      } catch (error) {
        button.disabled = false;
        Utils.toast(
          error.message || "Não foi possível atualizar a empresa.",
          true,
        );
      }
    };
  }

  function editProfile() {
    const profile = window.FirebaseSession?.profile || {},
      root = modal(
        `<header class="modal-head"><h3>Meus dados</h3><button class="icon-btn" type="button" data-close>${icon("x")}</button></header><form><div class="modal-body"><div class="field"><label>Nome</label><input name="name" required value="${esc(profile.name || "")}"></div><div class="field"><label>Telefone</label><input name="phone" inputmode="tel" value="${esc(profile.phone || "")}"></div></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-close>Cancelar</button><button class="btn btn-primary">Salvar alterações</button></footer></form>`,
      );
    root
      .querySelectorAll("[data-close]")
      .forEach((button) => (button.onclick = close));
    root.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        await window.FirebaseAuthActions.updateProfile(
          Object.fromEntries(new FormData(event.currentTarget)),
        );
        close();
        Utils.toast("Seus dados foram atualizados.");
        dispatchEvent(new Event("hashchange"));
      } catch (error) {
        button.disabled = false;
        Utils.toast(
          error.message || "Não foi possível atualizar seus dados.",
          true,
        );
      }
    };
  }

  async function syncNow(button) {
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${icon("loader-circle")} Sincronizando…`;
    try {
      const result = await SyncFirebase.synchronizeNow();
      Utils.toast(
        result.offline
          ? "Sem conexão. Os dados continuam salvos neste aparelho."
          : "Sincronização concluída.",
        Boolean(result.errors),
      );
    } catch (error) {
      Utils.toast("Não foi possível sincronizar agora.", true);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
      window.lucide?.createIcons();
    }
  }

  function bind() {
    if (!mq.matches) return;
    const root = document.querySelector("[data-desktop-settings]");
    if (!root) return;
    root
      .querySelector("[data-desktop-edit-business]")
      ?.addEventListener("click", editBusiness);
    root
      .querySelector("[data-desktop-edit-profile]")
      ?.addEventListener("click", editProfile);
    root
      .querySelector("[data-desktop-reset-password]")
      ?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await window.FirebaseAuthActions.sendPasswordReset();
          Utils.toast("Enviamos as instruções para o seu e-mail.");
        } catch (error) {
          Utils.toast(
            error.message || "Não foi possível enviar as instruções.",
            true,
          );
        } finally {
          button.disabled = false;
        }
      });
    root
      .querySelectorAll("[data-settings-logout]")
      .forEach(
        (button) =>
          (button.onclick = () => window.FirebaseAuthActions?.signOut?.()),
      );
    root
      .querySelector("#firebase-sync")
      ?.addEventListener("click", (event) => syncNow(event.currentTarget));
    root
      .querySelector("#desktop-clear-cache")
      ?.addEventListener("click", () =>
        root.querySelector("#clear-device")?.click(),
      );
    root
      .querySelectorAll("[data-settings-placeholder]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          Utils.toast(
            `${button.dataset.settingsPlaceholder}: área preparada para a próxima etapa.`,
          ),
        ),
      );
    window.OperationMode?.bindSettings?.(root);
  }

  window.DesktopSettings = { isDesktop: () => mq.matches, render, bind };
})();
