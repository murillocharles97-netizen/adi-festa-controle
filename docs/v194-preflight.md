# V194 — preflight e pacote para autorização

Data: 22/10/2026, America/Sao_Paulo. Publicação NÃO autorizada nesta etapa. Nenhuma chamada de produção, venda, troca, replay, alteração de permissão, migração ou limpeza de dados foi executada.

## 1. Comparação das falhas globais

O checkout separado `sync-resolved-reviews` permanece no commit publicado V193 `3d9ef19f4b5df7a7534647185bf3a32d042ca065`, sem alterações rastreadas. O mesmo executável Node e o mesmo reporter foram usados nos dois checkouts.

- V193: 931 testes, 897 aprovados, 34 falhas.
- V194 antes de atualizar metadados de release: 1006 testes, 972 aprovados, **as mesmas 34 falhas**, por arquivo + nome. Nenhuma identidade de falha introduzida ou removida.
- V194 empacotada: 1006 testes, 974 aprovados, **32 falhas preexistentes**, nenhuma nova. Duas falhas antigas passaram ao corrigir a divergência entre release do PWA, build e imports singleton. Não se alteraram as expectativas desses dois testes para fazê-los passar.
- Nenhum teste novo de Trocas/crédito/lucro falhou.

Evidências completas com nomes, arquivos, linhas e mensagens: `preflight/v194-before-release-metadata.json` e `preflight/v194-final-test-comparison.json`. Reprodução: `node scripts/v194-preflight.cjs <checkout-V193-intacto> <arquivo-de-saida.json>`. Não declarar a suíte global verde.

Validação direcionada final: **117/117 testes de app/backend e 65/65 cenários Firestore Emulator**, sem falhas ou skips. Inclui domínio de Trocas, crédito parcial, cancelamento da venda futura, idempotência, estoque, permissões, projeção financeira, custos privados, reset e regressão de venda/Sync de seller. Essas contagens são adicionais à comparação da suíte global, não uma alegação de que todos os testes do repositório passam.

Lint e build locais aprovados (406 arquivos JavaScript), `node --check scripts/v194-preflight.cjs` e `git diff --check` aprovados. Nenhum teste novo específico de Trocas foi omitido por skip. O conteúdo de `js/firebase/sync.js`, `js/fiados.js`, `js/storage.js`, `js/business-cache.js` e `firestore.indexes.json` permanece byte-idêntico à V193; nas entradas Auth/UI mudou apenas a URL versionada do mesmo singleton Sync para a V194.

## 2. Custo e lucro: lacuna identificada e fechada

Havia uma janela em que consulta não confirmada/erro devolvia nenhum ajuste e permitia mostrar lucro histórico incompleto. Agora Home mobile, Dashboard desktop, fechamento e Desempenho ocultam custo/lucro/margem quando:

- a projeção de trocas ainda não foi confirmada;
- há consulta em andamento, inclusive nova consulta após cache previamente confirmado;
- a consulta falha ou o aparelho fica offline;
- há troca concluída no período considerado.

Textos: “Em revisão”, “Ajustes de troca não confirmados” ou “Custos e lucro das trocas em revisão”. Não converter `null` em R$0, não mostrar crescimento percentual de lucro sem base válida. Período anterior, gráficos e espaços seguem o mesmo guard. Consulta confirmada e período sem troca preservam os cálculos existentes. Seller não recebe campos privados.

## 3. Restrições verificadas

- Fiado bloqueado no domínio servidor de troca e de uso de crédito; nenhum ajuste inferido no saldo.
- Não há endpoint de reembolso automático.
- Não há endpoint de cancelamento da troca. Eventos, resumos e créditos não admitem escrita direta pelo cliente.
- O cancelamento específico existente é da **venda futura que consumiu crédito**, com restauração das alocações e estoque exatamente uma vez; não é cancelamento da troca.
- Não houve mudança em concessões, memberships, clientes reais, estoques reais, recuperação real, Sync/Fiado comercial ou Rules para ampliar acesso.

## 4. Rollback: distinção obrigatória

