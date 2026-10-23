# V170 — publicação controlada por espaço

Autorizada em 15/10/2026. Produção: https://veconi.app.br/.
Código funcional aprovado: `4afed246f2ed1b889477175ce8958417920baeed`.

## Rollback e segurança

Base preservada: V169, `b5c1aed4066c569d2665ad43749ecffd934b9f86`.
Tag local `rollback/v169-before-v170` aponta exatamente para essa base.
Frontend pode voltar ao artefato V169 pelo workflow Pages existente, sem apagar dados.
Não reativar catálogo global nem restaurar cegamente Rules/checkout/financeiro antigos:
o código antigo pode misturar espaços e encaminhar receita QA ao espaço global.
Em caso de falha, pausar APENAS o checkout QA envolvido e preservar pedidos,
reservas, expiração e recuperação. Não apagar entradas/vendas para simular rollback.

Não há migração de dados nem ativação automática de loja. Sem limpeza adicional de
legado nesta publicação; histórico preservado, somente leitura. Domínio/DNS/CNAME,
Firebase Auth, Storage, planos, assinaturas, Mercado Pago e webhook não são alterados.
Entrada histórica R$25 é protegida por hash antes/depois, sem estorno ou reclassificação.

## Conteúdo e atualização PWA

Loja V2 por espaço, isolamento de catálogo/pedidos, fluxo canônico de venda,
reserva transacional, cancelamento e liberação idempotentes, expiração de Novo em
30 minutos, projeção pública de disponibilidade, Sync/cache e financeiro por origem.
Financeiro desabilitado implica zero receita automática. Não reprocessar histórico.

Release visível 170; service worker `veconi-v170-online-store-scoped-finance`.
Mantido fluxo de atualização `SKIP_WAITING`/GET_VERSION e escopo relativo na raiz.
Somente caches VECONI/Adi Festa obsoletos são substituídos pelo mecanismo existente;
não há limpeza de IndexedDB/localStorage/queue/dados ou origin inteira.

## Publicação backend mínima

Firestore Rules; getOnlineStore/saveOnlineStore; submitCatalogOrder e
identifyCatalogCustomer (recusa legado); status/claim/ack V2; expiração existente;
projectOnlineProductAvailability/projectOnlineVariantAvailability;
projectSaleFinancialIncome/projectCustomerPaymentFinancialIncome;
reconcileBusinessFinancialIncome (impede backfill antigo mesmo em PWA desatualizado).
Política de reset reconhece a nova coleção operacional de recibos financeiros;
nenhum reset é invocado pelo deploy/smoke. Demais endpoints de cobrança/Auth não são publicados.
Índices/Storage Rules não mudam em relação à V169.

Scheduler já existente: every 1 minutes, uma instância, expiração em lotes limitados.
Não criar job nem aumentar frequência. Observar reserva QA durante 30 minutos reais,
sem alterar timestamps e sem executar varredura global manual.

## Escopo do smoke

Empresa `adi-festa`, owner já autenticado, somente:

- VECONI QA: `3488517b-872d-4836-9796-aa488c1437f1`.
- VECONI QA — isolamento: `b746fc80-3ed8-4092-b07f-860e689cd93f`.

Produtos fictícios novos, identificados QA V170; nenhuma alteração de produto real.
Publicar manualmente apenas essas duas lojas. Antes de publicar seleção, remover
da seleção do rascunho QA os produtos reais que ela continha, SEM editar seus cadastros.
Para cenário financeiro ativo, habilitar temporariamente Financeiro/automação apenas
em QA, sem conta bancária real, e depois restaurar as configurações anteriores.
Pedidos/vendas/lançamentos QA serão inventariados, não apagados silenciosamente.

## Evidências

Testes: app, backend, Firestore/Auth/Storage Emulator, lint, build e diff --check.
Logs e inventários locais em `artifacts/v170-release` e `artifacts/v170-*-tests.txt`.
Auditoria antes/depois usa metadados/hash/updateTime; nunca token ou conteúdo sensível.
Resultado final de produção, IDs QA e limitações serão registrados separadamente.
Android/PWA físico não deve ser declarado aprovado por teste desktop responsivo.
