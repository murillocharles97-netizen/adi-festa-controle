# Reset operacional — auditoria e barreiras de publicação

Base: V159 / 91a6114cefdcadf9483e428a6720c10c05a76d83.
Nenhum reset de produção autorizado por esta tarefa: implementar e testar em
empresas isoladas no Emulator. A ação futura será explícita pelo proprietário.

## Inventário de escopos

| Escopo | Classificação / tratamento |
|---|---|
| Firebase Auth, users/{uid} | Identidade global; nunca excluir. Desvincular somente a empresa resetada dos usuários adicionais, sem afetar outras memberships. |
| businesses/{id} | Documento permanece; preservar ownerId/id, assinatura, limites/entitlements, billing e metadados essenciais. Remover configuração operacional, mantendo geração/estado de reset. |
| billingCheckoutAttempts, subscriptionIntents (subcoleções da empresa) | Billing da VECONI: preservar integralmente, inclusive descendentes. Não confundir subscriptionIntents com paymentIntents. |
| members | Manter somente membership do proprietário canônico; remover demais vínculos. |
| products, productVariants, stockMovements, productFinancials, variantFinancials, stockMovementFinancials | Catálogo, variações, estoque/custos: apagar recursivamente. |
| clients, sales, saleFinancials, payments, balanceAdjustments, balanceEvents, processedOperations | Operação/fiado: apagar. `payments` aqui é recebimento de dívida do comércio, não cobrança da assinatura. |
| campaigns, campaignProgress, campaignEvents, campaignRedemptions, paymentAllocations, rewards | Campanhas/benefícios operacionais: apagar. |
| customerSubscriptions, customerSubscriptionEvents | Renovações dos clientes do comércio: apagar; não são a assinatura VECONI. |
| charges, messageHistory, messageTemplates, messageSequences, clientContacts, customerMetrics, customerMonthlyMetrics, customerSegments, metricEvents, visits | CRM/mensagens/métricas: apagar. |
| catalogOrders, activityEvents, auditLogs, invites, teamInvites, settings, syncMetadata | Operacional: apagar; manter somente novo log mínimo do reset fora desses dados. |
| paymentTerminals, paymentProviderConfigs, paymentIntents/events, paymentCheckoutLocks, paymentReceivables | Mock/simulador: apagar. Qualquer evidência não-mock bloqueia o reset simples antes da exclusão. |
| financialSpaces/{spaceId} e descendants | Fora de businesses. Resolver vínculo exato businessId/linkedBusinessId; não selecionar por ownerUid apenas. |
| financialSpaces descendants: entries, events, categories, recurrences, financialAccounts, creditCards, creditCardInvoices, creditCardPurchases, creditCardInvoicePayments, creditCardAdjustments | Apagar somente dos espaços pertencentes à empresa. Contas/cartões compartilhados com espaços externos exigem proteção adicional; não excluir silenciosamente. |
| financialTransfers | Resolver referências dos espaços e empresa; transferências cruzadas não podem ser apagadas unilateralmente. |
| financialViewProfiles/{uid} | Preferências pessoais/multiespaço: remover apenas referências aos espaços apagados; preservar preferências de outras empresas. |
| publicCatalogs/{token} e orders/campaignProgress/phoneIndex/portalProfiles/portalSessions/redemptionRequests | Resolver businessId; apagar recursivamente, incluindo pais inexistentes quando conhecidos. |
| memberships, teamInviteTokens, onboarding | Índices externos: remover vínculos/convites/onboarding do business, preservar índice owner e identidades globais. |
| subscriptionIndex, subscriptionPlanIndex, billingOrderIndex, billingPaymentEvents, subscriptionPaymentEvents, billingReconciliationRequests, webhookEvents | Billing/security: fora do reset. |
| adminCoupons, adminCouponCodes, couponQuotes, couponRedemptions, couponUsageCounters, couponAuditLogs, couponBillingEvents | Cupons da assinatura SaaS: preservar, não confundir com campanhas comerciais. |
| plans | Catálogo de planos global: preservar. |
| publicRateLimits | Segurança/TTL, hashes de catálogo/IP; não limpar globalmente. |

