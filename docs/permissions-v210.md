# V210 — Permissões V2 (candidato para publicação controlada)

Base sanitizada: V209 `d1a549d9f00d86ce856a00ac80f86a38eeb57b5c`.
Branch de trabalho: `codex/v210-permissions-v2`. Publicação controlada autorizada pelo usuário; hashes e etapas efetivamente executadas ficam registrados no relatório privado do release.

## Matriz atual × proposta

As 20 chaves existentes permanecem. São acrescentadas somente duas chaves reais, de clientes (22 no total). Controles vinculados de descontos, preços, Loja Online, metas e administração continuam vinculados; não são autorizações fictícias independentes.

| Chave | Até V209 | V210 |
|---|---|---|
| `sales.create` | Vender e consulta operacional | Mesmo alcance; guard antes da captura comercial |
| `sales.cancel` | Cancelamento autorizado e requisito de Trocas | Mesmo alcance; não concede edição arbitrária de vendas |
| `sales.viewAll` | Consulta administrativa/pedidos | Preservada |
| `customers.view` | Consultar clientes | Preservada; pré-requisito dos controles de cadastro |
| `customers.create` | Incluída em `customers.edit` | **Nova**: cadastro novo, saldo zero, sem editar existentes |
| `customers.edit` | Cadastrar, editar e remover cliente | Dados cadastrais existentes no modelo V2; não muda saldo |
| `customers.archive` | Incluída em `customers.edit` | **Nova**: desativação/reativação; não apaga cadastro/histórico |
| `customers.receiveDebt` | Recebimentos/consulta de Fiado | Preservada; fluxo canônico, não exige Financeiro adicional |
| `customers.adjustBalance` | Ajuste explícito de saldo | Preservada; exige evento tipado, não patch solto de saldo |
| `products.view` | Consultar produtos | Preservada |
| `products.edit` | Cadastro/edição/arquivamento | Preservada; não necessária para estoque derivado de venda autorizada |
| `inventory.view` | Estoque/movimentações | Preservada |
| `inventory.adjust` | Entradas/ajustes | Preservada; não necessária para baixa de uma venda autorizada |
| `financial.view` | Consultar e movimentar Financeiro | Mesmo alcance; guard na API antes de chamadas/efeitos locais |
| `reports.view` | Relatórios, CRM e campanhas | Preservada; não equivale a edição de clientes |
| `profit.view` | Lucro/margem | Preservada; continua a ressalva de registros financeiros compartilhados |
| `cost.view` | Custos | Preservada; não concedida para poder vender |
| `team.view` | Consultar equipe | Preservada |
| `team.manage` | Gerenciar funcionários/permissões | Preservada; revalidada na transação; sem autoelevação/delegação de espaços extras |
| `settings.manage` | Configurações empresariais | Preservada; inclusive guard anterior à alteração do modelo de operação |
| `billing.manage` | Acesso a planos | Preservada; cobrança/contratação continuam com seus guards canônicos |
| `spaces.manage` | Gerenciar espaços | Preservada; protegida também na ação antes da projeção otimista/fila |

## Divergências encontradas e tratadas

