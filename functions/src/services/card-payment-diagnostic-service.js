"use strict";

const REASONS = Object.freeze({
  cc_rejected_high_risk:
    "O Mercado Pago não aprovou este pagamento por uma análise de segurança. Use outro cartão ou pague por Pix.",
  high_risk:
    "O Mercado Pago não aprovou este pagamento por uma análise de segurança. Use outro cartão ou pague por Pix.",
  cc_rejected_insufficient_amount:
    "O cartão não possui limite disponível suficiente para esta cobrança.",
  insufficient_amount:
    "O cartão não possui limite disponível suficiente para esta cobrança.",
  cc_rejected_call_for_authorize:
    "O banco emissor precisa autorizar esta compra. Entre em contato com o banco ou tente outro cartão.",
  cc_rejected_card_disabled:
    "O cartão está desabilitado ou bloqueado para compras online ou recorrentes. Verifique com o banco ou tente outro cartão.",
  cc_rejected_bad_filled_card_number:
    "Confira o número do cartão e tente novamente.",
  cc_rejected_bad_filled_date:
    "Confira a validade do cartão e tente novamente.",
  cc_rejected_bad_filled_security_code:
    "Confira o código de segurança do cartão e tente novamente.",
  cc_rejected_bad_filled_other:
    "Confira os dados do cartão e tente novamente.",
  bad_filled_card_data:
    "Confira os dados do cartão e tente novamente.",
  cc_rejected_duplicated_payment:
    "O Mercado Pago identificou uma cobrança semelhante recente. Aguarde ou tente outro meio de pagamento.",
  cc_rejected_blacklist:
    "Este cartão não pôde ser usado nesta cobrança. Use outro cartão ou pague por Pix.",
  cc_rejected_other_reason:
    "O banco ou o Mercado Pago não aprovou esta cobrança. Use outro cartão ou pague por Pix.",
  cc_rejected_max_attempts:
    "Não foi possível tentar novamente com este cartão agora. Use outro cartão ou pague por Pix.",
});

function normalizeStatusDetail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 120) || null;
}

function paymentDeclineMessage(statusDetail) {
  const detail = normalizeStatusDetail(statusDetail);
  return (
    REASONS[detail] ||
    "Seu banco ou o Mercado Pago não aprovou esta cobrança. Tente outro cartão ou pague por Pix."
  );
}

function publicCardPaymentDiagnostic(payment = {}, authorizedPayment = {}) {
  const nested = authorizedPayment?.payment || {};
  const status = String(payment.status || nested.status || "unknown")
      .trim()
      .toLowerCase(),
    statusDetail = normalizeStatusDetail(
      payment.status_detail ||
        nested.status_detail ||
        authorizedPayment.rejection_code ||
        authorizedPayment.status_detail,
    ),
    paymentId = String(payment.id || nested.id || "").trim() || null,
    amount = Number(
      payment.transaction_amount ?? authorizedPayment.transaction_amount,
    );
  return {
    paymentId,
    authorizedPaymentId:
      String(authorizedPayment.id || "").trim() || null,
    status,
    statusDetail,
    paymentMethodId:
      String(
        payment.payment_method_id ||
          nested.payment_method_id ||
          authorizedPayment.payment_method_id ||
          "",
      ).trim() || null,
    paymentTypeId:
      String(payment.payment_type_id || nested.payment_type_id || "").trim() ||
      null,
    issuerId:
      String(payment.issuer_id || nested.issuer_id || "").trim() || null,
    transactionAmount: Number.isFinite(amount) ? amount : null,
    dateCreated:
      payment.date_created || authorizedPayment.date_created || null,
    dateApproved: payment.date_approved || null,
    rejected: status === "rejected",
    message: status === "rejected" ? paymentDeclineMessage(statusDetail) : null,
  };
}

module.exports = {
  normalizeStatusDetail,
  paymentDeclineMessage,
  publicCardPaymentDiagnostic,
};
