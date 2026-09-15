# Pagamentos presenciais VECONI — Fase 1

Versão da aplicação: **138**
Escopo: engine multiadquirente, cadastro de terminais, simulador, checkout, recuperação e recebível mínimo. Nenhuma integração real com adquirente é ativada nesta fase.

## Arquitetura

```text
Vendas / Checkout
        ↓
TerminalPayments (UI e recuperação)
        ↓ callable autenticada
TerminalPaymentService (estado, autorização e idempotência)
        ↓
ProviderRegistry → SimulatorProvider
                 → CieloProvider (estrutura, sem endpoints)
                 → futuros MercadoPagoProvider / PagBankProvider
        ↓
Terminal físico ou serviço remoto
```

`Vendas` não conhece adquirentes. Ela entrega um rascunho estável da venda e o valor em centavos à engine. A engine escolhe o provider pelo terminal salvo, valida capabilities e só devolve uma venda aprovada para a finalização idempotente existente.

## Contrato dos providers

Todo provider implementa:

- `createPayment`
- `getPaymentStatus`
- `cancelPayment`
- `refundPayment`
- `handleWebhook`
- `pairTerminal`
- `listTerminals`
- `healthCheck`

Providers com envio remoto também podem implementar `dispatchPayment`. O registro rejeita implementações que não cumpram o contrato comum. `CieloProvider` é deliberadamente um esqueleto `not_configured`: nenhum endpoint, credencial ou comportamento da Cielo foi inventado.

## Estados internos

| Estado | Significado | Venda |
| --- | --- | --- |
| `created` | tentativa persistida | `payment_pending` |
| `awaiting_terminal` | pronta para o terminal | `payment_pending` |
| `processing` | cobrança em processamento | `payment_pending` |
| `pending_confirmation` | timeout ou resultado ainda inconclusivo | `payment_pending` |
| `approved` | cobrança confirmada | finaliza como `paid` uma única vez |
| `declined` | não aprovada | `payment_failed`; carrinho preservado |
| `cancelled` | cancelada antes da aprovação | `cancelled` |
| `expired` | tentativa expirada | `payment_failed` |
| `error` | falha operacional | `payment_failed` |
| `refunded` | estorno simulado/confirmado | exige reversão operacional da venda |

`pending_confirmation` é proposital: timeout não é recusa. A interface nunca dispara uma nova cobrança automaticamente nesse estado; oferece consulta explícita ou cancelamento quando a capability permitir.

## Esquemas Firestore

Todos os documentos vivem sob `businesses/{businessId}` e repetem `businessId` para validação e auditoria.

### `paymentIntents/{intentId}`

Campos públicos seguros:

```text
id, businessId, saleId, terminalId, terminalNickname, provider,
amountCents, currency, paymentMethod, installments, status, saleStatus,
idempotencyKey, providerPaymentId, providerOrderId, createdByUid,
createdAt, updatedAt, approvedAt, failureReason, capabilities,
finalizationOperationId, finalizationStatus, finalizedSaleId
```

O backend também guarda o snapshot mínimo `saleDraft`, hash do pedido, leases de processamento/finalização e ator. A subcoleção `events` registra transições relevantes com origem, data, uid, nome e role quando disponíveis.

### `paymentTerminals/{terminalId}`

```text
id, businessId, provider, nickname, externalTerminalId, model, serial,
merchantId, status, isDefault, capabilities, createdByUid,
createdAt, updatedAt, archivedAt
```

Capabilities suportadas nesta base: crédito, débito, Pix no terminal, parcelamento, limite de parcelas, cancelamento, estorno e pagamento remoto.

### `paymentReceivables/{paymentIntentId}`

```text
id, businessId, paymentIntentId, saleId, grossAmountCents, currency,
provider, terminalId, terminalNickname, status, feeStatus,
feeAmountCents, netAmountCents, expectedSettlement, settledAt,
createdByUid, createdAt, updatedAt
```

Na Fase 1 o recebível nasce como `pending_settlement`, com taxa e data esperada desconhecidas. A venda no cartão presencial não aumenta imediatamente o saldo de nenhuma conta bancária.

`paymentProviderConfigs/{provider}` fica reservado a metadados seguros de configuração. Segredos reais deverão entrar por Secret Manager/configuração exclusiva do backend, nunca em documentos legíveis pelo cliente.

## Idempotência e concorrência

- O cliente usa uma chave estável derivada do ID da venda.
- O ID do intent é determinístico a partir de `businessId + idempotencyKey`.
- A transação compara um hash de todo o pedido; replay igual reutiliza o intent, replay com dados diferentes falha.
- O envio ao terminal usa lease transacional para impedir duplo despacho por toques concorrentes.
- A aprovação precisa adquirir um claim de finalização com token hash e lease de 60 segundos.
- A venda recebe `finalizationOperationId`; o mecanismo `processedOperations` já existente impede repetir venda, estoque, cliente e campanhas.
- A confirmação final cria o recebível na mesma transação que encerra o intent.
- Eventos repetidos, refresh ou dois dispositivos convergem para a mesma venda e o mesmo recebível.

## Recuperação e performance

A interface acompanha somente o documento exato do pagamento ativo e remove o listener ao concluir. Não existe listener global nem polling por segundo. Ao autenticar, reconectar ou recarregar, uma callable busca somente intents marcados como ativos do usuário na empresa atual. Ela retoma o envio seguro ou a finalização já aprovada, sem criar outra cobrança.

Troca de empresa ou encerramento de sessão remove listener, token temporário de claim e todo o estado em memória. Terminais, intents e credenciais não são cacheados em `localStorage`.

## Segurança

- Todas as operações passam por callable autenticada e contexto de empresa validado no backend.
- Owner/admin gerenciam terminais e estornos; owner/admin/manager/cashier operam pagamentos.
- O simulador só é liberado no Emulator, por flag segura de servidor ou para a empresa interna no plano interno.
- Rules permitem apenas leitura compatível com a empresa; todas as escritas de intent, terminal, eventos, configuração e recebível são backend-only.
- O frontend nunca recebe segredo de adquirente.
- Nenhum PAN, CVV, senha, track data ou formulário de cartão existe na aplicação.

## Integração com a venda

Dinheiro, Pix manual e fiado mantêm o fluxo anterior. Em “Cartão na maquininha”, o checkout valida carrinho/estoque, cria o intent e só chama `Vendas.registrar` após `approved`. Recusa, erro ou cancelamento preservam o carrinho. A finalização aprovada reutiliza os mesmos efeitos de estoque, cliente, campanhas, histórico e recibo, protegidos pelo operation ID.

Histórico e recibo mostram forma de pagamento, provider, terminal, crédito/débito, parcelas e identificador seguro da transação. Nenhum dado do cartão é persistido.

## Simulador

O `SimulatorProvider` percorre o mesmo serviço, callables, persistência, listener e finalização do fluxo real. Ele simula aprovação, recusa, timeout inconclusivo, erro, cancelamento e estorno. Crédito, débito e parcelamento até 12 vezes são anunciados pelas capabilities do terminal.

## Verificação

Comandos de aceite:

```text
npm test
npm test --prefix functions
npm run test:emulator
npm run test:functions-emulator
npm run test:terminal-payments-browser
npm run lint
npm run build
git diff --check
```

As evidências responsivas ficam em `docs/screenshots/terminal-payments-v138/`, cobrindo 360, 375, 390, 412 e 430 px, além de desktop.
