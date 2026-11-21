# VECONI Visual 1C: Vender, Clientes, Produtos e Financeiro

Branch `claude/veconi-visual-v1`, sobre a 1B aprovada (`c7c0a8e`). Não houve deploy, push ou merge. O service worker e a versão global não foram alterados.
As capturas usam dados fictícios, de fixtures locais servidas em loopback, sem rede. Ficam em `docs/screenshots/veconi-telas-1c/`:
- `antes/`;
- `depois/`;
- `depois-vazio/`.

## O que mudou

### Tema escuro de verdade nas quatro telas, incluindo gavetas e modais
- **O problema**: o CSS legado dessas telas usa centenas de cores fixas, espalhadas por cerca de 20 arquivos.
- **Gerador**: em vez de reescrever arquivo por arquivo, `scripts/build-veconi-dark-bridge.cjs` lê as regras com o parser do próprio navegador (CSSOM). Ele remapeia só as declarações de cor para os tokens `--vf-*`, por família:
  - superfícies neutras;
  - turquesa;
  - verde;
  - vermelho;
  - âmbar;
  - azul;
  - textos;
  - bordas;
  - degradês.
- **Onde fica a saída**: entre marcadores no `css/veconi-fluxo.css`, com o escopo `html.vf-dark-1c`.
- **Quem define o escopo**: o `veconi-fluxo.js` aplica `vf-dark-1c` só quando o tema está escuro e uma das quatro telas está aberta. Ele também aplica `vf-area-1c` e `data-vf-route` para as regras desenhadas à mão.
- **Tamanho**: cerca de 210 KB, com escopo de uma única classe. Comprimido fica em torno de 20 KB.
- **Quando regenerar**: sempre que o CSS legado dessas telas mudar.
- **Exceção**: os cartões de banco (`.vac-card`) ficam fora da ponte e mantêm a cor da instituição nos dois temas.

### Contraste no tema claro
A mesma ferramenta faz uma segunda passada. Ela sobe para o token da mesma família os textos médios que não chegavam a 4,5:1 sobre branco:
- cinzas, preços turquesa claros e verdes viraram `text-3`, `accent-text` ou `pos`;
- vermelhos, âmbar e azuis viraram `neg`, `warn` ou `info`.

Não toca em texto sobre fundo próprio, como botões e selos, nem em estados desativados.

### Design system aplicado (dois temas)
- **Botão principal**: turquesa da marca com texto petróleo escuro. Antes era verde com texto branco, a cerca de 2,6:1.
- **Campos**: superfície do tema e foco turquesa.
- **Chips ativos**: turquesa.
- **Selos de estoque**: semânticos (esgotado, baixo, disponível).
- **Sombras**: naturais, iguais às do Início.
- **Assinatura geométrica**:
  - **Vender (desktop)**: cabeçalho "Nova venda" com relevo de cubos.
  - **Clientes e Produtos (desktop)**: barra do espaço com cubos recortados à direita.
  - **Espaços de imagem sem foto**: textura de cubos quase imperceptível.
  - **Estados vazios**: pilha de cubos isométricos no lugar do ícone solto.
- **Vender**:
  - **Carrinho flutuante**: material petróleo, igual à meta do Início.
  - **Gaveta e pagamento (desktop)**: tipografia legível, de 12,5 a 20 px, em vez de 9 a 11 px.
  - **Pagamento (desktop)**: corrigi o espaçamento.

## Correções de layout encontradas pelas capturas
- **Pagamento no desktop**: a coluna era uma grade esticada até a altura da gaveta. Isso gerava espaços enormes e um botão "Concluir venda" com cerca de 120 px de altura. Agora é uma coluna compacta, com o botão de 52 px no pé.
- **"O que deseja criar?" em Produtos (desktop)**: as opções apareciam sem estilo, porque as regras existiam só no CSS mobile. Agora é uma grade 2×2 de cartões. Isso já estava quebrado antes da 1C.
- **Durante o trabalho**: um `display:flex` meu anulou o `[hidden]` dos campos de pagamento, e carrinho e pagamento apareceram juntos. Corrigi com `:not([hidden])`. A auditoria agora tem uma guarda para isso: os campos de pagamento não podem aparecer no passo do carrinho.
- **Na revisão das pranchas**:
  - **Botão de erro**: o botão principal turquesa tinha coberto o estado de erro do "Concluir venda" (`data-sale-state="error"`, "Tentar novamente"). Ele voltou a ser vermelho em todas as larguras.
  - **Cartões de banco**: as regras da ponte também alcançavam classes internas do carrinho de contas, apagando subtítulos e escurecendo a barra de limite. Excluí o carrossel inteiro (`.vac-*`) da ponte, e o subtítulo voltou à tinta do cartão.

