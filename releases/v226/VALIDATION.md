# Validação local da V226

Este documento descreve validação local. **Não é autorização de deploy.** Integração atual sobre a V225 publicada `e83635c0fee645ffeaf1a4dea9c6480cc153a2f9`; fonte V226 original preservada em `bcdc215e1f9f33aab459f5c5c62d6dbf6ee56bdb`.

## Revalidação integrada em 03/11

- 183 testes de app/DOM e regressões comerciais aprovados na árvore integrada.
- 186 testes comportamentais da cobrança V225, concorrência e autenticação Orders aprovados.
- Três testes novos de integração verificam os sete handlers e 13 arquivos de cobrança intactos, base publicada fixada, escopo, flags e Service Worker. A rodada combinada contém 207 testes aprovados (18 testes de vendas anteriores + 186 de cobrança + 3 de integração); não somar os 18 novamente aos 183 acima.
- 29 cenários do backend/Rules no Emulator passaram, incluindo registro normal, vendas de 01/11 registradas em 04/11, estoque, Fiado, efeitos únicos, resposta perdida, cancelamentos/trocas, métricas e SDK direto negado.
- Lint, build e pacote público de 254 recursos aprovados. O patch Rules foi comparado em leitura com o ruleset efetivamente publicado e altera somente as condições de escrita do match sales, reservando os metadados novos ao servidor. Nenhuma Rule foi publicada.
- O gate standalone V225 exige metadados V225 e não se aplica à árvore V226. Seu teste não foi alterado: a falha de hash em build-info ao executá-lo na V226 é esperada. O gate integrado substitui essa verificação de release para V226, mantendo comparação exata dos handlers e fontes de cobrança. Os testes comportamentais continuam executados integralmente.
- As portas 8188/9298 estavam ocupadas. O teste integrado admite também Firestore em 127.0.0.1:18188, com Auth local 19298, hub 14400 e logging 14500; nenhum processo existente foi encerrado. Produção e outros hosts continuam recusados.
- Não foi executado o roteiro antigo de navegador/CDP: o controle local está bloqueado no Work e não se contornou essa restrição. As capturas e oito layouts anteriores permanecem como evidência do candidato original, sem serem apresentados como nova homologação física da integração.

## Resultado

- 183 testes focados de app/DOM e regressões aprovados.
- 29 cenários Auth/Firestore Emulator do backend, incluindo reexecução contra o pacote final.
- Oito layouts em Chromium QA:1366×900,768×900,430×844,390×844,360×844,320×844,390×420 e1366×500. Uma venda sintética canônica e zero erros JavaScript.
- Lint/build estrutural e build público por allowlist aprovados;254 recursos.
- Diff-check aprovado. Nenhuma Functions/Rules, permissão ou dado comercial foi alterado em produção.

O conjunto de183 inclui cálculos monetários, modalidade anterior, caixa normal, Dashboard diário/semanal/mensal, histórico de cancelamento, Fiado, trocas e leitura de recibos V222. O conjunto de29 cobre as transações, os efeitos e as negativas do lançamento anterior. Não se somam reexecuções do mesmo teste como testes novos.

## Casos novos da revisão final

1. Venda comum correspondente chega depois da prévia: confirmação anterior negada atomicamente, sem nova baixa/saldo.
2. Recebimento chega depois da prévia Fiado: confirmação negada, preservando o pagamento existente.
3. Pagamento aplicado com data desconhecida: Fiado anterior exige conciliação.
4. Produto ou cliente desativado depois da prévia: confirmação negada antes de efeitos.
5. Venda de01/11/2026 confirmada com relógio de04/11/2026: data comercial01/11 preservada, horário técnico separado.
6. Manifesto usa `reconcileBusinessActivityEvents`, identifica cinco atualizações e duas Functions novas e não inclui billing.

A primeira execução do backend encontrou o limite de segurança de100 registros com mesmo horário por causa de dados sintéticos acumulados no projeto demo antigo. O harness passou a usar um projeto demo único por execução, mantendo a empresa QA autorizada e sem limpar dados nem aumentar o limite do produto. A execução isolada passou integralmente.

## Comandos de regressão

```text
node --test tests/prior-sales.test.cjs tests/checkout-local-preferences.test.js tests/home-mobile-v158.test.js tests/desktop-dashboard.test.js tests/performance-model.test.js tests/public-site-containment.test.cjs tests/static-containment-worker.test.cjs tests/sale-money.test.cjs tests/sale-money.dom.test.cjs tests/fiado-cancellation.test.js tests/sale-exchanges.test.js tests/history-cancelled-status.test.js tests/receipt-latency-v222.test.cjs
node scripts/check-project.js --build
node scripts/verify-prior-sales-release.cjs
```

Backend: definir `FIRESTORE_EMULATOR_HOST=127.0.0.1:8188` somente no processo de teste e executar `node --test tests/emulator/prior-sale.integration.cjs`. O harness recusa outro destino. Para validar o snapshot empacotado, `PRIOR_SALES_RUNTIME` aponta para seu diretório de Functions, com dependências de teste instaladas de forma local e controlada.

Navegador: `node scripts/audit-prior-sales.cjs`, com Auth/Firestore Emulator nas portas9298/8188, cria apenas identidades e dados sintéticos no ambiente local. Não usa usuário ou perfil de navegador comercial.

## O que ainda falta

- Publicação/validação V225 e integração local concluídas; verificar novamente o commit de produção imediatamente antes de qualquer publicação.
- Conferir o hash integrado e a referência de rollback no relatório de fechamento; repetir testes somente se houver mudança nova ou divergência.
- Preflight das Rules e das Functions na base que estiver publicada no momento, com os nomes exatos do manifesto.
- QA autenticado após futuro deploy autorizado.
- Homologação física Chrome Android/PWA descrita no README: teclado, safe-area, navegação de retorno, múltiplos itens, falha de resposta/consulta, recibos e isolamento.

## Aplicabilidade às vendas de01/11

Com deploy integrado autorizado, assinatura/acesso operacional válidos e dados originais completos, o proprietário poderá registrar individualmente essas vendas dentro da janela de sete dias. O teste específico comprovou a janela de04/11. A vendedora não ganha essa modalidade nem novas permissões.

Cada lançamento ainda exige que não exista venda duplicada nem baixa anterior de estoque. Fiado parcialmente recebido, recebimento posterior ou desconhecido e conflitos de identidade/estoque/valor permanecem bloqueados. Não declarar a venda real registrada ou a assinatura regularizada com base em testes sintéticos.
