# V188 — aviso de Sync e arquivo permanente de incidente

Base / rollback de frontend: V187, `8e060324af3473ffbf2e348dac8a93dd7a1a18d4`.

- Quarentena conhecida e arquivo resolvido não são contados como pendência enviável ou erro ativo. Falhas reais e vendas legítimas retidas continuam alertando.
- Arquivamento somente após confirmação na conta autenticada de origem, com empresa, vínculo, geração, espaços e hashes validados.
- O pacote e seu sidecar de quarentena permanecem intactos no IndexedDB. Um recibo separado registra o encerramento.
- Uma transação cria arquivo privado, original imutável e tombstone `archived_without_effects` em `processedOperations`.
- Arquivamento não cria venda, baixa de estoque, receita, fiado, meta ou faturamento. Não há trigger comercial nas coleções de custódia/fence.
- Arquivo/tombstone não podem ser apagados ou editados por clientes, inclusive owner. Rules bloqueiam replay desse operationId, sem ampliar permissões ou bloquear outras operações.
- Envios duplicados/resposta perdida são idempotentes. Conflito de conteúdo ou efeito remoto prévio interrompe o arquivamento.
- Escopo de Produtos owner 14 × seller 4 e otimização de confirmação de Fiado não pertencem a esta versão.

## Publicação controlada

Somente as Functions `archiveSyncIncident` e `getSyncIncidentArchive`, Firestore Rules e frontend. Sem deploy de Auth, Storage, pagamentos, Scheduler ou demais Functions.

Validações: 66 testes do app, 30 testes do Firestore Emulator, lint, build e diff-check. Smoke real autorizado somente para o incidente previamente identificado, sem vendas/retries comerciais.

## Rollback seguro

Restaurar o frontend da tag `rollback/v187-before-v188-incident-archive` por commit de reversão ou workflow no ref preservado, sem reset destrutivo e sem modificar dados locais.

**Não apagar arquivos, tombstones nem filas.** Manter o fence e as Rules de arquivo da V188 mesmo em rollback visual para V187, pois a proteção persistente do incidente não deve ser revertida. As duas callables podem permanecer sem uso; não executam operações comerciais. Um rollback para V187 não deve ser combinado com limpeza de IndexedDB, exclusão de marcadores ou reprocessamento.
