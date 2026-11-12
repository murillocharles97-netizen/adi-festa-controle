# Homologação comercial Android

## Preparação

Use a VECONI em um ambiente de QA com o build candidato, um Android com Chrome/PWA e uma segunda sessão de QA para conferir sincronização. Use duas empresas fictícias e contas distintas de proprietário e vendedor. Para a assinatura, confirme que o backend, o checkout, as credenciais e o webhook pertencem à integração de teste do Mercado Pago. Use os dados e meios de pagamento de teste compatíveis com a integração. Se não houver ambiente de teste configurado, marque a contratação como pendente.

## Roteiro

1. **Novo comerciante.** Abra o PWA como novo usuário, crie a empresa por e-mail, confirme o acesso de proprietário e o período de avaliação. Saia, reabra e entre novamente. Repita o cadastro e login com uma identidade Google de QA separada.
2. **Primeira venda.** Crie um produto de R$ 10,00 com estoque 3. Faça uma venda de uma unidade em dinheiro e outra em Pix registrado, com caixa de QA configurado para receber as vendas. Confira dois recibos, estoque 1 e dois lançamentos de R$ 10,00 no caixa correspondente.
3. **Reconexão.** Em uma nova venda de QA, interrompa a conexão durante a confirmação. Reabra o PWA e volte online. Confira a fila e o resultado na segunda sessão. Se houve confirmação, deve existir uma única venda, uma baixa e um lançamento. Se não houve, a interface deve manter a pendência ou orientar como retomar.
4. **Equipe.** Convide um vendedor para o espaço A. Com um produto antigo de QA sem vínculo e com custo protegido, o proprietário abre Produtos → opções do item → Definir espaços para a equipe e escolhe A. Após sincronizar, o vendedor deve encontrar o produto e suas variações em A, sem ver custos. Confira ausência no espaço B e na outra empresa.
5. **Assinatura.** Em Planos, confira preço e ciclo e contrate pelo Mercado Pago de teste. Use uma aprovação e uma recusa ou pendência em contas de QA separadas. Após voltar ao PWA e reabrir, a aprovação deve ativar o plano correto uma vez. Recusa ou pendência não deve conceder acesso pago. Confirme a notificação no servidor e que repetir a consulta mantém uma única contratação.

Registre build, modelo do Android, status de cada passo e IDs das operações sintéticas. O percurso comercial só passa quando o estado na segunda sessão e no servidor confirma o que o aparelho exibe.

Referência: [Teste de assinatura do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-test/payment-approval).
