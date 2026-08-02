"use strict";

const crypto = require("node:crypto");
const { getPlan, planBilling } = require("./plan-service");

const DISCOUNT_TYPES = new Set(["percentage", "fixed_amount", "final_price"]);
const DURATION_TYPES = new Set([
  "first_payment",
  "billing_cycles",
  "while_subscription_active",
  "until_date",
]);
const BILLING_CYCLES = new Set(["monthly", "yearly"]);
const CATEGORIES = new Set(["private", "promotional"]);
const EDITABLE_STATUSES = new Set(["draft", "active", "paused"]);
const PUBLIC_MESSAGES = {
  not_found: "Cupom inválido. Confira o código digitado.",
  expired: "Este cupom não está mais disponível.",
  scheduled: "Este cupom ainda não está disponível.",
  paused: "Este cupom está temporariamente indisponível.",
  ended: "Este cupom não está mais disponível.",
  limit_reached: "Este cupom atingiu o limite de utilizações.",
  already_used: "Esta empresa já utilizou este cupom.",
  plan_incompatible: "Este cupom não é válido para o plano selecionado.",
  billing_incompatible: "Este cupom não é válido para esta periodicidade.",
  private_forbidden: "Este cupom não está disponível para esta conta.",
  new_subscribers_only:
    "Este cupom está disponível apenas para novos assinantes.",
  first_paid_only:
    "Este cupom está disponível apenas para a primeira assinatura paga.",
  upgrade_forbidden: "Este cupom não permite alteração para este plano.",
  downgrade_forbidden: "Este cupom não permite redução de plano.",
  quote_expired: "A condição expirou. Aplique o cupom novamente.",
  invalid: "Cupom inválido. Confira o código digitado.",
};

class CouponError extends Error {
  constructor(
    code,
    message = PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES.invalid,
    details = {},
  ) {
    super(message);
    this.name = "CouponError";
    this.code = code;
    this.publicCode = code;
    this.details = details;
  }
}
const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const normalizeCouponCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
const couponCodeKey = (value) =>
  crypto.createHash("sha256").update(normalizeCouponCode(value)).digest("hex");
const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const cleanList = (
  values,
  normalize = (value) => String(value || "").trim(),
) => [
  ...new Set(
    (Array.isArray(values) ? values : []).map(normalize).filter(Boolean),
  ),
];
const safeInteger = (value, fallback = null) =>
  value === null || value === undefined || value === ""
    ? fallback
    : Number.isInteger(Number(value))
      ? Number(value)
      : NaN;

function deriveCouponStatus(coupon, now = new Date()) {
  const stored = String(coupon?.status || "draft");
  if (stored === "ended" || coupon?.endedAt) return "ended";
  if (stored === "paused") return "paused";
  if (stored === "draft") return "draft";
  const from = toDate(coupon?.validFrom),
    until = toDate(coupon?.validUntil);
  if (from && from > now) return "scheduled";
  if (until && until < now) return "expired";
  return "active";
}

