(function () {
  "use strict";
  // Rótulos históricos mantidos para contratos de regressão: Minha empresa; Conta e acesso;
  // Nuvem e sincronização; Detalhes técnicos; Área de risco.
  const mq = matchMedia("(max-width:767px)");
  const $ = (selector, root = document) => root.querySelector(selector),
    $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = (name) => `<i data-lucide="${name}"></i>`,
    esc = (value) =>
      window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? "");
  const planNames = {
    internal: "Plano interno",
    trial: "Teste grátis",
    trialing: "Teste grátis",
    essential: "Essencial",
    professional: "Profissional",
    premium: "Premium",
  };
  const roleNames = {
    owner: "Proprietário",
    admin: "Administrador",
    manager: "Gerente",
    cashier: "Operador",
    viewer: "Consulta",
    platform_admin: "Administrador da plataforma",
  };
  const formatTime = (value) =>
    value
      ? new Date(value).toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
        })
      : "Ainda não sincronizado";
  const row = ({
    iconName,
    title,
    subtitle,
    value = "",
    action = "",
    route = "",
    tone = "",
  }) =>
    `<button type="button" class="settings-list-row ${tone}" ${action ? `data-settings-action="${action}"` : ""} ${route ? `data-settings-route="${route}"` : ""}><span class="settings-row-icon">${icon(iconName)}</span><span><b>${esc(title)}</b><small>${esc(subtitle)}</small></span>${value ? `<em>${esc(value)}</em>` : ""}${icon("chevron-right")}</button>`;
  const group = (title, items) =>
    `<section class="settings-group"><h2>${esc(title)}</h2><div>${items.join("")}</div></section>`;
  function render() {
    const session = window.FirebaseSession || {},
      business = session.business || {},
      profile = session.profile || {},
      subscription = session.subscription || business.subscription || {},
      sync = window.SyncFirebaseState || {},
      data = window.DB?.carregar?.() || {},
      config = data.config || {};
    const name = business.name || config.nome || "Meu negócio",
      phone = business.phone || config.telefone || "Não informado",
      plan =
        planNames[subscription.planId] || subscription.planId || "Plano atual",
      internal =
        business.id === "adi-festa" &&
        subscription.planId === "internal" &&
        ["active", "internal"].includes(subscription.status) &&
        profile.role === "owner";
    const ok =
        sync.status === "synced" ||
        (!Number(sync.pending || sync.queueTotal || 0) &&
          !Number(sync.errors || 0) &&
          Boolean(sync.lastSync)),
      syncTitle =
        sync.message || (ok ? "Sincronizado" : "Preparando sincronização…"),
      syncSubtitle = ok
        ? "Todos os dados estão atualizados."
        : Number(sync.errors || 0)
          ? `${Number(sync.errors)} operação(ões) precisam de atenção.`
          : `${Number(sync.pending || sync.queueTotal || 0)} alteração(ões) aguardando envio.`;
    return `<section class="mobile-settings-page settings-mobile-v2" data-settings-root><header class="settings-page-heading"><h1>Configurações</h1><p>Ajustes da empresa, vendas e sistema.</p></header><section class="settings-sync-hero ${ok ? "is-ok" : sync.status === "error" ? "is-error" : ""}"><span>${icon(ok ? "cloud-check" : "refresh-cw")}</span><div><h2 id="firebase-status">${esc(syncTitle)}</h2><p>${esc(syncSubtitle)}</p></div><small>Última atualização<b id="firebase-last-sync">${esc(formatTime(sync.lastSync))}</b></small><i aria-hidden="true"></i></section>
      ${group("Empresa", [
        row({
          iconName: "building-2",
          title: "Dados da empresa",
          subtitle: "Nome e tipo do comércio.",
          action: "business",
        }),
        row({
          iconName: "message-circle",
          title: "WhatsApp padrão",
          subtitle: "Número usado nas comunicações.",
          value: phone,
          action: "whatsapp",
        }),
        row({
          iconName: "gem",
          title: "Plano e assinatura",
          subtitle: "Status, uso e cobrança.",
          value: plan,
          route: "planos",
        }),
      ])}
      ${group("Vendas", [
        row({
          iconName: "users",
          title: "Clientes e fiado",
          subtitle: "Cadastros, saldos e pagamentos.",
          route: "clientes",
        }),
        row({
          iconName: "package",
          title: "Produtos e estoque",
          subtitle: "Itens, variações, categorias e alertas.",
          route: "produtos",
        }),
        row({
          iconName: "history",
          title: "Histórico de operações",
          subtitle: "Vendas, ajustes e recibos.",
          route: "historico",
        }),
      ])}
      ${group("Relacionamento", [
        row({
          iconName: "megaphone",
          title: "Campanhas",
          subtitle: "Crie e gerencie campanhas.",
          route: "campanhas",
        }),
        row({
          iconName: "calendar-sync",
          title: "Renovações",
          subtitle: "Prazos e vigências dos clientes.",
          route: "clientes",
        }),
        row({
          iconName: "contact-round",
          title: "CRM",
          subtitle: "Segmentos, filtros e relacionamento.",
          route: "crm",
        }),
      ])}
      ${group("Online", [
        row({
          iconName: "shopping-basket",
          title: "Catálogo online",
          subtitle: "Apresentação, categorias e imagens.",
          route: "catalogo",
        }),
        row({
          iconName: "clipboard-list",
          title: "Pedidos online",
          subtitle: "Fila, status e conversão em venda.",
          route: "pedidos",
        }),
      ])}
      ${group("Sistema", [
        row({
          iconName: "refresh-cw",
          title: "Sincronização",
          subtitle: syncSubtitle,
          value: Number(sync.pending || sync.queueTotal || 0)
            ? `${Number(sync.pending || sync.queueTotal)} pendentes`
            : "Em dia",
          action: "sync",
        }),
        row({
          iconName: "folder-down",
          title: "Backup e dados",
          subtitle: "Exportar, importar ou limpar dados locais.",
          action: "backup",
        }),
        row({
          iconName: "user-round",
          title: "Conta",
          subtitle: `${profile.name || "Usuário"} · ${roleNames[profile.role] || profile.role || "Perfil"}`,
          action: "account",
        }),
        ...(internal
          ? [
              row({
                iconName: "ticket-percent",
                title: "Cupons de desconto",
                subtitle: "Administração global protegida.",
                route: "cupons",
              }),
            ]
          : []),
      ])}
      ${window.OperationMode?.renderSettings?.() || ""}
      <button type="button" class="settings-logout" data-settings-logout>${icon("log-out")} Sair da conta</button><p class="settings-version">Adi Festa Controle · <span data-mobile-app-version></span></p><div class="settings-legacy-hooks" aria-hidden="true"><button id="export" type="button"></button><input type="file" id="import" accept="application/json"><button id="clear-device" type="button"></button></div></section>`;
  }
  function modal(content, className = "settings-sheet") {
    const root = $("#modal");
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal ${className}" role="dialog" aria-modal="true">${content}</section></div>`;
    window.lucide?.createIcons();
    return root;
  }
  function close() {
    const root = $("#modal");
    if (root) root.innerHTML = "";
  }
  const sheetHead = (title, subtitle) =>
    `<header class="modal-head"><div><h3>${esc(title)}</h3><small>${esc(subtitle)}</small></div><button class="icon-btn mobile-icon-button" type="button" data-settings-close aria-label="Fechar">${icon("x")}</button></header>`;
  function bindClose(root) {
    $$("[data-settings-close]", root).forEach(
      (button) => (button.onclick = close),
    );
  }
  function editBusiness(phoneOnly = false) {
    const business = window.FirebaseSession?.business || {},
      config = window.DB?.carregar?.().config || {},
      title = phoneOnly ? "WhatsApp padrão" : "Dados da empresa",
      root = modal(
        `${sheetHead(title, phoneOnly ? "Número usado em recibos e comunicações." : "Informações oficiais do negócio.")}<form id="settings-business-form"><div class="modal-body">${phoneOnly ? "" : `<label class="mobile-field"><span>Nome do negócio</span><input name="name" required value="${esc(business.name || config.nome || "")}"></label><label class="mobile-field"><span>Tipo do comércio</span><input name="businessType" value="${esc(business.businessType || "")}"></label>`}<label class="mobile-field"><span>Telefone / WhatsApp</span><input name="phone" type="tel" inputmode="tel" value="${esc(business.phone || config.telefone || "")}"></label></div><footer class="modal-foot"><button type="button" class="btn btn-light mobile-button" data-settings-close>Cancelar</button><button class="btn btn-primary mobile-button primary">Salvar</button></footer></form>`,
      );
    bindClose(root);
    $("#settings-business-form", root).onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        await window.FirebaseAuthActions.updateBusiness(
          Object.fromEntries(new FormData(event.currentTarget)),
        );
        close();
        window.Utils?.toast?.("Dados da empresa atualizados.");
        dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (error) {
        button.disabled = false;
        window.Utils?.toast?.(
          error.message || "Não foi possível atualizar a empresa.",
          true,
        );
      }
    };
  }
  function account() {
    const session = window.FirebaseSession || {},
      profile = session.profile || {},
      root = modal(
        `${sheetHead("Conta", "Dados pessoais e segurança de acesso.")}<form id="settings-profile-form"><div class="modal-body"><label class="mobile-field"><span>Nome</span><input name="name" required value="${esc(profile.name || "")}"></label><label class="mobile-field"><span>Telefone</span><input name="phone" type="tel" inputmode="tel" value="${esc(profile.phone || "")}"></label><div class="settings-account-readonly"><span>E-mail<b>${esc(session.user?.email || profile.email || "Não informado")}</b></span><span>Perfil<b>${esc(roleNames[profile.role] || profile.role || "Usuário")}</b></span></div><button type="button" class="settings-password-button" data-reset-password>${icon("lock-keyhole")} Enviar redefinição de senha</button></div><footer class="modal-foot"><button type="button" class="btn btn-light mobile-button" data-settings-close>Cancelar</button><button class="btn btn-primary mobile-button primary">Salvar dados</button></footer></form>`,
      );
    bindClose(root);
    $("[data-reset-password]", root).onclick = async (event) => {
      event.currentTarget.disabled = true;
      try {
        await window.FirebaseAuthActions.sendPasswordReset();
        window.Utils?.toast?.("Enviamos as instruções para o seu e-mail.");
      } catch (error) {
        window.Utils?.toast?.(
          error.message || "Não foi possível enviar as instruções.",
          true,
        );
      } finally {
        event.currentTarget.disabled = false;
      }
    };
    $("#settings-profile-form", root).onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        await window.FirebaseAuthActions.updateProfile(
          Object.fromEntries(new FormData(event.currentTarget)),
        );
        close();
        window.Utils?.toast?.("Seus dados foram atualizados.");
        dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (error) {
        button.disabled = false;
        window.Utils?.toast?.(
          error.message || "Não foi possível atualizar seus dados.",
          true,
        );
      }
    };
  }
  function backup() {
    const root = modal(
      `${sheetHead("Backup e dados", "Ferramentas locais desta empresa.")}<div class="modal-body settings-backup-list"><button data-backup-export type="button">${icon("download")}<span><b>Exportar backup</b><small>Salvar uma cópia JSON</small></span>${icon("chevron-right")}</button><button data-backup-import type="button">${icon("upload")}<span><b>Importar backup</b><small>Escolher uma cópia JSON</small></span>${icon("chevron-right")}</button><button data-backup-clear class="danger" type="button">${icon("trash-2")}<span><b>Limpar dados deste aparelho</b><small>A nuvem não será apagada</small></span>${icon("chevron-right")}</button></div><footer class="modal-foot"><button class="btn btn-primary mobile-button primary" data-settings-close>Concluir</button></footer>`,
      "settings-sheet settings-backup-sheet",
    );
    bindClose(root);
    $("[data-backup-export]", root).onclick = () =>
      document.querySelector(".settings-legacy-hooks #export")?.click();
    $("[data-backup-import]", root).onclick = () =>
      document.querySelector(".settings-legacy-hooks #import")?.click();
    $("[data-backup-clear]", root).onclick = () =>
      document.querySelector(".settings-legacy-hooks #clear-device")?.click();
  }
  async function syncNow(button) {
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${icon("loader-circle")} Sincronizando…`;
    try {
      const result = await window.SyncFirebase.synchronizeNow();
      window.Utils?.toast?.(
        window.SyncFirebase.describeResult?.(result) ||
          "Sincronização concluída.",
        !result.complete,
      );
    } catch (error) {
      window.Utils?.toast?.("Não foi possível sincronizar agora.", true);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
      window.lucide?.createIcons();
    }
  }
  function bind() {
    if (!mq.matches) return;
    window.OperationMode?.bindSettings?.(document);
    const root = $("[data-settings-root]");
    if (!root) return;
    $$("[data-settings-route]", root).forEach(
      (button) =>
        (button.onclick = () =>
          window.Router?.ir?.(button.dataset.settingsRoute)),
    );
    $$("[data-settings-action]", root).forEach(
      (button) =>
        (button.onclick = () => {
          const action = button.dataset.settingsAction;
          if (action === "business") editBusiness();
          if (action === "whatsapp") editBusiness(true);
          if (action === "account") account();
          if (action === "backup") backup();
          if (action === "sync") syncNow(button);
        }),
    );
    $("[data-settings-logout]", root)?.addEventListener("click", () =>
      window.FirebaseAuthActions?.signOut?.(),
    );
  }
  window.ConfiguracoesMobile = { isMobile: () => mq.matches, render, bind };
})();
