# Payment Engine V1 — auditoria anterior à implementação

Base: V158 / c6d0016265f66f598d50f0daf8ea6ab0d047ddc6.

## Fluxo canônico encontrado

1. `Checkout` chama `Repositories.saleRepository().create`, que encaminha para
   `Vendas.registrar`. A operação recebe ID/operationId estáveis; `DB.alterar`
   aplica a mudança local e a camada sync captura a operação de venda completa.
2. `Vendas.registrar` aplica itens/campanhas, grava venda, movimentações/baixa
   de estoque, métricas do cliente e renovações no mesmo estado local. A sync
   usa a operação canônica e transação/idempotência existentes; não duplicar.
3. `pagamentos/payments` representa recebimento de dívida de cliente, não toda
   venda paga à vista. Inserir um pagamento de cartão nessa coleção poderia
   liquidar fiado indevidamente. A base presencial usa paymentIntent aprovado
   e paymentReceivable relacionado à venda como pagamento/recebível de cartão.
4. Histórico compartilhado é projetado pelos triggers de activity events,
   com IDs determinísticos a partir da venda/operação. Não criar outro evento
   de venda em paralelo no frontend.
5. `financial-income-service` já reconhece `cartao_presencial` e separa recebível
   de cartão de dinheiro disponível. Taxas/líquido desconhecidos ficam null.
6. businessId vem do contexto autenticado; espaço da venda é obrigatório;
   `Vendas.registrar` usa o actor da Equipe. Recovery precisa preservar o actor
   original da intenção, não atribuir a operação ao usuário que a retomou.

## Base de terminais existente e lacunas

Já existem provider contract/registry, intents/terminais no backend, listener de
uma intenção, claim de finalização, recuperação limitada e recebíveis. Nenhum
SDK ou integração real será adicionado. O stub Cielo existente não será ativado.

Lacunas encontradas: cargos pré-Equipe V1; ausência de restrição do terminal por
espaço; confirmação da finalização sem verificar existência da venda remota;
valor total recebido sem confronto com o carrinho; simulador com resultado
automático em vez de controles explícitos; guard insuficiente para cancelamento
de venda integrada; nova tentativa/reload dependente de estado só em memória.

Estratégia: fortalecer esta base, mantendo o pipeline de venda/estoque/campanha/
cliente/Histórico/Financeiro. Nenhum segundo checkout por adquirente. Não publicar
até os testes de segurança, recovery e smoke antigo passarem. A integração real,
split, parcelamento/estorno real e impressão física ficam fora desta fase.