Descobrir subcoleções com Admin SDK (`listCollections` / `listDocuments`) inclui
descendentes sob pais ausentes. Coleções novas/desconhecidas devem bloquear o
preflight, não ser adivinhadas como operacionais ou billing.

## Storage

Paths atuais encontrados em storage.rules e uploaders:
`businesses/{businessId}/products/...` (originais/miniaturas/variantes),
`businesses/{businessId}/catalog/{banners|categories|products}/...`,
`financialSpaces/{spaceId}/entries/{entryId}/...` (anexos financeiros).
Excluir prefixos completos com barra final somente após resolver o escopo.
Não executar limpeza do bucket/origin. Listagem/verificação paginada; excluir
versões dos objetos quando houver versionamento. Object retention/soft delete
do bucket é política da infraestrutura e precisa ser verificada, não prometida
como apagamento físico imediato. Não criar backup/snapshot de aplicação.

## Ressurreição identificada no código

1. `aggregateCustomerSaleMetrics` reage inclusive a exclusões de sales e cria
   customerMetrics/customerMonthlyMetrics/metricEvents usando Admin SDK.
2. Triggers financial-income, sale-cost e activity-event também podem escrever
   depois de um reset. Rules não protegem Admin SDK. Um check somente no início
   da função tem corrida: reset pode começar entre check e commit.
3. `legacyMember` nas Rules e `permissionService` aceitam perfil legado sem member.
   Apagar member sem invalidar fallback permite recuperar acesso indevido.
4. Queue e cache IndexedDB V156 não possuem geração. Retaggear a fila antiga com
   a geração nova é proibido. A geração deve acompanhar a origem da operação.
5. Escritas diretas existem em sync, firestore-repository, operation-settings,
   space-service, financial-space-service, catalog-bridge, auth e uploaders.
   Todos precisam ser cercados, não apenas o botão Sincronizar.
6. Spaces/finance caches incluem chaves por UID e recursos compartilhados. Remover
   tudo por UID afetaria outros negócios/espaços pessoais.

## Contrato obrigatório antes de habilitar a ação

- workspaceGeneration ausente significa 0. Após reset, requisições sem geração
  não recebem acesso implícito: versões antigas devem falhar fechadas.
- Lock + incremento transacional único, resetOperationId idempotente, FAILED
  permanece bloqueado, retry usa o mesmo job/geração.
- Rules cercam todas as escritas operacionais, inclusive coleções externas e
  Storage. Backend deve conferir lock/geração na transação da escrita; triggers
  com evento de geração antiga não projetam dados.
- Snapshot canônico novo nunca promove dados/fila de geração antiga. Limpeza
  local por business/principal, preservando Auth e outros escopos.
- Após exclusão, verificar vazio + Storage e preservação de owner/billing antes
  de liberar o business. Nenhum backup com conteúdo apagado.
- Não habilitar/deployar reset enquanto houver writer, trigger, cache ou caminho
  legado que não respeite a barreira. Testar concorrência real no Emulator.

## Situação

Implementação parcial local em 02/10/2026. **NÃO PUBLICADO, NÃO HABILITADO.**
Produção permanece V159 / `91a6114cefdcadf9483e428a6720c10c05a76d83`.
Callables, worker e UI já existem localmente. O serviço exige readiness explícita
e permanece desabilitado por padrão em produção (`VECONI_WORKSPACE_RESET_ENABLED`).
Nenhum dado de produção foi removido.

### Implementado e validado nesta etapa

- Serviço Admin com classificação fail-closed, owner canônico/recent auth,
  confirmação RESETAR, proteção de provider real, lock/geração transacional,
  operationId, lease, exclusão recursiva, verificação e retomada após falha.
