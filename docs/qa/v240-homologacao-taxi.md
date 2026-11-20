# V240 — homologação funcional no Emulator (dados fictícios)

Ambiente: emuladores locais auth+firestore+functions (projeto `adi-festa-variations-test`) e app servido por
`scripts/qa-v240-taxi-emulator.cjs` (empresa, usuário, espaços e clientes fictícios). Nenhum dado real.

Espaço "Táxi QA" semeado com o mesmo formato do caso auditado: `type: other`, sem `linkedBusinessId`, sem automação,
lançamentos manuais anteriores (entrada e despesa) e uma carteira própria.

| # | Ação no app | Resultado verificado |
|---|---|---|
| 1 | Dashboard do Táxi antes de qualquer operação | Todos os indicadores em R$ 0 (reproduz o caso) |
| 2 | Gerenciar espaço financeiro → vincular, conta padrão Carteira Táxi, online desligado | Function `configureFinancialSpaceAutomation`; mesmo ID; tipo continua `other`; revisão 1; registro em `automationChanges` |
| 3 | Venda Pix R$ 180 (corrida) | Uma entrada R$ 180 no Táxi, na Carteira Táxi; nada na Loja |
| 4 | Venda Fiado R$ 180 (Pai) | Nenhuma entrada financeira; dashboard "A receber R$ 180 · exigível confirmado" |
| 5 | Recebimento parcial R$ 50 (Pai) | Uma entrada R$ 50; saldo R$ 130; "Recebido hoje R$ 50" |
| 6 | Regularizar saldo do Pai para R$ 1.889 | `balanceAdjustment` confirmado pelo servidor; nenhuma entrada, venda ou pagamento; dashboard "A receber R$ 1.889,00 · exigível confirmado"; "Vendas hoje" inalterado |
| 7 | Financeiro → novembro | Resultado + R$ 230 (180 + 50); despesas continuam só as manuais |
| 8 | "Desfazer a última alteração" | Automação removida (volta a manual), revisão 2, trilha `configure`+`revert`, 4 lançamentos preservados |

Correção encontrada na homologação: depois da prova do servidor, o dashboard continuava "a conferir" porque o cache de
saldos da tela Clientes não era invalidado fora dessa tela. O dashboard agora chama `Clientes.prepareList()` antes de
redesenhar.

Observação (pré-existente, não alterada): "Saldo previsto" do Painel financeiro é `receita do período − A receber`
e fica negativo quando há dívida histórica regularizada.