1. Cadastro e edição compartilhavam `customers.edit` no domínio, cadastro rápido, importação, editor e gateway. Agora as decisões são por ação; cliente não confirmado continua impedindo a venda dependente.
2. Normalizações completavam mapas existentes com o preset do cargo. O retorno de membership passa a preservar o mapa original, e a atualização de um membro existente não preenche direitos ausentes com um preset.
3. Arrays legados eram exibidos como direitos, mas não eram autorizados pelo servidor V209 (que exige mapa booleano). Não são promovidos automaticamente: snapshot original preservado, aviso ao gestor, revisão e confirmação explícitas para uma conversão V2.
4. Não havia uma mesma verificação preventiva para todas as alterações capturadas. A nova política valida os writes antes da memória/publicação da fila, inclusive caminhos write-ahead de venda e recebimento. A decisão definitiva permanece no servidor.
5. A API financeira verificava plano sem uma barreira uniforme de permissão. Os métodos financeiros agora verificam `financial.view` antes de operar; os metadados de espaços necessários ao caixa continuam acessíveis.
6. Gerenciamento de espaços e modelo de operação tinham caminhos por cargo/evento que podiam projetar alterações antes da recusa. Os handlers agora verificam a chave efetiva antes da mutação.
7. Watcher de membership e escritas SDK assíncronas podiam sobreviver ao contexto original. Agora têm epoch/UID/empresa e snapshot de permissões; uma resposta anterior não confirma/salva na sessão seguinte.
8. A disponibilidade derivada de variações podia ser interpretada como edição de catálogo ao vender a última unidade. O guard distingue a projeção; o servidor recalcula a disponibilidade das variações canônicas e exige movimento autorizado (ou edição legítima do catálogo). Não aceita um flag arbitrário.
9. As Rules atuais ainda admitiam alguns writes diretos de clientes. Há um pacote **de transição separado**, derivado exatamente das Rules ativas, que obriga membros V2 a usar o gateway para clientes. Não ativa as Rules restritivas pendentes da V202.

## Compatibilidade e migração

- Não há migração automática nem atualização de funcionários reais.
- Mapa legado booleano com `customers.edit: true`, sem novas chaves, mantém apenas as duas atribuições que já possuía (cadastrar e desativar). `false` explícito sempre prevalece. Cargo sozinho não preenche permissões existentes.
- O editor mostra essas atribuições preservadas antes de salvar. Ao confirmar, envia as 22 escolhas explícitas e `permissionsVersion: 2`, mantendo cargo/espaços e o snapshot CAS original.
- Em V2 não há herança: `edit: true` com `create: false` não cadastra. É possível cadastrar sem editar ou desativar.
- O retorno de membership não é um preset; o cache não recebe aliases novos automaticamente só por abrir uma sessão legada. Os IDs, payloads, checksums e filas existentes não são reescritos.
- Um editor antigo não pode sobrescrever um vínculo já convertido em V2. Recebe orientação para atualizar, sem salvar mudanças.
- Convites novos transportam a versão e as escolhas explícitas. Modelos básicos não concedem cadastro automaticamente ao vendedor; o gestor escolhe. Gerente não recebe Financeiro/equipe/configurações/arquivamento por preset.
- Cadastro create-only exige confirmação do servidor de `permissionsVersion: 2` no handshake da sessão. Sem essa confirmação, o formulário permanece e a operação não é criada. O protocolo comercial continua sendo **1**, compatível com clientes V202–V209.
- Erros permanentes, revisões, quarentenas e arquivos históricos não são reativados por uma liberação de permissão.
- Offline: o app só usa a autorização conhecida da sessão e não declara confirmação remota inexistente. Não é possível conhecer uma revogação remota enquanto o aparelho está desconectado; o servidor revalida no envio. Uma sessão create-only sem handshake atualizado precisa conectar antes de criar cadastros. Isso não apaga rascunhos/filas.
- Vínculos legados esparsos podem ter recebido defaults de cargo somente na projeção de versões antigas. Remover esses defaults não modifica o registro real, mas pode mudar a assinatura de permissões/namespace. Os namespaces anteriores permanecem preservados; antes de publicar/converter esses casos, conferir filas por namespace, sem copiar ou reenviar operações automaticamente.
- Importação cadastral exige cadastro + edição. Importação que tentaria criar/reescrever saldos fora do fluxo financeiro autorizado é bloqueada antes de salvar, em vez de enfileirar uma operação que o gateway recusará. Não há ajuste de saldo implícito.

## Implementação e componentes