- Preservação de Auth (serviço sequer recebe Auth), owner, subscription/plano,
  billing operacionalmente separado e dados de outra empresa no Emulator.
- Pré-condição de versão do objeto Storage: worker antigo não pode excluir uma
  versão nova de um arquivo reutilizando o mesmo path.
- Triggers de métricas, histórico, custo e receitas cercados por leitura da
  geração/lock dentro da transação. Eventos antigos são ignorados sem regravar.
- Payment Engine e operações de Equipe cercados por geração nas transações.
  Login owner durante FAILED/DELETING só lê membership, não recria audit/seed.
- Escritas backend de catálogo e exclusão/arquivamento de contas/cartões recebem
  barreira transacional. Onboarding de conta antigo não recria settings após reset.
- Rules de Firestore/Storage bloqueiam geração antiga, lock e membro removido;
  nonce novo impede update/merge antigo de herdar a geração de um documento novo.
- Cache IndexedDB verifica a geração no mesmo commit; sessão antiga é aposentada.
  `DB.useBusiness` aceita escopo por geração, sem importar cache/fila antigos.
- Protocolo de limpeza scoped conectado ao bootstrap testa aborto
  transacional, reload, duas origens isoladas e duas abas na mesma origem.

### Evidências locais

| Verificação | Resultado | Log |
|---|---|---|
| Unit raiz | 554 aprovados | artifacts/business-reset-unit.log |
| Unit backend | 102 aprovados | artifacts/business-reset-functions-unit.log |
| Firestore/Storage Rules | 114 aprovados | artifacts/business-reset-rules.log |
| Suíte completa Functions Emulator | Aprovada | artifacts/business-reset-all-functions.log |
| Reset Admin/Auth/Storage + falha/retry + guardas | Aprovado | artifacts/business-reset-backend-final.log |
| Projeções com triggers reais + terminal/histórico | Aprovado | artifacts/business-reset-integrated-backend.log |
| Equipe/terminal com geração antiga/nova e lock | Aprovado | artifacts/business-reset-team-terminal.log |
| Cache real V156: escala, quota, incremental/offline | Aprovado | artifacts/business-reset-cache.log |
| Geração: dois dispositivos sintéticos + duas abas | Aprovado, protocolo/cache apenas | artifacts/business-reset-cache-generation.log |
| Lint/build | Aprovados | artifacts/business-reset-lint.log / business-reset-build.log |

Os testes de backend usam exclusivamente `adi-festa-variations-test` nos
emuladores locais. Os testes de cache usam Chromium headless em localhost,
sem Firebase/produção. Os resultados acima são a etapa inicial; a validação
posterior da interface completa está registrada abaixo. Não equivalem a Android físico.

### Checklist original de implementação (histórico; atualização abaixo)

1. Conectar geração ao bootstrap/login, listener existente de business e fila.
   Parar atividades antigas antes da limpeza; não trocar a geração da sessão
   enquanto callbacks antigos ainda podem executar. Reload seguro após limpeza.
2. Adaptar todos os writers frontend (sync/repository, espaços/financeiro,
   configurações, catálogo, Auth operacional e uploaders) para enviar geração
   original + nonce. **Não habilitar reset antes disso**: Rules atualmente
   bloqueiam clientes sem geração após o primeiro reset, deliberadamente.
3. Para uploads pós-reset, implementar exclusão de imagem generation-aware.
   `deleteObject` legado não carrega época; Rules o bloqueiam após geração > 0.
4. Finalizar limpeza seletiva de financialViewProfiles e caches financeiros por
   UID, e desvinculação do perfil users de membros removidos, sem tocar Auth
   nem outra empresa. O helper puro de preferências ainda não foi conectado.
5. Revisar descoberta de catálogos órfãos sem documento pai e referências
   financeiras cruzadas. O reset simples bloqueia conta/cartão/transferência
   externa; nunca desfaz saldo pessoal para conseguir apagar a empresa.
