# V227 — inicialização e reconciliação da projeção legada

Base publicada: `b197da1207302879747dc3b4c14a870fc73e57ec`. Trabalho somente local. Não há autorização para publicar ou reparar dados.

## Diagnóstico

O saldo contábil deve ser reconstruído pelos eventos aplicados e pelos documentos de origem. `legacyBalanceRemaining` é uma projeção auxiliar, não substitui o ledger. Ajustes tradicionais alteram saldo/versão e registram seu evento, mas não recompõem essa projeção. Assim, um histórico com ajustes pode fechar contabilmente e ainda falhar no invariante entre saldo, vendas abertas e legado do projetor V227.

O bloqueio atual não deve ser removido nem contornado. Uma correção de projeção existente exige auditoria, concorrência, idempotência e autorização própria, preservando vendas, recebimentos e saldo total. Uma mensagem de prévia indisponível também não equivale a bloqueio automático de confirmação de venda: não homologar novas parcelas nessa conta sem apuração válida e recebimentos compatíveis.

Foi reproduzido um defeito adicional na inicialização local do legado: o recebimento tradicional considerava apenas vendas com `status=fiado`; vendas remotas `formaPagamento=fiado, status=applied` eram ignoradas. Em fixture com dívida total 800 e venda aberta de 3,50, inicializava legado 800, em vez de 796,50. Isso não comprova qual escrita histórica inicializou um documento real: não há snapshot imutável de cada atribuição do campo.

## Correção local mínima

`js/fiados.js` passa a considerar a modalidade Fiado com status `fiado` ou `applied`, excluindo vendas inativas, excluídas, canceladas e desfeitas. O saldo total e o fluxo de recebimento são preservados. Campos legados existentes não são recalculados nem escritos automaticamente. A proteção de integridade do Parcelado permanece igual. Não foram alterados backend, Rules, calendário, modelos compartilhados, fila, recibo antigo ou SpaceService.

O patch não é uma reparação da conta existente e não é candidato autorizado para produção. A falta de manutenção da projeção nos ajustes continua exigindo desenho próprio antes de ampliar o uso de ajustes em contas parceladas; não foi criada uma política de redistribuição de dívidas ou pagamentos nesta investigação.

## Validação

- 34 testes dirigidos aprovados: inicialização em ambos os status, exclusão de históricos inativos, preservação de inconsistência já gravada, idempotência, prévia com dívida anterior, fluxo e permissões de recebimento.
- 12 testes Auth/Firestore Emulator aprovados em `demo-veconi-owner-v219`, incluindo inicialização com venda remota `applied`, recebimento único, resposta perdida, concorrência, funcionários e isolamento.
- Build aprovado: 646 arquivos JavaScript. Diff-check aprovado.
- Duas suítes históricas adicionais somaram 26 testes, com 9 falhas. As mesmas 9 falhas foram reproduzidas usando o código publicado de `js/fiados.js`, por preload somente em memória; não são regressões introduzidas pelo patch. Não foram alteradas neste escopo. Evidência externa: `baseline-tests.log` e `tests.log`.

## Critérios para homologação restrita

Usar somente conta com apuração completa e coerente de saldo/vendas/alocações, calendário integral, ausência de operações pendentes da conta no aparelho e prévia Android correta. Aprovar por conta, sem inferir que todas as contas que passam no projetor possuem histórico auditado. Verificar confirmação remota da venda e baixa única de estoque antes de qualquer nova tentativa. A operação antiga preservada nunca deve ser reenviada como parte desse procedimento.

O patch local pode ser descartado retornando à base publicada; não contém migração de dados. Isso não é instrução de rollback de produção. Qualquer publicação ou reparação permanece dependente de nova autorização.
