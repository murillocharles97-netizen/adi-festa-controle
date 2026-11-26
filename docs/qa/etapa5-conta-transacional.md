# Etapa 5 — conta por Espaço gravada na mesma transação

Local, sem push nem deploy. Plano geral em `arquitetura-unica-etapas.md`.

## O que muda

Toda operação financeira atualiza a conta por Espaço na própria transação: venda Fiado,
venda parcelada, recebimento (parcial ou antecipado), desfazer venda, cancelamento pela
Function, regularização e ajuste pelo comando.

- **Itens em aberto mantidos evento a evento.** `shared/customer-account-ledger.js` aplica,
  para cada evento, as mesmas regras da reconstrução por Espaço, sem reler o histórico:
  - as dívidas sem parcelamento ficam como itens, com o restante de cada uma;
  - as vendas parceladas guardam o calendário e quanto já foi pago, e as parcelas são
    calculadas no dia;
  - o recebimento aloca às vendas e às parcelas;
  - o restante sem venda consome o saldo mais antigo do Espaço;
  - a reversão de venda já recebida e a obrigação com data futura são recusadas, como na
    reconstrução.
- **Na mesma transação.** `services/customer-account-ledger-service.js` lê a conta antes da
  primeira gravação. Só atualiza quando a conta está em dia com o cliente, na mesma versão
  financeira. Os itens precisam somar o total de cada Espaço. Então grava, junto com a
  operação:
  - a conta;
  - os saldos publicados;
  - o marcador de cada evento.

  Em qualquer outro caso a operação segue igual, e o gatilho e a conferência completa
  decidem.
- **O gatilho não reconstrói mais a cada evento.** O evento já aplicado na transação é
  reconhecido pelo marcador, e a reconstrução completa do histórico não roda. Ela continua
  quando um evento chega por um caminho que ainda não atualiza a conta, por exemplo as
  correções de manutenção, e refaz os itens nesse momento.
- **Cliente novo.** A conta é criada vazia na mesma transação da primeira venda Fiado, que
  é a que abre o cliente (Etapa 1).
- **Bases comprovadas guardam os itens.** A carga, a verificação, a migração, a abertura e o
  comando de ajuste gravam os itens e a versão do cliente a que correspondem.
- **Recebimento pela conta.**
  - Usa os itens mantidos na transação quando a conta está na versão atual do cliente.
  - Senão, usa a última verificação, se ela comprovou essa versão.
  - Senão, a rota completa decide.

Interruptor: `TRANSACTIONAL_ENABLED` em `customer-account-ledger-service.js`. Com `false`,
a conta volta a seguir as operações só pelo gatilho, como antes.

## Limite que já existia

A Function de cancelamento exige que o Espaço principal do cliente seja o Espaço da venda.
Um cliente com vendas em mais de um Espaço não consegue cancelar por ela uma venda fora do
Espaço principal. Isso não muda nesta etapa e fica registrado para a Etapa 7.

## Testes

`tests/emulator/transactional-account.test.cjs` nunca roda o gatilho entre as operações:

| Teste | O que confere |
|---|---|
| Sequência fixa | Venda, venda parcelada, venda em outro Espaço, recebimento parcial, antecipação, desfazer, ajustes pelo comando, cancelamento pela Function. Depois de cada uma, a conta mantida na transação é igual à reconstrução completa: itens, vencimentos, Espaços e saldo. No fim, o gatilho reconhece todos os eventos e não reconstrói nenhum. |
| Sequência aleatória | 30 operações sorteadas, com a mesma paridade depois de cada uma. |
| Conta que não acompanha | A rota completa decide; a conferência refaz os itens, e a transação volta a acompanhar. |
| Migração e abertura | Contas vindas das duas também seguem cada operação na transação, sem reconstrução. |

O teste também confirma duas proteções que já existiam: o ajuste não consome parcelas, e o
aparelho não desfaz venda depois de outra operação financeira.

## Testes anteriores atualizados

Com a conta acompanhando as operações na transação, alguns testes de fases anteriores
mudaram de expectativa. Cada um mantém o que comprova:

| Arquivo | O que mudou |
|---|---|
| `customer-account-shadow.test.cjs` (Fase 1) | Roda com a atualização na transação desligada, porque testa o caminho do gatilho, que segue como recuo. |
| `customer-account-backfill.test.cjs` (Fase 2) | A regularização posterior à carga roda sem a atualização na transação, para testar o gatilho. |
| `customer-account-receipt.test.cjs` (4c) | Depois do recebimento, a rota já usa a conta, sem esperar o gatilho. Os casos de conta atrasada são simulados com uma operação que a transação não acompanha. |
| `native-space-account.test.cjs` (Etapa 1) | Confere a conta em dia com a versão do cliente, no lugar da verificação pelo gatilho. |

## Suítes completas

| Suíte | Resultado | Em relação à base |
|---|---|---|
| Unidade | 2614 testes, 115 falhas antigas | Nenhuma falha nova. |
| Emulator das Fases 0 a 4c e Etapas 1 a 5 | 84 testes, nenhuma falha, 1 ignorado | Mais 4 desta etapa. |
| Rota de recebimento e crediário anteriores | 20 e 16 aprovados, 1 ignorado cada | Igual à base. |
| Rules | 518 testes | Uma falha a mais, num teste de importação simultânea de produtos. Sozinho, passou com 10 de 10. |
