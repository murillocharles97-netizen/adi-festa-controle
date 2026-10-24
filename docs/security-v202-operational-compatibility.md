# V202 — conclusão local da compatibilidade operacional

Base: V201 sanitizada `66e6969ba3b8cdc16053466ab2ae6c80e286ba78`, descendente da V199 sanitizada `3265f375a6bcd6276e202646725ce63e06a8d20c`.

Somente implementação e testes locais. Sem commit/tag de release, push, deploy, migração, alteração de permissões ou acesso a dados reais. Nenhuma fila/cache real foi aberta ou modificada. Os testes usam tenants fictícios em Firestore/Storage Emulator de loopback. Não foi retomada a Loja V3.

## As quatro rotinas administrativas

As APIs e entradas existentes do app foram mantidas. `js/firebase/sync.js` envia intenções tipadas para **`commitFinancialMaintenance`**, sem fallback para transação comercial no navegador.

| API existente | Comando servidor | Quem pode executar | Validação/efeito autorizado |
|---|---|---|---|
| `reconcileOnlyLocalSaleBalance` | `reconcile_only_local_balance` | Owner; admin existente com `customers.adjustBalance` e `settings.manage` | Motivo, alvo explícito, empresa/geração/espaço, ausência de venda/débito/resolução anterior, saldo e versão atuais. Registra ajuste e eventual evento, não publica venda nem estoque. |
| `recoverOnlyLocalSale` | `recover_only_local_sale` | Mesma autorização administrativa | Mantém saleId/operationId e ator original. Comprova itens, total, vínculo e **baixas originais já existentes**, sem mexer no estoque novamente. Fiado só aplica débito com saldo/versão anteriores exatos ou reaproveita efeito comprovado. Venda paga avulsa continua possível sem cliente. |
| `reconcileFinancialBalances` | `reconcile_balances` | Mesma autorização administrativa, com fontes completas da empresa | Recalcula a auditoria a partir de documentos canônicos lidos dentro da transação. Não aceita um corpo de evento/delta arbitrário enviado pelo navegador. Confere os IDs de efeitos previstos, cadeia e saldo/versão antes de aplicar ou apenas completar recibos ausentes. |
| `reverseDuplicatePayment` | `reverse_duplicate_payment` | Mesma autorização administrativa | Compara os dois pagamentos, cliente/valor, efeito original, saldo/versão e dependências. Bloqueia recebimento alocado/campanhas. Emite compensação determinística; **não reescreve o balanceEvent original**. Não realiza reembolso externo. |

Vendedor não recebe qualquer nova autorização. As quatro ações são recusadas no servidor para seller, inclusive com chamadas construídas fora da interface. Vínculo/plano/geração são rechecados dentro da transação.

Cada manutenção grava um recibo privado imutável em `financialMaintenanceAudits/{operationId}`, com responsável, timestamp, intenção original, hash e resultado. A coleção não tem acesso direto de clientes, incluindo owner; não possui trigger comercial. Os recibos comerciais necessários são emitidos atomicamente com os efeitos. Um retry do mesmo efeito retorna o resultado anterior; outro alvo/conteúdo é recusado. Uma prévia atualizada após resposta perdida não aplica o efeito duas vezes.

Os pacotes da fila **não são removidos**. Quando uma manutenção resolve uma venda local, a confirmação autenticada fica separada em metadados do namespace, vinculada a operação/venda/espaço/UID/geração/checksum. Auto-sync, Sync manual e reload mantêm o bloqueio de replay. As regras remotas de reconciliação continuam bloqueando uma tentativa sem essa confirmação local. Quarentenas e recuperações preexistentes permanecem preservadas.

## Campanhas e renovações

- Criação, edição, pausa/retomada e encerramento de campanha usam a permissão **existente** `reports.view`, plano e produtos/espaços autorizados. A comparação de versão aceita a representação canônica de timestamps e recusa edição concorrente.
- Ganho/resgate/confirmação/expiração/reversão são conferidos contra as mesmas funções de domínio da V2, geradas mecanicamente para o servidor, sem `eval` ou carregamento remoto de código.
- Progresso e eventos não podem ser forjados por escrita direta. Resgate não concede `inventory.adjust`: autoriza somente a baixa exata da recompensa comprovada. Estoque/reservas continuam conferidos no servidor.
- Recebimento autorizado confirma benefício pendente sem exigir `sales.create` adicional. Cancelamento autorizado pode compensar benefício sem conceder gestão de campanha.
- Renovações mantêm ativação, renovação, pausa/retomada/encerramento e histórico append-only. A extensão exige venda e itens correspondentes; uma mudança manual exige evento/status coerentes e acesso ao espaço. Não muda vigência para outro espaço silenciosamente.
- Cancelamento canônico de venda antiga com campanha/renovação continua sujeito aos bloqueios já publicados na V201; eles não foram removidos.

