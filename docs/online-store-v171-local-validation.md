# Loja Online V171 — correções e validação local

Data: 15/10/2026. Resultado: **pronto para V171 como candidata a deploy controlado; piloto real ainda não liberado**.

Nenhum deploy/push, acesso administrativo à produção, reprocessamento financeiro ou limpeza de dados reais foi executado nesta etapa. APP_VERSION/SW/cache permanecem V170; a atualização para V171 será feita na preparação da publicação autorizada.

## Base e rollback

- Base V170: `5ff8f898b9f6fa559b92a5a2b7ab7cbd011be080`.
- Rollback adicional V169: `e59b290b31d893e58f11b4ef40fe3bd4b77a26f9` (`rollback/v169-before-v170`).
- Trabalho isolado em `codex/online-store-v2-no-legacy`, worktree `domain-release`; checkout original preservado.
- Rollback de código não desfaz vendas/pedidos. Não excluir reserva, fila ou evidências QA ao voltar uma versão.

## 1. Conclusão de variação

Causa principal: `enrich(productVariants)` removia `onlineOrderFinalizationId` e `onlineReservedStock`, necessários para a transação comprovar nas Rules que a baixa usa a reserva daquele pedido. A operação era negada, sem confirmação da venda.

O teste do executor real revelou também atualizações indevidas em patches só de estoque: nome normalizado vazio, tokens de busca, controle de estoque default, troca de owner/schema, reordenação dos tokens do pai conforme a ordem da consulta de variações e criação de `onlineReservedStock:0` no pai que não possuía esse campo. Operadores sem `products.edit` corretamente não podem alterar esses metadados.

Correção:

- Preservar o comprovante da reserva no serializador, mantendo a allowlist.
- Derivar índices/defaults somente quando seus campos de origem vierem no patch.
- Não trocar owner/schema em merge de catálogo.
- Recomputação `stockOnly` nas vendas/desfazer/ajustes: apenas estoque, disponibilidade e updatedAt; edição normal de catálogo mantém sua recomputação completa.
- Não inventar reserva no pai; respeitar o local canônico da reserva (produto simples ou variação).
- A mesma transação continua validando claim, ator, venda, itens, valores, espaço, reserva e processedOperations nas Rules.
- Para claims online, não consultar resolução financeira legada nem tentar ler antecipadamente um receipt inexistente inacessível ao operador. A idempotência continua baseada na venda e em processedOperations, atomicamente.
- As Rules apenas reutilizam o resultado de membership/permissões em três helpers, evitando o limite de avaliação. Nenhuma permissão, plano, geração ou condição de estoque foi removida.

## 2. Auth/bootstrap/Sync

Causa: `allowed()` iniciava o novo Sync com `setUser()` e depois `registerCleanup('firebase-sync', ...)` executava o cleanup anterior, cujo `stop()` encerrava justamente a nova sessão. O cleanup do badge também fechava a assinatura nova por usar uma variável mutável.

Correção: executar os cleanups anteriores antes de iniciar os substitutos; capturar o unsubscribe exato; invalidar o handler antes de invocá-lo; validar o token/sequence do bootstrap após a abertura assíncrona do IndexedDB e no callback de montagem da UI. Bootstrap cancelado não vira um falso modo degradado.

## 3. Movimentações de estoque por espaço

Causa: produtores canônicos registravam produto/venda/ator, mas não spaceId, enquanto a consulta e Rules dos operadores exigem esse escopo. Produtos compartilhados não permitem inferir um espaço global.

Correção:

- Venda e desfazer registram businessId + espaço original da venda em cada movimentação.
- `diffWrites` valida/atribui origem somente a movimentações NOVAS antes da persistência da fila/projeção; cobre entradas, ajustes e demais produtores existentes.
- Resolver apenas um espaço autorizado, da mesma empresa, com capabilities de produto/estoque, compatível com o produto. Seleção agregada/ambígua falha fechada; nenhum fallback fixo.
- Histórico antigo não é reescrito; owner continua lendo registros antigos. Operador recebe somente consultas filtradas por seus espaços, sem liberar histórico sem escopo.
- Exceção de compatibilidade de payload, não de Rules: fila online V170 sem spaceId recupera-o do claim autenticado já persistido pelo backend, validando produto/variação/venda. Nunca da seleção atual da UI; payload explícito conflitante é rejeitado. A fila original permanece inalterada durante upload.

## Testes automatizados

| Execução | Resultado |
| --- | --- |
| `npm test` | 674/674 |
| `npm --prefix functions test` | 140/140 |
| `npm run test:emulator` — Auth/Firestore/Storage e Rules | 181/181 |
| Reexecução final `v171-online-order-sync.rules.test.js` | 9/9 |
| lint app/backend, build, git diff --check | sem erros |

Os 9 testes novos usam Vendas, ProductVariations, diffWrites, serializador, WorkspaceWriter e commitQueueItem reais, SDK autenticado e Rules reais no Emulator; não um uploader alternativo. Fixtures exclusivamente sintéticas.

