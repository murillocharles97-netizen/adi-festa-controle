# Etapa 3 — parcelamentos na conta por Espaço

Local, sem push nem deploy. Plano geral em `arquitetura-unica-etapas.md`.

## O que muda

- **Recebimento pela conta com parcelas.** A verificação já guardava os itens em aberto,
  inclusive as parcelas, com número, vencimento e valor.
  - O restante de uma parcela depende só do que foi pago na venda. O dia muda apenas o que
    está vencido e o que é futuro.
  - Por isso, a rota pela conta faz a divisão entre vencidas e futuras no dia do
    recebimento, e a confirmação aloca às parcelas como a rota atual.
  - A antecipação de parcela futura continua exigindo a escolha explícita.
  - Quando os dias passam sem nova operação, a rota pela conta acompanha os vencimentos sem
    precisar de outra verificação.
- **Mesma proteção da rota atual.** Cliente marcado com parcelamento mas sem venda parcelada
  vai para a rota completa, que pede revisão.
- **Cliente novo com crediário.** A primeira venda Fiado parcelada também abre a conta por
  Espaço, na mesma transação.
- **Migração com parcelas (Etapa 2).** Cliente simples com parcelamento migra quando o
  restante de cada venda parcelada é igual à soma das suas parcelas. Os vencimentos, os
  valores e as alocações ficam iguais.
  - O indicador de parcelamento sem venda parcelada é recusado (`history_review`).

## Verificação de cobertura

A prévia por empresa deve conferir o montante exigível, parcelas futuras e o calendário de todas as obrigações comprovadas antes de migrar.

## Testes

`tests/emulator/installment-account.test.cjs`, com 4 testes:

| Teste | O que confere |
|---|---|
| Cliente novo com parcelamento | Abre a conta. Vencidas e futuras iguais à reconstrução, com as mesmas parcelas, vencimentos e valores. |
| Recebimento e antecipação | Recebimento do vencido e antecipação de parcelas, com as linhas por parcela gravadas na alocação. Sem antecipação, parcela futura não é cobrada. |
| Passar dos dias | Com o relógio do servidor adiantado 40 e 100 dias, as parcelas vencem, e a rota pela conta continua igual à reconstrução. |
| Migração com parcelas | Cliente simples com parcelamento e antecipação migra com a venda intacta e as mesmas parcelas antes e depois. |

`tests/emulator/customer-account-migration.test.cjs` foi atualizado: o indicador de
parcelamento sem venda parcelada agora aparece como `history_review`.

## Suítes completas

| Suíte | Resultado | Em relação à base |
|---|---|---|
| Unidade | 2610 testes, 115 falhas antigas | Nenhuma falha nova. |
| Emulator das Fases 0 a 4c e Etapas 1 a 3 | 76 testes, nenhuma falha, 1 ignorado | Mais 4 desta etapa. |
| Rota de recebimento anterior | 20 aprovados, 1 ignorado | Igual à base. |
| Crediário e prova anteriores (`installment-credit-v227`, `fiado-history-backend-v227`, `preserved-payment-recognition`) | 16 aprovados, 1 ignorado | Igual à Fase 4c, antes das etapas. |
