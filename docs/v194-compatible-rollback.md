# V194 — rollback operacional compatível

Preparado localmente após aceite explícito da estratégia compatível. **Não publicado.** Não é restauração integral da V193 e não apaga dados. O candidato original permanece imutável em `c1f8b08bb141ba5feb9c4b2b6288fb6db4fd0293` / `candidate/v194-sale-exchanges`.

## O que este artefato faz

- Branch separada `codex/v194-compatible-rollback`; tag de contenção `rollback/v194-compatible-sale-exchanges`.
- Pausa novas confirmações de troca e de venda que consome crédito. O servidor aplica o bloqueio dentro da transação, após verificar o recibo idempotente e antes de preparar qualquer escrita. Não existe flag de request, localStorage ou permissão que remova esse bloqueio.
- Uma operação já confirmada pode retornar o mesmo recibo sem repetir efeitos. Uma tentativa sem commit é rejeitada com `failed-precondition`, motivo `exchange_new_commits_paused`, sem executar seu payload.
- Mantém consultas de histórico, saldo, ajustes econômicos, status, recibos e guard de undo. Mantém o cancelamento específico autorizado de venda que já consumiu crédito, que restaura suas alocações exatamente uma vez.
- UI informa pausa, mantém consulta das tentativas existentes e não oferece repetir/liberar nova revisão. Tentativas sem confirmação continuam intactas no namespace original e bloqueiam nova venda pelo mesmo checkout até esclarecimento.
- Ao consultar uma tentativa cujo commit já está comprovado, o envelope original vai para o arquivo de auditoria local antes de liberar a chave ativa. Não se perde o payload original; falha na preservação impede a liberação.
- Não altera venda normal, Fiado, Sync, recuperação anterior ou permissões. Não cancela operações já admitidas/em andamento: elas podem concluir atomicamente com seus IDs; consultar o recibo, nunca compensar por suposição.

## Piso de compatibilidade preservado

Byte-idênticos ao candidato: `firestore.rules`, índices, projetor financeiro, bloqueio de reset, `js/exchange-economics.js`, checkout normal, undo seguro, recibos, Sync, Fiado e storage/cache. As duas únicas diferenças de backend são os guards de novas confirmações nos serviços de troca e crédito. Ledger, projeções e demais endpoints permanecem presentes. O cache PWA é distinto e as três entradas alteradas possuem URL própria; build continua release 194 com canal `compatible-rollback` e SHA do artefato.

Coleções que NÃO podem ser apagadas ou restauradas de backup antigo: `saleExchanges`, `saleExchangeSummaries`, `exchangeCredits`, `exchangeCreditEvents`, `saleExchangeMetrics`, `processedOperations`, `financialIncomeRoutes`, movimentos e lançamentos correspondentes. Não resetar geração, não limpar filas e não reprocessar histórico.

## Uso futuro — somente após autorização específica

1. Parar temporariamente novas confirmações de Trocas/crédito com os operadores. Registrar versões e IDs de tentativas em andamento, sem executar ou limpar nada.
2. Publicar deste artefato **somente** `confirmSaleExchange` e `confirmExchangeCreditSale`; aguardar ambas prontas. Clientes antigos também ficam impedidos de novos commits quando atendidos pelas novas versões. Não fazer deploy global nem publicar Rules/projetores antigos.
3. Publicar frontend/PWA deste artefato, com SHA e cache identificáveis.
4. Conferir no QA: novo commit negado sem efeito; status de já confirmado legível; envelope pendente intacto; saldo, estoque, recibos e projeção financeira preservados; cancelamento específico idempotente. Nunca executar pendência real para testar.
5. Monitorar entrega tardia dos triggers V194, que devem continuar projetando apenas dinheiro novo. Não desligar o projetor para simular rollback.

Retomar a operação exige nova autorização. Primeiro republicar os dois confirmadores do candidato aprovado, aguardar prontos, depois seu frontend; consultar tentativas originais antes de qualquer confirmação explícita com os mesmos IDs. Não há execução/retry automático nesta reversão nem na retomada.

## Validação local

9 testes dedicados de UI/artefato aprovados e 6 cenários Emulator aprovados, sem falhas ou skips; 58 regressões adicionais de domínio, economia, custo/lucro, Financeiro e reset aprovadas. Lint/build aprovados (408 arquivos JS), sintaxe dos arquivos finais e diff-check aprovados. A suíte global da operação ativa não é usada para avaliar um artefato intencionalmente pausado; os contratos do candidato continuam na referência separada, sem mudanças.

Testes dedicados cobrem guard transacional, bloqueio mesmo com parâmetro adulterado, replay somente leitura, consultas, cancelamento específico, dados/`updateTime` estáveis em negativas, envelopes/IDs preservados, reload e troca de conta. O teste Emulator semeia exclusivamente dados fictícios através da implementação ativa do candidato, depois aplica os serviços do rollback aos mesmos registros. A rodada oficial utilizou instância isolada local na porta 8189, encerrada ao terminar; configuração temporária removida. Nenhuma chamada a produção.

Este artefato serve para **contenção da funcionalidade nova**, não garante corrigir qualquer eventual defeito do próprio ledger/projetor. Se o incidente estiver nesse piso, congelar novos efeitos e investigar/patchear preservando dados; não voltar cegamente à V193.
