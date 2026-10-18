# V184 — Dashboard operacional compartilhado

Base e rollback: V183, `4d1ae2e63858087827a787ee1438cbb77ca83d3b`.

## Escopo

- Vendas operacionais e eventos de venda compartilhados entre usuários já
  autorizados do mesmo espaço; não são métricas pessoais por padrão.
- Clientes não dependem de vínculo com vendas do usuário.
- Caches permanecem separados por UID/permissões/empresa/geração; hidratação
  de leitura versionada não limpa nem reprocessa filas comerciais.
- Histórico e Sync ignoram leituras/callbacks de sessões anteriores.
- Custos/lucro e Financeiro/Equipe/Configurações continuam restritos.
- Meta geral e metas por espaço permanecem independentes. Nenhuma configuração,
  membership, meta, venda, estoque ou registro financeiro é migrado.
- A otimização de confirmação de Fiado pendente localmente não integra a release.

## Verificação

52 testes direcionados do app; 31 Firestore Emulator; lint; build; diff-check.
Fixture operacional reproduz R$401,60 / 8 vendas / 37 clientes / 180 produtos
para owner e dois vendedores; listeners, leitura mensal e restrições negativos.

## Publicação ordenada

1. Adicionar quatro índices de activityEvents sem remover os 50 existentes.
2. Aguardar todos os índices necessários em READY pela API do Firestore.
3. Publicar somente Firestore Rules e conferir o ruleset efetivo.
4. Publicar frontend pelo workflow GitHub Pages existente.
5. Conferir commit/release e conteúdo dos assets no domínio oficial.

Nenhuma Function, Storage Rule, DNS, Auth ou pagamento precisa ser publicado.
Smoke de produção usa apenas espaços QA e não executa venda real. Login de
vendedor em nuvem depende de conta QA disponível; não impersonar usuário real.

## Rollback

Referência Git: `rollback/v183-before-v184-operational-dashboard`.
Restaurar primeiro o frontend V183 por novo commit/publicação, sem reset forçado.
Com clientes V184 retirados de circulação, se necessário republicar as Rules
V183 preservadas no backup privado. Não remover índices adicionados: são
aditivos e compatíveis com V183. Não reverter dados, filas ou efeitos comerciais.
O service worker do rollback precisa de novo identificador de cache para
notificar clientes já atualizados; não modificar IndexedDB/localStorage.

Importante: retornar às Rules V183 retoma também a antiga leitura pessoal do
vendedor. Não reverter as Rules antes do frontend enquanto houver consultas
V184 ativas, sob risco de permission-denied temporário.
