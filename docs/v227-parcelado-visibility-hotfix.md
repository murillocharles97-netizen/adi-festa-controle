# Hotfix de exibição do Parcelado

Base publicada 5942e4d32bfc8714cc457905b4abfb56d2111a01. Branch local codex/v227-parcelado-visibility. GO técnico para publicação seletiva do frontend do novo candidato, após autorização específica. Validação física no Android após atualização continua necessária antes de liberar uso comercial.

## Causa comprovada

O seletor canônico de checkout.js já continha crediario, mas não era a interface efetivamente apresentada em todos os layouts.

Em até 767 px, checkout-mobile.js esconde o campo nativo e cria botões próprios em paymentChips. A lista fixa não incluía Parcelado. O método updatePayment também tratava somente fiado como venda a prazo e notificava somente o campo de status, deixando de passar pelo change canônico que atualiza as parcelas.

A partir de 768 px, desktop-sales.js renderiza outro carrinho completo. Seu seletor fixo terminava em Fiado e o template não incluía InstallmentCredit.fields. Assim, faltavam tanto a modalidade quanto seus parâmetros.

Não foi encontrada condição de empresa, proprietário, cliente, configuração comercial ou nova flag financeira responsável pela ausência. A falha era de composição da interface. Selecionar cliente não acrescentava os controles ausentes. Permissões e validações continuam nos serviços existentes.

As versões públicas de checkout-mobile.js, desktop-sales.js, checkout.js e installment-credit.js foram obtidas por HTTP e conferidas byte a byte contra 5942e4d. O problema pertence ao candidato efetivamente servido. Rodapé V227 e opção presente no DOM oculto não comprovavam a presença do botão visível no Android.

O QA anterior usava uma fixture que montava diretamente os campos de InstallmentCredit e não passava pelos dois renderizadores de carrinho. O novo teste usa Checkout.view/bind, DesktopSales e checkout-mobile reais.

## Correção local

- Mobile adiciona o botão Parcelado quando a opção canônica existe, seleciona status Fiado e despacha change no seletor canônico. A nota explica vencimentos e recebimentos separados.
- Desktop adiciona a opção Parcelado e reutiliza exatamente InstallmentCredit.fields para entrada, quantidade e primeiro vencimento.
- index.html atualiza as referências dos dois arquivos. Service Worker recebe cache veconi-v227-parcelado-visibility-hotfix-v1.

As alterações de runtime ficam nesses quatro arquivos. Não houve modificação de Functions, Rules, modelos de parcelas, Fiado, sync.js, filas, cobrança, permissões ou SpaceService. Não houve publicação.

## Validação dirigida

146 testes de regressão aprovados, com zero falhas. Incluem caixa desktop/mobile, parcelas, datas comerciais, cliente obrigatório, Fiado tradicional, recebimentos, isolamento da operação rejeitada e contenção do pacote público. Após formatar a função de seleção mobile, o teste de navegador foi reexecutado com aprovação.

No Chromium isolado, origem loopback e rede externa bloqueada, a fixture reproduz empresa adi-festa e proprietário com dados inteiramente fictícios. Em 390 e 1366 px, utiliza produto real da fixture no carrinho, cliente selecionado e controles visíveis. Confere Pix, dinheiro, cartão, Fiado e Parcelado, status correspondente, campos de entrada/parcelas/vencimento e prévia de dez parcelas. Sem cliente, a tentativa não cria venda. Com cliente, a conclusão sintética gera dez parcelas consistentes, uma única venda e uma baixa de estoque mesmo com dois cliques rápidos. Nenhum pagamento adicional é criado.

O teste usa repositórios/modelos locais reais para a venda. A presença do cliente no servidor é simulada, e o Sync usa a fila sintética da fixture. Nenhuma chamada a backend produtivo é permitida pelo teste. Esta validação não representa homologação física do Android nem novo teste de pagamento em produção.

As primeiras execuções revelaram limitações da fixture antiga, incluindo ausência de SaleMoney, a posição da mensagem de validação no desktop e uma corrida de animação ao abrir o carrinho. O teste passou a carregar SaleMoney, verificar o aviso no documento e aguardar o carrinho entrar no viewport. Os logs foram mantidos. A execução final serializada passou integralmente.

Build aprovado em 646 arquivos JavaScript. Diff-check aprovado. Screenshots, inspeção dos arquivos publicados e logs estão em C:/Users/Murillo/.codex/visualizations/2026/11/07/v227-parcelado-hotfix.

## Publicação futura e contenção

Publicar somente o novo commit do frontend mediante autorização, usando o workflow Pages e o pacote permitido. Conferir hashes Git/Linux, com somente os metadados de build previstos no HTML, e os 258 recursos. Confirmar os dois renderizadores no domínio antes de prosseguir à homologação Android.

A atualização deve preservar o mecanismo de persistência e confirmação já publicado. No Android, concluir/salvar formulário antes de atualizar, conferir o build, abrir carrinho com produto e cliente e verificar o botão Parcelado e seus parâmetros. Não limpar cache ou IndexedDB, nem tentar novamente o recebimento antigo.

Se houver falha, avaliar a operação existente antes de qualquer recuo. A base 5942e4d preserva o backend/calendário e o isolamento de fila, mas volta à ausência visual identificada. Uma contenção não deve apagar vendas, recebimentos ou histórico. Nenhum rollback foi executado.