A tag `rollback/v193-before-v194-sale-exchanges` aponta para a V193 publicada e preserva a referência do código anterior. **Não é autorização nem garantia para um rollback integral bruto depois do primeiro efeito V194, inclusive QA.**

Um deploy de código não apaga documentos por si só. Porém, Rules V193 voltariam a permitir alteração de vendas trocadas; o projetor financeiro antigo não conhece o complemento de crédito; o frontend antigo ignora ajustes econômicos e possui undo local genérico. Portanto, a reversão integral poderia invalidar invariantes mesmo mantendo os documentos fisicamente presentes.

Antes de qualquer troca/crédito emitido, é possível retornar o pacote completo à referência V193, sem restauração de dados. Depois da primeira emissão, somente **rollback operacional compatível**, preservando os fences V194, projetor monetário correto, serviços/recibos/ledger, cancelamento específico, guard de undo e relatórios conscientes dos ajustes. Não apagar coleções, não restaurar backup antigo, não mudar geração, não limpar fila e não forçar reprocessamento.

O mínimo de compatibilidade está enumerado em `v194-release-package.json`. Um build de rollback compatível precisa ser explicitamente preparado e validado antes de ser executado. **Não há neste pacote uma promessa de rollback integral V193 seguro após emissão.** Se a condição da autorização for voltar exatamente ao backend/Rules/frontend V193 após uso, a publicação deve ficar bloqueada até resolver essa condição.

## 5. Functions selecionadas — 15, nenhuma exclusão

Infraestrutura/projeção primeiro:

1. `projectSaleFinancialIncome` — receita apenas do dinheiro novo em vendas com crédito.
2. `projectExchangeIncome` — novo trigger idempotente do complemento de troca.
3. `requestBusinessReset` — impede início de reset que descartaria créditos/evidências.
4. `processBusinessReset` — mantém o mesmo bloqueio no worker.

Depois, 11 callables:

`quoteSaleExchange`, `confirmSaleExchange`, `listSaleExchanges`, `lookupSaleExchange`, `listSaleExchangeAdjustments`, `checkSaleExchangeUndo`, `getExchangeCreditBalance`, `quoteExchangeCreditSale`, `confirmExchangeCreditSale`, `getExchangeCreditSaleStatus`, `cancelExchangeCreditSale`.

Não usar `firebase deploy --only functions` global, não excluir Functions existentes, não chamar reconciliações. Os outros consumidores dos helpers só usam caminhos cuja lógica não mudou. `retryBusinessReset` apenas dispara o worker, que será atualizado. Nenhum Scheduler novo.

## 6. Rules e índices

Mudanças estritamente restritivas:

- Cinco coleções novas server-only: trocas, resumos, créditos, eventos de crédito e projeção mínima.
- Recibos de troca/crédito só podem ser produzidos pelo backend.
- Movimentos canônicos de troca/crédito não podem ser forjados ou modificados por clientes antigos/atuais.
- Venda original com troca e venda financiada por crédito não admitem edição direta.
- Cancelamento manual normal sem troca continua autorizado pelas mesmas permissões.

`firestore.indexes.json` está idêntico à V193. As consultas novas usam igualdade simples e, na projeção, ordenação/cursor por `__name__ ASC`, atendidos pelos índices automáticos; nenhuma nova isenção desses índices está no repositório. Nenhum índice composto novo previsto. Confirmar ausência de `failed-precondition / index required` no smoke; se houver, parar a ação, publicar somente o índice necessário e aguardar ativo antes de continuar com o MESMO ID.

