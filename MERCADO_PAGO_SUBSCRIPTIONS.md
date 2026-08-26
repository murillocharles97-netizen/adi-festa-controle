# Assinaturas Mercado Pago

## Decisão de arquitetura

O Adi Festa separa entitlement de estratégia de cobrança. O plano, o período de acesso e o cupom pertencem ao Adi Festa; o Mercado Pago processa, confirma e concilia o pagamento.

- **Cartão:** assinatura recorrente gerenciada pelo provedor com `POST /preapproval`.
- **Pix mensal/anual:** pagamento manual guest pelo Checkout Transparente / Orders API com `POST /v1/orders`.

O fluxo anterior de Pix criava `preapproval_plan` e abria seu `init_point`. Na experiência real, esse checkout solicitava login ou criação de conta Mercado Pago. Não havia `purpose=wallet_purchase` no código; a restrição vinha do produto de assinatura hospedado escolhido. A Orders API foi adotada porque devolve diretamente `qr_code`, `qr_code_base64` e `ticket_url`, permitindo pagar pelo aplicativo de qualquer banco sem autenticar o pagador na carteira Mercado Pago.

Referências oficiais:

- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/overview
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview

## Pix guest

1. O navegador envia somente `businessId`, `planId`, `billingCycle`, `quoteId`, `paymentMethodType` e `operationId`.
2. `createSubscription` autentica o proprietário e recalcula plano, preço e cupom.
3. O backend cria `POST https://api.mercadopago.com/v1/orders` com `type=online`, moeda BRL, `payment_method.id=pix`, `payment_method.type=bank_transfer` e `X-Idempotency-Key=operationId`.
4. A UI mostra QR Code e Pix Copia e Cola dentro do Adi Festa. Criar o QR mantém a assinatura atual/trial e nunca libera plano.
5. O webhook assinado recebe `type=order`, consulta `GET /v1/orders/{orderId}` e valida ID, referência externa, valor, moeda e meio de pagamento.
6. Somente `processed/accredited` ativa ou renova o plano.
7. O marcador determinístico `billingPaymentEvents/pix_{orderId}` impede que a mesma Order adicione dois períodos.
8. Status terminal remove QR/Copia e Cola, libera reserva de cupom e permite gerar uma nova tentativa.

Não é chamado de Pix Automático: a próxima renovação exige uma nova cobrança e pagamento manual. Uma renovação antecipada parte do fim do período vigente; uma renovação após vencimento parte da data do novo pagamento.

## Cupom

- O backend revalida cotação, vigência, plano, ciclo e elegibilidade.
- A Order usa o valor final calculado no servidor.
- A tentativa guarda snapshot de preço original, desconto, total e cupom.
- Gerar QR apenas reserva o cupom.
- Aprovação confirma o uso; expiração/cancelamento libera a reserva.

## Dados e segurança

- `businesses/{businessId}/billingCheckoutAttempts/{operationId}`: tentativa e QR transitórios.
- `billingOrderIndex/{orderId}`: índice backend-only para localizar a empresa sem consulta ampla.
- `billingPaymentEvents/pix_{orderId}`: idempotência financeira backend-only.
- `webhookEvents/{eventId}`: lease e idempotência da entrega.

O proprietário lê somente a tentativa exata criada por seu UID. O navegador não grava tentativas, índices ou eventos. QR, base64 e ticket são apagados após aprovação ou estado terminal; nenhum arquivo é criado no Storage. Access Tokens e segredo HMAC ficam exclusivamente no Secret Manager.

## Interface e custo

A tela observa somente `businesses/{businessId}/billingCheckoutAttempts/{operationId}` enquanto o modal estiver aberto. Não existe listener global nem polling por segundo. A conferência manual ao provedor é limitada a uma vez por minuto; a reconciliação geral, a cada 15 minutos.

## Validação

Os testes usam mocks e Firebase Emulator Suite: payload Orders, valor com cupom, QR pendente sem ativação, aprovação, webhook duplicado, expiração, isolamento multiempresa, trial, plano interno e regressão do cartão. Nenhum pagamento real é disparado automaticamente durante QA.