function normalizeCouponDefinition(input = {}, existing = {}) {
  const code = normalizeCouponCode(input.code ?? existing.code),
    discountType = String((input.discountType ?? existing.discountType) || ""),
    durationType = String((input.durationType ?? existing.durationType) || ""),
    category = String((input.category ?? existing.category) || "promotional"),
    status = String((input.status ?? existing.status) || "draft");
  const normalized = {
    ...existing,
    ...input,
    code,
    codeNormalized: code,
    name: String((input.name ?? existing.name) || "")
      .trim()
      .slice(0, 120),
    campaign: String((input.campaign ?? existing.campaign) || "")
      .trim()
      .slice(0, 120),
    category,
    description: String((input.description ?? existing.description) || "")
      .trim()
      .slice(0, 1000),
    discountType,
    discountValue: roundMoney(input.discountValue ?? existing.discountValue),
    durationType,
    billingCycles: safeInteger(input.billingCycles ?? existing.billingCycles),
    discountEndsAt: input.discountEndsAt ?? existing.discountEndsAt ?? null,
    allowedPlanIds: cleanList(
      input.allowedPlanIds ?? existing.allowedPlanIds,
      (value) =>
        String(value || "")
          .trim()
          .toLowerCase(),
    ),
    allowedBillingCycles: cleanList(
      input.allowedBillingCycles ?? existing.allowedBillingCycles,
      (value) =>
        String(value || "")
          .trim()
          .toLowerCase(),
    ),
    validFrom: input.validFrom ?? existing.validFrom ?? null,
    validUntil: input.validUntil ?? existing.validUntil ?? null,
    maxRedemptions: safeInteger(
      input.maxRedemptions ?? existing.maxRedemptions,
    ),
    maxUsesPerBusiness: safeInteger(
      input.maxUsesPerBusiness ?? existing.maxUsesPerBusiness,
      1,
    ),
    maxUsesPerUser: safeInteger(
      input.maxUsesPerUser ?? existing.maxUsesPerUser,
    ),
    authorizedEmails: cleanList(
      input.authorizedEmails ?? existing.authorizedEmails,
      normalizeEmail,
    ),
    authorizedUids: cleanList(input.authorizedUids ?? existing.authorizedUids),
    authorizedBusinessIds: cleanList(
      input.authorizedBusinessIds ?? existing.authorizedBusinessIds,
    ),
    authorizedEmailDomains: cleanList(
      input.authorizedEmailDomains ?? existing.authorizedEmailDomains,
      (value) => normalizeEmail(value).replace(/^@/, ""),
    ),
    newSubscribersOnly: Boolean(
      input.newSubscribersOnly ?? existing.newSubscribersOnly,
    ),
    inactiveSubscriptionsOnly: Boolean(
      input.inactiveSubscriptionsOnly ?? existing.inactiveSubscriptionsOnly,
    ),
    allowUpgrade: input.allowUpgrade ?? existing.allowUpgrade ?? true,
    allowDowngrade: input.allowDowngrade ?? existing.allowDowngrade ?? false,
    stackable: false,
    firstPaidSubscriptionOnly: Boolean(
      input.firstPaidSubscriptionOnly ?? existing.firstPaidSubscriptionOnly,
    ),
    businessCreatedAfter:
      input.businessCreatedAfter ?? existing.businessCreatedAfter ?? null,
    status: EDITABLE_STATUSES.has(status) ? status : "draft",
  };
  validateCouponDefinition(normalized);
  return normalized;
}

function validateCouponDefinition(coupon) {
  if (coupon.name.length < 2)
    throw new CouponError("invalid", "Informe o nome interno do cupom.");
  if (!/^[A-Z0-9_-]{3,40}$/.test(coupon.code))
    throw new CouponError(
      "invalid",
      "Use um código de 3 a 40 caracteres com letras, números, hífen ou underscore.",
    );
  if (
    !CATEGORIES.has(coupon.category) ||
    !DISCOUNT_TYPES.has(coupon.discountType) ||
    !DURATION_TYPES.has(coupon.durationType)
  )
    throw new CouponError("invalid");
  if (
    coupon.discountType === "percentage" &&
    (!(coupon.discountValue >= 1) || coupon.discountValue > 100)
  )
    throw new CouponError(
      "invalid",
      "O desconto percentual deve ficar entre 1% e 100%.",
    );
  if (coupon.discountType !== "percentage" && !(coupon.discountValue >= 0))
    throw new CouponError(
      "invalid",
      "O valor do desconto não pode ser negativo.",
    );
  if (
    coupon.durationType === "billing_cycles" &&
    (!(coupon.billingCycles >= 1) || coupon.billingCycles > 120)
  )
    throw new CouponError(
      "invalid",
      "Informe uma quantidade válida de cobranças.",
    );
  if (coupon.durationType === "until_date" && !toDate(coupon.discountEndsAt))
    throw new CouponError("invalid", "Informe a data final do desconto.");
  if (
    !coupon.allowedPlanIds.length ||
    coupon.allowedPlanIds.some((id) => !getPlan(id))
  )
    throw new CouponError("invalid", "Selecione ao menos um plano válido.");
  if (
    !coupon.allowedBillingCycles.length ||
    coupon.allowedBillingCycles.some((cycle) => !BILLING_CYCLES.has(cycle))
  )
    throw new CouponError(
      "invalid",
      "Selecione ao menos uma periodicidade válida.",
    );
  for (const field of [
    "maxRedemptions",
    "maxUsesPerBusiness",
    "maxUsesPerUser",
  ])
    if (
      coupon[field] !== null &&
      (!(coupon[field] >= 1) || !Number.isInteger(coupon[field]))
    )
      throw new CouponError(
        "invalid",
        "Os limites devem ser números inteiros positivos.",
      );
  const from = toDate(coupon.validFrom),
    until = toDate(coupon.validUntil);
  if (from && until && until <= from)
    throw new CouponError(
      "invalid",
      "A data final deve ser posterior ao início.",
    );
  if (coupon.category === "promotional" && !until)
    throw new CouponError(
      "invalid",
      "Cupons promocionais precisam de uma data final.",
    );
  return coupon;
}