Referência: [índices automáticos e ordenação por nome do documento — Firebase](https://firebase.google.com/docs/firestore/query-data/index-overview).

## 7. Ordem de deploy proposta — aguardar autorização

1. Conferir commit/tag/pacote, validar acesso QA e readiness dos índices existentes. Não alterar dados/configurações reais.
2. Publicar apenas `firestore:rules`; validar release e restrições.
3. Publicar as quatro Functions de infraestrutura/projeção acima e aguardar prontas. O projetor de receita deve estar atualizado ANTES de disponibilizar confirmações com crédito.
4. Publicar os 11 callables e aguardar prontos. Não publicar Storage, Auth, Scheduler, permissões ou migração.
5. Publicar frontend/PWA V194 pelo workflow controlado. Não fazer push em `main` antes de autorização.
6. Confirmar SHA/release/PWA no domínio e executar o smoke abaixo; HTTP200 sozinho não comprova o fluxo.

## 8. Smoke QA proposto

Exclusivamente `VECONI QA` e `VECONI QA — isolamento`; não operar Adi festa, 3 Lindas ou outros espaços reais. Conferir businessId+spaceId antes de cada mutação. Usar owner e seller de teste já autorizados; se faltar vínculo QA, pedir autorização específica, sem modificar usuário real.

Preparar cliente `QA V194 Trocas` e produtos novos claramente QA, associados explicitamente ao espaço. Um roteiro determinístico por espaço:

| Etapa | Operação | Resultado canônico esperado |
|---|---|---|
| Base | Três vendas QA originais, 1 item A de R$80 cada | IDs estáveis e três vendas confirmadas; snapshot de estoque e Fiado |
| Igual | A R$80 → item E R$80; apto | Uma troca, entrada A +1, saída E -1, cobrança/crédito zero |
| Maior | A R$80 → item H R$110; avariado | Uma troca, nenhuma entrada A, saída H -1, complemento R$30 apenas |
| Menor | A R$80 → item L R$50; apto | Uma troca, A +1/L -1, crédito nominal R$30, sem receita pela emissão |
| Uso parcial | Nova venda U R$30; usar R$10 do crédito e receber R$20 | Um consumo de R$10, saldo R$20, uma venda, uma saída U, receita apenas R$20 se habilitada |
| Cancelar venda futura | Cancelar a venda U pelo fluxo específico | Um restore de R$10, saldo volta R$30, U +1, estorno apenas dos R$20 monetários |

Com estoques iniciais 20 de cada produto, depois desse roteiro: A=19, E=19, H=19, L=19, U=20. As vendas originais continuam imutáveis. São três trocas, um crédito emitido e uma venda futura cancelada, sem exclusão de evidências.

Executar ações distribuídas entre owner/seller. Comparar visibilidade no Histórico e números operacionais sem liberar Financeiro/custos ao seller. No espaço `finance=false`, zero receita automática; no QA com Financeiro legitimamente habilitado, complemento/estorno somente no destino daquele espaço. Não habilitar Financeiro para testes sem autorização.

Para cada confirmação, registrar operationId, saleId/exchangeId, recibo, número de movimentos, saldos e snapshots. Repetir a MESMA chamada após resposta simuladamente perdida e consultar novamente após reload; esperar uma troca/venda/movimento/alocação, sem duplicação. Nunca criar IDs novos para testar retry. Validar disputa de duas abas, estoque insuficiente e bloqueio de um segundo consumo concorrente.

Comparar antes/depois `clients.saldo`, `payments`, `balanceEvents` e ajustes de saldo: nenhuma alteração pelo mecanismo de troca/crédito. No checkout em modo Fiado, crédito deve ser bloqueado sem finalizar dívida. Não criar venda Fiado real para esse teste.

Parada imediata: escopo errado, recibo divergente, estoque inesperado, tentativa de repetir efeito, erro financeiro, negativa inesperada de Rules ou índice ausente. Preservar payload e IDs; não usar Reprocessar todos, não corrigir estoque manualmente e não compensar Financeiro.

## 9. Estado antes da autorização

Referências locais previstas: branch `codex/v194-sale-exchanges`, tag de candidato `candidate/v194-sale-exchanges` e tag histórica `rollback/v193-before-v194-sale-exchanges` na base V193 acima. O SHA do candidato é informado no retorno de preparação; não é embutido no próprio conteúdo do commit.

Nenhum push, workflow, deploy ou smoke comercial em produção nesta etapa. O ponto de rollback integral está explicitamente NÃO confirmado após emissão; depende da estratégia compatível descrita acima, não de apagar/restaurar dados. O build de rollback compatível ainda não está preparado e é condição a resolver antes da publicação com efeitos QA/reais.
