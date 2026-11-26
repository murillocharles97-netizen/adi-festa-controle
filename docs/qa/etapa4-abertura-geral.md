# Etapa 4 — abertura e migração gerais por Espaço

Local, sem push nem deploy. Plano geral em `arquitetura-unica-etapas.md`.

## O que muda

### Abertura geral no servidor

Novo comando em `manageCustomerAccounts`, para o proprietário de qualquer empresa:

| Chamada | O que faz |
|---|---|
| `customer_account_opening_preview` | Só lê. Mostra os Espaços do cliente, o saldo sugerido por Espaço e o código da revisão. |
| `customer_account_opening` | Grava. Exige a revisão vigente, confirmação, a conferência das filas dos aparelhos e um identificador. |

É a mesma abertura do corte de 12/11, com as mesmas regras e a mesma auditoria em
`fiadoOpeningBalances`:

- o saldo confirmado precisa cobrir as parcelas existentes;
- uma diferença em relação ao cadastro exige motivo;
- depois da abertura, só as operações novas entram na conta;
- o histórico anterior fica guardado como evidência.

O que muda em relação ao corte:

- **Sem política fixa.** Não depende de empresa, proprietário nem dos dois Espaços da
  função de 12/11 (`reviewFiadoOriginEvidence`). Os Espaços são os de vendas da própria
  empresa ligados ao cliente ou presentes no histórico, validados pelo servidor. Espaço de
  outra empresa não entra.
- **Saldo zero aceito.** Recomeça um cliente sem dívida cujo histórico antigo não se
  comprova. A regra da abertura do corte continua exigindo saldo maior que zero.
- **Conta pronta na hora.** A conta por Espaço sai montada e comprovada na mesma transação,
  com os saldos publicados. O recebimento seguinte já usa a conta.

### Tela "Conta por Espaço"

O menu do cliente, em Financeiro, ganha a ação "Conta por Espaço" (`js/customer-account-setup.js`). Ela aparece só para o proprietário e só para cliente
ativo fora da conta por Espaço.

1. A tela pede a prévia da migração (Etapa 2).
2. **Cliente elegível.** Mostra o saldo por Espaço e migra sem mudar nada financeiro.
3. **Migração recusada.** Mostra o motivo e oferece "Abrir saldo por Espaço":
   - o proprietário revisa o valor de cada Espaço e o motivo;
   - vê o resumo do servidor;
   - confirma depois de conferir as filas dos aparelhos.
4. **Sem resposta do servidor.** A confirmação fica guardada no aparelho e é reenviada
   igual, com o mesmo identificador.

## Situação por cliente existente

Clientes no novo regime passam pela carga. Clientes simples com prova seguem pela migração. Quando a prova não fecha, a abertura exige revisão do proprietário, inclusive para contas realmente zeradas. A central legada continua disponível durante a transição.

## Testes

`tests/emulator/customer-account-opening.test.cjs` roda numa empresa fictícia com três
Espaços, sem relação com a empresa principal:

| Teste | O que confere |
|---|---|
| Abertura zero | Histórico sem prova: a migração recusa, e a abertura em zero começa a conta. A venda nova entra nela, e o recebimento usa a conta e quita a venda. |
| Divisão do saldo | Saldo antigo sem eventos, dividido entre dois Espaços. Conta, saldos publicados e rota seguem a divisão; o recebimento reduz só o próprio Espaço. |
| Recusas | Diferença sem motivo, Espaço de outra empresa, gerente, dono de outra empresa e cliente de outra empresa. Nada é gravado. Com motivo, a diferença é aplicada. |
| Repetição | Repetição idempotente e abertura única por cliente. Depois dela, a migração mostra "já está na conta". |

`tests/customer-account-setup.dom.test.cjs`, com 4 testes:

- quem vê a ação;
- migração com o código da prévia;
- abertura com resumo e conferência obrigatórios;
- reenvio com o mesmo identificador.

Menu do cliente, contenção do pacote público e lint: 60 de 60 e 580 arquivos.

## Suítes completas

| Suíte | Resultado | Em relação à base |
|---|---|---|
| Unidade | 2614 testes, 115 falhas antigas | Nenhuma falha nova. |
| Emulator das Fases 0 a 4c e Etapas 1 a 4 | 80 testes, nenhuma falha, 1 ignorado | Mais 4 desta etapa. |
| Rota de recebimento e crediário anteriores | 20 e 16 aprovados, 1 ignorado cada | Igual à base. |
| Rules | 518 testes | Só o teste de criações simultâneas do diretório de clientes, já conhecido por instabilidade. |
