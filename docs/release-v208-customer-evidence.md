# V208 — complemento dos cadastros para recuperação

Base exclusiva: V207 sanitizada `ca4382162353388d550aa436d6c417ffd778bf5b`.
Publicação somente frontend/PWA. Functions, Rules, permissões, protocolo Sync, Produtos V206 e caminhos comerciais permanecem idênticos.

## Causa e correção

`businessCache.recoverySources()` descartava as operações negadas `clients/create` antes de `SaleRecoveryClient.entries()`. Reenviar as três vendas já recebidas era idempotente, mas não incluía os quatro cadastros originais.

A leitura inclui agora somente o cadastro original de uma operação com uma única escrita `clients/create`, estado `error` e erro `permission-denied`, da mesma conta, empresa e geração. Os filtros existentes de espaço, autoria, elegibilidade e conflito continuam aplicados. Namespaces anteriores elegíveis são consultados em transações somente leitura; nada é importado, regravado, normalizado ou reprocessado. Operações arquivadas não entram nesse fluxo.

O botão passa a **Complementar dados para recuperação** quando existem cadastros elegíveis. A confirmação explicita quantas vendas e cadastros serão enviados. O resultado diferencia vendas novas, vendas já recebidas, complementos aceitos, cadastros já recebidos e dados ainda ausentes. A conferência usa a Function autenticada existente, validando identidade e hashes. Falha de consulta ou divergência não é apresentada como confirmação de recebimento.

Os três pacotes originais, seus IDs e hashes não são substituídos. O servidor V207 já aceita o complemento privado e imutável `original/customer-dependencies`, com hash próprio. Enviar evidências não aprova clientes, não recupera vendas, não altera filas e não produz efeitos comerciais.

## Validação e publicação

- Testes Node/DOM: coleta real do cache, quatro cadastros e três vendas fictícias, namespaces, sessão, espaço, hash, falhas, idempotência e mensagens.
- Emulator isolado: originais anteriores sem clientes, complementação, aprovação explícita por owner, recuperação individual e recibos/estoque/financeiro uma única vez. Nenhum dado real é utilizado.
- Gate `scripts/verify-v208-release.cjs`, lint, build e diff-check; lista pública explícita preservada (227 recursos), testes e documentação não publicados.
- Publicar somente frontend pelo GitHub sanitizado e credencial temporária, mantendo os dois rulesets. Conferir Actions, domínio, recursos e `GET_VERSION` do Service Worker.
- Produção: apenas consultas para as três revisões. Nenhum envio de evidências ou decisão comercial durante o deploy.

## Rollback compatível

Tag `rollback/v208-compatible-customer-evidence` aponta para V207 `ca4382162353388d550aa436d6c417ffd778bf5b`. Somente frontend pode ser revertido; backend V207, recibos, evidências e complementos aceitos permanecem intactos. Não apagar dados nem voltar Functions a versões anteriores. O frontend V207 volta a ter a limitação de coleta; não utilizá-lo para tentar complementar cadastros enquanto durar o rollback. O rollback de pausa de decisões V207 existente continua preservado, sem ativação automática.

## Próxima ação no aparelho

Após confirmar V208: abrir a recuperação, tocar **Complementar dados para recuperação → Confirmar complemento**. Conferir a mensagem de cadastros efetivamente recebidos; só depois o owner aprova os cadastros e decide as vendas individualmente pelo fluxo existente. Esta publicação não executa essas decisões.
