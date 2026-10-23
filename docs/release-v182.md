# V182 — decisões de recuperação

Base/rollback de frontend: V181, commit `41a107fcc673393a16cf1d5da3780df259f7b5a8`.

Inclui somente decisões explícitas de recuperação, área Resolvidas, proteção transacional/idempotente/replay e atualização dos identificadores de versão/cache. Não inclui a otimização de Fiado pendente em `js/firebase/sync.js`.

Backend necessário: atualizar `submitSaleRecovery`, `listSaleRecoveryReviews`, `getSaleRecoveryOriginal`; criar `decideSaleRecovery`. Publicar as Rules com proteção adicional contra replay, sem ampliar permissões ou publicar outros endpoints. Não há trigger de venda/estoque/receita nas coleções de recuperação.

Publicação segue Firebase CLI para os endpoints/Rules acima e o workflow existente Deploy GitHub Pages para frontend, no domínio oficial `https://veconi.app.br`.

## Validação prévia do pacote limpo

- 45 testes: `node --test tests/sale-recovery-decision.test.js tests/sale-recovery.test.js tests/sale-recovery-access.test.js tests/crm-operation.test.js tests/team-sale-review-hold.test.js tests/team-sale-diagnostic.test.js tests/workspace-sync-queue.test.js tests/team-sync-release-v179.test.js`
- 9 backend: `node --test functions/test/financial-income.test.js functions/test/sale-cost-service.test.js functions/test/workspace-projection.test.js`
- 33 Emulator: `firebase emulators:exec --only firestore --project adi-festa-variations-test "node --test --test-concurrency=1 tests/emulator/sale-recovery-decision.rules.test.js tests/emulator/sale-recovery.rules.test.js tests/emulator/team-manual-sale-sync.rules.test.js"`
- Lint, build e diff-check.

Smoke em nuvem exclusivamente com registros fictícios nos espaços QA. Nenhum replay/decisão das quatro vendas reais faz parte da publicação. Não limpar nem regravar filas/payloads locais.

## Rollback seguro

O commit acima e a tag `rollback/v181-before-v182-recovery-decisions` preservam a base anterior. Reverter frontend/callables anteriores e suspender controladamente novas decisões, se necessário. Se já houver decisões gravadas, MANTER as proteções remotas de replay da V182; não restaurar Rules que permitam reaplicar a operação resolvida. Nenhuma reversão de código deve apagar os registros de revisão nem desfazer efeitos comerciais já confirmados.

## Uso

Owner abre Vendas aguardando revisão e escolhe uma decisão por registro, com confirmação individual. Já registrada: apenas vínculo/auditoria. Recuperar original: estoque atual/reservas/efeitos existentes são revalidados e podem bloquear a ação. Revisões resolvidas ficam em Resolvidas. Não há botão de recuperação em lote ou decisão automática.

Limites do executor aprovado estão em `sale-recovery-owner-decisions-local.md`: vendas manuais pagas, sem efeitos auxiliares desconhecidos. Fiado, cliente/campanhas/integrações exigem revisão específica e não são executados parcialmente.
