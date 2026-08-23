# Assinaturas Mercado Pago

## Decisão de produto

O Adi Festa usa a API de Assinaturas do Mercado Pago. O backend calcula o plano, a periodicidade e o cupom; o navegador envia somente identificadores. O retorno do checkout nunca libera acesso. A fonte de verdade financeira é o objeto consultado no Mercado Pago após um webhook válido.

Não existe, na documentação pública atual usada nesta integração, um identificador oficial de API para **Pix Automático** em `preapproval`. Por isso a interface não promete autorização bancária automática. A opção sem cartão é apresentada como **Pix mensal** (ou Pix por período no plano anual).

## Fluxo de cartão preservado

1. O backend valida empresa, usuário, plano, ciclo e cupom.
2. Cria uma assinatura pendente com `POST /preapproval`, sem plano associado.
3. O cliente escolhe e conclui o meio de pagamento no checkout hospedado.
4. `subscription_preapproval`, `subscription_authorized_payment` e `payment` são validados pelo webhook.
5. Somente o status confirmado pelo provedor atualiza o acesso no Firestore.

Assinantes existentes por cartão não são migrados nem alterados.

## Fluxo de Pix mensal

1. O backend valida os mesmos dados e recalcula o valor final.
2. Cria um `preapproval_plan` dedicado à tentativa, com `payment_methods_allowed` limitado a `bank_transfer`/`pix`.
3. O checkout usado é o `init_point` oficial desse plano.
4. `subscriptionPlanIndex/{providerPlanId}` relaciona o plano dedicado com empresa, usuário, plano Adi Festa, periodicidade e snapshot do cupom.
5. Quando o Mercado Pago cria a assinatura, o webhook usa `preapproval_plan_id` para criar `subscriptionIndex/{subscriptionId}` e aplicar o status oficial.
6. Pagamentos pendentes ou rejeitados não ativam o plano e não avançam ciclos de desconto.

O identificador interno é `pix_monthly`. Ele não representa uma chave Pix e não é enviado como `payment_method_id` arbitrário. Os identificadores oficiais usados no plano do provedor são `bank_transfer` e `pix`.

## Cupons

- A cotação é criada e reservada no backend.
- Abrir o checkout não confirma o uso.
- O valor original e o valor descontado ficam no snapshot da intenção.
- O resgate só é confirmado quando o provedor confirma a assinatura/pagamento.
- Cupons de primeira cobrança ou quantidade de ciclos continuam usando a restauração de valor já existente.

## Idempotência

Cada checkout possui `operationId` e um documento em `businesses/{businessId}/billingCheckoutAttempts/{operationId}`. A primeira execução adquire um lease curto; uma repetição simultânea não cria outra tentativa. Uma repetição de uma tentativa concluída reutiliza o mesmo checkout.

Webhooks usam `webhookEvents/{eventId}` e lease transacional. Eventos de pagamento também possuem marcador próprio, impedindo atualização duplicada de cupom ou status.

## Estados internos relevantes

- `trialing`: teste ainda válido, mesmo que exista checkout pendente.
- `pending`: checkout criado, aguardando confirmação.
- `active`: provedor confirmou assinatura autorizada.
- `payment_pending`: cobrança Pix de uma assinatura já ativa ainda não foi aprovada; acesso fica em modo leitura.
- `past_due`, `paused`, `canceled`, `expired`: mantêm os dados e seguem as regras de leitura existentes.
- `internal`: conta interna, fora do billing.

## Webhooks

Eventos aceitos:

- `subscription_preapproval`: consulta `/preapproval/{id}`.
- `subscription_authorized_payment`: consulta `/authorized_payments/{id}` e considera sucesso somente quando `payment.status === "approved"`.
- `payment`: consulta `/v1/payments/{id}` e considera sucesso somente quando `status === "approved"`.
- `subscription_preapproval_plan`: é informativo e não ativa assinatura.

O HMAC é obrigatório e nenhum token, segredo ou dado bancário é persistido no frontend.

## Segredos e ambientes

- `MERCADO_PAGO_ACCESS_TOKEN`: credencial de produção.
- `MERCADO_PAGO_ACCESS_TOKEN_TEST`: credencial de teste enquanto não houver padronização neutra de nomes.
- `MERCADO_PAGO_WEBHOOK_SECRET`: validação HMAC.
- `MERCADO_PAGO_ENV`: seleciona o ambiente server-side.

Nunca registrar valores desses secrets em logs, documentação ou respostas da Function.

## Validação

Testar primeiro com credenciais/test users e mocks. O ambiente de teste auditado não expôs Pix em `/v1/payment_methods`, embora tenha aceitado a configuração `pix`/`bank_transfer` em `preapproval_plan`. A conta brasileira de produção informou Pix ativo, mas pagamentos reais não devem ser automatizados como teste.
