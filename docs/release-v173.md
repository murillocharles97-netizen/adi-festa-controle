# V173 — hotfix de convite, sessão e diagnóstico

## Escopo

- Aceitação de convite exclusivamente pelo bootstrap de Auth existente.
- Guarda contra duplo envio da criação de acesso e remoção do token consumido
  tanto da URL quanto do estado pendente em memória.
- Reinício autenticado não reutiliza mensagem de sessão encerrada.
- Callbacks de listeners de sessões antigas não atualizam a sessão nova.
- Histórico limitado de erros/transições em memória, isolado por usuário, com
  caminho, operação, geração, ator e contagens de fila. Sem senhas/tokens/payloads.
- Diagnóstico preserva falhas mesmo após recuperação e avisos do bootstrap.
- Auth e firebase-ui usam a mesma URL de Sync para evitar instâncias duplicadas.

APP_VERSION 173; cache `veconi-v173-session-team-hotfix`.
Somente frontend via workflow GitHub Pages já existente. Sem deploy de backend,
Rules, índices ou Scheduler. Sem novos convites/contas, mudança de permissões,
ativação de lojas, ajuste de estoque ou reprocessamento financeiro.

## Validação e rollback

43 testes direcionados de sessão/Auth/Sync/fila/convite/permissões; 9 testes
Firestore Emulator de Equipe/Rules; lint, build e git diff --check aprovados.
Não corresponde a auditoria ampla da Loja Online ou teste físico Android.

Rollback: V172, commit `7535d71528119fee9ae6e43ff6ec0bee6d3699fa`, referência
`rollback/v172-before-v173`. Restaurar somente código; não restaurar dados.
O erro intermitente de permissão anterior não foi reproduzido na investigação;
não afirmar que sua causa está resolvida. Novos incidentes ficam diagnosticáveis.

Smoke posterior limitado a acesso owner/equipe, reload, Sync e espaço autorizado.
Login da conta de equipe exige suas credenciais normais; sem impersonação
administrativa, alteração de conta ou envio de senha para o agente.
