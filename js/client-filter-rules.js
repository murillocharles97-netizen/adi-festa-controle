(function () {
  "use strict";

  const normalize = (value) =>
    String(value || "")
      .trim()
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  const digits = (value) => String(value || "").replace(/\D/g, "");
  const balance = (client) => (globalThis.Clientes?.financialStatus?.(client)?.saldo ?? Number(client?.saldo || 0));

  function matchesSearch(client, query) {
    const text = normalize(query);
    return !text || includesSearch(client, text, digits(query));
  }

  function includesSearch(client, text, phone) {
    const searchable = normalize(
      `${client?.nome || ""} ${client?.apelido || ""} ${client?.telefone || ""} ` +
        `${client?.telefone2 || ""} ${client?.observacoes || client?.observacao || ""}`,
    );
    return (
      searchable.includes(text) ||
      Boolean(phone && digits(`${client?.telefone || ""}${client?.telefone2 || ""}`).includes(phone))
    );
  }

  function matchesStatus(client, filter = "todos", adapters = {}) {
    const selected = String(filter || "todos");
    if (selected === "todos" || selected === "todas") return true;
    const getBalance = adapters.balance || balance;
    if (selected === "debito") return getBalance(client) < 0;
    if (selected === "credito") return getBalance(client) > 0;
    if (selected === "zero") return getBalance(client) === 0;
    if (selected === "semTelefone") return digits(client?.telefone).length < 10;
    if (selected === "nunca") return !adapters.lastCharge?.(client);
    if (selected === "vencida") return Boolean(adapters.chargeExpired?.(client));
    if (selected === "pagamento") return Boolean(adapters.recentPayment?.(client));
    return true;
  }

  function filter(clients, options = {}) {
    const query = options.query || "", text = normalize(query), phone = text ? digits(query) : "";
    return (clients || []).filter(
      (client) =>
        (options.includeInactive || client?.ativo !== false) &&
        (!text || includesSearch(client, text, phone)) &&
        matchesStatus(client, options.status || "todos", options),
    );
  }

  window.ClientFilterRules = Object.freeze({
    normalize,
    digits,
    matchesSearch,
    matchesStatus,
    filter,
  });
})();
