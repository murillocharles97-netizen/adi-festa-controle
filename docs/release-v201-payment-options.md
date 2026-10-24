# V201 — hotfix frontend do seletor de cancelamento

Base sanitizada exclusiva: V200 `5d60e5f5fa159001da39b6b50bcd438129f93fb6`, descendente da V199 `3265f375a6bcd6276e202646725ce63e06a8d20c`.

## Correção isolada

Somente três tags do template em `js/sale-cancellation.js`: substituir `</option value="...">` por `</option><option value="...">`. Os valores `external_refund_confirmed`, `not_due` e `pending_external` permanecem idênticos. A opção pendente continua desabilitada. Não alterar envio, guard, razão, confirmação, idempotência ou tratamento financeiro.

Metadados e referências PWA passam para 201, com cache próprio, sem remover caches anteriores ou armazenamento dos usuários. Sem alteração da lista explícita de arquivos públicos; os novos testes e este documento não são publicados.

## Regressão com DOM real

`tests/sale-cancellation-dom.test.cjs` abre Chrome instalado em modo headless, perfil temporário novo e servidor apenas em loopback. Não usa a extensão, perfil do usuário, credencial ou configuração Firebase. CSP bloqueia conexões e a Function é simulada.

Valida desktop/mobile, quatro opções no DOM, duas escolhas permitidas selecionáveis, opção pendente desabilitada, valor escolhido enviado ao callable, motivo, confirmação, mensagens honestas sobre reembolso Pix/cartão, Fiado `not_applicable` e duplo envio.

O controle negativo `VECONI_CANCELLATION_DOM_BASELINE=1` executa o mesmo DOM contra o código V200 sanitizado para comprovar que a regressão detecta o defeito. Não altera o código de produção.

Validação do candidato: **166 testes aprovados**, incluindo 10 em DOM Chromium real; nenhum ignorado. O controle negativo com a V200 reproduziu seis falhas esperadas, incluindo ausência das opções. Lint, build, diff-check e pacote público de 224 arquivos aprovados. Regressões existentes de Trocas, crédito, Fiado, Histórico e Financeiro incluídas; nenhuma mudança de backend.

## Escopo preservado e rollback

Functions, Rules, índices, permissões, Sync, Fiado, Trocas, créditos, pagamentos, manifest público e workflow de publicação são idênticos à V200. Testes específicos comparam os arquivos e limitam o diff de produção exatamente às três tags e metadados PWA.

Rollback compatível mantido: `8e50eab2f7bd841038f5847e5252e00d450b31d4`, tag `rollback/v200-compatible-sale-cancellation`. Não voltar ao frontend V200 defeituoso como rollback operacional; o rollback compatível suspende novos cancelamentos no servidor e preserva seus registros. Não é executado automaticamente.

## Publicação autorizada e smoke

1. Testes DOM + regressões essenciais, lint, build e diff-check.
2. Commit isolado, ancestry sanitizada e ausência dos seis blobs conhecidos.
3. Revalidar `main` V200 e rulesets `25744131`/`25744311` ativos; usar somente a chave temporária restrita com SSH fixado e lease individual do `main`. Não alterar pushurl, hooks ou rulesets.
4. Publicar somente frontend/PWA pelo workflow da lista explícita. Nenhum comando Firebase deploy.
5. Confirmar versão, commit, módulo, Service Worker e contenção no domínio.
6. Retomar somente as fixtures `qa_cancel_v200_20261024_*` no espaço VECONI QA `3488517b-872d-4836-9796-aa488c1437f1`: antigo/intermediário, delta, segundo cancelamento, Pix/cartão, bloqueios de troca/crédito/recebimento, Fiado, reload e Sync. Não alterar permissões/configurações nem executar operação em lojas reais. Parar se aparecer bloqueador novo.

Evidências e resultados finais ficam fora do repositório/publicação em `C:/Users/Murillo/.codex/visualizations/2026/10/24/sale-cancellation-qa/`.