## Loja Online V2

`claimOnlineOrderFinalization` e `acknowledgeOnlineOrderFinalization` não foram alteradas. O novo canal confere **antes do commit**: ator, empresa, geração, espaço, saleId, operationId, status pendente da conclusão, total, lista exata de produto/variação/quantidade/preço, cliente e modalidade. A reserva do próprio pedido é validada contra os documentos canônicos; somente o acknowledge existente consome/libera a reserva após confirmação.

IDs antigos válidos com `:` e componentes URI-encoded continuam aceitos como **um único ID de documento**; barras/caminhos continuam proibidos. Nenhum ID é substituído durante retry.

## Estoque inicial

- A origem `initialStockSpaceId` é capturada no diff da **ação nova**, antes da persistência da operação, e não na seleção de espaço durante upload/retry.
- O cadastro valida uma origem inequívoca antes de publicar sua alteração local. `all_spaces` exige um espaço operacional autorizado selecionado, ou único elegível. O vínculo comercial do produto não é alterado para contornar o guard.
- Servidor confirma produtos/estoque habilitados no espaço, vínculo do produto, saldo inicial/aliases, reserva zero e grants existentes de cadastro.
- Cada produto simples/variação recebe movimento determinístico `initial_<hash>`. Produto pai variável é somente agregado, sem segunda entrada física.
- **Não há backfill/migração automática.** Produto histórico órfão com estoque e sem origem comprovada não ganha uma entrada inventada. Operações antigas ambíguas continuam intactas para revisão explícita.

## Sync e permissões

- `commitOperationalSync`: mesmo envelope durável, IDs/checksum locais preservados, hash de conteúdo no recibo servidor, commit atômico e confirmação de autoria/escopo/plano/geração. Nenhuma escrita direta é usada como fallback.
- `getOperationalSyncReceipt`: confirmação mínima do efeito Fiado ou seu desfazimento, sem conceder leitura de Financeiro ao vendedor.
- Resposta perdida, duplo clique e nova instância do serviço retornam um único efeito e recibo. Alteração de conteúdo no mesmo ID falha.
- Erros de domínio tipados viram `failed-precondition` no callable; erros de rede continuam transitórios. Permissão permanente, quarentena, revisão e arquivo não entram em loop.
- Resolução de um **recebimento conflitante não aplicado** continua permitida em transição estrita. Recebimento aplicado e seu evento não são reescritos.
- Auditoria de perfil financeiro restrito a alguns espaços informa escopo parcial e não propõe reconciliação do saldo empresarial global. Erros de fontes autorizadas continuam aparecendo.
- Callbacks da conta anterior são invalidados; confirmação administrativa não grava no cache da sessão seguinte. Caches permanecem separados por usuário.

## Functions e Rules

Functions novas no pacote: **`commitOperationalSync`**, **`getOperationalSyncReceipt`**, **`commitFinancialMaintenance`**. Nenhuma Function comercial existente foi modificada. `index.js` apenas registra esses novos callables.

Firestore Rules fecham escritas comerciais diretas já identificadas na base V202 e, para que a validação de compatibilidade não possa ser contornada, também tornam server-only as gravações de campanhas/progresso/eventos/resgates e vigências/eventos de renovação. Leituras continuam conforme as permissões existentes. A auditoria administrativa privada é server-only. Storage mantém a restrição de permissão financeira + espaço da base V202. Não há novas permissões, índices compostos ou migração previstos neste pacote.

## Arquivos

Runtime:

- `firestore.rules`, `storage.rules`.
- `functions/src/index.js`.
- `functions/src/services/operational-commit-service.js`, `financial-maintenance-service.js`, `operational-engagement-validation.js`.
- `functions/src/shared/commercial-commit-engine.js`, `engagement-domain.js`, `financial-maintenance-audit.js`, `operational-callable.js`, `operational-id.js`.
- `js/firebase/sync.js`, `js/firebase/firestore-repository.js`, `js/workspace-callables.js`, `js/produtos.js`, `js/product-variations.js`.

Suporte/testes:

- Os três geradores `scripts/generate-*.cjs` deste pacote e `scripts/verify-v202-security-floor.cjs`.
- `firebase.security.json`.
- Novos `authorization-hardening.rules.test.js`, `operational-compatibility.rules.test.js`, `operational-commit-client.test.cjs`.
- Contratos atualizados em testes de cancelamento, arquivo de incidente, finalização online, renovação, reconciliação manual e escopo da auditoria. Asserções que esperavam escrita direta foram substituídas por **negação direta + caminho servidor permitido**, não removidas para esconder falha.
- Este documento e `security-authorization-v202.md`.

