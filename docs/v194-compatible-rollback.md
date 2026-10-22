# V194 — rollback operacional compatível com single_space

Preparado localmente após aceite explícito da estratégia compatível. **Não publicado.** Não é restauração integral da V193 e não apaga dados. O candidato corrigido é `4ae78b90bc9405fb9d8aaa66da652a3cb804268c` / `candidate/v194-single-space`. O candidato original `c1f8b08bb141ba5feb9c4b2b6288fb6db4fd0293` / `candidate/v194-sale-exchanges` e a contenção anterior `67c16811f557f674bc2b8d30b75711400681b1b7` / `rollback/v194-compatible-sale-exchanges` permanecem intactos. Este novo artefato incorpora a correção canônica de produtos `single_space`.

## O que este artefato faz

- Branch separada `codex/v194-compatible-rollback-single-space`; nova tag proposta de contenção `rollback/v194-compatible-sale-exchanges-single-space`. Nenhuma tag anterior será movida ou substituída.
- Pausa novas confirmações de troca e de venda que consome crédito. O servidor aplica o bloqueio dentro da transação, após verificar o recibo idempotente e antes de preparar qualquer escrita. Não existe flag de request, localStorage ou permissão que remova esse bloqueio.
- Uma operação já confirmada pode retornar o mesmo recibo sem repetir efeitos. Uma tentativa sem commit é rejeitada com `failed-precondition`, motivo `exchange_new_commits_paused`, sem executar seu payload.
- Mantém consultas de histórico, saldo, ajustes econômicos, status, recibos e guard de undo. Mantém o cancelamento específico autorizado de venda que já consumiu crédito, que restaura suas alocações exatamente uma vez.
- UI informa pausa, mantém consulta das tentativas existentes e não oferece repetir/liberar nova revisão. Tentativas sem confirmação continuam intactas no namespace original e bloqueiam nova venda pelo mesmo checkout até esclarecimento.
- Ao consultar uma tentativa cujo commit já está comprovado, o envelope original vai para o arquivo de auditoria local antes de liberar a chave ativa. Não se perde o payload original; falha na preservação impede a liberação.
- Não altera venda normal, Fiado, Sync, recuperação anterior ou permissões. Não cancela operações já admitidas/em andamento: elas podem concluir atomicamente com seus IDs; consultar o recibo, nunca compensar por suposição.

## Piso de compatibilidade preservado

Byte-idênticos ao candidato: `firestore.rules`, índices, projetor financeiro, bloqueio de reset, `js/exchange-economics.js`, checkout normal, undo seguro, recibos, Sync, Fiado e storage/cache. As duas únicas diferenças de backend são os guards de novas confirmações nos serviços de troca e crédito. Ledger, projeções e demais endpoints permanecem presentes. O cache PWA é distinto e as três entradas alteradas possuem URL própria; build continua release 194 com canal `compatible-rollback` e SHA do artefato.

O helper `functions/src/shared/exchange-product-scope.js` deve ser byte-idêntico ao candidato corrigido. Produtos `single_space` só são admitidos quando `defaultSpaceId` e o único `allowedSpaceIds` concordam com o espaço autorizado, sem vínculo conflitante; cadastros ambíguos continuam bloqueados. O cancelamento específico usa o mesmo helper corrigido para devolver estoque e crédito de uma venda já confirmada. A publicação de contenção continua limitada aos dois confirmadores; não deve substituir uma Function de cancelamento corrigida por versão antiga.

Coleções que NÃO podem ser apagadas ou restauradas de backup antigo: `saleExchanges`, `saleExchangeSummaries`, `exchangeCredits`, `exchangeCreditEvents`, `saleExchangeMetrics`, `processedOperations`, `financialIncomeRoutes`, movimentos e lançamentos correspondentes. Não resetar geração, não limpar filas e não reprocessar histórico.

## Uso futuro — somente após autorização específica

