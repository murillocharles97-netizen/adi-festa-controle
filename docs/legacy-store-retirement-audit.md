# Loja Online — encerramento do modelo global, sem migração

Auditoria em 14/10/2026, exclusivamente na empresa `adi-festa`. Base local V169
b5c1aed4066c569d2665ad43749ecffd934b9f86. Sem deploy autorizado nesta etapa.

## Classificação anterior à exclusão

| Estrutura | Resultado | Tratamento |
| --- | --- | --- |
| `publicCatalogs/{token}` schema 4/5, sem space, vínculo ou referência V2 | 10 documentos antigos | Desativar e remover conteúdo público; excluir 7 pais sem pedidos; manter 3 pais mínimos privados com 4 pedidos |
| `publicCatalogs/{token}/portalProfiles` | 1.678 projeções de clientes/campanhas, não clientes canônicos | Excluir somente folhas verificadas, sem subcoleções |
| `publicCatalogs/{token}/phoneIndex` | 528 índices derivados | Excluir somente folhas verificadas |
| `publicCatalogs/{token}/portalSessions` | 2 sessões exclusivas do portal antigo | Excluir; não são sessões Firebase Auth |
| `publicCatalogs/{token}/orders` | 4 pedidos, em 3 pais | PRESERVAR integralmente, sem atribuir espaço, converter ou excluir |
| `redemptionRequests`, subcoleções desconhecidas | Nenhuma no inventário; consideradas protegidas | Nunca excluir implicitamente |
| `businesses/adi-festa/settings/default.catalogSettings` | Configuração global antiga | Remover apenas o campo; conservar todas as demais configurações; marker `legacyStoreRetired` |
| `businesses/adi-festa/visits/{id}` | 6 registros de visitas com publicToken/catalogItems | Manter visitas; remover apenas publicToken, catalogItems e catalogSettings ligados aos tokens auditados |
| `publicCatalogSlugs` | `qa-v169-a`, `minhaloja-teste` pertencem a stores V2 existentes | PRESERVAR; nenhum slug legado foi encontrado |
| `catalogStoreBindings` | 1 binding V2, de QA | PRESERVAR; não excluir coleção inteira |
| `businesses/{id}/onlineStores`, `catalogOrders`, `onlineOrderReservations` | Modelo V2 e histórico compartilhado | PRESERVAR |
| Produtos, variações, clientes, vendas, pagamentos, estoque, saldos, financeiro, memberships | Fontes canônicas de outros módulos | ZERO escrita/exclusão |
| Imagens/Storage | Podem estar referenciadas por produtos e outros módulos | PRESERVAR; nenhuma limpeza de bucket ou origin |
| Auth, plano/assinatura, billing | Não pertencem à loja | ZERO alteração |

IDs de tokens não são publicados no relatório. Scripts exibem hashes de metadados;
credenciais permanecem em memória. Não há backup oculto do conteúdo excluído.

## Guarda da limpeza

`audit-legacy-store.cjs` é somente leitura. `cleanup-legacy-store.cjs` começa em
dry-run, exige empresa exata e hash do inventário revisado para `--apply`. Confere
schema, ownership, vínculo V2, referências de stores, subcoleções, folhas e updateTime.
Escopo exato é validado para TODA escrita. Não usa recursiveDelete, limpeza global,
deleção de banco, nem exclusão de orders/redemptionRequests. Qualquer alteração
concorrente na folha causa falha por precondição, não sobrescrita.

Primeiro desativa pais antigos para encerrar checkout público, depois remove somente
as projeções exclusivas. Pais com pedidos ficam com businessId/visitId/schema,
active=false e legacyStoreRetired=true, sem produtos, branding ou link ativo. Seu ID
continua como endereço de histórico protegido; apagar esse pai quebraria o acesso aos
pedidos. Nenhum pedido é copiado ou migrado. Retry reconhece pais já aposentados.

Metadados de quantidade/updateTime das coleções canônicas são comparados antes/depois.
O documento business (incluindo assinatura) não recebe nenhuma escrita. Não há ação
sobre usuários ou Firebase Auth. Mudanças externas concorrentes são relatadas, não
revertidas por este comando.

## Novo contrato local

- Rota de loja chama somente OnlineStoreUI, sem CatalogoUniversal, ensure/seed global,
  bridge de portal ou fallback de UI antigo.