## Validação e limites

Resultados finais selecionados: **243 testes do app/Sync + 25 de catálogo/estoque + 35 de backend aprovados**. A rodada integral crítica do Emulator passou **200/200**; após os últimos refinamentos, os três arquivos do gateway/admin/online passaram novamente **71/71**, incluindo um cenário adicional de recebimento conflitante/confirmado. O arquivo administrativo passou ainda **31/31** no fechamento, com a regressão adicional de colisão de ID de evento. São **202 cenários distintos de Emulator cobertos**, sem falhas remanescentes nesses testes. Não se trata de afirmação sobre toda a suíte global histórica.

Cobertura inclui venda normal/Fiado, recebimento, cancelamentos rápidos/canônicos, troca/crédito, ajuste/entrada inicial, campanhas, renovações, finalização online, quatro comandos administrativos, seller/owner, negativa de Financeiro, isolamento, reload/troca de sessão, resposta perdida e idempotência. Lint/build, três geradores/paridade, diff-check e allowlist pública passaram. A publicação local de teste contém somente os 224 recursos previstos. Os dois rulesets GitHub foram consultados, permanecendo ativos; o push URL local segue desabilitado.

Logs fictícios privados: `C:/Users/Murillo/.codex/visualizations/2026/10/24/security-authorization-v202/`, em especial `node-operational-final.log`, `initial-stock-catalog-regressions.log`, `backend-compatible-final.log`, `compatibility-release-floor.log`, `final-operational-gateway.log`, `maintenance-final-immutable.log` e `compatible-floor-manifest.json`. Não entram no build público.

Limites explícitos: reparos históricos sem evidência suficiente seguem para revisão, nunca estimativa; consultas históricas do domínio são limitadas para caber na transação; filas antigas de estoque ambíguo não são reescritas. O rollout precisa garantir que os clientes ativos usam a nova bridge **antes** de fechar as Rules. Não houve teste em dados/contas reais nem homologação de latência de rede real nesta etapa.

Os achados fora dos bloqueadores aprovados (custos aninhados legados, markup de campanhas e tokens antigos de anexos) não são declarados corrigidos aqui. A contenção V199/allowlist continua intacta.

## Ordem segura de publicação — depende de nova autorização

1. Confirmar base sanitizada, pacote isolado, hashes, credencial temporária e rulesets ativos. Sem bypass/desativação de proteções por iniciativa do agente.
2. Publicar **somente os três callables novos**, incluindo os módulos de domínio/validação. Manter todos os serviços V201 de Trocas/crédito/Fiado/cancelamento/projeção financeira.
3. Publicar frontend/PWA versionado V202 com bridge, origem inicial e consultas escopadas. Metadados HTML/SW/imports já estão preparados na etapa de release, mantendo manifest e allowlist.
4. Confirmar atualização de cada aparelho operacional conhecido e QA do novo canal enquanto as Rules antigas ainda estão ativas. Não presumir atualização remota, descartar filas nem forçar logout. Filas de protocolo anterior permanecem retidas para revisão. A janela só termina após o fechamento das Rules.
5. Publicar **Firestore e Storage Rules restritivas**; repetir os testes negativos e smoke QA. Não reabrir escrita genérica se uma operação falhar.
6. Validar login, seller/owner, Sync manual/automático, recebimento, finalização online e módulos existentes somente QA. Interromper diante de qualquer bloqueador.

Nenhum dado comercial real deve ser utilizado como smoke.

## Rollback compatível com V201

O piso de rollback é a **interface/recursos da V201 com a bridge, os três callables, validadores, Rules restritivas, consultas escopadas e leitores de recibos V202 preservados**. Como esta etapa só muda autorização/compatibilidade, esse piso não exige restaurar dados nem migrar documentos. Nunca restaurar as Rules permissivas ou o uploader antigo.

`scripts/verify-v202-security-floor.cjs` verifica a genealogia e a identidade de 13 fontes comerciais/containment V201 retidas (metadados HTML/SW agora são V202), confere geração do domínio e emite hashes dos arquivos que não podem regredir. O teste de rollback também mantém a leitura dos recibos, idempotência e estruturas de Trocas/créditos/recuperação/cancelamento.

Preparação de commit/tag e transição agora autorizada, sem push/deploy. O procedimento e os limites do rollback compatível estão em [pacote V202](security-v202-release.md). Os rollbacks históricos sanitizados continuam preservados, mas não substituem esse piso de segurança.
