# V148 — reconciliação individual de venda legada

## Objetivo operacional

Liberar com segurança uma nova venda fiado para um cliente bloqueado por uma
venda antiga que existe somente no aparelho, sem criar uma venda fictícia e sem
alterar automaticamente as demais operações órfãs.

## Fluxo do responsável

1. No carrinho, toque em **Resolver agora**.
2. Confira cliente, data, valor, pagamento, itens e saldo atual na nuvem.
3. Escolha **Corrigir saldo manualmente**.
4. Informe o **saldo correto total em aberto** e o motivo.
5. Confirme a mudança de saldo exibida na tela.
6. Após a confirmação remota, o carrinho é preservado e recalculado com o novo
   saldo. A venda fiado pode ser concluída normalmente.

Para o caso controlado da Bruna, a reconciliação esperada é de R$ 0,00 para
R$ 26,00 em aberto. Mantendo R$ 25,00 no carrinho, a prévia passa a R$ 51,00 em
aberto.

## Garantias técnicas

- A operação remota usa o ID determinístico
  `legacy_reconciliation:{saleId}`.
- O documento auditável fica em `balanceAdjustments` com
  `adjustmentType=reconciliation`, `reasonCode=legacy_sale_not_synced` e
  `source=owner_manual_reconciliation`.
- Cliente, ajuste, evento financeiro e marcador idempotente são gravados na
  mesma transação do Firestore.
- A venda original não é criada e a receita não é inflada.
- O tombstone `resolved_by_reconciliation` é consultado antes de qualquer
  recuperação ou sincronização posterior da venda antiga.
- Somente entradas da fila que correspondem ao `saleId` ou `operationId`
  resolvido são arquivadas e removidas.
- Repetir a confirmação retorna o mesmo ajuste; não há segundo débito.
- A recuperação da venda original continua disponível apenas quando a auditoria
  classifica a operação como segura.

## Escopo

Este fluxo resolve uma operação por vez. Ele não reconcilia em massa as demais
vendas somente locais e não toma decisão financeira automática sobre elas.
