# V225 — correção do guard de concorrência,03/11/2026

Base corretiva: `41d5095e7f4b716e8d0eb559b953ae1e6883898a`. Branch `codex/v225-billing-hotfix`, V224 sanitizada preservada. Alteração exclusivamente local, sem leitura de credenciais novas, chamada financeira real, deploy, push ou reparação de produção.

## Causa e política corrigida

O guard inicial lia apenas `payment.status` da fatura mais recente. O preflight encontrou wrapper `scheduled` e `next_retry_date` futuro, embora o último pagamento estivesse `rejected`. Essa combinação passava e podia permitir nova contratação concorrente. As evidências originais do preflight permanecem intactas; não se presume que o agendamento real desapareceu desde a consulta.

O guard interno compartilhado `legacy-source-billing-guard.js` é usado tanto na contratação quanto no encerramento de reserva creating. Ele:

- Confere owner/empresa/contrato/índice canônicos, referência, moeda/valor e estado atual do contrato. Um meio manual configurado localmente não oculta um contrato ainda vinculado.
- Lê todas as páginas de faturas, com limit10 e teto100. Total/offset/limit ausentes, paginação inconsistente, IDs duplicados, dados de outra assinatura, datas inválidas ou resposta indisponível bloqueiam; não se presume que uma página parcial prova ausência de concorrência.
- Bloqueia `scheduled`, `recycling`, qualquer `next_retry_date` ainda presente (futuro ou vencido sem encerramento confirmado), pagamento em processamento, aprovação recente, estados desconhecidos e inconsistências. Não interpreta `retry_attempt>0` sozinho como agenda atual: tentativas já encerradas continuam válidas quando comprovadas.
- Exige aprovação com horário confiável (`payment.date_approved` ou `last_modified`) anterior ao fim pago; data antiga de débito sozinha não comprova que uma aprovação não foi tardia. Cancelado/expirado no contrato não neutraliza fatura ainda agendada.
- Para contrato autorizado, exige próxima data regular válida e futura; se vencida ou ausente, bloqueia. Uma renovação regular futura, sem fatura/retry aberto nas leituras completas, continua compatível com a migração approval-first existente.
- Reconsulta o contrato após ler as faturas e revalida o contexto canônico. A prova interna de leitura expira em15 segundos e é ligada a UID/empresa/contrato/estado, sem aceitar autorização do navegador.
- Exige essa prova na transação de reserva e faz outra conferência antes do POST ao provedor. Na reparação, verifica antes do lease e antes da transação final. O risco conhecido bloqueia antes de liberar a reserva; se aparecer durante a conferência, a reserva continua preservada.

Limite real: não existe transação distribuída que impeça o provedor de alterar sua agenda após uma leitura. A correção bloqueia risco conhecido/inconclusivo, não cancela recorrência e não promete eliminar toda corrida externa. Uma concorrência posterior continua exigindo conciliação, sem segundo pagamento ou estorno automático.

## Contratos preservados

Webhooks, `getPixCheckoutStatus`, `getCardCheckoutStatus`, `syncSubscription` e confirmação de pedidos existentes não usam o novo gate de intake. Assim, uma aprovação legítima já recebida continua conciliável mesmo com nova fatura antiga agendada. A regra existente de ativar o plano aprovado antes de encerrar verificavelmente o contrato antigo permanece. Os testes simulam esse fluxo; nenhum contrato real foi cancelado.

Repetir a consulta de uma reparação já concluída retorna o recibo imutável e não inicia reparação, pagamento ou nova busca financeira. Uma nova contratação continua exigindo o guard novamente.

## Diff exato e originais imutáveis

- **Novo:** `functions/src/services/legacy-source-billing-guard.js`.
- **Alterados:** `legacy-plan-transition-service.js`, `legacy-checkout-recovery-service.js`, `mercado-pago-service.js` (offset de paginação GET) e `functions/src/index.js` (reconferência antes dos três caminhos de criação).
- Testes, documentação, manifesto e verificador atualizados separadamente. Nenhum arquivo frontend mudou no commit corretivo.
- Os dez arquivos originais continuam no diretório privado congelado e `original-hashes.json` permanece intacto. `corrective-hashes.json` registra hashes da base e corrigidos separadamente; não redefine os hashes originais.
- Mesmas sete Functions, nenhuma nova exportada. Seis handlers originais permanecem iguais; createSubscription recebe a correção. Noventa e dois exports canônicos preservados. Sem Rules, índices, Google, V3, Sync, permissões ou arquivos V226.

## Testes

- 63 testes unitários novos: scheduled/rejected, retry futuro e vencido, múltiplas páginas, respostas incompletas, contrato cancelado/desconhecido, aprovações tardias, datas, empresa, contexto e prova obsoleta.
- 171 regressões unitárias/DOM/contratos/contenção existentes: **234 no conjunto atual**.
- 29 cenários autenticados Auth/Firestore Emulator:19 existentes e10 adicionais. Contratação/reparação negadas sem POST/PUT, alteração entre conferências, preservação da tolerância, evidências e idempotência. Webhook+conciliação de pedido aprovado continuam aplicando uma única vez.
- 17 regressões Emulator de migração e três roteiros de persistência de Pix/cartão/assinatura.
- Lint/build, diff-check, build público por allowlist e reexecução contra o backend empacotado. Os logs ficam em artefato privado de validação; não são publicados.

Total de testes nomeados:280, além de três roteiros. Reexecuções do mesmo cenário não são somadas como testes novos.

A primeira regressão legado apontou mudança do código de erro do owner indevido. Foi restaurado o código contratual `legacy-migration-owner-required`, mantendo a negativa, e reexecutado o cenário completo. Os fixtures de fatura receberam status/paginação explícitos porque ausência desses dados agora deve bloquear, em vez de simular uma resposta segura incompleta.

## Rollback e sequência

Gerar rollback **sobre o novo commit**, preservando este guard, os recibos e toda a conciliação. Alterar apenas pausa de novos checkouts no servidor/frontend e nome do cache estático. Não utilizar o rollback antigo331cb454 para voltar ao código sem proteção de scheduled. A referência antiga permanece intacta como histórico.

Publicação futura: confirmar fonte/revisões/configuração Orders → sete Functions seletivas na ordem do manifesto → QA isolado → frontend se autorizado → validação não destrutiva. Não iniciar contratação ou reparação da3 Lindas enquanto a fatura agendada/inconclusiva continuar presente. Esta correção não regulariza a reserva e não altera a tolerância.

## GO / NO-GO

**GO técnico local para o guard corrigido**, após aprovação integral dos testes e pacote. **NO-GO de publicação** enquanto a configuração Orders no painel não for comprovada e o novo candidato não receber preflight/autorização específica. Orders é uma pendência independente, não um motivo para afrouxar o guard.

**NO-GO para operação financeira real** se o agendamento antigo persistir. É necessária nova conferência oficial e tratamento autorizado do conflito, sem cancelamento automático ou cobrança alternativa às cegas. Não foi executada essa etapa.

Referência de schema: [busca de faturas](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/authorized-payment-search/get) e [dados da fatura](https://www.mercadopago.com.br/developers/en/reference/online-payments/subscriptions/get-authorized-payment/get). Estado da fatura e estado do último pagamento são campos separados.
