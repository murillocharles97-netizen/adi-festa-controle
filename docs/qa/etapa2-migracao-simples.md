# Etapa 2 — migração dos clientes simples

Local, sem push nem deploy. Plano geral em `arquitetura-unica-etapas.md`.

O proprietário migra um cliente do regime simples para a conta por Espaço. Nada
financeiro muda: saldo, versão financeira, vendas, recebimentos, alocações e eventos ficam
iguais. O cliente passa ao mesmo regime de uma regularização. A conta por Espaço é montada
e comprovada na mesma transação, e o recebimento seguinte já a usa.

## Comando

O comando roda na Function `manageCustomerAccounts`:

| Chamada | O que faz |
|---|---|
| `customer_account_migration_preview` | Só lê. Com `clientId`, mostra a situação do cliente e o código da prévia. Sem `clientId`, lista os clientes da empresa por página, com a situação e o motivo de cada um. |
| `customer_account_migration` | Grava. Exige o proprietário, confirmação, um identificador e a prévia vigente. |

Situações:

| Situação | Significado |
|---|---|
| `eligible` | Pode migrar. A prévia mostra o saldo por Espaço. |
| `already_space` | Já está na conta por Espaço: abertura, regularização ou cliente nativo. |
| `nothing_to_migrate` | Sem movimento. A primeira venda Fiado abre a conta (Etapa 1). |
| `blocked` | Não migra, e o motivo vem junto. |

Motivos de recusa:

| Motivo | O que significa |
|---|---|
| `installments` | Cliente com parcelamento. A migração das parcelas chega na Etapa 3. |
| `sale_history_mismatch` | O restante de alguma venda mudaria. |
| `cross_space_allocation` | Recebimento antigo alocado a venda de outro Espaço. |
| `payments_exceed` | Os recebimentos antigos passam das vendas comprovadas. |
| `history_unproven` | O histórico não comprova o saldo por Espaço. |
| `origin_unknown` | Há dívida sem Espaço. |
| `balance_mismatch` | O saldo cadastral não confere com o histórico. |
| `credit` | Cliente com crédito. |
| `pending` | Há recebimento ou venda pendente. |
| `archived` | Cliente arquivado. |

## Regras

- **Comprova antes de gravar.** Reconstrói o histórico como se o cliente já estivesse no
  regime por Espaço. Só aceita quando valem todas as condições abaixo:
  - o total é igual ao saldo cadastral;
  - toda dívida tem Espaço;
  - cada venda continua devendo exatamente o mesmo;
  - a conferência do recebimento está limpa;
  - não há pendência.
- **Sem mudar a versão financeira.** Nada financeiro muda. Uma prévia de recebimento feita
  antes da migração é recusada na confirmação, porque a rota passa a ser por Espaço.
- **Na mesma transação:**
  - o regime do cliente;
  - a conta por Espaço, com a verificação e os itens em aberto;
  - os saldos publicados;
  - o registro `customerAccountMigrations/{cliente}`, com antes e depois;
  - o marcador da operação;
  - o sinal de sincronização.
- **Proteção contra repetição.** O mesmo identificador com o mesmo pedido devolve o
  resultado anterior; com outro pedido, é recusado.
- **Rules.** O registro da migração só é lido e gravado pelo servidor.
- **Interruptor.** `WRITES_ENABLED` em `customer-account-migration-service.js` pausa novas
  migrações e mantém a prévia.

A tela para o proprietário chega com a abertura e a migração gerais (Etapa 4). Até lá, o
comando é chamado pela Function.

## Triagem de clientes existentes

Execute a prévia por empresa. Clientes sem prova precisam de revisão e podem seguir para o fluxo auditado de abertura da Etapa 4. Clientes sem movimento entram na primeira venda Fiado.

## Testes

`tests/emulator/customer-account-migration.test.cjs`, com 4 testes:

| Teste | O que confere |
|---|---|
| Migração completa | Vendas em dois Espaços e recebimento parcial. Saldo, versão, vendas, recebimentos, alocações e eventos iguais antes e depois. A conta é usada logo em seguida, igual à reconstrução, e o recebimento seguinte quita a venda certa. |
| Repetição | Repetição idempotente, identificador reaproveitado, prévia vencida e cliente já migrado. |
| Recusas | Parcelamento, restante divergente, pendência, outro perfil e cliente sem movimento. Em todos, nada é gravado. |
| Lista | Situação e motivo por cliente, sem expor o histórico. |

`tests/emulator/customer-account.rules.test.js`: ninguém lê nem grava o registro da
migração.

## Suítes completas

| Suíte | Resultado | Em relação à base |
|---|---|---|
| Unidade | 2610 testes, 115 falhas antigas | Nenhuma falha nova. |
| Emulator das Fases 0 a 4c e Etapas 1 e 2 | 72 testes, nenhuma falha, 1 ignorado | Mais 4 desta etapa. |
| Rules | 518 testes | O teste novo passa. A falha a mais é o teste de criações simultâneas do diretório de clientes, já conhecido por instabilidade do Emulator. |
