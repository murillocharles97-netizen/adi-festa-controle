# Fase 2 — carga auditada das contas por Espaço

A carga monta a conta de cada cliente a partir do histórico atual e mostra quais contas
precisam de uma decisão do proprietário. Ela grava só a conta (`customerAccounts`) e o
relatório (`customerAccountBackfills`). Cliente, vendas, pagamentos, ajustes, eventos e
marcadores não mudam.

Nada no app lê a conta ainda, e nada foi publicado.

## Como funciona

A Function nova `manageCustomerAccounts` é chamada só pelo proprietário e anda pelos
clientes em páginas de até 50, ordenadas por id. Ela tem dois modos:

| Modo | O que faz |
|---|---|
| `customer_account_backfill_preview` | Só lê. Devolve a classificação de cada cliente da página e a posição da próxima página. |
| `customer_account_backfill_apply` | Grava a conta de cada cliente e um item do relatório. Exige `confirmed: true`, `backupConfirmed: true` e um `runId`. |

No modo de gravação:

- **A mesma carga pode ser repetida.** Repetir com o mesmo `runId` não muda nada que esteja
  igual (`unchanged`).
- **O `runId` fica preso ao pedido.** Usar o mesmo `runId` com outras regras é recusado.
- **Nada se perde ao substituir.** Uma conta já existente, por exemplo criada pela conta
  sombra da Fase 1, só é trocada se for diferente, e a versão anterior fica guardada no
  item do relatório.

A conta sombra da Fase 1 continua aplicando os eventos que chegarem depois da carga. A
classificação da carga fica guardada na conta (`status` e `backfill`).

Há um interruptor, `WRITES_ENABLED`: desligado, ele pausa a gravação e mantém a prévia.

## Classificação

| Situação | Quando | O que falta |
|---|---|---|
| `ready` | Sem saldo; dívida comprovada por Espaço; ou soma dos eventos, cada um no seu Espaço | Nada |
| `ready_by_rule` | Total comprovado e Espaço definido por uma regra aprovada no pedido | Nada; a regra fica registrada |
| `needs_attribution` | Total comprovado, mas parte da dívida não tem Espaço, ou a divisão entre Espaços é só um cálculo | Decisão do proprietário: uma regra ou a abertura |
| `needs_opening` | Os eventos não explicam o saldo cadastral (saldo antigo sem eventos) | Abertura por Espaço (Fase 3) |

## Regras de atribuição

Nenhuma regra vale sem aprovação. Elas só são aplicadas quando vêm listadas no pedido, e
nunca mexem numa conta já comprovada por Espaço nem numa conta que precisa de abertura.

| Regra | O que faz |
|---|---|
| `single_linked_space` | Cliente ligado a um único Espaço e sem dívida em outro: a parte sem Espaço vai para esse Espaço. |
| `fallback_space` | A parte sem Espaço vai para o Espaço que o proprietário indicar (`fallbackSpaceId`). O servidor confere se o Espaço pertence à empresa. |
| `accept_history_split` | Numa conta antiga com dívida em vários Espaços, aceita como ponto de partida a divisão que a projeção calcula hoje. Nessa divisão, recebimentos sem Espaço abatem a dívida mais antiga. |

## Testes (dados fictícios)

- **`tests/customer-account-backfill-v1.test.cjs`:** classificação e regras, 7 testes.
  - Abertura acima de qualquer regra.
  - Regras não aplicadas onde não precisam.
  - Espaço único recusado para cliente de dois Espaços ou com dívida em outro.
  - Divisão calculada só aceita com aprovação.
  - Crédito.
  - Validação das regras.
  - Comparação de contas.
- **`tests/emulator/customer-account-backfill.test.cjs`:** código real do servidor no
  Emulator, 5 testes, com seis clientes fictícios: sem saldo, regularizado em dois Espaços,
  ajuste antigo com um Espaço, ajuste antigo com dois Espaços, saldo sem eventos e
  crédito.
  - A prévia classifica cada situação, percorre todas as páginas e não grava nada.
  - As regras aprovadas resolvem a atribuição, sem tocar o que já é comprovado nem a
    abertura.
  - Só o proprietário grava, e com confirmação, cópia e regras válidas. Um Espaço de
    outra empresa é recusado.
  - A gravação cria as contas e o relatório; repetir não muda nada; outras regras com o
    mesmo `runId` são recusadas.
  - Clientes, vendas, pagamentos, ajustes, eventos, marcadores e estoque ficam
    byte a byte iguais.
  - Uma conta sombra existente é substituída com a versão anterior no relatório, e o
    evento seguinte é aplicado e confere com o histórico.
- **`tests/emulator/customer-account.rules.test.js`:** o relatório também fica fora do
  alcance de qualquer aparelho (5 testes no total).
- **Fases anteriores:** os testes das Fases 0 e 1 continuam passando (25 de 25).
- **Suíte completa de Rules:** 516 testes, com as mesmas 85 falhas da `main`, teste por
  teste, e nenhuma nova.

## O que fica para depois

- **Carga em produção.** Exige três coisas, cada uma com GO próprio: publicar as
  Functions `projectCustomerAccount` e `manageCustomerAccounts` e as Rules; rodar a
  prévia em produção; e aprovar as regras escolhidas a partir do resultado da prévia.
- **Abertura e atribuição.** As contas em `needs_opening` e `needs_attribution` são
  resolvidas na Fase 3, pelo comando único de ajuste, com a abertura por Espaço.
- **Leitura pelos aparelhos.** Continua fechada até a Fase 4.

## Rollback

- **Gravação:** `WRITES_ENABLED = false` pausa novas gravações e mantém a prévia.
- **Contas:** podem ser descartadas, porque nada depende delas. O relatório guarda a versão
  anterior de cada conta substituída.
