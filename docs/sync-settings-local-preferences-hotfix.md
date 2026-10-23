# Hotfix local — preferências, hidratação e configuração sem autorização

Data: 20/10/2026. Base operacional V191, commit `1c0d48c96e2519b9c822beb39866e962c82879e7`, branch `codex/online-workspace-ux-v177`.

Implementação local, sem commit ou deploy. Nenhum login, Sync/retry, alteração de permissão ou dado comercial real foi executado. Prévia independente da Loja V3 preservada e não utilizada.

## Escopo implementado

### Preferências e hidratação

- `js/storage.js`: `DB.getRecentClientIds()` e `DB.rememberRecentClient(id)` guardam até cinco IDs como preferência local por UID + empresa + geração. Não leem/migram o antigo `config.recentClientIds` compartilhado. Falha de armazenamento mantém fallback em memória, sem impedir a escolha do cliente.
- `js/checkout.js`: o picker não chama `DB.alterar` para guardar recentes. Clique e debounce validam empresa/principal/geração e identidade dos elementos do modal. Callback antigo não renderiza clientes nem seleciona/grava preferências de outra sessão. Fechar cancela o timer.
- `DB.hydrateConfig(patch)` persiste a projeção local por caminho separado da captura do Sync, mantendo fences, normalização e sanitização. O bootstrap de nome/telefone em `js/firebase/auth.js` usa essa API. Edição explícita do proprietário permanece no fluxo anterior.
- `diffWrites` só gera settings quando o contexto autenticado efetivo possui `settings.manage`. Antes/depois de config são normalizados simetricamente; `operation`, `recentClientIds` e `appSchemaVersion` não viram patch empresarial.
- A entrada de baixo nível `queueWrites` também recusa settings sem autorização, antes de append/agendamento. Estado de autorização ausente ou obsoleto falha fechado.

### Operação antiga preservada

Operação do diagnóstico: `ccf95d33-7a3e-45d3-afac-8a306d073f86`, criada em 17/10, `settings/default`, erro original `permission-denied`, 11 tentativas, checksum `fnv1a:f360ebf8`.

**Nenhuma alteração foi aplicada a esse aparelho/registro real durante a implementação.** Ao receber a versão, um pacote com esse formato e contexto elegível ficará efetivamente `quarantined`, motivo `settings_permission_required`, sem modificar o estado original `error` nem seu payload.

A classificação exige:

1. Ator autenticado igual ao autor; empresa/perfil iguais; geração operacional correspondente.
2. BusinessContext resolvido, sem erro, papel conhecido, UID/empresa coincidentes, permissões efetivas disponíveis e membership não inativo.
3. Operação standalone `simple/legacy`; todas as escritas em `settings/default`, create/update.
4. Ausência explícita de `settings.manage` nesse contexto.

Contexto desconhecido não gera uma conclusão permanente de falta de permissão: apenas bloqueia envio/normalização enquanto não for resolvido. Lotes mistos e vendas reais não são classificados como configurações descartáveis nem divididos. Guard de autorização impede reenvio de settings não autorizado, mas conserva o alerta acionável desses outros casos.

O mecanismo existente registra um sidecar separado em IndexedDB, no key-value do namespace:

`{queueKey}:manualReview:{queueId}`

Contém motivo, timestamp, IDs, checksum e `originalPacketJson`. A fila original, operationId, payload, tentativas, timestamps e erro original não são reescritos/removidos. Compatibilidade, envio automático, manual e forçado respeitam esse bloqueio. Concessão futura de permissão não libera silenciosamente um sidecar já persistido.

Não é encerramento do incidente nem arquivamento remoto. A UI e a API não oferecem o arquivamento genérico dessa configuração: o backend atual tem um contrato específico de incidente histórico que não inclui settings. Nenhuma mudança de Rules/Function ou tombstone remoto foi criada como atalho.

Configuração preservada não bloqueia hidratação canônica de `settings/default`: o owner pode atualizar a empresa e o seller recebe a nova projeção sem alterar a evidência. Essa exceção não se aplica a lotes mistos/comerciais.

### UI e diagnóstico

Quando essa for a única ocorrência:

> 1 ocorrência preservada para análise. Nenhuma sincronização pendente.

No detalhe:

> Configuração preservada — envio bloqueado neste perfil
>
> Este perfil não pode alterar configurações da empresa. O registro original permanece para análise, sem reenvio automático ou manual.

A ocorrência continua visível, mas não conta como envio pendente, erro ativo ou processamento em andamento. Operações comerciais legítimas, falhas de listeners, rede e integridade continuam alertando normalmente. Somente uma falha ativa explicitamente atribuída ao mesmo operationId/empresa/ator pode ser retirada do estado ativo; histórico permanece intacto.

- Histórico `lastErrorPath` antigo é preservado como evidência.
- Novo diagnóstico da retenção mostra `settings_permission_preflight`, `settings/default` e a permissão exigida.
- O proxy SDK registra o caminho real de cada leitura/preparação de escrita.
- Uma rejeição do commit não acusa automaticamente o último marcador. Mostra destino(s) do pacote, etapa `shared_settings_commit`/`transaction_commit`, caminhos da transação e `lastObservedPath` separado. Explica que Firestore não individualiza no cliente qual Rule negou um commit atômico.
- Callback de sessão aposentada não recebe diagnóstico de Firestore na conta substituta.

## Arquivos desta correção

Aplicação:

- `js/storage.js`
- `js/checkout.js`
- `js/firebase/auth.js`
- `js/firebase/sync.js` — somente os hunks deste hotfix; ver exclusão obrigatória abaixo.
- `js/firebase/firebase-ui.js`

