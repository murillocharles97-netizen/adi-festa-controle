# Validação local V225

**Estado atual:** revisão corretiva do guard de concorrência; ver `CORRECTION.md`. Os resultados abaixo de207 testes descrevem o candidato inicial e ficam preservados como histórico. A execução atual soma234 testes unitários/DOM e29+17 cenários Emulator, além dos três roteiros de persistência. O guard novo é incluído no pacote e no rollback; as conclusões antigas não liberam o candidato rejeitado no preflight.

## Resultado

- **171 testes unitários, DOM, contrato HTTP e contenção pública aprovados.** Incluem cotação/cupom, assinatura, Pix, cartão, Device ID, autorização, interface de recuperação e gates de release.
- **19 cenários autenticados Auth/Firestore Emulator aprovados**, usando handlers integrados sobre a V224. Reexecutados também contra o snapshot empacotado, sem contar a reexecução como testes novos.
- **17 regressões Emulator de migração legado aprovadas.**
- **Três roteiros adicionais de persistência Emulator aprovados:** Pix com cupom/recusa/aprovação/tenant, cartão com challenge/idempotência e máquina de estados da assinatura.
- Lint/build estrutural, diff-check, build público de **251 recursos**, comparação de escopo e rollback de contenção aprovados.
- Os dez hashes brutos originais continuam intactos. O gate verifica nove arquivos integrados por hash LF e os sete handlers originais dentro do índice V224 preservado.

Total: **207 testes nomeados**, além dos três roteiros. Não se contam reexecuções como cenários novos.

## Falhas intermediárias esclarecidas

1. A primeira execução autenticada usou outro nome de projeto demo, enquanto a API REST do Auth Emulator atendia ao projeto configurado. O login sintético retornou EMAIL_NOT_FOUND antes da chamada comercial. O harness agora utiliza esse projeto demo e IDs fictícios únicos, sem limpar dados ou mudar a política do produto. A reexecução passou.
2. Um teste antigo exigia `notification_url` no body de Orders, exatamente o comportamento corrigido. Atualizou-se somente essa expectativa para ausência da propriedade, de acordo com o contrato oficial; o teste de `/preapproval` continua exigindo seu callback. A suíte completa passou.

Nenhuma validação foi removida ou enfraquecida para obter aprovação.

## Comandos

```text
node --test tests/billing-v225-release.test.cjs tests/billing-migration-hotfix.test.cjs tests/subscription-plans.test.js tests/subscription-pix.test.js tests/subscription-payer-email.test.js tests/subscription-coupons.test.js tests/plan-catalog-v2.test.js tests/legacy-billing-audit.test.js tests/manual-legacy-reconciliation-v148.test.js functions/test/legacy-plan-transition.test.js functions/test/subscriptions.test.js functions/test/coupons.test.js tests/public-site-containment.test.cjs tests/static-containment-worker.test.cjs
node --test tests/emulator/billing-migration-hotfix.integration.cjs
node --test tests/emulator/billing-v225-legacy.integration.cjs
node --test tests/billing-scheduled-retry-v225.test.cjs
node functions/test/pix-billing-emulator.js
node functions/test/card-monthly-emulator.js
node functions/test/billing-state-machine-emulator.js
node scripts/verify-billing-release.cjs
node scripts/check-project.js --build
git diff --check
```

Executar em processo de teste isolado. Para integração: Firestore Emulator local8188 e Auth9298, projeto demo configurado, sem credenciais de produção. O harness usa exclusivamente loopback, identidades descartáveis e respostas Mercado Pago sintéticas. Para os demais roteiros, definir `FIRESTORE_EMULATOR_HOST=127.0.0.1:8188` e `GCLOUD_PROJECT` demo exclusivo por execução. `BILLING_TEST_RUNTIME` seleciona um snapshot local para repetir os 19 cenários do pacote.

## Cobertura crítica

Owner/seller, empresa incorreta, revogação, falsificação de provas pelo SDK, reserva creating e lease, rejeição definitiva, GET encontrado/incerto, concorrência, resposta perdida, cupom, novo Pro119,90 sem desconto legado, preservação da tolerância, duplicação de webhook, aprovação tardia e cobrança antiga concorrente. Ativação única antes do encerramento verificado do contrato antigo. Pausa de novas contratações preservando conciliação de pedido existente.

## Limites e condições de publicação

Não houve pedido, cobrança, cancelamento ou conciliação reais. Aceitação da adquirência e desafio 3DS real não estão homologados por um adaptador sintético. O Device ID do SDK real já tinha evidência no pacote original; nesta rodada foram reexecutadas as validações de preservação e transporte desse formato, sem nova transação externa.

O teste físico Chrome Android/PWA continua pendente. Conferir teclado, carregamento do SDK, cancelamento/erro, retorno ao checkout e consulta da tentativa preservada, utilizando QA e credenciais de teste; não solicitar dados de cartão em relatório.

Main/domínio/Service Worker foram consultados nesta rodada e permanecem V224 `730abca`. Os dois rulesets estão ativos. A consulta Firestore de02/11 às22:55:13 de Brasília confirmou acesso temporário vigente até04/11 às12:07:44, plano legado pending e reserva creating sem replacement/ativação vinculados. Não se reconsultou o provedor; o preflight de pagamentos precisa ser renovado antes de qualquer alteração real.

A conclusão atual encontra-se em CORRECTION.md: GO técnico local para a correção, NO-GO para publicação enquanto a configuração Orders não for comprovada e o novo candidato não passar no preflight autorizado. NO-GO para criar cobrança, reparar reserva ou cancelar contrato nesta preparação. O deploy do código sozinho não comprova assinatura regularizada.
