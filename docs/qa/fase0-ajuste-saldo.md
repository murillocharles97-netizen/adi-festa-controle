# Fase 0 — contrato do ajuste manual de saldo

O teste `tests/emulator/balance-adjustment-contract.test.cjs` descreve, contra o código atual
do servidor, o que o ajuste manual de saldo faz hoje. Esta fase não muda nenhum
comportamento.

Cada teste confirma o comportamento atual e o classifica em uma de quatro situações:
atende, atende com restrições, ainda não existe (lacuna) ou é complexidade a remover. Ao
implementar as próximas fases, cada lacuna deve virar um teste que passa com o comportamento
novo.

Todos os dados são fictícios e o teste só roda no Emulator. Ele não mexe em Functions,
Rules nem dados reais.

## Como rodar

```
NODE_PATH=functions/node_modules firebase emulators:exec --only firestore --project demo-veconi-adjustment-contract \
  "node --test --test-concurrency=1 tests/emulator/balance-adjustment-contract.test.cjs"
```

O teste usa o mesmo serviço do servidor (`operationalCommitService`) que
`tests/emulator/fiado-space-regularization.test.cjs`. Ao definir
`VECONI_CONTRACT_REPORT=<arquivo.json>`, ele grava os resultados e as medições nesse
arquivo.

## Resultado em `f84d34f` (17 de 17 testes passando)

| # | Operação | Situação | O que acontece hoje |
|---|---|---|---|
| 1 | Aumentar a dívida sem venda | Com restrições | Pelo Regularizar saldo. Exige proprietário, Espaço ativo, conexão e conta comprovável. |
| 2 | Diminuir sem recebimento fictício | Com restrições | Mesmo caminho e mesmas condições. Não cria pagamento. |
| 3 | Zerar mediante ajuste | Com restrições | Aceita total 0 quando não há parcelas no Espaço. |
| 4 | Conceder crédito | Lacuna | O Regularizar recusa total negativo. O ajuste antigo ainda cria crédito em cliente simples, mas nenhuma tela o oferece. |
| 5 | Corrigir valor lançado | Indireto | Só redefinindo o total (finalidade "correção"). Não há estorno ligado ao ajuste errado. |
| 6 | Ajustes consecutivos | Com restrições | Funcionam, cada um com uma prévia nova. Uma prévia anterior é recusada pela versão. |
| 7 | Receber depois | Atende | A rota verificada do Espaço mostra o exigível do ajuste. |
| 8 | Histórico completo | Parcial | O servidor guarda motivo, autor e saldo antes e depois. A interface mistura essa fonte com o histórico local. |
| 9 | Sincronizar entre aparelhos | Com restrições | O sinal marca clientes, ajustes e eventos. Um aparelho com operação do cliente na fila mantém o saldo retido. |
| 10 | Isolamento entre Espaços | Atende | Um ajuste não muda o outro Espaço. |
| 11 | Sem faturamento, caixa ou estoque | Atende | Nenhuma venda, pagamento, alocação, estoque ou lançamento de caixa. |
| 12 | Outros perfis e visão da empresa | Lacuna | Vendedor e gerente com permissão de ajuste são recusados. Sem Espaço, não há ajuste. |
| 13 | Corrigir conta sem histórico comprovável | Lacuna | O Regularizar exige a prova que a própria correção deveria estabelecer. |
| 14 | Regime depois da primeira regularização | Complexidade | O cliente fica com histórico comprovado e regularizado. O ajuste antigo passa a ser recusado. |
| 15 | Ajuste antigo em cliente simples | Complexidade | O servidor ainda aceita o contrato antigo, sem Espaço obrigatório, e gera o evento sozinho. |

## Documentos lidos no servidor

Medidos dentro das transações do servidor, conforme o número de eventos financeiros já
registrados para o cliente.

| Fluxo | 0 eventos | 10 eventos | 30 eventos | 40 eventos | 60 eventos |
|---|---|---|---|---|---|
| Prévia do ajuste | 5 | 147 | 427 | — | 847 |
| Confirmação do ajuste | 6 | 148 | 428 | — | 848 |
| Consulta da conta (`fiado_account`) | 4 | 94 | 274 | — | 544 |
| Rota de recebimento | 5 | 75 | 215 | — | 425 |
| Confirmação do recebimento | — | 86 | — | 296 | — |

O custo de cada fluxo cresce em linha reta com o histórico, porque cada um reconstrói a
conta inteira:

| Fluxo | Documentos a mais por evento |
|---|---|
| Prévia do ajuste | cerca de 14 |
| Confirmação do ajuste | cerca de 14 |
| Consulta da conta | cerca de 9 |
| Rota de recebimento | cerca de 7 |
| Confirmação do recebimento | cerca de 7 |

A consulta da conta se repete para cada cliente regularizado visível na lista. Um cliente
com 60 eventos custa cerca de 544 leituras a cada revalidação, e a revalidação acontece a
cada 60 a 95 s enquanto a lista está aberta.

Na proposta da Fase 1 em diante, um ajuste deve ler no máximo 5 documentos,
independentemente do histórico. A exibição não deve fazer consultas por cliente.
