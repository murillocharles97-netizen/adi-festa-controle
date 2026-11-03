# V225 — correção isolada do manifesto Orders e diagnóstico de HTTP 401

Base: `1054294955c81f9b80fba2039ca0f22d944eb44e`, já publicada no backend. Branch `codex/v225-billing-hotfix`. Esta revisão é somente local e não autoriza push, deploy ou teste comercial.

## Evidência e limite da conclusão

O simulador oficial da aplicação `4053098777156528` enviou uma notificação Orders para `receiveWebhook-00025-vuj`, que retornou HTTP 401. O log da Function confirma `[Webhook] invalid signature`, antes do GET de recurso e do processamento comercial. O identificador fictício havia sido comprovado inexistente no provedor. A comparação segura, sem registro dos valores, confirmou que o segredo do painel de produção corresponde ao segredo vinculado no backend.

Foi reproduzida uma incompatibilidade concreta no código: o servidor transformava `data.id` em minúsculas antes do HMAC, enquanto `buildManifest` do SDK Node oficial atual preserva o valor recebido. Um ID `ORD...` assinado pelo manifesto do SDK falha no código publicado, tanto em segundos quanto em milissegundos. Pagamentos numéricos e preapprovals com IDs minúsculos não apresentam essa diferença.

Isso demonstra o defeito do contrato local. Não comprova sozinho o motivo preciso do 401 oficial, pois o handler publicado ainda não distingue formato de cabeçalhos, divergência HMAC e rejeição temporal. **A falha de produção permanece aberta até obter uma resposta autenticada válida do simulador oficial após um deploy expressamente autorizado.** Não declarar sucesso com base nas fixtures desta revisão.

## Correção mínima

- O manifesto passa a usar `id:<data.id original>;request-id:<x-request-id original>;ts:<ts original>;`. Sem lowercase, uppercase, trim do identificador ou fallback para outro manifesto.
- Somente a verificação de idade normaliza os formatos estritos de 10/13 dígitos. A janela máxima continua 300000 ms, qualquer futuro é recusado e a comparação permanece em tempo constante com `timingSafeEqual`.
- `validateWebhookSignature()` é a única decisão de autenticação e retorna um resultado seguro. A API booleana anterior permanece como wrapper para compatibilidade dos leitores locais/testes.
- Query e `body.data.id`, quando ambos fornecem o recurso, devem coincidir exatamente. Arrays/objetos e divergência de caixa são recusados. `body.id` é tratado como ID independente da notificação quando existe query/data.id, preservando o fallback numérico legado apenas quando não há identificador de recurso mais específico.
- O handler não divulga o motivo ao chamador: mantém HTTP 401 e `invalid-signature`.

## Diagnóstico estruturado

Razões internas fechadas: `missing_signature`, `malformed_signature`, `missing_request_id`, `invalid_request_id`, `missing_identifier`, `invalid_identifier`, `identifier_mismatch`, `invalid_timestamp`, `expired_timestamp`, `future_timestamp`, `hmac_mismatch` e `verifier_unavailable`.

O log de autenticação contém somente razão, flags de presença, quantidade válida de dígitos do timestamp, estado temporal, estágio, status HTTP e tipo de evento limitado a enum. Não inclui timestamp bruto, request-id, data.id, manifesto, payload, assinatura, segredo ou impressão digital do segredo. Campos controlados pelo remetente não são interpolados no diagnóstico.

Replay continua separado da autenticação: o lease transacional existente bloqueia estados `processed`, `ignored` e `processing` ainda vigente. O log novo `[BILLING_WEBHOOK_REPLAY_BLOCKED]` informa respectivamente `replay_processed`, `replay_ignored` ou `replay_in_flight`, usando somente o identificador de evento derivado por SHA256. Repetições legítimas continuam recebendo HTTP 200 para interromper a retentativa do provedor, sem reaplicar efeitos. Lease vencido/falha anterior continua elegível ao retry canônico já existente.

Não mudou a identidade do evento, o esquema persistido, o prazo do lease, o GET do provedor, a máquina financeira ou a idempotência por pedido/pagamento. Eventos com outro request-id continuam protegidos pela conciliação canônica, conforme a regressão integrada.

## Escopo e integridade

Somente dois arquivos de produção diferem da base publicada:

1. `functions/src/services/webhook-service.js`.
2. `functions/src/index.js`: import e handler `receiveWebhook`.

O gate confere que o restante do índice e os seis outros handlers publicados permanecem idênticos, assim como `eventId()` e `readWebhookResource()`. Todos os 92 exports da base sanitizada permanecem. Guard de faturas agendadas, contratos de consulta/conciliação, frontend, Rules, secrets, permissões V3 e V226 não foram alterados.

Os dez originais congelados, `original-hashes.json`, `corrective-hashes.json` e `webhook-auth-hashes.json` continuam imutáveis. O verificador confere as camadas anteriores em seus commits originais e o delta atual em `webhook-canonical-hashes.json`. O bloco `webhookPatch` do manifesto limita uma eventual publicação futura exclusivamente a `receiveWebhook`; a lista de sete Functions permanece como histórico do release completo já publicado, não como escopo deste patch.

## Testes

- 345 regressões de unidade/DOM aprovadas, incluindo 63 casos do guard de concorrência. Fixtures HMAC independentes para IDs maiúsculos, minúsculos, mistos e numéricos nos dois formatos temporais; rejeição da assinatura gerada com caixa diferente; alteração de request-id; janela exata de cinco minutos; 1 ms futuro; cabeçalhos inválidos; query/body incompatíveis; diagnóstico sem vazamento; replay terminal/em andamento.
- 32 cenários Auth/Firestore Emulator aprovados com dados fictícios e adaptador Mercado Pago que bloqueia rede externa não mapeada. Incluem confirmação duplicada com outros timestamps/request-id/action, um único evento/período, diagnóstico de identificadores inconsistentes, concorrência financeira e consulta/conciliação de pedidos existentes.
- 17 regressões legadas de migração aprovadas no Firestore Emulator.
- Os 32 cenários integrados também passaram no backend empacotado, sem contá-los novamente como cenários novos.
- Lint/build aprovados (934 arquivos JavaScript), diff-check e pacote allowlist de 251 arquivos públicos. O frontend é idêntico ao candidato anterior; o rollback conserva os dois guards e a correção canônica.

Não houve notificação enviada à produção nesta revisão, transação financeira, criação/cancelamento/reparação de assinatura, mudança de segredo, edição comercial ou limpeza de dados/filas. Os relatórios de execução ficam fora do pacote público.

## Publicação futura e rollback

**GO técnico local para preparar a repetição oficial, condicionado à autorização de publicar apenas `receiveWebhook`. NO-GO para declarar o incidente resolvido ou liberar o frontend agora.**

Após autorização: reconferir commit/pacote e revisão atual, preservar variáveis/bindings do serviço, publicar somente `functions:receiveWebhook`, comparar source e revisão ACTIVE, executar negativos não financeiros e enviar uma notificação pelo simulador oficial para ID previamente inexistente. Exigir HTTP 200, log `signatureValid:true`, resultado `provider-resource-not-found`, ausência de evento/efeito comercial e ausência de regressões legacy. Em 401, consultar somente os motivos seguros novos; não ampliar janela, aceitar manifestos alternativos, remover HMAC ou rotacionar segredo para contornar a falha.

O rollback compatível deve conservar o manifesto com caixa original, o diagnóstico, formatos temporais, antirreplay e guard scheduled. A contenção preparada pausa novos checkouts sem restaurar o validador conhecido como incompatível, preservando webhooks, consultas, conciliação e dados. Não há rollback automático ou restauração de banco. Qualquer ação de contenção em produção exige evidência e autorização apropriada.

A retentativa da assinatura antiga e a reserva `creating` da 3 Lindas continuam questões independentes. Esta revisão não tenta contratar, regularizar ou reparar nenhuma delas. O estado do provedor precisa ser reconsultado antes de futura operação financeira; não reutilizar o diagnóstico anterior como prova atual.

## Referência primária

[SDK Node oficial Mercado Pago — `buildManifest`, HMAC e comparação constante](https://raw.githubusercontent.com/mercadopago/sdk-nodejs/master/src/utils/webhook/index.ts), consultado em 03/11/2026. A VECONI adota sua preservação de caixa, mantendo controles próprios mais estritos de cabeçalhos, formatos temporais e frescor. Não houve instalação ou atualização de SDK.
