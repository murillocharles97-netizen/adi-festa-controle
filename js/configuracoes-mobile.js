(function () {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector),
    $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = (name) => `<i data-lucide="${name}"></i>`,
    esc = (value) =>
      window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? "");
  const roleNames = {
    owner: "Proprietário",
    admin: "Administrador",
    manager: "Gerente",
    cashier: "Operador",
    viewer: "Consulta",
    platform_admin: "Administrador da plataforma",
  };
  const row = ({
    iconName,
    title,
    subtitle,
    action = "",
    route = "",
    operation = false,
    logout = false,
    tone = "",
  }) =>
    `<button type="button" class="settings-list-row ${tone}" ${action ? `data-settings-action="${action}"` : ""} ${route ? `data-settings-route="${route}"` : ""} ${operation ? "data-edit-operation" : ""} ${logout ? "data-settings-logout" : ""}><span class="settings-row-icon" aria-hidden="true">${icon(iconName)}</span><span class="settings-row-copy"><b>${esc(title)}</b><small>${esc(subtitle)}</small></span>${icon("chevron-right")}</button>`;
  const group = (title, subtitle, items) =>
    `<section class="settings-group"><header class="settings-group-heading"><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></header><div class="settings-group-list">${items.join("")}</div></section>`;

  function syncPresentation(sync = {}) {
    const pending = Number(sync.queueTotal ?? sync.pending ?? 0);
    const errors = Number(sync.errors || 0);
    if (!navigator.onLine || sync.status === "offline") return { state: "offline", title: "Sem conexão", subtitle: pending ? `${pending} alteração(ões) salvas no aparelho, aguardando rede.` : "Dados disponíveis neste aparelho." };
    if (errors || sync.status === "error") return { state: "error", title: "Sincronização precisa de atenção", subtitle: errors ? `${errors} operação(ões) com erro.` : sync.message || "Confira o status da sincronização." };
    if (pending) return { state: "pending", title: "Envio pendente", subtitle: `${pending} alteração(ões) aguardando envio.` };
    if (sync.status === "syncing" || sync.status === "testing") return { state: "syncing", title: "Sincronizando", subtitle: sync.message || "Conferindo dados com a nuvem." };
    if (sync.status === "success" && sync.testPassed && sync.hydrated && sync.listenerConnected) return { state: "ready", title: "Sincronização pronta", subtitle: "Todos os dados salvos." };
    return { state: "waiting", title: "Verificando sincronização", subtitle: sync.message || "Aguardando confirmação da nuvem." };
  }

  function updateSyncView(sync) {
    const card = $("[data-settings-sync]");
    if (!card) return;
    const view = syncPresentation(sync);
    card.dataset.syncState = view.state;
    $("[data-settings-sync-title]", card).textContent = view.title;
    $("[data-settings-sync-subtitle]", card).textContent = view.subtitle;
  }
  addEventListener("firebase-sync-status", (event) => updateSyncView(event.detail));

  function render() {
    const sync = syncPresentation(window.SyncFirebaseState || {});
    return `<section class="mobile-settings-page settings-mobile-v2" data-settings-root><button type="button" class="settings-sync-hero" data-settings-sync data-settings-action="sync" data-sync-state="${sync.state}"><span class="settings-sync-icon" aria-hidden="true">${icon("cloud")}<i></i></span><span class="settings-sync-copy"><b data-settings-sync-title>${esc(sync.title)}</b><small data-settings-sync-subtitle>${esc(sync.subtitle)}</small></span>${icon("chevron-right")}</button>
      ${group("Conta e operação", "Gerencie as informações do seu negócio.", [
        row({
          iconName: "building-2",
          title: "Dados da empresa",
          subtitle: "Nome, telefone e documento",
          action: "business",
        }),
        row({
          iconName: "gem",
          title: "Plano e assinatura",
          subtitle: "Plano atual e cobrança",
          route: "planos",
        }),
        row({
          iconName: "message-circle",
          title: "WhatsApp padrão",
          subtitle: "Número usado nas comunicações",
          action: "whatsapp",
        }),
        row({
          iconName: "truck",
          title: "Modelo de operação",
          subtitle: "Entrega, retirada e fiado",
          operation: true,
        }),
        row({
          iconName: "user-round",
          title: "Conta",
          subtitle: "Perfil e acesso",
          action: "account",
        }),
      ])}
      ${group("Sistema", "Configurações e manutenção do app.", [
        row({
          iconName: "refresh-cw",
          title: "Sincronização",
          subtitle: "Status e envios pendentes",
          action: "sync",
        }),
        row({
          iconName: "database",
          title: "Backup de dados",
          subtitle: "Exportar, importar e restaurar",
          action: "backup",
        }),
        row({
          iconName: "circle-help",
          title: "Ajuda e tutoriais",
          subtitle: "Primeiros passos com a VECONI",
          action: "tutorials",
        }),
      ])}
      ${group("Ações", "Gerencie sua sessão com segurança.", [
        row({ iconName: "log-out", title: "Sair da conta", subtitle: "Encerrar sessão neste dispositivo", logout: true, tone: "is-danger" }),
      ])}
      <p class="settings-version">VECONI · <span data-mobile-app-version></span></p><div class="settings-legacy-hooks" aria-hidden="true"><button id="export" type="button"></button><input type="file" id="import" accept="application/json"><button id="clear-device" type="button"></button></div></section>`;
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
  function tutorials() {
    const root = modal(`${sheetHead("Ajuda e tutoriais", "Aprenda no seu ritmo.")}<div class="modal-body"><h4>Primeiros passos com a VECONI</h4><p>Um guia rápido para conhecer a navegação do aplicativo.</p></div><footer class="modal-foot"><button type="button" class="btn btn-primary mobile-button primary" data-settings-review-intro>Rever tutorial</button></footer>`);
    bindClose(root);
    root.querySelector("[data-settings-review-intro]")?.addEventListener("click", () => {
      close();
      window.VeconiAppIntro?.open?.({ manual: true });
    });
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
    const root = $("[data-settings-root]");
    if (!root) return;
    window.OperationMode?.bindSettings?.(root);
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
          if (action === "tutorials") tutorials();
          if (action === "sync") {
            const badge = $(".local-badge");
            if (badge?.dataset.cloudPanelBound === "true") badge.click();
            else void syncNow(button);
          }
        }),
    );
    $("[data-settings-logout]", root)?.addEventListener("click", () =>
      window.FirebaseAuthActions?.signOut?.(),
    );
  }
  window.ConfiguracoesMobile = { render, bind };
})();
