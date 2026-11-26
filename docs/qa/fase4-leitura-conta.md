# Fase 4 — as telas leem a conta por Espaço

O servidor publica o saldo de cada cliente por Espaço, a partir da conta das Fases 1 a 3.
Os cards e totais de Clientes e a Central de Cobranças passam a mostrar esse valor sem
pedir a conta de cada cliente ao servidor. Recebimentos e cobranças continuam com a
revalidação no servidor. A nova "Ajustar saldo" da Fase 3 entra no app, mas só aparece
quando o aparelho está recebendo o saldo publicado.

Nada foi publicado. Sem o deploy das Functions e das Rules, o leitor não recebe nada e as
telas continuam com as fontes de hoje.

## Servidor: o que é publicado

Coleção `businesses/{empresa}/customerSpaceAccounts`. O identificador de cada documento é
`{cliente}__{Espaço}`, ou `{cliente}__sem-espaco` para a parte sem Espaço.

| Campo | Conteúdo |
|---|---|
| `debtCents` | Saldo no Espaço, em centavos. Maior que zero é dívida, menor que zero é crédito. |
| `spaceId` | O Espaço, ou `null` para a parte sem Espaço. |
| `status` | `ready` ou `ready_by_rule`, a classificação da conta. |
| `clientId`, `businessId`, `workspaceGeneration` | Identificam o cliente, a empresa e a geração. |
| `accountEventCount`, `accountUpdatedAt` | Quantos eventos a conta já aplicou e quando. |

Quem grava, sempre na mesma transação que grava a conta:

- a carga das contas (Fase 2);
- o comando de ajuste (Fase 3);
- o gatilho de cada evento do razão (conta sombra da Fase 1).

Regras:

- **Só contas prontas.** Uma conta que precisa de abertura, atribuição ou revisão não é
  publicada.
- **Conta que deixa de estar pronta.** Os documentos dela são retirados, e nenhum saldo
  antigo fica visível.
- **Espaço zerado.** Fica publicado com zero, para que os aparelhos vejam a mudança.

## Rules

| Quem | Pode ler |
|---|---|
| Quem lê o razão (`balanceEvents`) | Os documentos dos Espaços que acessa. |
| Proprietário | Também a parte sem Espaço. |
| Ninguém | Gravar ou apagar. Só o servidor grava. |

As Rules não conseguem provar o Espaço de uma consulta aberta. Por isso, quem não é
proprietário consulta com o filtro `spaceId in [...]`.

## Aparelho

- **`js/customer-space-accounts.js`** guarda os saldos por usuário, empresa e geração.
  - Uma cópia local do mesmo escopo aparece até a resposta do servidor chegar, marcada como
    não atualizada.
  - Outro usuário, empresa ou geração começa vazio.
- **`js/firebase/customer-accounts-reader.js`** mantém a loja atualizada e só lê.
  - O proprietário escuta a empresa inteira.
  - Os demais escutam os Espaços que acessam, em grupos de até 30.
- **Clientes.**
  - O card usa o saldo publicado e não consulta a conta do cliente.
  - Para o proprietário, o total publicado precisa ser igual ao saldo cadastral. Se não
    for, a tela volta à consulta de antes.
  - Quem não vê todos os Espaços vê a soma dos seus.
  - Quando chega um saldo novo, o card se atualiza sozinho.
- **Cobranças.** A lista e os totais usam o mesmo saldo de exibição. A ordenação e os
  cálculos da Central não mudaram; otimizá-los é a prioridade 2 de desempenho, ainda não
  iniciada.
- **Ajustar saldo.** A tela nova aparece no menu do cliente só com:
  - a permissão `customers.adjustBalance`;
  - os Espaços carregados;
  - o saldo publicado já confirmado pelo servidor neste aparelho.

  Fora disso, o menu mostra a ação antiga, como hoje.

## O que continua igual

- **Recebimentos.** Continuam com a prova do histórico e a revalidação no servidor. Ler a
  conta no recebimento é a etapa 4c.
- **Crédito nas contas comprovadas.** Continua bloqueado enquanto `PROOF_COMPATIBILITY`
  estiver ligado.
- **Regimes antigos.** Sem documento publicado, ou com divergência, cada tela usa a fonte
  de antes: a regra local, o legado ou a consulta da conta.

## Testes

| Teste | Resultado |
|---|---|
| `tests/customer-space-accounts.test.cjs` (loja) | 4 de 4 |
| `tests/fiado-shared-balance-v24213.test.cjs` (Clientes e Ajustar saldo) | 5 de 5 |
| `tests/customer-balance-adjustment.dom.test.cjs` (tela de ajuste) | 6 de 6 |
| `tests/emulator/customer-space-accounts.test.cjs` (publicação no Emulator) | 4 de 4 |
| `tests/emulator/customer-account.rules.test.js` (Rules) | 6 de 6 |
| Contenção do pacote público | 56 de 56 |

Suítes completas, comparadas com a base: veja o fim deste documento.

## Antes de publicar

A ordem importa, e cada passo precisa do próprio GO:

1. **Rules e Functions.** Deploy de `projectCustomerAccount`, de `manageCustomerAccounts` e
   das Rules.
2. **Carga em produção.** Prévia e depois a aplicação. A prévia somente leitura de
   produção classificou todas as contas como prontas.
3. **Frontend.** Versão V242.13 com cache e tags novos. A troca de versão ainda não foi
   feita nesta branch.

Pontos a conferir:

- **Índice.** A consulta de quem não é proprietário combina `spaceId in` com
  `workspaceGeneration ==`. São só igualdades, que o Firestore atende juntando índices
  simples. Conferir em produção que não aparece erro de índice; se aparecer, criar o
  índice composto.
- **Leituras.** Ao abrir o app, cada aparelho lê um documento por cliente e Espaço com
  saldo publicado. Depois, só as mudanças.

## Rollback

| Parte | Como voltar |
|---|---|
| Frontend | Tirar os três scripts do `index.html`. As telas voltam às fontes de antes. |
| Servidor | Desligar `SHADOW_ENABLED`. Os documentos publicados só são lidos para exibição. |

## Suítes completas

Comparadas com a base da Fase 3 (unidade e Emulator) e da `main` (Rules):

| Suíte | Resultado | Em relação à base |
|---|---|---|
| Unidade | 2606 testes, 115 falhas antigas | Nenhuma falha nova; uma a menos. |
| Emulator das Fases 0 a 4 | 56 testes, nenhuma falha, 1 ignorado | Era 52; mais 4 da Fase 4. |
| Rules | 517 testes, 86 falhas | Uma a mais, por instabilidade do Emulator. |
| Lint | 577 arquivos | Sem erro. |

A falha a mais nas Rules foi um tempo esgotado de transação ("Transaction is invalid or
closed") num teste de criações simultâneas do diretório de clientes. Esse teste não
passa pelo código desta fase. Rodado sozinho, o arquivo passou duas vezes, com 41 de 41.