6. Conectar job/callables/retry do worker; construir UI owner-only com duas
   confirmações, reautenticação, progresso bloqueante, falha e retomada.
7. Impedir bootstrap de criar espaços padrão automaticamente após reset.
   Fluxo “Configurar VECONI” não é novo provisionamento de conta/assinatura.
8. Completar smoke real do aplicativo e QA mobile nos seis tamanhos, incluindo
   WhatsApp, Payment Engine, sync, venda, fiado e recebimento. Teste físico Android
   e multidispositivo de ponta a ponta continuam pendentes.
9. Verificar retenção/soft-delete do bucket antes de publicar; não alterar política
   global do bucket nem prometer exclusão física imediata sem evidência.
10. Contagem de documentos é transacional. Contagem de arquivos é de deleções
    confirmadas; pode subcontar se o processo morrer entre GCS e Firestore. A
    verificação de Storage vazio, não a contagem, é o critério de conclusão.

Só depois: revisão final, APP_VERSION 160/SW correspondente, commit coeso e
deploy único, com rollback identificado. Um rollback de código **não recupera**
conteúdo que um proprietário tiver apagado irreversivelmente.

## Atualização — 04/10/2026

Os itens 1–7 do checklist foram implementados localmente: runtime de geração
imutável, bootstrap confirmado pelo servidor, listener existente, writers
Firestore/Storage/callables, fila carimbada com a geração de origem, limpeza
seletiva de preferências e perfis de membros, descoberta de catálogos órfãos por
referências explícitas, UI de confirmação/senha e worker com retry seguro.
Nenhum listener global novo foi adicionado. O watcher de progresso observa um
único job. Nenhum reset de produção foi solicitado.

Correções adicionais: snapshot antigo do cache é ignorado pelo BusinessContext;
duas abas verificam o marcador dentro da mesma transação de migração; um erro
transitório do worker sem FAILED persistido é reenviado pelo mecanismo de retry.

### Evidências atuais

- `artifacts/business-reset-unit-current.log`: 574 unit tests do app aprovados.
- `artifacts/business-reset-functions-unit-current.log`: 102 backend aprovados.
- `artifacts/business-reset-regression-current.log`: 115 Rules aprovadas;
  fluxo real UI → senha → callable → worker → conclusão; dois dispositivos de
  navegador isolados; app fechado com fila offline antiga reabre sem ressuscitar
  dados, mesma Auth e assinatura; nova escrita de cliente e espaço autorizada.
  Smoke de venda fiado/recebimento, WhatsApp individual e sequência de 3 contatos
  (abertura externa simulada, sem mensagens reais), Financeiro, Histórico, Equipe,
  reload e convergência também aprovado.
- `artifacts/business-reset-ui-e2e.log`: backend com falha parcial/retry,
  isolamento, preservação e exclusão de assets por versão aprovados.
- Layouts 320/360/375/390/412/430 sem overflow, screenshots em
  `artifacts/reset-ui/`; imagem de 320 px inspecionada após aguardar a animação.
- Build validado; Android/PWA físico não realizado.
- `artifacts/business-reset-commerce-current.log`: produto, estoque, venda fiado
  e recebimento pós-reset persistidos na geração 1; Payment Engine com recusa,
  aprovação, duplicidade, reload e recuperação de UNKNOWN aprovado, além do
  smoke geral. Nenhum pagamento real ou mensagem WhatsApp real foi enviado.
- `artifacts/business-reset-cache-generation-current.log`: migração concorrente,
  interrupção/rollback IndexedDB e isolamento de outros apps/empresas aprovados.
- `artifacts/business-reset-ui-final.log`: último reteste completo da UI aprovado,
  incluindo cancelar durante a leitura de capacidade sem reabrir a confirmação.

### Custo operacional da implementação

