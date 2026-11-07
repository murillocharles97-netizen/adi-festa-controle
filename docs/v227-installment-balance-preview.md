# Prévia do saldo no Parcelado

Base publicada 5313fba1b1882e95ef50b2ae5dc359a46777f70e. Correção local na branch codex/v227-installment-balance-preview. GO técnico para publicação seletiva do frontend após autorização específica.

## Causa e efeito financeiro

Checkout.selectedClient somava abs(min(0, client.saldo)) ao total do carrinho sempre que sale-status era fiado. A opção crediario também usa esse status, portanto entrava na mensagem genérica “Após esta venda ... em aberto”. Além disso, o cartão mostrava o saldo contábil integral com o rótulo “Deve”. Ambos os layouts consomem essa mesma função.

clients.saldo representa a dívida contábil integral. Após uma venda parcelada de 20 com dívida anterior de 247, o valor contábil 267 é esperado, mas não significa 267 exigíveis. A exigibilidade é apurada separadamente por vencimento. O helper compartilhado FiadoAccount.project e o leitor do servidor retornam dueCents, futureCents e totalCents.

O caso foi demonstrado em dados sintéticos no Emulator. Para saldo contábil -267, legado 247 e dez parcelas futuras de 2, a Function de leitura existente retorna 247 exigíveis, 20 futuros e 267 totais. No primeiro vencimento retorna 249 exigíveis, 18 futuros e 267 totais. Leituras repetidas não modificam o cliente ou criam pagamentos. O cenário de recebimento parcial 330 → 230 → 510 também passou. A evidência aponta para erro de apresentação no fluxo observado, sem necessidade de modificar backend ou regras financeiras.

## Correção mínima

Ao selecionar Parcelado, o cartão agora projeta a conta atual usando FiadoAccount.project, e o novo contrato usando InstallmentPlan.create/rows. Mostra exigível atual, futuras atuais, contribuição da venda para exigível/futuro, exigível após confirmação, futuras após confirmação e total comprometido após confirmação. Os termos usados são os mesmos campos lidos pelo checkout na confirmação. Alterar entrada, data, quantidade ou valor atualiza a prévia.

No exemplo observado, a interface mostra 247 de Fiado exigível, 20 futuros da venda, 247 exigíveis após confirmar e 267 de total comprometido. Não mostra 267 “em aberto” como exigível. Entrada combinada permanece uma obrigação exigível na data da venda, sem confirmação automática de recebimento. Primeiro vencimento no dia atual acrescenta somente essa parcela ao exigível.

O Fiado tradicional mantém o comportamento anterior. Em Parcelado, falha de apuração, calendário ausente ou legado inconsistente resulta em “Prévia indisponível”, sem estimativa silenciosa. Clientes com crédito positivo ficam sem esta prévia até apuração específica. Isso afeta somente a apresentação e não altera validação, autorização ou execução financeira.

A prévia é explicitamente local e depende da sincronização do histórico. Ela não é comprovante de confirmação remota. A fonte do recebimento continua sendo a apuração do servidor e suas validações existentes.

## Validação

- 69 testes locais dirigidos aprovados, incluindo o carrinho real em 390/1366 px, cliente obrigatório, dívida 247 + venda 20, transição Parcelado/Fiado e alteração de entrada de zero para cinco. Confirmou exigível 252 e futuras 15 nesse último caso.
- Testes unitários cobrem dívida anterior, parcelas vencidas/futuras, pagamento parcial, vencimento no dia atual, histórico incompleto e ausência de mutações na projeção.
- 15 testes Emulator aprovados, incluindo o novo cenário 247/20/267 pela Function de leitura existente e os recebimentos parciais, antecipação, concorrência, perda de resposta e financeiro já direcionados.
- 47 testes de contenção aprovados. Build e diff-check aprovados.

Os testes usam origem loopback e registros fictícios. Nenhuma venda real foi concluída. Não foi feita leitura ou alteração dos valores do cliente real citado pelo usuário.

## Escopo e publicação futura

Runtime alterado somente em js/checkout.js e js/installment-credit.js. index.html atualiza referências desses dois arquivos e o Service Worker recebe veconi-v227-installment-balance-preview-v1. Não houve alteração de Functions, Rules, modelos compartilhados, recebimentos, filas, saldos reais, estoque real, cobrança ou SpaceService. Não houve push, deploy ou rollback.

Uma publicação futura requer autorização do novo commit. Conferir os bytes Git/Linux dos 258 recursos, os metadados de build e as revisões de backend antes do workflow de frontend. Após publicar, conferir o cenário sem concluir venda em Android e desktop. Manter eventual contenção compatível com contas parceladas e operações pendentes, sem reprocessar recebimentos ou restaurar dados.
