# Mercado Pago — relatório técnico de aprovação

Gerado para suporte técnico do Mercado Pago. Este arquivo não contém Access Token, Public Key completa, número completo do cartão, CVV, CPF, endereço ou telefone.

## Resumo

Três assinaturas recorrentes distintas do plano Premium foram confirmadas pelo comprador no checkout hospedado e recusadas pelo antifraude do Mercado Pago com o mesmo detalhe: `cc_rejected_high_risk`.

| Operação/Payment | Preapproval | Authorized payment | Data do provider | Valor | Método | Resultado |
|---|---|---|---|---:|---|---|
| `175359087983` | `a70fe10da2cd403780c95b08037d807d` | `7031380329` | tentativa anterior auditada | R$ 51,94 | Visa crédito, emissor 25 | `rejected / cc_rejected_high_risk` |
| `176318686130` | `35d5192b18e04ad88340c939dffd476d` | `7031381578` | tentativa anterior auditada | R$ 51,94 | Visa crédito, emissor 25 | `rejected / cc_rejected_high_risk` |
| `176600506714` | `3d555b9bb4184e15a08fd04aac42960c` | `7031415869` | 2026-08-31 19:50:59 -04 | R$ 50,34 | Visa crédito, emissor 25 | `rejected / cc_rejected_high_risk` |

A última operação foi atualizada pelo provider em 2026-08-31 19:51:02 -04. As três operações usam o mesmo payer e o mesmo fingerprint mascarado do cartão, porém possuem preapprovals, authorized payments, external references, checkout attempts e chaves de idempotência distintos. Não foi encontrada duplicação causada por um único clique.

## Identificação da integração

- Seller/collector account ID: `1201319471`
- Application ID: `4053098777156528`
- Nome da aplicação: `Adi Festa SaaS`
- Ambiente: produção
- Identificação comercial retornada pela conta vendedora: `Taxpress 03`
- Soft descriptor observado: `TAXPRESS`

O item cobrado foi identificado como `Adi Festa Controle - Premium`. O vínculo do plano é feito por `checkoutAttemptId`, `businessId` e `external_reference`, nunca pelo e-mail do pagador.

## Correlação da operação mais recente

- Payment/operation: `176600506714`
- Preapproval: `3d555b9bb4184e15a08fd04aac42960c`
- Authorized payment: `7031415869`
- Checkout attempt interno: `bd9a2b0d-7e17-41cb-b785-439a99f38dcc`
- Business: `biz_WWyiExJw9INyUjElqsIo28ozS403`
- Plano: `premium`
- External reference: inicia por `billing_` e é um hash determinístico do business/attempt; o valor integral permanece nos registros internos e não é incluído neste relatório público.

## Estado interno após a recusa

- tentativa: terminal/rejeitada;
- motivo: `cc_rejected_high_risk`;
- plano pago ativado: não;
- pendência atual dessa empresa: zero;
- reserva do cupom: liberada, sem consumo;
- histórico: preservado.

A reconciliação imediata da última tentativa ocorreu no retorno do checkout (`checkout_return`). Não foi localizado evento correspondente em `webhookEvents` para nenhuma das três preapprovals. A auditoria do painel encontrou a causa de infraestrutura: no modo de produção, a URL global de Webhooks estava vazia e o evento `Order (Mercado Pago)` estava desmarcado; apenas o modo de teste possuía URL. O código também envia `notification_url` por operação, e o job periódico permanece apenas como contingência.

## Sinais antifraude e nova rota oficial

A integração passou a coletar o Device ID oficial (`MP_DEVICE_SESSION_ID`) e a enviá-lo no header `X-meli-session-id`. Para clientes cuja cobrança recorrente continue recusada, foi criada uma rota separada de cartão mensal:

- Card Payment Brick oficial para tokenização no navegador;
- backend recebe somente token, meio, emissor, parcelas e identificação quando fornecida pelo Brick;
- Orders API com `transaction_security.validation = on_fraud_risk`;
- `liability_shift = required`;
- challenge 3DS tratado como `action_required / pending_challenge`;
- ativação de exatamente um período somente após `processed / accredited`;
- idempotência por operação, verificação de valor/referência/moeda/método e isolamento por business.

Essa rota não contorna o antifraude. Ela permite que o emissor autentique o titular por 3DS quando o Mercado Pago solicitar.

## Solicitação ao suporte Mercado Pago

Solicitamos a análise dos três pagamentos acima e da configuração da conta/aplicação, com atenção para:

1. motivo concreto da recorrência de `cc_rejected_high_risk` para o mesmo payer/cartão;
2. disponibilidade de 3DS para Orders/Checkout Transparente nessa conta;
3. recebimento dos webhooks de assinaturas e Orders na aplicação;
4. eventuais restrições, revisões de compliance ou limitações de cartão na conta seller;
5. confirmação de que a aplicação de produção está habilitada para os produtos usados.

## Branding “Taxpress 03”

O texto vem da identidade comercial da conta vendedora, não do campo `reason` da assinatura. Para alterar o que o comprador reconhece, revisar no painel da conta Mercado Pago os dados do negócio/personalização do checkout e o nome/soft descriptor, e revisar no painel Developers os dados da aplicação. A mudança deve ser feita no cadastro oficial da conta, não por substituição artificial no payload.

## Referências oficiais usadas na implementação

- Device ID em Assinaturas: https://www.mercadopago.com.br/developers/en/docs/subscriptions/how-tos/improve-payment-approval/recommendations
- Orders com 3DS: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/integrate-3ds
- Card Payment Brick: https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/card-payment-brick/default-rendering
- Webhooks: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