function calculateDiscount({ discountType, discountValue }, originalPrice) {
  const original = roundMoney(originalPrice);
  let discounted = original;
  if (discountType === "percentage")
    discounted = roundMoney(original * (1 - Number(discountValue) / 100));
  if (discountType === "fixed_amount")
    discounted = roundMoney(original - Number(discountValue));
  if (discountType === "final_price") discounted = roundMoney(discountValue);
  discounted = Math.max(0, Math.min(original, discounted));
  return {
    originalPrice: original,
    discountedPrice: discounted,
    savings: roundMoney(original - discounted),
  };
}

function privateAuthorized(coupon, { uid, email, businessId }) {
  if (coupon.category !== "private") return true;
  const lists = [
    coupon.authorizedEmails,
    coupon.authorizedUids,
    coupon.authorizedBusinessIds,
    coupon.authorizedEmailDomains,
  ];
  if (lists.every((list) => !Array.isArray(list) || !list.length)) return true;
  const normalized = normalizeEmail(email),
    domain = normalized.split("@")[1] || "";
  return (
    coupon.authorizedEmails?.includes(normalized) ||
    coupon.authorizedUids?.includes(uid) ||
    coupon.authorizedBusinessIds?.includes(businessId) ||
    coupon.authorizedEmailDomains?.includes(domain)
  );
}

