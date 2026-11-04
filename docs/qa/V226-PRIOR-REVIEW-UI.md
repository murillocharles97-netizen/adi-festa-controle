# V226 — apresentação da conferência final de venda anterior

## Escopo e isolamento

Branch `codex/v226-prior-review-ui`, em checkout separado, sobre o frontend publicado `c06402d494b1e529ea7d8498f6406499873bfacf`.

A investigação de identidade e seu diagnóstico local permanecem intactos em `C:/Users/Murillo/Documents/VECONI-V226-Integrated-225`, branch `codex/v226-android-readonly-diagnostics`. Nada desse pacote foi incorporado. Cobrança e demais branches também foram preservadas.

Somente dois arquivos públicos mudam:

- `js/prior-sales.js`: HTML do modal criado por `dialog()`. Nenhuma alteração fora desse template.
- `css/prior-sales.css`: regras acrescentadas, todas sob `#modal .prior-sale-review`, sem modificar regras anteriores ou outras telas.

Testes, fixture, documentação e manifesto específico completam o commit; não fazem parte do pacote público.

## Causa visual comprovada

A tela publicada foi reproduzida usando os 68 estilos referenciados pelo index de produção. Em 390 px:

- A regra geral mobile de labels em modais sobrescrevia o flex dos rótulos com grid de uma coluna.
- O input recebia largura total do formulário e min-height de 48 px. Seu retângulo efetivo media aproximadamente **312 × 48 px**; o checkbox aparecia grande e centralizado, acima do texto.
- A tipografia genérica também deixava o texto com cerca de 10,6 px e peso 750, em vez de uma confirmação legível e proporcional.

As novas regras têm especificidade limitada ao modal final e suficiente para prevalecer sobre esses seletores gerais. Cada linha usa grid `20px minmax(0,1fr)`, input fixo de 20 × 20 px, texto de 14 px/peso 500 e alvo de toque mínimo de 44 px. O texto inteiro continua associado ao checkbox por label nativo.

## Preços, descontos e declarações

O modal final já tinha **uma única** chave `pricesConfirmed`; não havia duas validações com esse nome. A conferência anterior `originalPrices` tem função diferente: determina quais preços originais serão informados no intent antes da prévia. Removê-la alteraria o contrato comercial.

A revisão final agora mostra uma única linha “Conferi os preços e descontos”, com o desconto total em texto secundário, sem repetir a declaração longa. O checkbox anterior e seu comportamento permanecem inalterados, fora do modal. Nenhuma confirmação obrigatória foi removida, marcada automaticamente ou inferida.

Continuam exatamente cinco declarações por operação: preços/descontos, entrega, estoque ainda não baixado, ausência de registro anterior e pagamento externo recebido **ou** Fiado integral em aberto. A distinção entre as cinco chaves e o ramo Fiado foi testada. A legenda “Confirme antes de registrar” agrupa os controles de forma acessível.

## Layout e navegação

- Dados de venda, espaço, cliente, pagamento, recebimento/situação e motivo em lista compacta, preservando os valores.
- Itens e total preservados; nota de estoque permanece visível.
- Cabeçalho e rodapé fora da região rolável; dois botões empilhados no mobile e lado a lado no desktop.
- Estado vazio da mensagem de status não reserva espaço. Erros continuam usando a área original com role alert.
- Novo registro só é liberado com as cinco marcações. Uma marcação removida bloqueia o botão imediatamente.
- Consultar uma tentativa de resposta perdida continua sendo leitura: não exige recriar a venda ou repetir pagamento. Esse comportamento anterior foi preservado.
- Trap de Tab/Shift+Tab, Escape, retorno ao carrinho e proteção contra cliques repetidos mantidos sem alteração de handlers.

## Evidência de navegador