## Relatório de regressões

| Verificação | Resultado |
|---|---|
| `audit-veconi-telas-1c.cjs`: 4 telas × claro/escuro × 390/1440, mais modal de cada área (carrinho, pagamento, novo cliente, novo produto, nova despesa) | ok: 0 superfícies claras no escuro, 0 textos abaixo de 4,5:1 (3:1 para texto grande), sem rolagem horizontal, sem erros de página |
| O mesmo em 360/768/1024 (sem modais) | ok: sem rolagem horizontal, 0 superfícies claras, 0 contraste baixo (o valor de despesa em 360 px pedia o vermelho semântico; corrigido) |
| Estados vazios (Vender, Clientes, Produtos) × 2 temas × 390/1440 | ok |
| Guarda do passo do carrinho (pagamento oculto até "Continuar venda") | ok |
| Início 1B (`audit-veconi-fluxo-v1.cjs`) | ok: sem regressão (5 larguras × 2 temas, movimento reduzido, contraste) |
| `node --test tests/*.test.js` | 1160 aprovados e 104 falhas: as mesmas falhas da base, comparadas pelo nome (105 linhas ✖, diferença 0) |
| `node --test tests/*.test.cjs` | 988 aprovados e 100 falhas: as mesmas da base (101 linhas ✖, diferença 0) |
| `scripts/check-project.js` (lint) | ok, 551 arquivos |

**Antes da 1C, só para comparar**:
- **Escuro**: as quatro telas e os modais tinham de 13 a 28 superfícies claras por combinação de tela e largura.
- **Claro**: havia de 8 a 26 textos abaixo do contraste mínimo por combinação.

Os números estão em `antes/report.json`.

## O que não muda
- **Regras e dados**: regras de negócio, cálculos, validações financeiras, sincronização, backend, Firebase e Firestore Rules ficaram intactos.
- **JavaScript de tela**: nenhum arquivo de tela foi alterado nesta fase. Só o `veconi-fluxo.js` mudou, e apenas para marcar o `<html>`.
- **Operação no celular**: os mesmos fluxos e toques. Não acrescentei passos nem elementos pesados. A textura é uma imagem CSS pequena e a assinatura é estática.
- **Service worker**: `service-worker.js`, `index.html` e o manifesto não mudaram. O CSS novo está dentro do `veconi-fluxo.css`, que já é pré-carregado.

## Limitações
- **Fixtures**: as capturas são de fixtures locais.
  - **Shell do app**: precisa carregar `permission-policy`, `installment-plan` e `installment-credit` pela auditoria, porque a fixture não os carrega.
  - **Financeiro**: usa a fixture própria, com o shell real injetado.
  - **Pagamento no celular**: a fixture mostra o aviso "Atualize o aplicativo para conferir os valores". É uma proteção de integridade do app, não da 1C.
- **Estados não capturados**: telas profundas, como perfil do cliente, histórico do produto, subpáginas do Financeiro e assistentes de pagamento, são cobertas pela ponte gerada mas não foram capturadas uma a uma. Vale a revisão humana.
- **Cartões de banco**: mantêm a cor da instituição e o selo branco "Fatura vencida" nos dois temas. A auditoria ignora as superfícies claras dentro de `.vac-card` de propósito.
- **Seletores frágeis**: a ponte depende das classes do CSS legado. Se uma tela for reescrita, é preciso rodar o gerador de novo.
- **Publicação**: avaliar a versão de cache do service worker.