function planRank(planId) {
  return { essential: 1, professional: 2, premium: 3 }[planId] || 0;
}
function validateCouponUse({
  coupon,
  planId,
  billingCycle,
  business = {},
  uid = "",
  email = "",
  globalCounts = {},
  businessCounts = {},
  userCounts = {},
  now = new Date(),
}) {
  const status = deriveCouponStatus(coupon, now);
  if (status !== "active")
    throw new CouponError(
      status === "draft" ? "not_found" : status,
      status === "scheduled" && toDate(coupon.validFrom)
        ? `Este cupom estará disponível a partir de ${toDate(coupon.validFrom).toLocaleDateString("pt-BR")}.`
        : undefined,
    );
  const plan = getPlan(planId);
  if (!plan || !coupon.allowedPlanIds.includes(plan.id))
    throw new CouponError("plan_incompatible");
  if (!coupon.allowedBillingCycles.includes(billingCycle))
    throw new CouponError("billing_incompatible");
  if (!privateAuthorized(coupon, { uid, email, businessId: business.id }))
    throw new CouponError("private_forbidden");
  if (
    coupon.maxRedemptions !== null &&
    Number(globalCounts.confirmed || 0) + Number(globalCounts.reserved || 0) >=
      coupon.maxRedemptions
  )
    throw new CouponError("limit_reached");
  if (
    coupon.maxUsesPerBusiness !== null &&
    Number(businessCounts.confirmed || 0) +
      Number(businessCounts.reserved || 0) >=
      coupon.maxUsesPerBusiness
  )
    throw new CouponError("already_used");
  if (
    coupon.maxUsesPerUser !== null &&
    Number(userCounts.confirmed || 0) + Number(userCounts.reserved || 0) >=
      coupon.maxUsesPerUser
  )
    throw new CouponError("already_used");
  const subscription = business.subscription || {},
    hasPaid = Boolean(
      subscription.hasPaidSubscription ||
        subscription.lastPaymentDate ||
        subscription.mercadoPago?.subscriptionId,
    ),
    active = subscription.status === "active",
    currentRank = planRank(subscription.planId),
    targetRank = planRank(plan.id);
  if (coupon.newSubscribersOnly && hasPaid)
    throw new CouponError("new_subscribers_only");
  if (coupon.inactiveSubscriptionsOnly && active)
    throw new CouponError(
      "new_subscribers_only",
      "Este cupom está disponível somente para empresas sem assinatura ativa.",
    );
  if (coupon.firstPaidSubscriptionOnly && hasPaid)
    throw new CouponError("first_paid_only");
  if (active && targetRank > currentRank && !coupon.allowUpgrade)
    throw new CouponError("upgrade_forbidden");
  if (active && targetRank < currentRank && !coupon.allowDowngrade)
    throw new CouponError("downgrade_forbidden");
  const created = toDate(business.createdAt),
    threshold = toDate(coupon.businessCreatedAfter);
  if (threshold && (!created || created < threshold))
    throw new CouponError("private_forbidden");
  const pricing = planBilling(plan, billingCycle),
    prices = calculateDiscount(coupon, pricing.amount);
  if (prices.discountedPrice < 1)
    throw new CouponError(
      "invalid",
      "A condição resultou em um valor abaixo do mínimo permitido.",
    );
  return { valid: true, plan, billing: { ...pricing, ...prices } };
}

function durationLabel(coupon) {
  if (coupon.durationType === "first_payment")
    return "Somente no primeiro pagamento";
  if (coupon.durationType === "billing_cycles")
    return `Durante ${coupon.billingCycles} cobrança(s)`;
  if (coupon.durationType === "while_subscription_active")
    return "Enquanto esta assinatura permanecer ativa";
  return `Até ${toDate(coupon.discountEndsAt)?.toLocaleDateString("pt-BR") || "a data configurada"}`;
}
function discountSnapshot(coupon, pricing, now = new Date()) {
  const endsAt =
    coupon.durationType === "until_date"
      ? toDate(coupon.discountEndsAt)?.toISOString() || null
      : null;
  return {
    source: "coupon",
    couponId: coupon.id,
    couponCodeSnapshot: coupon.code,
    couponVersion: Number(coupon.version || 1),
    originalPrice: pricing.originalPrice,
    discountedPrice: pricing.discountedPrice,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    durationType: coupon.durationType,
    remainingBillingCycles:
      coupon.durationType === "first_payment"
        ? 1
        : coupon.durationType === "billing_cycles"
          ? coupon.billingCycles
          : null,
    validWhileSubscriptionActive:
      coupon.durationType === "while_subscription_active",
    startsAt: now.toISOString(),
    endsAt,
    restoreDueAt: endsAt,
    createdAt: now.toISOString(),
  };
}

module.exports = {
  CouponError,
  PUBLIC_MESSAGES,
  normalizeCouponCode,
  couponCodeKey,
  deriveCouponStatus,
  normalizeCouponDefinition,
  validateCouponDefinition,
  calculateDiscount,
  privateAuthorized,
  validateCouponUse,
  durationLabel,
  discountSnapshot,
  roundMoney,
  toDate,
};