- GET do espaço é somente leitura e não consulta catálogos globais. Sem store, retorna
  estado em preparação. Salvar cria um rascunho; publicar exige owner e confirmação.
- Migração/pause_legacy são ações inválidas. Novo token pertence apenas ao store V2.
- Loja pública recusa schema antigo, redirects antigos e cache offline de loja global.
- Rules locais impedem restaurar catalogSettings após retirement e protegem pais
  arquivados; serão publicadas somente mediante autorização posterior.
- Pedidos antigos são histórico separado. A sua permanência não é dependência da loja V2.

## Limite de produção antes de deploy

A exclusão de conteúdo antigo não exige publicar Functions. A V169 já bloqueia escrita
direta de publicCatalogs, mas Rules adicionais e interface nova ainda são locais. Um
PWA muito antigo pode tentar restaurar configuração de settings até a publicação do
novo fence; não consegue recriar a projeção pública pelas Rules V169. Não afirmar que
a interface nova já está em produção. Não usar rollback V169 para republicar legado.

## Resultado executado

Limpeza em produção concluída na empresa auditada, sem deploy: 2.208 projeções de
portal excluídas (1.678 profiles, 528 índices, 2 sessões), 7 pais sem dependências
excluídos e 3 pais aposentados conservando 4 pedidos. Um campo global de settings e
os 3 campos de catálogo em 6 visitas foram removidos. Slugs/binding V2 preservados.
2.232 escritas exclusivas de manutenção; ZERO escrita canônica e ZERO pedido excluído.
Não há recuperação/undo dessa exclusão por este fluxo; nenhum backup foi criado.

Metadados de todas as 15 coleções protegidas coincidiram antes/depois; nenhuma
mudança concorrente detectada. O documento business manteve o mesmo updateTime:
assinatura/plano/entitlement não foram alterados. Auth/Storage não foram acessados
para mutação. Nenhum produto, variante, venda, payment, saldo, estoque ou membro
foi alterado. Também foram preservados onlineStores, catalogOrders e reservas V2.

Dry-run depois da limpeza: catalogs=[], settingsField=false,
visitCatalogFields=0, writes=0. Os 3 pais restantes possuem somente orders.

Regressão local: 655/655 app, 131/131 backend, 163/163 Firestore/Auth/Storage Emulator;
lint/build e git diff --check aprovados. Cobertura inclui preparação sem herança,
publicação owner-confirmed, isolamento A/B/multiempresa, slug concorrente, estoque,
duplo clique/retry, status/cancelamento/conclusão, expiração, reserva concorrente,
privacidade do pedido e fence de recriação do legado. Um teste antigo de onboarding
usava Auth Emulator 9099 fixo; foi corrigido para usar o host local explicitamente
configurado 9097, sem modificar Auth da aplicação ou produção.

Verificação de interface por navegador e Android físico não foi refeita nesta etapa.
Não afirmar que o smoke controlado anterior da V169 foi integralmente encerrado.
Versão/SW continuam V169: não houve push, publicação Pages ou deploy Firebase.

## Arquivos desta alteração

- `js/online-store-ui.js`, `js/catalogo-admin.js`, `js/firebase/catalog-bridge.js`,
  `js/catalogo-publico.js`, `js/storage.js`, `index.html`: experiência V2 exclusiva,
  rascunho/publicação manual e fim do bootstrap/cache global.
- `functions/src/services/online-store-service.js`, `functions/src/shared/online-store.js`,
  `functions/src/index.js`: load/save/publicação/checkout sem migração ou fallback.
- `firestore.rules`: pais aposentados privados e bloqueio de recriação por cliente antigo.
- `functions/src/shared/legacy-store-cleanup.js`, `scripts/audit-legacy-store.cjs`,
  `scripts/cleanup-legacy-store.cjs`: política de escopo, auditoria e manutenção explícita.
- `tests/legacy-store-retirement.test.js`, `tests/online-store-v2.test.js`,
  `tests/emulator/online-store-v2.rules.test.js`, `tests/emulator/online-orders-v2.rules.test.js`,
  `tests/emulator/onboarding.rules.test.js`: validação funcional/segurança.
- Testes estáticos existentes de catálogo, hardening, multitenant, variações,
  mobile e branding atualizados para validar o contrato V2 (não a UI aposentada).

Trabalho isolado em `codex/online-store-v2-no-legacy` no worktree domain-release.
Alterações não relacionadas do workspace principal foram preservadas.