Não há varredura permanente de coleções para reset. O listener de business já
existente detecta a geração; durante a restauração a UI observa somente o job
atual. Preflight/verificação são manuais e paginados. A exclusão atual é
conservadora por documento, com leitura de job/business/alvo na transação e
atualização de contagem/lease. É O(N), não uma exclusão gratuita por coleção;
volumes grandes podem exigir retomada do mesmo job após o limite do worker.
Resolvers de coleções externas adicionam leitura do pai para confirmar escopo,
com cache por sessão fora de transações; transações revalidam o pai.

### Storage real: leitura somente de metadados

Bucket `adi-festa-controle.firebasestorage.app`: soft delete já habilitado por
604800 segundos (7 dias), vigente desde 25/07/2026; sem retentionPolicy,
versioning ou defaultEventBasedHold informados. Consulta feita em 04/10/2026.
Nenhuma configuração do bucket foi alterada e nenhum objeto foi apagado.

O serviço não cria backup, mas a infraestrutura existente pode reter arquivos
deletados por sete dias. Em 04/10/2026, o usuário autorizou manter essa política e
explicitá-la na confirmação. O aviso aparece nas duas confirmações, sem prometer expurgo físico imediato
nem alterar a política global (que afetaria outras empresas).

### Candidato validado para publicação

- Retenção de Storage aprovada pelo usuário; aviso nas duas confirmações validado.
- APP_VERSION 160 / cache `veconi-v160-workspace-reset` preparados. Aceitação
  final concluída; este relatório é registrado antes da publicação.
- `artifacts/business-reset-v160-acceptance.log`: Functions, onboarding, equipe,
  billing, Financeiro, reset pela UI e Payment Engine passaram (exit code 0).
  O script legado do Payment Engine ainda imprime o rótulo fixo `release:159`;
  a aplicação servida foi o código local V160, confirmado em `js/build-info.js`.
- Unit 574/574, backend 102/102, Rules 118/118, lint e build aprovados.
  Android/PWA físico continua pendente. Nenhum reset de produção foi executado.

### Revisão de segurança final

- Perfil financeiro pessoal tem revisão monotônica: uma gravação offline velha
  não pode sobrescrever a remoção seletiva de referências da empresa resetada.
- Espaço rotulado pessoal/outro mas vinculado por businessId também respeita
  geração e lock, tanto em Firestore quanto em Storage. Espaço realmente pessoal,
  sem vínculo empresarial, permanece independente. 118 testes de Rules aprovados.
- Catálogo órfão requer comprovação do business em cada documento sobrevivente.
  O token informado em settings/visits não é autorização suficiente para Admin delete.
- Cada deleção externa revalida o dono dentro da transação. Mudança de empresa
  durante retry bloqueia o job sem apagar documentos da empresa nova. O teste
  de corrida passou em `artifacts/business-reset-final-smoke.log`.
- Assinatura/plano sem identificação válida bloqueiam antes de qualquer deleção.
- Pós-reset validado: produto, estoque, venda fiado, recebimento, nova conta,
  lançamento financeiro pago, preferências de visualização e sessão preservada.
- O smoke completo e Payment Engine passaram novamente; versão 160 concluiu a
  aceitação com Functions/billing em emuladores, sem providers reais.
- Screenshots finais em `docs/screenshots/business-reset-v160/`.

### Publicação e rollback

Habilitação somente no backend (`VECONI_WORKSPACE_RESET_ENABLED=true` no ambiente
de produção); não existe flag frontend capaz de autorizar a exclusão. Auth,
owner canônico, autenticação recente e confirmação continuam obrigatórios.

Rollback de interface: V159 / `91a6114cefdcadf9483e428a6720c10c05a76d83`.
Depois que existir qualquer reset real, **não restaurar Rules/backend antigos
sem as barreiras de geração**: isso permitiria ressuscitar dados antigos. Para
conter uma falha, desabilitar novas solicitações no backend e manter as barreiras;
jobs em andamento precisam terminar ou permanecer bloqueados para retomada.
Nenhum rollback de código recupera conteúdo apagado. Retenção do Storage não é
backup da empresa nem recuperação oferecida pela VECONI.
