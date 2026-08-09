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
  const balance = (client) => Number(client?.saldo || 0);

  function matchesSearch(client, query) {
    const text = normalize(query);
    if (!text) return true;
    const phone = digits(query);
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
    if (selected === "debito") return balance(client) < 0;
    if (selected === "credito") return balance(client) > 0;
    if (selected === "zero") return balance(client) === 0;
    if (selected === "semTelefone") return digits(client?.telefone).length < 10;
    if (selected === "nunca") return !adapters.lastCharge?.(client);
    if (selected === "vencida") return Boolean(adapters.chargeExpired?.(client));
    if (selected === "pagamento") return Boolean(adapters.recentPayment?.(client));
    return true;
  }

  function filter(clients, options = {}) {
    return (clients || []).filter(
      (client) =>
        (options.includeInactive || client?.ativo !== false) &&
        matchesSearch(client, options.query || "") &&
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
