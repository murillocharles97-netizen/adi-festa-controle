# Assinaturas com Mercado Pago

O backend de assinaturas usa Cloud Functions e mantém o Firestore como a única fonte de estado para o aplicativo. O frontend nunca recebe tokens e não consulta a API do Mercado Pago.

## Fluxo de produção

1. O proprietário escolhe um plano.
2. `createSubscription` valida usuário, empresa, plano, ciclo e cupom no servidor.
3. Para cartão, retorna a URL oficial da assinatura recorrente (`POST /preapproval`).
4. Para Pix, cria uma Order guest (`POST /v1/orders`) e retorna somente QR Code, Pix Copia e Cola e URL de pagamento. A validade padrão de 24 horas é controlada pelo Mercado Pago, sem `expiration_time` customizado.
5. O Mercado Pago envia uma notificação assinada para `receiveWebhook`.
6. A função valida o HMAC, consulta o objeto oficial no provedor, elimina eventos duplicados e atualiza `businesses/{businessId}.subscription`.
7. O aplicativo lê o novo estado diretamente do Firestore.

`syncSubscription` lê somente o Firestore por padrão. A consulta direta ao Mercado Pago exige `reconcileProvider: true`, permissão de proprietário e respeita intervalo mínimo de 15 minutos. Ela existe apenas para reconciliação excepcional.

## Segredos obrigatórios

Os três valores devem existir no Secret Manager:

- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_ACCESS_TOKEN_TEST`
- `MERCADO_PAGO_WEBHOOK_SECRET`

O último valor é a assinatura secreta exibida ao configurar Webhooks no painel do Mercado Pago. Ele não é o Access Token e não deve ser inventado ou reutilizado.

Para cadastrar o segredo sem gravá-lo no terminal ou no repositório:

```bash
firebase functions:secrets:set MERCADO_PAGO_WEBHOOK_SECRET
```

## Configuração do webhook

No painel da aplicação do Mercado Pago, configure a URL:

```text
https://southamerica-east1-adi-festa-controle.cloudfunctions.net/receiveWebhook
```

Habilite notificações de Orders, assinaturas/preapproval e pagamentos de assinaturas. A URL é configurada no painel. Orders Pix são sempre consultadas novamente pelo backend antes de qualquer ativação.

## Funções

- `createSubscription`: cria assinatura recorrente por cartão ou Order Pix guest com preço recalculado pelo backend.
- `getPixCheckoutStatus`: lê uma tentativa exata e permite reconciliação manual limitada.
- `cancelSubscription`: cancela no provedor e atualiza o Firestore.
- `receiveWebhook`: valida assinatura, processa cada evento uma vez e atualiza a empresa pelo índice exato da assinatura.
- `syncSubscription`: leitura do Firestore ou reconciliação manual limitada.
- `expireSubscriptionsDaily`: encerra trials e assinaturas vencidas diariamente.
- `initializeBusinessTrial`: garante o trial de sete dias em novas empresas que ainda não possuam assinatura.

## Modelo de dados

O projeto usa o caminho multiempresa já existente `businesses/{businessId}`. Os aliases externos `starter` e `pro` são normalizados para os IDs canônicos atuais `essential` e `professional`.

Documentos auxiliares privados:

- `subscriptionIndex/{subscriptionId}`: resolve a empresa por leitura direta, sem varrer coleções.
- `businesses/{businessId}/subscriptionIntents/{subscriptionId}`: registra a intenção de checkout.
- `businesses/{businessId}/billingCheckoutAttempts/{operationId}`: tentativa Pix visível somente ao proprietário que a criou.
- `billingOrderIndex/{orderId}`: resolve uma Order Pix por leitura direta e é inacessível pelo cliente.
- `billingPaymentEvents/pix_{orderId}`: marcador idempotente que impede adicionar dois períodos para a mesma Order.
- `webhookEvents/{eventId}`: idempotência, lease de processamento e auditoria técnica.

As regras negam leitura e escrita desses índices pelo cliente. Somente o proprietário pode ler sua tentativa Pix por ID exato; toda gravação financeira é exclusiva do Admin SDK.

## Testes e deploy

```bash
cd functions
npm test
cd ..
firebase deploy --only functions,firestore:rules,firestore:indexes
```

Antes do primeiro pagamento real, confirme no painel do Mercado Pago que o webhook foi validado e faça uma assinatura de teste usando credenciais de teste. Não ative checkout de produção sem o webhook operacional.

Cartão permanece uma assinatura recorrente de provedor. Pix é uma cobrança pontual manual: aprovação adiciona exatamente um período ao entitlement existente; pagamento antecipado parte do fim do período atual e pagamento após vencimento parte da aprovação.