- Política pública pura: `functions/src/shared/permission-policy.js` (mesmas chaves no frontend/servidor).
- Guard de captura: `js/permission-mutations.js`, `js/firebase/sync.js`.
- Clientes: domínio, ações rápidas, checkout, formulário da página e formulário legado.
- Equipe: modelo/editor/página, serviço do frontend e `team-access-service` do servidor.
- Sessão: `business-context`, watcher da equipe, `workspace-firestore`/`workspace-writer`.
- Financeiro, espaços e configuração: guards nas APIs existentes; nenhuma concessão financeira nova.
- Contenção: somente os dois novos módulos públicos puros entram na allowlist. Fixtures, documentação, artefatos e Rules não são públicos.
- Nenhuma Function de recuperação V205–V208 foi modificada. Nenhum código comercial de Trocas/créditos foi modificado.

### Functions existentes a atualizar no release

`commitOperationalSync`, `getOperationalSyncReceipt`, `ensureCurrentMembership`, `createTeamInvite`, `acceptTeamInvite`, `updateTeamMember`.

Não há nova Function nem índice. `getTeamInvitePreview` não precisa ser republicada. O gateway conserva recibos, validações financeiras, isolamento e idempotência.

## Plano de publicação (requer autorização)

1. Revalidar base sanitizada, diff isolado, rulesets GitHub ativos e credencial temporária. Repetir somente os checks essenciais após gerar o commit.
2. Publicar as seis Functions indicadas, mantendo protocolo 1 e compatibilidade legada. Validar handshake/negativas/recibos em QA. Não converter funcionários durante essa etapa.
3. Revalidar por hash que as Rules ativas ainda são a base registrada em `security/v210/transition-baseline.json`. Qualquer divergência interrompe o deploy do patch de transição.
4. Publicar **somente** `security/v210/firestore.transition.rules` usando a configuração `security/v210/firebase.transition.json` e `--only firestore:rules`. Não usar o `firebase.json` principal para essa etapa: ele aponta para o pacote restritivo V202 ainda pendente. Storage permanece intacto.
5. Validar em QA vínculo legado e V2: V1 mantém o caminho anterior, V2 só escreve clientes pelo gateway; no restante, o arquivo de transição é idêntico à base ativa.
6. Publicar frontend/PWA V210 com a allowlist, confirmar assets/Service Worker, autenticação e filas QA. Não limpar armazenamento e não enviar operações históricas.
7. Só depois atualizar os aparelhos e permitir que o gestor revise/converta individualmente acessos. Antes de converter um aparelho com operações comerciais pendentes, conferir seu diagnóstico; não transportar/reexecutar filas automaticamente entre contextos.

O `firestore.rules` principal também contém o mesmo guard V210 para que uma futura ativação V202 não o perca, mas **esse arquivo principal não faz parte do deploy de transição**. A ativação V202 continua dependendo de autorização e do inventário dos aparelhos.

## Rollback compatível

Não é seguro restaurar integralmente frontend/backend/Rules V209 depois de existirem vínculos V2. Isso perderia a distinção de clientes e poderia reabrir escritas diretas.

O pacote `security/v210/rollback-compatible.patch` pausa a edição de permissões na interface/API cliente e usa um cache de assets separado. Mantém os acessos já salvos, o cadastro create-only autorizado, todos os guards, Functions, Rules de transição, recibos e canais comerciais. É uma **pausa operacional compatível**, não um retorno ao código inseguro. Um defeito no gateway exige correção para frente, sem baixar esse piso.

Validar/aplicar com `git apply --check --ignore-space-change security/v210/rollback-compatible.patch`. O processo autorizado cria commit separado e tag `rollback/v210-compatible-permissions-v2`, preservando exatamente o backend e as Rules V210; somente a interface de edição é pausada.

## QA e prévia

