# Fase 4c — o recebimento lê a conta por Espaço

A rota do recebimento (`fiado_receipt_route`) passa a usar a conta por Espaço quando o
servidor já a comprovou. Nesse caso, ela não reconstrói o histórico do cliente a cada
consulta e a cada confirmação. O valor, o efeito gravado e as recusas são os mesmos de
hoje. Em qualquer dúvida, a rota completa decide, como antes.

A mesma rota atende o recebimento no card e a cobrança com valor.

Só o servidor muda. O aparelho não precisou de nenhuma alteração. Nada foi publicado.

## Quando a conta é usada

Todas as condições abaixo precisam valer na mesma transação da consulta, e de novo na
confirmação.

| Condição | Por quê |
|---|---|
| Cliente com abertura confirmada ou regularização por Espaço | Nesses regimes a rota completa já trata cada Espaço separadamente. |
| Sem parcelamento | Parcelas exigem a divisão por venda e por vencimento, que a conta não guarda. |
| Conta pronta, sem parte sem Espaço e igual ao saldo cadastral | Mesmas regras da publicação da Fase 4. |
| Última verificação da conta com resultado igual ao histórico, Espaço por Espaço | A conta foi conferida com a reconstrução completa. |
| Verificação feita na versão financeira atual do cliente | Nada financeiro mudou desde a conferência. |
| Conferência do recebimento limpa na verificação | São as mesmas checagens de histórico da rota completa, feitas no momento da verificação. |
| Nenhum recebimento ou venda pendente, em conflito ou em revisão | Esses registros podem surgir sem mudar a versão. Por isso são consultados na hora. |

Fora disso, a rota completa decide, com as mesmas mensagens de hoje.

## Quem grava a verificação

| Momento | Quem grava |
|---|---|
| Carga das contas (Fase 2) | A própria carga, logo depois de montar a conta a partir do histórico. |
| Cada evento do razão | O gatilho da conta sombra (Fase 1), que já reconstruía e comparava. |
| Ajuste pelo comando (Fase 3) | O próprio comando, que já comprovava o histórico depois do ajuste. |

Depois de um recebimento ou de uma venda, até o gatilho verificar a nova versão, a rota
completa decide. Isso costuma levar poucos segundos.

## O que o recebimento grava

O efeito é o mesmo da rota completa nesses regimes:

- o pagamento, o evento do razão e o novo saldo do cliente;
- nenhuma alocação a venda;
- todo o valor como parte histórica do Espaço.

A conta enviada ao aparelho tem uma única linha por Espaço, com todo o valor exigível. O
aparelho e o servidor calculam a mesma linha, então a conferência da confirmação continua
exata.

Uma prévia pode vir de uma fonte e a confirmação, da outra. A confirmação aceita se a
prévia ainda vale por qualquer das duas, e recusa se algo financeiro mudou.

## Leituras no servidor

Medido no Emulator, com cliente regularizado em dois Espaços:

| Fluxo | 2 eventos | 12 eventos | 32 eventos |
|---|---|---|---|
| Rota pela conta | 12 | 12 | 12 |
| Rota completa (como antes) | 26 | 96 | 236 |
| Confirmação do recebimento pela conta | 23 | — | 23 |

Pela conta, as leituras não crescem com o histórico. Seis delas são as consultas de
pendências; cada uma custa uma leitura mesmo sem resultado.

## Interruptor e rollback

- `ACCOUNT_RECEIPT_ENABLED` em `fiado-receipt-route.js`: com `false`, todo recebimento
  volta à rota completa.
- Desligar a verificação a cada evento (`VERIFY_EVERY_EVENT`) também desliga esta fase na
  prática: sem verificação atual, a rota completa decide.

## Testes

`tests/emulator/customer-account-receipt.test.cjs`, com 6 testes no Emulator:

| Teste | O que confere |
|---|---|
| Mesmo exigível | Rota pela conta e rota completa iguais em cada Espaço, na abertura e na regularização. |
| Leituras | Constantes com 2, 12 e 32 eventos. |
| Recebimento | Recebimento real montado pelo código do aparelho; mesmo efeito, sem alocação. A conta volta a ser usada depois da verificação. |
| Rota completa decide | Evento não verificado, recebimento em conflito, parcelamento, verificação de outra versão e conferência pendente. |
| Fontes diferentes | Prévia pela reconstrução e confirmação pela conta é aceita. Com mudança no meio, é recusada. |
| Ajuste | Depois do comando de ajuste, o próximo recebimento usa a conta. |

Suítes completas: veja o fim deste documento.

## Antes de publicar

- **Deploy das Functions.** `getOperationalSyncReceipt`, `commitOperationalSync`,
  `projectCustomerAccount` e `manageCustomerAccounts`, com GO próprio, depois das Rules e
  das Functions da Fase 4.
- **Carga em produção.** Precisa rodar de novo depois do deploy, para gravar a verificação
  nas contas já montadas.
- **Índices.** As consultas de pendências combinam o cliente com `status in` ou
  `applicationStatus in`. São só igualdades, que o Firestore atende juntando índices
  simples. Conferir em produção que não aparece erro de índice. Um erro ali faria a
  consulta de recebimento falhar, em vez de voltar à rota completa.

## Suítes completas

Comparadas com a Fase 4 (unidade) e com a `main` (Rules):

| Suíte | Resultado | Em relação à base |
|---|---|---|
| Unidade | 2606 testes, 115 falhas antigas | Nenhuma falha nova. |
| Emulator das Fases 0 a 4c | 62 testes, nenhuma falha, 1 ignorado | Mais 6 desta fase. |
| Rota de recebimento anterior (`fiado-receipt-route.cjs`) | 20 aprovados, 1 ignorado | Igual à base. |
| Rules | 517 testes, 86 falhas | Uma a mais, por instabilidade do Emulator. |
| Lint | 577 arquivos | Sem erro. |

- **Falha a mais nas Rules.** É o mesmo teste de criações simultâneas do diretório de
  clientes que já falhou na Fase 4, por tempo esgotado. Rodado sozinho, o arquivo passou
  com 41 de 41.
- **`fiado-central-review.cjs`.** Falha ao carregar, igual na base. Não é desta fase.
