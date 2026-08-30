'use strict';

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeBillingPayerEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw Object.assign(
      Error('Informe um e-mail válido da pessoa que fará o pagamento.'),
      { code: 'invalid-billing-payer-email' },
    );
  }
  return email;
}

function providerIndicatesPayerEmailMismatch(diagnostic = {}) {
  const text = [
    diagnostic.providerErrorCode,
    diagnostic.providerMessage,
    diagnostic.providerStatusDetail,
    ...(diagnostic.providerCauses || []).flatMap((cause) => [cause.code, cause.message]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/subscription[-_ ]invalid[-_ ]user/.test(text)) return true;
  const mentionsIdentity = /payer|pagador|e-?mail|email|user|usu[aá]rio/.test(text);
  const mentionsMismatch = /invalid|inv[aá]lid|mismatch|different|diferente|correspond/.test(text);
  return mentionsIdentity && mentionsMismatch;
}

module.exports = {
  MAX_EMAIL_LENGTH,
  normalizeBillingPayerEmail,
  providerIndicatesPayerEmailMismatch,
};
