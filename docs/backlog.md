# Planejamento VECONI

## Desconto por produto na sacolinha

Programar após a estabilização da V242.15, em branch e worktree separados. Acionar UI/UX para o fluxo da sacolinha, Segurança Financeira para as regras de cálculo e QA para a validação.

- Preservar o desconto geral existente e acrescentar um botão compacto de desconto em cada produto. Permitir valor em reais ou porcentagem.
- Exibir preço original, desconto e valor líquido por item. Discriminar descontos individuais no recibo e no compartilhamento pelo WhatsApp.
- Definir antes da implementação a ordem de aplicação em relação ao desconto geral, a distribuição em itens com quantidade e o arredondamento em centavos. Validar compatibilidade com vendas anteriores, dados offline e pacotes já pendentes.
- Verificar estoque, lucro, Fiado, cancelamentos, recebimentos e sincronização offline. Cobrir restauração do rascunho, retomada após perda de resposta e idempotência.