Pré-condição: o fix operacional `single_space` do candidato `4ae78b90` precisa estar instalado, especialmente a Function `cancelExchangeCreditSale`. Cada Function tem implantação independente: publicar somente os dois confirmadores deste artefato NÃO corrige uma Function de cancelamento antiga ainda instalada. Se essa prontidão não estiver comprovada, parar e instalar primeiro o piso compatível autorizado; não voltar a implantar o serviço de cancelamento do artefato antigo `67c16811`.

1. Parar temporariamente novas confirmações de Trocas/crédito com os operadores. Registrar versões e IDs de tentativas em andamento, sem executar ou limpar nada.
2. Publicar deste artefato **somente** `confirmSaleExchange` e `confirmExchangeCreditSale`; aguardar ambas prontas. Clientes antigos também ficam impedidos de novos commits quando atendidos pelas novas versões. Não fazer deploy global nem publicar Rules/projetores antigos.
3. Publicar frontend/PWA deste artefato, com SHA e cache identificáveis.
4. Conferir no QA: novo commit negado sem efeito; status de já confirmado legível; envelope pendente intacto; saldo, estoque, recibos e projeção financeira preservados; cancelamento específico idempotente. Nunca executar pendência real para testar.
5. Monitorar entrega tardia dos triggers V194, que devem continuar projetando apenas dinheiro novo. Não desligar o projetor para simular rollback.

Retomar a operação exige nova autorização. Primeiro republicar os dois confirmadores do candidato aprovado, aguardar prontos, depois seu frontend; consultar tentativas originais antes de qualquer confirmação explícita com os mesmos IDs. Não há execução/retry automático nesta reversão nem na retomada.

## Validação local

A rodada anterior do artefato `67c16811` permanece preservada como evidência histórica. Na nova rodada `single_space`, passaram **9 testes dedicados de UI/artefato, 45 regressões curtas de domínio/economia/custo-lucro e 6 cenários Emulator**, sem falhas ou skips. O teste carrega a implementação ativa do candidato corrigido `4ae78b90` para semear os efeitos e comprova: novas tentativas owner/seller negadas sem escrita; replay somente leitura; consultas preservadas; cancelamento de venda com crédito e produto `single_space` restaurando exatamente as mesmas alocações/estoque/receita, uma única vez.

Foi reproduzida a diferença de forma controlada: o serviço antigo isolado `67c16811` rejeita o cancelamento `single_space` com `permission-denied / Produto não autorizado`, sem alterar dados nem `updateTime`. O novo serviço cancela a MESMA operação de cancelamento com os MESMOS IDs, restaura o crédito e estoque uma vez, e nova chamada retorna o recibo sem novos efeitos. A receita e reversão são somente R$20 do complemento; Fiado permanece idêntico.

Lint e build validaram 409 arquivos JavaScript; sintaxe e `git diff --check` passaram. Comparado ao candidato corrigido, os dois serviços diferem somente pelas três linhas de contenção pós-recibo em cada confirmador; helper, Rules e projetores preservam o piso corrigido.

Testes dedicados cobrem guard transacional, bloqueio mesmo com parâmetro adulterado, replay somente leitura, consultas, cancelamento específico, dados/`updateTime` estáveis em negativas, envelopes/IDs preservados, reload e troca de conta. A fixture usa produtos `single_space`, com `defaultSpaceId`, `allowedSpaceIds` e versão de escopo explícitos. O teste Emulator semeia exclusivamente dados fictícios através da implementação ativa do candidato corrigido, depois aplica os serviços do rollback aos mesmos registros. A rodada oficial utilizou Emulator próprio na porta 8197, encerrado após exit 0; a configuração temporária foi removida. Nenhuma chamada a produção foi usada para validar este artefato.

Este artefato serve para **contenção da funcionalidade nova**, não garante corrigir qualquer eventual defeito do próprio ledger/projetor. Se o incidente estiver nesse piso, congelar novos efeitos e investigar/patchear preservando dados; não voltar cegamente à V193.
