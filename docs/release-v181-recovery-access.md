# V181 — acesso à recuperação da equipe

Rollback: V180 / 2cd4ec0af33b25e60191340dd7d39701da644208.
Tag: rollback/v180-before-v181-recovery-access.

## Publicação autorizada

Hotfix exclusivamente de descoberta/preservação e acesso à recuperação:
namespaces anteriores da mesma conta, empresa e geração; envio sem sales.create;
painel independente das rotas comerciais; configuração inicial respeita settings.manage.
Nenhuma ampliação de permissões, migração de dados ou reenvio de vendas.

Atualizar somente submitSaleRecovery, listSaleRecoveryReviews e
getSaleRecoveryOriginal, antes do frontend pelo workflow Deploy GitHub Pages.
Não publicar Rules, índices, Storage, Scheduler, Auth ou outras Functions.
Nenhuma trigger nova. Revisões continuam privadas e sem efeitos comerciais.

Não incluir a otimização local de confirmação de Fiado em js/firebase/sync.js.
O blob desse arquivo deve permanecer exatamente igual ao da V180.
Não incluir auditorias privadas, exports, scripts ou dados reais locais.

## Validação

Reexecutar os 39 testes direcionados e 24 do Firestore Emulator, lint, build e
git diff --check na árvore exata da release.
Conferir assets/versão/commit publicados, endpoints sem autenticação negados e
estado das quatro vendas/11 movimentos preservado com leitura antes/depois.
Smoke visual sem retry/envio comercial. Login real da funcionária e captura dos
pacotes dependem do próprio aparelho; não solicitar ou usar sua senha.

## Uso real

Depois da atualização normal do PWA, no mesmo aparelho/navegador de origem:
abrir normalmente → Enviar dados para recuperação → confirmar.
Owner consulta Vendas aguardando revisão no Início/Histórico.
Receber evidência não executa venda, não altera estoque/Financeiro/metas e não
remove a fila. Nunca usar Reprocessar todos para as quatro operações retidas.

## Rollback

Frontend: publicar novamente a árvore V180 pelo mesmo workflow, sem limpar IDB,
fila ou cache de dados operacionais. Backend: republicar apenas as três callables
a partir da V180, se necessário. Manter todos os pacotes privados preservados.
O rollback restaura as limitações de descoberta/permissão da V180; não voltar a
versões anteriores à retenção segura das vendas e não liberar a fila no rollback.