| Viewport | Checkbox | Texto | Menor linha | Rolagem | Rodapé |
|---|---|---|---|---|---|
| 360 × 800 | 20 × 20 px | 14 px | 44 px | pequena, funcional | dentro do viewport |
| 390 × 844 | 20 × 20 px | 14 px | 44 px | conteúdo cabe | dentro do viewport |
| 430 × 932 | 20 × 20 px | 14 px | 44 px | conteúdo cabe | dentro do viewport |
| 1440 × 1000 | 20 × 20 px | 14 px | 44 px | conteúdo cabe | dentro do viewport |

Em 390 px, a seção de declarações passou de aproximadamente 488 para **294 px**, redução de cerca de 40%, mesmo com texto maior. O modal passou de 820 para aproximadamente 773 px. Em 360 px ele respeita a altura disponível com rolagem interna, sem cortar o rodapé nem criar rolagem horizontal.

Também foi testada altura reduzida de 390 × 540: o último checkbox pôde ser alcançado por rolagem, o rodapé permaneceu acessível e o modal respeitou 516 px. Space alternou checkbox, quatro marcações mantiveram o botão bloqueado, cinco liberaram e remover uma bloqueou novamente. Não foi necessário confirmar nenhuma venda no navegador para comprovar isso.

Capturas locais e métricas ficam em `C:/Users/Murillo/.codex/visualizations/2026/11/04/v226-prior-review-ui/`: `before-390.jpg`, `after-360.jpg`, `after-390.jpg`, `after-430.jpg`, `after-1440.jpg`, `after-fiado-390.jpg`, `LAYOUTS.json` e `BROWSER-CHECKS.json`. Arquivos exploratory documentam iterações anteriores e não representam o resultado final.

## Testes e preservação

Os testes comparam o JavaScript ao commit publicado e comprovam que tudo fora do HTML do modal é idêntico, incluindo handlers de confirmação/status, captura de escopo, chaves, idempotência, payloads e callback de conclusão. O CSS original também permanece íntegro; o acréscimo inteiro é restrito à revisão final.

Regressões exercitam Pix e Fiado, cinco declarações únicas, vínculo dos labels, confirmação única, clique repetido, resposta perdida e consulta pelo mesmo operationId, preços originais independentes, cancelamento, Escape/foco, datas comerciais e integração com a cobrança V225. A suíte de integração preserva os sete handlers e treze arquivos financeiros imutáveis da V225.

Resultado final: **100 testes aprovados, zero falhas**, em seis arquivos; lint e build aprovados com 482 arquivos JavaScript verificados no checkout isolado; diff-check aprovado. O smoke final em uma aba nova não apresentou warnings ou erros JavaScript. A quantidade de arquivos difere dos checkouts antigos porque os artefatos preservados da investigação anterior não foram copiados para este worktree.

Nenhuma Function, Rule, índice, autenticação, protocolo Sync, arquivo de cobrança ou dado real foi alterado. A fixture não carrega Firebase e seu servidor local aceita só GET, com connect-src none. Todas as operações do harness são memória sintética; nenhuma venda ou cobrança foi criada em produção.

## GO/NO-GO e publicação futura

**GO técnico para publicação controlada somente frontend/PWA, após autorização específica.** O resultado de navegador não substitui a conferência física posterior no Android/PWA original.

Plano: conferir que produção continua na base esperada; publicar apenas o frontend pelo workflow existente; verificar commit/build e hashes dos dois recursos alterados; smoke de leitura; conferir no Android a revisão sem concluir outra venda de teste. Não limpar armazenamento, ativar V3, alterar Functions/Rules ou reenviar filas.

Rollback visual compatível: frontend `c06402d494b1e529ea7d8498f6406499873bfacf`. Mantém backend V226, cobrança V225, vendas já registradas e seus recibos; não restaura dados nem reprocessa operações. Ele reintroduz o layout anterior, portanto deve ser usado somente após avaliação e autorização. A referência de contenção que pausa vendas anteriores não é necessária para esse ajuste apenas visual.

Não houve push, deploy ou rollback nesta preparação.
