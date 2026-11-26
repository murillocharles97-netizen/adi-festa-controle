# Fase 3 — comando único de ajuste de saldo

Um só comando no servidor, por Espaço, para ajustar o saldo de um cliente. Ele cobre as
operações que hoje não existem ou só funcionam com restrições. A tela nova está pronta e
testada, mas fica desligada e fora do app até a Fase 4.

Nada foi publicado. O app atual e a "Regularizar saldo" não mudaram.

## Servidor

O comando roda na Function `manageCustomerAccounts` e tem três tipos de chamada:

| Chamada | O que faz |
|---|---|
| `customer_balance_adjustment_preview` | Só lê. Mostra o saldo do Espaço hoje e depois do ajuste, com o código da prévia. |
| `customer_balance_adjustment_history` | Só lê. Lista os ajustes do cliente no Espaço, indicando quais ainda podem ser estornados. |
| `customer_balance_adjustment` | Grava. Exige confirmação, motivo de 10 a 500 caracteres, um identificador e a prévia vigente. |

Tipos de ajuste (`mode`):

| Tipo | O que faz |
|---|---|
| `increase` | Aumenta a dívida no Espaço. |
| `decrease` | Reduz a dívida, sem registrar recebimento. |
| `set` | Define o total devido no Espaço (zerar = 0). |
| `reverse` | Estorna um ajuste anterior do mesmo Espaço, uma única vez. |
| `credit` | Concede crédito. |

Regras:

- **Parte da conta preparada.** O comando parte da conta por Espaço das Fases 1 e 2, que
  precisa estar pronta, por exemplo pela carga. Ele confere a conta com o saldo cadastral
  antes de qualquer coisa.
- **Quem pode ajustar.**
  - É preciso ter a permissão `customers.adjustBalance`, não só ser o proprietário.
  - O ajuste vale só nos Espaços que a pessoa acessa.
  - O cliente precisa estar ligado ao Espaço, ou ter saldo nele.
- **Proteção contra conflito e repetição.**
  - A prévia fica presa à versão financeira do cliente; uma prévia antiga é recusada.
  - O mesmo identificador com o mesmo pedido devolve o resultado anterior.
  - O mesmo identificador com outro pedido é recusado.
- **O que grava.** Numa única transação: o ajuste, o evento do razão, o marcador, o
  cliente (saldo e versão), a conta por Espaço com o seu marcador e o sinal de
  sincronização.
  - Não cria venda, pagamento, caixa ou estoque.
  - Não troca o regime do cliente: a primeira regularização deixa de ser um caminho sem
    volta.
- **Formato compatível.** O ajuste usa o mesmo formato que a prova do histórico aceita. A
  conta sombra recebe o evento já aplicado, e o gatilho da Fase 1 o reconhece como
  repetido.

### Enquanto telas e recebimentos ainda dependem da prova

Isso vale até a Fase 4, para clientes com histórico comprovado, abertura do legado,
regularização ou parcelado:

- **A prova continua válida.** O comando confere o histórico antes e depois do ajuste e
  recusa qualquer ajuste que tornaria a prova inválida ou mudaria outro Espaço.
- **Parcelas continuam protegidas.** Um ajuste não pode consumir parcelas existentes.
- **Crédito, por enquanto, só para contas simples.** A prova atual não representa crédito.
  Nas contas comprovadas, o crédito chega quando a prova deixar de ser a fonte das telas
  e dos recebimentos.

Interruptores em `customer-balance-adjustment-service.js`:

- `WRITES_ENABLED`: pausa novos ajustes e mantém prévia e histórico.
- `PROOF_COMPATIBILITY`: liga a conferência da prova. Sai quando a prova deixar de ser a
  fonte das telas.

## Tela

`js/customer-balance-adjustment.js` (ainda não carregado pelo `index.html`):

- **Espaço.** Na tela de um Espaço, só ele. Na visão da empresa, os Espaços do cliente.
- **Escolha.** O tipo, o valor (ou o ajuste a estornar) e o motivo.
- **Prévia.** "Ver resultado" mostra a prévia do servidor. "Confirmar ajuste" só é
  liberado depois dela, e qualquer mudança exige uma prévia nova.
- **Falha de rede.** O pedido fica guardado e é reenviado igual, com o mesmo identificador,
  sem duplicar. Uma recusa definitiva descarta o pedido guardado.
- **Depois de confirmar.** A tela relê o cliente e avisa as telas abertas.

O valor nunca é calculado no aparelho. A tela fica desligada porque as telas atuais ainda
exibem o saldo por Espaço pela prova ou pela projeção local. Ligá-la antes da Fase 4
mostraria o Espaço de forma incompleta em contas do legado.

## Testes (dados fictícios)

**`tests/emulator/customer-balance-adjustment.test.cjs`**, no Emulator com o código real,
9 testes:

- aumentar, reduzir e zerar por Espaço, com o outro Espaço intacto, a prova válida e
  nenhum efeito em vendas, recebimentos, caixa ou estoque;
- crédito em conta simples, recusado em conta comprovada;
- estorno único, com a lista do histórico;
- ajustes consecutivos, com prévia antiga recusada e repetição sem efeito duplo;
- recebimento depois do ajuste com o exigível novo, histórico completo e sinal de
  sincronização;
- perfis: gerente e caixa com permissão ajustam nos seus Espaços; caixa fora do Espaço e
  vendedor sem permissão são recusados;
- conta não preparada ou divergente bloqueia sem gravar;
- conta sombra coerente;
- leituras no servidor, medidas abaixo.

| Tipo de conta | Prévia | Confirmação |
|---|---|---|
| Simples | 6 documentos | 7 documentos |
| Que ainda depende da prova, no exemplo | 20 documentos | 21 documentos |

Numa conta que depende da prova, o número cresce com o histórico até a Fase 4.

**`tests/customer-balance-adjustment.dom.test.cjs`**, a tela, 6 testes:

- desligada por padrão;
- Espaços por contexto;
- prévia e confirmação;
- nova prévia depois de mudar o valor;
- estorno;
- reenvio idêntico e descarte em recusa definitiva.

**Suítes completas:**

- **Emulator:** 52 testes das Fases 0 a 3, mais a suíte atual de "Regularizar saldo". 51
  passam e 1 é pulado: o teste de rollback, que só roda quando se informa uma versão
  anterior das Functions. Nenhum falha.
- **Unitários:** 2.597 testes, com as mesmas 116 falhas da V242.12, teste por teste, e
  nenhuma nova.

## Próximos passos

- **Fase 4.**
  - As telas (cards, totais, Cobranças, Central, Dashboard) e a rota de recebimento passam
    a ler a conta por Espaço.
  - A tela nova é carregada no app e ligada, no lugar de "Regularizar saldo".
  - O crédito passa a valer para todas as contas.
- **Revisão assistida dos pacotes antigos bloqueados.** Para ajustes antigos que o
  servidor recusa: mostrar o pacote e descartá-lo sem efeito, para refazer pelo comando
  novo. Fica para depois.
- **Publicação.** O comando exige o deploy de `manageCustomerAccounts`, junto com as Fases
  1 e 2 e a carga das contas, cada uma com GO.
