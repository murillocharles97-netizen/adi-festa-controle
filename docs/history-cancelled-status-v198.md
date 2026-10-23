# V198 — status canônico do Histórico (frontend/PWA)

## Causa confirmada

A venda cancelada continua fisicamente presente em `sales`, com `active=false`, `deletedAt` e, nas novas operações V197, `cancelledAt`. O projetor existente de `activityEvents` só considera remoção física e prioriza `applicationStatus=applied`, mantendo o evento como `confirmed`. A UI interpreta pagamento Fiado como “Pendente”. A ausência em `DB.vendas` não prova cancelamento: o cache também pode não conter vendas antigas.

Um teste reproduz o problema com o arquivo exato da V197 (`d4f9703fc3c3416dbf1256648e55f04337e69c57`) e prova que a mesma entrada fica “Cancelada” na V198.

## Correção isolada

- `js/activity-center.js`: adapta somente o status/subtítulo visual dos eventos de venda. Um cancelamento canônico tem prioridade sobre a forma de pagamento.
- `js/firebase/firestore-repository.js`: novo leitor **somente de status de vendas**, `getSaleStatusFromServer`. Usa `getDocFromServer`, nunca fallback de cache; devolve apenas ID, empresa, espaço, geração e campos de ciclo de vida. Nenhum método existente foi modificado.
- A confirmação fica exclusivamente em memória da página, segregada por UID, empresa, permissões, geração e espaço selecionado. Respostas antigas são descartadas.
- Reaproveita os filtros de visibilidade antes da consulta. Espaços sem Vendas/plano sem Vendas não disparam a consulta; Rules continuam sendo a proteção final.
- Consultas limitadas aos eventos de venda já carregados no Histórico, com no máximo quatro em paralelo. Re-renderizações não repetem consultas da mesma revisão. Não há varredura da coleção inteira nem novo listener de coleção.
- Mudança de revisão do evento, atualização de vendas pelo Sync, reload, reconexão ou mudança de contexto revalidam o estado. Não se guarda resultado no DB/localStorage/IndexedDB da aplicação.
- Fonte ausente, indisponível, negada ou com empresa/espaço/geração divergentes: “Status não confirmado”, sem presumir cancelamento. Durante consulta: “Verificando status…”. Nenhuma operação comercial é criada.
- Cancelada: badge “Cancelada” e subtítulo “Venda cancelada”. Detalhe sem ação de segundo cancelamento. Sem confirmação do status, o botão de cancelamento permanece desabilitado; os guards financeiros/transacionais V197 continuam idênticos.
- Filtros, busca, ordenação, paginação, IDs, datas e valores históricos preservados. O filtro de cancelados passa a refletir o status correto, sem excluir eventos ou criar novos registros.

## Escopo / arquivos

Runtime: `js/activity-center.js`, `js/firebase/firestore-repository.js`.
Release: `index.html`, `js/build-info.js`, `service-worker.js` (V198; demais URLs e singleton Sync V197 preservados).
Testes: `tests/history-cancelled-status.test.js`, `tests/history-status-release.test.js`, `tests/emulator/history-status.rules.test.js`, `tests/fixtures/history-cancelled-status.html`.
Contratos anteriores: `tests/fiado-cancellation-release.test.js` fixa o pacote histórico V197 no seu commit; `tests/team-sync-release-v179.test.js` reconhece que V198 mantém os singletons V197. O novo contrato V198 rejeita alterações fora da allowlist e verifica byte a byte os módulos financeiros/comerciais preservados.
Documentação: este arquivo.

Sem alteração de Functions, Rules, índices, permissões, modelo de dados, Sync, Fiado, estoque, Financeiro, recibos, Trocas ou créditos. Nenhuma migração, backfill, replay ou cancelamento real.

## Validação

- 46 testes Node direcionados: 22 de status/isolamento/leitor servidor, 4 de pacote V198 e contratos/regressões existentes de Histórico, Fiado e assets.
- 15 Emulator: leitor servidor real para owner/seller, isolamento, Financeiro negado ao seller, ledger de atividade protegido e cancelamento Fiado V197/idempotência.
- Lint, build e `git diff --check` devem estar aprovados no commit final.
- Preview local fictício: Fiado cancelado, à vista cancelada, Fiado ativo; filtro cancelados com duas ocorrências/total três; atualização simulada do Sync; troca de perfil; reload; zero escrita comercial.
- Não foi acessado nem alterado o caso real do Japa nesta demanda.

## Limites e publicação

A correção é exclusivamente de leitura/apresentação no frontend. O evento bruto antigo permanece preservado, inclusive com seu status legado; é o adaptador do Histórico que o apresenta conforme a venda canônica. Não modifica agregações financeiras ou reconcilia dados.

Custo adicional: uma leitura de status por venda carregada/revisão na abertura do Histórico, reutilizada em memória; páginas adicionais consultam apenas os IDs adicionais. Revalidações de Sync/contexto podem consultar novamente. Uma rede indisponível mantém o status explicitamente não confirmado, sem inventar um resultado.

Publicação futura: somente frontend/PWA do candidato aprovado; sem deploy Firebase. Smoke inicialmente só leitura (abrir Histórico QA de venda já cancelada e outra ativa, filtros, reload e Sync sem replay).

Rollback compatível: frontend V197 `d4f9703fc3c3416dbf1256648e55f04337e69c57`, tag local `rollback/v198-compatible-history-status`. Reverte apenas a apresentação, preservando estorno idempotente V197 e todas as estruturas de Trocas/crédito. O rollback de contenção `0a5a25d5613ef747a0a95f4a0cec987a9eec4d19` e suas tags anteriores permanecem preservados. Nenhum rollback envolve restauração/apagamento de dados.

**Não publicar sem autorização explícita.**
