# V180 — preservação de vendas retidas para revisão

Rollback: V179 / 216493be7d718b2edc68e81f78edfaeff4633d2e.
Tag prevista: rollback/v179-before-v180-sale-review.

## Escopo

Envio explícito e confirmado de pacotes locais retidos, separados de vendas.
Tela de revisão no Início/Histórico; nenhuma aplicação, deduplicação, cancelamento,
baixa, receita ou atualização de metas automática. Fila comercial preservada.

Somente três Functions novas: submitSaleRecovery, listSaleRecoveryReviews,
getSaleRecoveryOriginal. Publicar Rules/índice de recuperação e esses endpoints
antes do frontend pelo workflow GitHub Pages existente. Não publicar outras
Functions, Scheduler, Auth, Storage ou configuração de billing/domínio.

As coleções saleRecoveryReviews/saleRecoveryOperations e subdocumentos são
privados, acessíveis pelo backend autenticado e sem gatilhos comerciais.
Somente o owner real tem revisão administrativa nesta V1. Vendedor/Caixa vê
apenas os próprios resumos autorizados. O pacote original é imutável.

Não incluir a otimização de confirmação paralela de Fiado presente no working
tree: o bloco canônico verifySaleQueueCommit da V179 deve permanecer idêntico
na árvore da release. Não incluir scripts, exports ou evidências privadas locais.

## Uso real

No aparelho e login originais da funcionária:
1. Atualizar pelo aviso normal do PWA e confirmar V180, sem limpar dados.
2. Abrir normalmente; tocar em Enviar dados para recuperação.
3. Confirmar envio; aguardar a mensagem de dados recebidos para revisão.

No login do owner, na empresa/espaço correspondentes:
1. Abrir Início ou Histórico.
2. Abrir Vendas aguardando revisão.
3. Conferir os quatro registros, com itens, horários, valores e sugestões.

Recebimento não executa a operação e não zera a fila. Não refazer vendas antigas,
não limpar dados e não usar Reprocessar todos. Se falhar, preservar o aparelho;
nova tentativa explícita é idempotente. Sucesso na publicação não comprova captura
dos quatro pacotes: isso depende do envio confirmado no aparelho original.

## Rollback

Reverter frontend pelo workflow existente a partir da árvore V179, sem resetar
cache/IDB/fila ou Firestore. As coleções de revisão existentes permanecem privadas
e preservadas. Os endpoints são apenas de intake/leitura: podem ser desativados
se necessário, sem excluir pacotes. Não voltar a uma versão anterior à retenção
V179. As quatro operações não podem ser liberadas como parte do rollback.