- Runner reproduzível: `node scripts/test-permissions-v210.cjs node`.
- Emulator: `firebase emulators:exec --only firestore --project demo-veconi-permissions-v210 "node scripts/test-permissions-v210.cjs emulator"`.
- Resultados detalhados gerados em `artifacts/permissions-v210/` (ignorados pelo Git e fora do pacote público).
- DOM real com dados fictícios: controles independentes, dependências, modelo Personalizado, revisão explícita, duplo envio, erro de rede, sucesso confirmado, troca de sessão e pausa compatível.
- Testes em 320/360/390/430/768/1440 representam estados DOM/colapso; **não substituem medição de layout nem teste físico Android**.
- Prévia navegável: `node scripts/serve-team-permissions-qa.cjs` → `/tests/team-permissions.fixture.html`. Sem Firebase, CSP `connect-src 'none'`, somente loopback.
- Capturas desktop/mobile não foram produzidas: o navegador do Work respondeu **“Local browser use is disabled in Work settings”**. Nenhum bloqueio foi contornado e nenhuma imagem fictícia foi apresentada como captura.

## Riscos e limites restantes

1. Não liberar chaves V2 em produção antes de Functions + patch granular de Rules estarem validados; frontend isolado não basta.
2. Atualizar os aparelhos antes da conversão individual. Um aparelho antigo não ganha suporte a create-only por receber uma permissão nova; a fila original permanece protegida.
3. Formulários negados preservam o texto; ao trocar identidade/empresa, editores antigos são deliberadamente invalidados, em vez de reutilizados.
4. Os problemas gerais cobertos pelo pacote restritivo V202 continuam pendentes em produção até sua ativação separada. O patch V210 não se apresenta como conclusão daquela etapa.
5. Validação visual física e capturas permanecem pendentes devido ao bloqueio do navegador, não por testes comerciais em lojas reais.
6. Produção, usuários reais, vendas recuperadas, auditorias, recibos, estoque e quatro ocorrências históricas não foram modificados.

## Revisão final de compatibilidade

- O caixa legado sem membership mantém somente as atribuições do cargo imutável já aceito pelo servidor V209. Mapas editáveis no perfil não se tornam fonte de autorização. Arrays de permissões de memberships continuam não autorizados como eram no servidor; não confundir os dois casos.
- Edição de nome/telefone nunca reativa um cliente. Desativação e reativação usam a mesma confirmação explícita de status, com permissão própria e validação da sessão; preservam saldo, cadastro e histórico.
- Convites V2 exigem escolhas explícitas e coerentes. Reenviar um convite preserva sua versão, sem recuperar atribuições implícitas de um modelo legado.
- O snapshot assíncrono inclui a versão e o mapa original de permissões. Uma conversão V1 → V2 invalida callbacks anteriores mesmo quando a lista de chaves verdadeiras não mudou.
- Sem membership confiável, um cargo ou mapa do perfil não autoriza ações locais; somente o proprietário canônico conserva a recuperação de acesso existente.
- O teste antigo de estoque inicial em `all_spaces` usava um editor limitado a um espaço. A V210 bloqueia essa ampliação de escopo deliberadamente. O positivo agora usa autorização explícita para todos os espaços, e os negativos restritos permanecem.
- O teste da Loja Online foi atualizado para usar o gateway real de vendas, em vez de forjar recibos/baixas diretamente pelo SDK. Os ataques diretos continuam sendo testes negativos. Não houve alteração de código comercial da Loja Online.
- Os testes Emulator são sequenciais: a execução paralela das suítes gerou uma falha transitória de transação inválida/fechada no Emulator. Não foi adicionado retry ao código comercial nem ignorado teste; a execução final deve passar integralmente.

## Resultado final dos checks locais

| Verificação | Resultado |
|---|---|
| App/DOM, 29 arquivos de testes | 406 aprovados, 0 falhas, 0 ignorados |
| Emulator Firestore local, 7 suítes sequenciais | 129 aprovados, 0 falhas, 0 ignorados |
| Reexecução focada final, incluindo reativação legada | 16 aprovados, 0 falhas |
| Lint | Aprovado: 2.436 arquivos JavaScript na execução |
| Build/check estrutural | Aprovado: 2.436 arquivos JavaScript na execução |
| Proveniência dos três módulos gerados | Aprovada, sem regeneração comercial |
| Pacote público | 229 recursos allowlisted, sem fixtures/documentação interna |
| Patch de rollback compatível | `git apply --check --ignore-space-change` aprovado |
| `git diff --check` | Aprovado |
| Capturas/renderização e Android físico | Não testados: navegador bloqueado pelo Work |

