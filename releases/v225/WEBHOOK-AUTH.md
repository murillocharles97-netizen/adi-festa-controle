# V225 — correção isolada da autenticação Orders

Base corretiva: `e07e043f95e42724c2f4b02f72f763b183b53bf7`, branch `codex/v225-billing-hotfix`. Preparação exclusivamente local em 03/11/2026, sem push, deploy, segredo de produção ou transação real.

## Causa e correção

O validador anterior multiplicava todo `ts` por 1000. Um timestamp Unix de 13 dígitos, assinado corretamente, era interpretado como segundos e recusado como fora da janela. A documentação oficial atual de Orders apresenta esse formato de 13 dígitos.

A correção aceita exclusivamente tokens decimais de 10 ou13 dígitos, sem zeros iniciais. Somente a verificação de idade converte segundos para milissegundos. O HMAC continua usando o texto original recebido, inclusive o `ts` de 13 dígitos. Não se tenta uma segunda assinatura com timestamp convertido.

Mantém HMAC-SHA256 e `crypto.timingSafeEqual`, com digest hexadecimal de 64 caracteres validado antes da comparação. A idade máxima permanece 300000ms, inclusive o limite; qualquer timestamp futuro, mesmo 1ms, é recusado. Uma configuração não pode ampliar essa janela ou desativá-la.

`x-signature` deve conter exatamente um `ts` e um `v1`, sem campos extras, duplicados, quebras de linha ou coerção de arrays/objetos. Espaço opcional entre os pares e ordem inversa dos pares são aceitos. `x-request-id` deve ser um token ASCII não vazio e limitado, sem injeção de separadores. Ausência ou formato inválido resulta em 401 antes de consultas ao provedor e ao banco.

O manifesto mantém `id:<data.id em minúsculas>;request-id:<valor original>;ts:<texto original>;`. O identificador usado no GET continua original. A normalização já existente de `data.id` foi preservada; não se adicionou fallback de assinaturas alternativas. IDs numéricos legados no body continuam aceitos. A documentação atual de Orders/SDK não repete todas as notas de normalização das páginas anteriores; as fixtures fixam a convenção documentada de `data.id` e a evidência real do provedor continua necessária antes de declarar autenticação Orders de produção homologada.

## Idempotência e compatibilidade

A autenticação não é, sozinha, um registro de replay. O handler existente mantém lease transacional e estados finais em `webhookEvents`. A identidade do evento não inclui `ts`, portanto mudar de segundos para milissegundos não cria outro evento. A conciliação canônica de pagamento mantém a segunda barreira contra duplicatas, inclusive quando o provedor envia outro request-id. Uma repetição legítima é reconhecida sem reaplicar período ou efeitos.

Os sete corpos de handlers do candidato anterior permanecem idênticos. Somente `functions/src/services/webhook-service.js` muda em produção neste commit corretivo. Não há alterações em criação/cotação de cobrança, guard, frontend, Rules, IAM, OAuth, segredo ou V226. O manifesto completo da V225 segue limitado às sete Functions já previstas. Os dez originais congelados e o manifesto da correção de faturas permanecem intactos; `webhook-auth-hashes.json` registra separadamente este delta.

## Validação local

- 308 testes de unidade/DOM/regressão aprovados, incluindo HMAC independente de 10/13 dígitos, adulteração de token/recurso/request-id/digest, formatos inesperados, limites temporais, cabeçalhos e duplicatas. Inclui os 63 cenários do guard de faturas/retentativas.
- 31 cenários integrados aprovados no Auth/Firestore Emulator. MP é um adaptador sintético que bloqueia chamadas externas não mapeadas. Fixtures Orders válidas chegam somente ao GET e 404 sintético, sem registros persistentes ou efeitos financeiros. Inválidas retornam 401 sem consultas. Duplicatas autenticadas nos dois formatos aplicam um único evento de pagamento sintético.
- 17 regressões legadas de migração no Firestore Emulator e três roteiros de ledger aprovados (Pix, cartão mensal e máquina de estados).
- Lint/build aprovados (780 arquivos JavaScript); pacote público allowlist com 251 arquivos verificados. Frontend permanece byte a byte igual ao candidato anterior.
- Os 31 cenários integrados também passaram no backend empacotado; reexecuções não contam como cenários novos. Rollback conserva o mesmo módulo de autenticação e os bloqueios financeiros.

A primeira execução da suíte legada foi interrompida pelo próprio guard do harness por ausência de `FIRESTORE_EMULATOR_HOST`; foi repetida com loopback 8188, sem mudar o código do produto. Os emuladores existentes foram reutilizados; não houve limpeza ou exportação de dados locais. Uma prova comparativa por VM exigiu injetar `Buffer` no contexto de teste, sem alteração do validador para acomodar o harness.

Não se recebeu uma notificação real Orders nesta rodada. Nenhuma assinatura do painel foi copiada ou comparada com o backend. Nenhum simulador oficial enviou POST à produção. As fixtures usam segredo sintético e não comprovam a correspondência do segredo real ou a entrega do provedor. O recurso oficial “Enviar teste” continua sendo uma possível verificação restrita após autorização e análise de seus efeitos; não exige criar uma cobrança para testar a recepção, mas seu resultado não pode ser presumido.

## Rollback e próxima etapa

O rollback atualizado suspende novos checkouts no servidor/frontend e preserva este validador corrigido, o guard de faturas agendadas, consultas do provedor, webhooks, conciliação, pagamentos pendentes, auditorias, identidades e tolerância administrativa. Não reverte para o validador que recusava13 dígitos, nem para o guard anterior. Não restaura banco ou reexecuta operações.

**GO para novo preflight de leitura.** Isso não autoriza publicação nem contratação/reparação da 3 Lindas. Reconfirmar revisões/main/domínio, hashes, destino/tópicos de webhook, mecanismo de prova da assinatura real e estado atual das cobranças. A retentativa agendada conhecida continua sendo bloqueador independente para criar contrato/reparar reserva enquanto houver risco ou incerteza. Não presumir que passou ou foi cancelada.

Ordem posterior, somente com autorização: `retryLegacyPlanMigrations`, `receiveWebhook`, `getPixCheckoutStatus`, `getCardCheckoutStatus`, `syncSubscription`, `getBillingCheckoutConfig`, `createSubscription`; QA isolada antes de frontend. Usar filtros explícitos e nunca deploy genérico de Functions/Rules. Interromper se assinatura legítima for recusada, estado remoto divergir ou aparecer risco financeiro.

## Fontes oficiais consultadas

- [Orders: cabeçalhos, timestamp de 13 dígitos, autenticação e simulador](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications).
- [Manifesto e HMAC-SHA256 na documentação de notificações](https://www.mercadopago.com.ar/developers/pt/docs/checkout-api-orders/optional-notifications).
- [Nota oficial de normalização alfanumérica de data.id](https://www.mercadopago.com.ar/developers/en/docs/wallet-connect/notifications).

As fontes descrevem o contrato; a comprovação local é identificada como sintética e não como evidência do provedor em produção.
