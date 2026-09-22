# V147 — vendas somente locais

## Estados e confirmação

A venda nova é preparada na fila (`local_preparing`) antes de ser persistida no banco local. Depois da gravação local, a entrada passa a `pending`. Falha em qualquer etapa preserva a fila ou impede a gravação da venda. Uma venda moderna sem confirmação e sem item de fila é uma inconsistência; não deve ser considerada concluída.

O ACK de venda exige leitura do documento remoto pelo mesmo `saleId` e `operationId`. Para fiado, também exige `financialAppliedAt` e evento financeiro remoto com o mesmo `saleId`, `operationId`, cliente e delta. Somente então a entrada é removida da fila. Se a confirmação falhar, a entrada permanece para diagnóstico/retry.

## Recuperação

`Comparar com a nuvem` é apenas leitura. A auditoria individual classifica A (candidata segura), B (já representada por outra operação), C (cancelada), D (possível duplicata) ou E (revisão manual). A classificação A exige uma operação moderna e autocontida, ou efeito financeiro remoto já comprovado; efeitos de estoque, campanhas, assinaturas e operações financeiras posteriores impedem recuperação automática.

`Recuperar` é permitido somente a owner/admin, após nova comparação e backup. A transação reutiliza os IDs originais, verifica marcador/efeito e, quando há débito a aplicar, exige saldo e `financialVersion` remotos exatamente iguais ao estado anterior local. O replay é idempotente. Não há recuperação financeira em lote. A revisão histórica registra justificativa explícita no aparelho, sem alterar venda ou saldo; não equivale a comprovar cobrança.

## Guard de fiado

O guard é por cliente. Uma venda fiado recente (sete dias) ou identificada na última comparação como somente local bloqueia outra venda fiado desse mesmo cliente se não estiver na fila, confirmada na nuvem ou explicitamente revisada. O guard não bloqueia outros clientes nem pagamentos Pix, dinheiro, cartão ou maquininha. Uma órfã antiga de estoque/saldo incerto continua exigindo revisão daquele cliente; igualdade entre saldos atuais, por si só, não prova que a venda foi liquidada.

O carrinho mostra um único aviso com ação para comparar a operação/cliente com a nuvem. Fechar o aviso não apaga o carrinho. A revisão histórica pode liberar o guard apenas mediante atestado do owner/admin, depois de nova comparação, saldos atuais iguais e justificativa registrada. A venda continua visível como somente local. Não há ação de exclusão.