Comprovado: simples/variação; upload concorrente/retry da mesma operação; reserva consumida uma vez; disponibilidade pública; operador restrito; leitura scoped e negação de query global/outro espaço; histórico antigo legível pelo owner; tentativa de mudar preço negada; marcador ausente negado atomicamente sem venda/baixa parcial; scope conflitante negado. Suíte existente cobre cancelamento, concorrência da última unidade, expiração de 30 minutos e confirmação sem expiração.

Novos testes unitários executam o código real de Auth/cleanup/serialização: bootstrap consecutivo, cancelamento enquanto IndexedDB abre, timer obsoleto e callback reentrante. Não há API ou SDK novo de pagamento.

## Smoke visual integrado — exclusivamente local

Projeto `demo-veconi-online-qa`; app `http://127.0.0.1:8188`; Auth/Firestore/Functions/Storage em loopback. Dois espaços: VECONI QA e VECONI QA — isolamento.

- Logout/login com usuário fictício: passou.
- Rebootstrap por revalidação de sessão, seguido de Sync: passou.
- Pausa/reconexão do SDK Firestore, seguido de Sync: passou.
- Reload com service worker local controlando página e cache IndexedDB: passou; sessão autorizada e fila 0/0.
- Troca A → B → A: pedidos A não aparecem em B; estados preservados.
- Retomar conclusão visual de variação pendente: passou.
- Cancelamento visual em duas etapas: passou; reserva liberada, nenhuma venda de cancelamento.
- Responsividade local em 390px: sem overflow horizontal. Isto NÃO comprova Android físico/PWA instalado.

### Evidência sintética do smoke

- Produto usado: `qa-v171-variation-1792091594471`, exclusivamente no Emulator.
- Estoque inicial: vermelho 2 + azul 1 = 3; reservas de dois pedidos de 1 vermelho cada.
- Pedido retomado: `6790b70a-96a8-4631-993e-37e68e2674c7` → entregue/completed/consumed.
- Venda única: `online_6790b70a-96a8-4631-993e-37e68e2674c7`.
- Receipt único: `e147ebe8-b9f7-45e8-a5f5-a42999940130`, quantidade -1, businessId e spaceId explícitos.
- Pedido cancelado: `eaea5255-2d58-40b9-b333-8a21a8edfc07` → cancelado/released, sem venda.
- Estoque final: vermelho 1 + azul 1 = 2; reserva 0. Sem duplicação ou baixa no cancelamento.
- Um produto sintético adicional, `qa-v171-variation-1792091569271`, foi criado pela primeira tentativa do harness, antes de ele detectar um campo incorreto de publicação. Permaneceu sem pedido/venda; não foi apagado nem reutilizado. Não é dado de produção.
- Screenshots e logs locais em `artifacts/v171-*` (não publicados).

## Recuperação do pedido QA da V170 em produção

Pedido preservado: `38c34218-1df7-48cf-a8fe-cd02b42ff9fe`, empresa `adi-festa`, espaço QA A `3488517b-872d-4836-9796-aa488c1437f1`.

**Não recuperado nesta etapa**, pois isso exigiria gravação em produção e o deploy ainda está proibido. Fila/reserva/evidências existentes não foram alteradas.

O teste equivalente de fila V170 passou: mesmo operationId, mesmo saleId, receipt sem spaceId preenchido somente pelo claim e upload/retry idempotente, sem recriar o pedido. Portanto há caminho seguro de recuperação após deploy, condicionado a revalidar a mesma fila, ator, geração e reserva no ambiente real.

Após publicação autorizada: atualizar o dispositivo que preserva a fila, confirmar claim/reserva/venda/processedOperations, executar Retomar conclusão (flush forçado da fila existente), confirmar uma única venda/receipt e acknowledge da reserva. Não limpar cache nem criar venda manual substituta. Se qualquer estado estiver divergente, parar para revisão.

A entrada histórica financeira de R$25,00 não foi alterada/excluída nem reprocessada. Nenhum dado real, Auth, assinatura, Financeiro ou loja real foi modificado.

## Arquivos da correção

- `js/firebase/sync.js`
- `js/firebase/auth.js`
- `js/firebase/session-lifecycle.js`
- `js/product-variations.js`
- `js/vendas.js`
- `js/spaces.js`
- `firestore.rules`
- `tests/global-spaces-v1.test.js`
- `tests/v171-online-order-recovery.test.js`
- `tests/emulator/v171-online-order-sync.rules.test.js`
- Este relatório.

Ferramentas QA locais auxiliares: `scripts/smoke-v171-local-recovery.cjs` e `tests/fixtures/online-store-integrated-controls.js` (guardas explícitas de host/projeto Emulator; não incluídas no app de produção).

## Próxima etapa obrigatória

Novo smoke controlado em nuvem após deploy explicitamente autorizado, incluindo Rules + app V171 no mesmo release, retomada do pedido QA V170 com fila preservada, operador restrito, variações, Sync/reload, disponibilidade pública, Scheduler e Android físico. Nenhum piloto real deve ser liberado com base apenas nesta validação local.