Testes novos:

- `tests/checkout-local-preferences.test.js`
- `tests/sync-settings-permission.test.js`
- `tests/sync-settings-permission-ui.test.js`
- `tests/emulator/sync-settings-permission.rules.test.js`

Ajustes de testes existentes:

- `tests/team-sync-release-v179.test.js`: mantém o digest do checkout V177, desfazendo em memória somente o diff aprovado de preferência/fences; rejeita qualquer alteração extra. Reconhece o baseline publicado V191 com URLs antigas intencionais, mas exige URLs novas para a próxima versão.
- `tests/sync-session-alert.test.js`: mesma distinção do baseline V191; não força uma mudança de versão/imports sem preparar uma release.
- `tests/emulator/sync-integrity-permissions.rules.test.js`: corrige helper de snapshot para comparar conteúdo real, não `undefined`; assertions mantidas.

## Validação

Suíte dirigida do app: **125/125 aprovados** — preferências, bootstrap, settings, UI, quarentena/arquivamento, sessão/cache, Dashboard/Histórico, auditoria por permissão e recovery. Destes, 23 são os cenários específicos de captura/guard/diagnóstico de settings. Lint e build aprovados (404 arquivos JavaScript); `git diff --check` aprovado, somente avisos de conversão LF/CRLF.

Comando Node:

```text
node --test tests/checkout-local-preferences.test.js tests/bootstrap-no-commercial-writes.test.js tests/sync-settings-permission.test.js tests/sync-settings-permission-ui.test.js tests/sync-queue-quarantine.test.js tests/cache-session-hotfix.test.js tests/storage-bootstrap-performance.test.js tests/sync-session-alert.test.js tests/sync-integrity-permissions.test.js tests/operational-dashboard-access.test.js tests/sale-recovery-decision.test.js tests/team-sync-release-v179.test.js
```

Emulator, somente IDs/dados fictícios, projeto `demo-v191-settings-regression`, host localhost:

- 7 cenários novos de settings/diagnóstico: seller sem grant, rollback atômico, marcador isolado permitido, owner autorizado/idempotente, grant/contexto obsoleto no cliente, leitura realmente negada versus commit negado.
- 15 cenários existentes de venda manual/estoque com identidade seller.
- 10 cenários existentes de arquivo/replay fence.
- 4 cenários existentes de integridade por permissões, com snapshot real.
- Total 36 aprovados. Emulator encerrado após os testes.

Revisão independente reproduziu e confirmou: timer antigo inerte, contexto desconhecido sem quarentena, payload legado malformado sem novo TypeError e hidratação remota com evidência intacta.

Nenhum teste gerou venda real. Não houve smoke autenticado em produção. Testes VM/SDK/Emulator não substituem o smoke curto após uma publicação autorizada.

## Exclusão obrigatória do pacote de publicação

Antes deste trabalho já existia um diff não publicado de 11 adições/4 remoções em `verifySaleQueueCommit`, paralelizando confirmação de venda Fiado. Ele foi preservado integralmente no worktree, mas **não pertence a este hotfix**.

Não publicar o worktree inteiro. Preparar a próxima release a partir da V191 limpa, aplicar somente a allowlist acima e manter `verifySaleQueueCommit` igual à V191 publicada. Uma prova em memória executou os **125 testes novamente** com essa função substituída pelo baseline, sem editar o worktree; 125/125 passaram.

SHA-256 LF da função ACK baseline: `d12682922658762b79ae0482dd8606dd904005bcc4484d4081db2c2a9aba42c4`.

SHA-256 LF do Sync candidato em memória, sem o hunk Fiado: `10bbf93e7863367b42ca15fa5866bb309526be6cd4733941d58af3b0ba4b9ffa`.

Nenhuma alteração de `firestore.rules`, `storage.rules`, índices, Functions, estoque, Fiado, Financeiro ou esquema comercial faz parte da release. Os achados separados da auditoria sobre Fiado/ACK e recibos de recovery não foram implementados.

## Limites e plano de publicação — somente após autorização

1. Sugerida V192, caso a produção continue na V191. Sem commit/release nova nesta etapa.
2. Exportar baseline limpo V191; aplicar somente esta correção e seus testes, excluindo o hunk Fiado e demais arquivos locais preexistentes.
3. Preparar commit, versão, URLs dos assets alterados, imports singleton de Sync e cache de assets/PWA coerentes. Não limpar cache operacional, IndexedDB, localStorage ou filas.
4. Repetir suíte dirigida/Emulator/lint/build/diff-check no pacote exato e apresentar commit/rollback para autorização.
5. Publicar somente frontend/PWA. Sem Rules, Functions, índices, migração ou custo recorrente novo.
6. Smoke seguro: owner configura somente QA, seller escolhe cliente, login/reload/troca de conta; confirmar ocorrência antiga preservada, zero aumento de tentativas, checksum estável e pulls funcionando. Não executar/reprocessar a operação antiga nem vendas reais.
7. Rollback: V191, `1c0d48c96e2519b9c822beb39866e962c82879e7`, Hosting anterior. O sidecar usa o formato de quarentena já reconhecido pela V191; manter todos os dados locais. Rollback retorna o comportamento de preferências da versão anterior, não apaga evidência.

O conteúdo exato dos campos do pacote real ainda exige leitura do original antes de qualquer decisão definitiva de encerramento. A classificação por autorização não o declara inofensivo, resolvido ou descartável. Ele permanece preservado e sem replay.