Os testes positivos incluem cadastro create-only, atualização de permissões, convites, venda à vista/Fiado, recebimento, cancelamento, Trocas/crédito, estoque, campanhas, rotinas administrativas e finalização online pelo gateway. Os negativos incluem autorização, empresa/espaços, saldo e recibos forjados, revogação, callbacks antigos, preservação de rascunhos e bloqueio de replay. Não foi executada a suíte global inteira; os números são das suítes essenciais indicadas no runner.

O processo controlado registra os commits de release/rollback e a publicação remota separadamente. Não se deve deduzir execução de deploy apenas pela existência deste documento.

## Gates adicionais para a publicação autorizada

- `scripts/verify-v210-release.cjs`: allowlist de alterações, ancestralidade sanitizada, código comercial e recuperação intactos, prova de que o patch de Rules só acrescenta o guard de clientes V2.
- `tests/emulator/permissions-v210-callable-smoke.cjs`: 13 checks autenticados com Auth/Functions/Firestore locais. Exercita as seis Functions, o cliente release 209 com protocolo 1, convite/aceite, owner, listener de membership, create-only, revogação, isolamento, recibos e quarentena. Projeto `demo-` obrigatório; nenhuma operação comercial em produção.
- Preflight somente leitura encontrou cinco vínculos owner/seller nas empresas conferidas, com as 20 chaves explicitamente autorizadas preservadas. Nenhum vínculo foi convertido durante o deploy.

## Arquivos alterados nesta implementação

- `.gitignore`
- `css/team.css`
- `docs/permissions-v210.md`
- `firestore.rules`
- `functions/src/services/operational-commit-service.js`
- `functions/src/services/team-access-service.js`
- `functions/src/shared/permission-policy.js`
- `index.html`
- `js/app.js`
- `js/build-info.js`
- `js/checkout.js`
- `js/client-actions.js`
- `js/clientes-page.js`
- `js/clientes.js`
- `js/fiados.js`
- `js/firebase/business-context.js`
- `js/firebase/financial-space-service.js`
- `js/firebase/space-service.js`
- `js/firebase/sync.js`
- `js/firebase/team-service.js`
- `js/firebase/workspace-firestore.js`
- `js/operation-mode.js`
- `js/permission-mutations.js`
- `js/produtos.js`
- `js/team-access.js`
- `js/team-page.js`
- `js/team-permission-editor.js`
- `js/team-permission-model.js`
- `js/vendas.js`
- `js/workspace-writer.js`
- `public-site.manifest.json`
- `scripts/build-public-site.cjs`
- `scripts/serve-team-permissions-qa.cjs`
- `scripts/test-permissions-v210.cjs`
- `scripts/verify-v210-release.cjs`
- `security/v210/firebase.transition.json`
- `security/v210/firestore.transition.rules`
- `security/v210/rollback-compatible.patch`
- `security/v210/transition-baseline.json`
- `service-worker.js`
- `tests/customer-permission-v205.test.cjs`
- `tests/emulator/authorization-hardening.rules.test.js`
- `tests/emulator/online-orders-v2.rules.test.js`
- `tests/emulator/operational-compatibility.rules.test.js`
- `tests/emulator/permissions-v210.rules.test.cjs`
- `tests/emulator/permissions-v210-callable-smoke.cjs`
- `tests/helpers/sync-integrity-scope-harness.cjs`
- `tests/permissions-editor-v210.dom.test.cjs`
- `tests/permissions-v210.test.cjs`
- `tests/public-site-containment.test.cjs`
- `tests/static-containment-worker.test.cjs`
- `tests/team-access-v150.test.js`
- `tests/team-permission-model.test.js`
- `tests/team-permissions.fixture.html`
