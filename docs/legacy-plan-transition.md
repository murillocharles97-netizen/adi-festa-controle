# V165 — migração voluntária, aprovação primeiro

Esta política substitui a proposta antiga de interromper renovações pela classificação
como legado. Classificar não cancela, não congela a renovação nem cria outro contrato.

## Ordem e segurança

1. Owner escolhe um novo plano e aceita explicitamente a troca antes do checkout.
2. Uma operação idempotente vincula contrato antigo, checkout e índice server-side novo.
3. Checkout pendente, recusado ou abandonado preserva contrato e acesso anteriores.
4. Webhook autenticado consulta o provedor e valida pagamento, valor e vínculo da empresa.
5. A transação ativa o plano novo e registra prova de pagamento e ID do webhook.
6. Somente depois do evento estar `processed` pode ser cancelada a recorrência antiga.
7. GET confirma o cancelamento; só então o estado legado é removido.

Reconciliação manual ou retorno de checkout sem webhook não pode ativar a migração.
Falha depois de ativar preserva o plano novo e a assinatura antiga, sem cancelar às cegas.
Notificação antiga não deve sobrescrever o contrato novo. Rules negam alteração dos
índices, entitlements, jobs e prova de pagamento pelo cliente.

## Retry

`retryLegacyPlanMigrations` consulta até 100 jobs vencidos a cada cinco minutos. Não
descobre nem cadastra empresas. Revalida nova ativação, índice, prova de pagamento e
webhook processado. Lease impede execução concorrente. Antes de repetir PUT, consulta
o status antigo; confirma com GET. `systemConfig/planTransitionV2.enabled=false` pausa
o scheduler. Não existe trigger automático de cadastro de legados.

Logs registram operação, empresa, estágio e códigos, sem credenciais. O job registra
início/fim da sobreposição. Um cancelamento atrasado pode coincidir com cobrança já
iniciada pelo provedor: não há promessa de impossibilidade absoluta de cobrança dupla.
O fluxo não faz reembolso automático nem cria créditos por período sobreposto.

## Acesso, preços e rollback

Direitos legados pagos são preservados até o fim contratado ou até a troca voluntária
confirmada. A nova matriz passa a valer quando a nova assinatura é ativada. Sem troca,
o vencimento segue a política existente, sem apagar dados. Nenhuma assinatura real é
reprecificada pelo deploy; o índice conserva o preço do contrato antigo.

Rollback de frontend não desfaz cancelamentos financeiros já confirmados. Restaurar
backend/Rules/UI de forma coordenada, preservando registros de pagamento e migração.

## Evidências e limitações

V165: 627 testes de aplicação, 131 de backend e 27 testes dirigidos de integração e
Rules/Storage passaram. Casos incluem webhook ausente/falho, duplicado, pagamento
recusado, cancelamento com falha/retry e isolamento de empresas. Navegador usa módulos
reais com contexto simulado, não assinaturas de produção.

Pagamentos da aplicação de teste Mercado Pago foram aprovados, mas o ciclo completo
de webhook genuíno seguido de cancelamento não foi comprovado. O deploy controlado
foi autorizado pelo usuário com preservação obrigatória da assinatura antiga na dúvida.
Não tratar testes emulados como confirmação ponta a ponta no Mercado Pago.

Auditoria de produção é somente GET: `scripts/audit-legacy-plans-dry-run.cjs --provider`.
Não executar seed, migração em massa ou cancelamento manual durante a publicação.
