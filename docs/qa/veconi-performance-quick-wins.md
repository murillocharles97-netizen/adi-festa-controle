# VECONI V242.1 — Performance Fase 1

A candidata parte de `main` em `c643cc5`. A auditoria `b665580` fornece a [linha de base](veconi-performance-baseline-c643cc5.md). A branch local é `codex/veconi-performance-quick-wins`.

## Causas e correções

- `js/clientes-mobile.js` avaliava `scoped` fora do escopo ao montar o estado vazio. O reparo reutiliza a mensagem da montagem inicial, mantém a distinção de débito por espaço e exibe carregamento quando a consulta remota por texto é aplicável. A pesquisa e a limpeza reconstroem o marcador da paginação local quando há mais registros.
- A captura do evento de texto em `js/app.js` interceptava o listener que mostrava o botão **Limpar busca**. A atualização do botão agora acompanha o estado compartilhado da busca. O debounce consulta se o texto do campo ainda é o do disparo, evitando aplicar uma pesquisa antiga depois de limpar. A ordenação, o filtro e o mecanismo remoto continuam pelos caminhos existentes.
- `js/customer-metrics.js` e `js/crm-segment-engine-v2.js` criavam `Intl.DateTimeFormat` a cada conversão de dia. Cada módulo agora cria um formatador sob demanda e o reutiliza. As opções de cálculo são as mesmas, com `America/Sao_Paulo` e `formatToParts`. `en-CA` já era a localidade interna anterior e fornece partes numéricas do dia civil. A formatação visível em pt-BR permanece onde já era feita. Datas inválidas, ausência, timestamps e o fallback do CRM mantêm seus resultados.
- Os testes novos ficam em `tests/performance-quick-wins.test.cjs` e `scripts/audit-client-search-quick-wins.cjs`. O teste de datas conta instâncias, verifica limites de dia com e sem horário de verão histórico e testa o fallback. O teste de navegador usa a fixture da auditoria e pode servir os quatro módulos originais de `c643cc5`.

## Medições antes e depois

Cada célula mostra **mediana (mínimo–máximo, n)** e a variação da mediana em relação à base. Sinal negativo indica menor tempo ou contagem. Os tempos estão em ms. As três repetições por caso usaram o mesmo cenário, a mesma ordem de rotas e o mesmo perfil da auditoria. A primeira visita e o retorno são listados separadamente.

### Clientes e CRM até a pintura

| Perfil | Base | Rota | Visita | Antes | Depois | Variação |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop claro | pequena | Clientes | primeira | 110 (101–133, n=3) | 86 (86–97, n=3) | -22,0% |
| Desktop claro | pequena | Clientes | retorno | 85 (78–86, n=3) | 69 (61–70, n=3) | -19,0% |
| Desktop claro | pequena | CRM | primeira | 26 (22–65, n=3) | 24 (21–60, n=3) | -7,6% |
| Desktop claro | pequena | CRM | retorno | 15 (11–23, n=3) | 12 (12–16, n=3) | -17,0% |
| Desktop claro | grande | Clientes | primeira | 1.257 (1.250–1.271, n=3) | 528 (452–553, n=3) | -58,0% |
| Desktop claro | grande | Clientes | retorno | 275 (260–283, n=3) | 196 (193–214, n=3) | -28,7% |
| Desktop claro | grande | CRM | primeira | 26 (26–29, n=3) | 26 (26–27, n=3) | +0,8% |
| Desktop claro | grande | CRM | retorno | 26 (25–34, n=3) | 22 (21–25, n=3) | -14,9% |
| Mobile claro | pequena | Clientes | primeira | 564 (532–605, n=3) | 513 (512–534, n=3) | -9,0% |
| Mobile claro | pequena | Clientes | retorno | 281 (278–359, n=3) | 266 (260–267, n=3) | -5,4% |
| Mobile claro | pequena | CRM | primeira | 199 (181–206, n=3) | 110 (107–111, n=3) | -44,6% |
| Mobile claro | pequena | CRM | retorno | 130 (125–137, n=3) | 54 (52–56, n=3) | -58,2% |
| Mobile claro | grande | Clientes | primeira | 7.062 (6.571–7.256, n=3) | 2.351 (2.334–2.377, n=3) | -66,7% |
| Mobile claro | grande | Clientes | retorno | 564 (564–708, n=3) | 514 (488–518, n=3) | -8,9% |
| Mobile claro | grande | CRM | primeira | 6.704 (5.801–6.750, n=3) | 560 (560–596, n=3) | -91,6% |
| Mobile claro | grande | CRM | retorno | 6.764 (6.468–6.897, n=3) | 471 (462–472, n=3) | -93,0% |
| Mobile escuro | pequena | Clientes | primeira | 573 (543–575, n=3) | 512 (499–527, n=3) | -10,6% |
| Mobile escuro | pequena | Clientes | retorno | 294 (291–294, n=3) | 272 (260–318, n=3) | -7,6% |
| Mobile escuro | pequena | CRM | primeira | 194 (188–195, n=3) | 107 (106–120, n=3) | -44,5% |
| Mobile escuro | pequena | CRM | retorno | 125 (122–143, n=3) | 57 (48–58, n=3) | -54,6% |
| Mobile escuro | grande | Clientes | primeira | 6.503 (6.446–6.521, n=3) | 2.377 (2.334–2.488, n=3) | -63,4% |
| Mobile escuro | grande | Clientes | retorno | 543 (543–618, n=3) | 527 (513–566, n=3) | -3,0% |
| Mobile escuro | grande | CRM | primeira | 6.368 (6.156–6.771, n=3) | 554 (545–565, n=3) | -91,3% |
| Mobile escuro | grande | CRM | retorno | 6.226 (6.164–6.286, n=3) | 447 (441–468, n=3) | -92,8% |

### CPU, renderização e tarefas longas na primeira visita, base grande

| Perfil | Rota | Medição | Antes | Depois | Variação |
| --- | --- | --- | --- | --- | --- |
| Desktop claro | Clientes | Script CDP | 1.044 (1.043–1.168, n=3) | 443 (379–460, n=3) | -57,5% |
| Desktop claro | Clientes | Estilo e layout CDP | 62 (60–68, n=3) | 61 (52–71, n=3) | -1,2% |
| Desktop claro | Clientes | Tarefas de pelo menos 50 ms (contagem) | 1 (1–1, n=3) | 1 (1–1, n=3) | 0,0% |
| Desktop claro | Clientes | Tarefa mais longa (ms, 0 se ausente) | 1.071 (1.071–1.197, n=3) | 468 (404–491, n=3) | -56,3% |
| Desktop claro | CRM | Script CDP | 14 (14–15, n=3) | 14 (14–14, n=3) | -2,4% |
| Desktop claro | CRM | Estilo e layout CDP | 10 (10–12, n=3) | 10 (10–11, n=3) | -0,3% |
| Desktop claro | CRM | Tarefas de pelo menos 50 ms (contagem) | 0 (0–0, n=3) | 0 (0–0, n=3) | — |
| Desktop claro | CRM | Tarefa mais longa (ms, 0 se ausente) | 0 (0–0, n=3) | 0 (0–0, n=3) | — |
| Mobile claro | Clientes | Script CDP | 6.131 (5.740–6.477, n=3) | 2.090 (2.076–2.161, n=3) | -65,9% |
| Mobile claro | Clientes | Estilo e layout CDP | 467 (450–510, n=3) | 451 (435–479, n=3) | -3,4% |
| Mobile claro | Clientes | Tarefas de pelo menos 50 ms (contagem) | 2 (2–2, n=3) | 2 (2–2, n=3) | 0,0% |
| Mobile claro | Clientes | Tarefa mais longa (ms, 0 se ausente) | 6.224 (5.800–6.302, n=3) | 2.148 (1.985–2.173, n=3) | -65,5% |
| Mobile claro | CRM | Script CDP | 6.066 (5.708–6.198, n=3) | 481 (477–508, n=3) | -92,1% |
| Mobile claro | CRM | Estilo e layout CDP | 69 (65–70, n=3) | 64 (62–69, n=3) | -7,5% |
| Mobile claro | CRM | Tarefas de pelo menos 50 ms (contagem) | 2 (2–2, n=3) | 2 (2–2, n=3) | 0,0% |
| Mobile claro | CRM | Tarefa mais longa (ms, 0 se ausente) | 6.065 (5.707–6.198, n=3) | 480 (477–507, n=3) | -92,1% |
| Mobile escuro | Clientes | Script CDP | 5.672 (5.603–5.794, n=3) | 2.149 (2.112–2.178, n=3) | -62,1% |
| Mobile escuro | Clientes | Estilo e layout CDP | 458 (414–473, n=3) | 453 (428–501, n=3) | -1,1% |
| Mobile escuro | Clientes | Tarefas de pelo menos 50 ms (contagem) | 2 (2–2, n=3) | 2 (2–2, n=3) | 0,0% |
| Mobile escuro | Clientes | Tarefa mais longa (ms, 0 se ausente) | 5.668 (5.625–5.762, n=3) | 2.180 (1.979–2.271, n=3) | -61,5% |
| Mobile escuro | CRM | Script CDP | 5.877 (5.690–6.030, n=3) | 477 (467–478, n=3) | -91,9% |
| Mobile escuro | CRM | Estilo e layout CDP | 65 (61–68, n=3) | 63 (62–65, n=3) | -2,0% |
| Mobile escuro | CRM | Tarefas de pelo menos 50 ms (contagem) | 2 (2–2, n=3) | 2 (2–2, n=3) | 0,0% |
| Mobile escuro | CRM | Tarefa mais longa (ms, 0 se ausente) | 5.877 (5.690–6.030, n=3) | 476 (466–478, n=3) | -91,9% |

O perfil de CPU da primeira visita mobile clara, uma captura por versão, reduziu o tempo próprio de brazilDayNumber de 3.957 para 125 ms e o de dayNumber do CRM de 5.620 para 167 ms. O teste de construção mostra um formatador por módulo. Na matriz, o ganho principal aparece no tempo de script e na duração da tarefa mais longa. A mediana de contagem de tarefas longas permaneceu em duas nas duas rotas mobile claras grandes.

### Busca mobile até exibir o estado esperado

O ensaio espera o ID de cliente ou o estado vazio real e duas oportunidades de pintura. O debounce de 300 ms permanece. O estado vazio da base ultrapassou 2.200 ms e não tem percentual válido. A limpeza é medida logo depois da busca vazia, cujo estado visual era diferente na base com erro. A diferença da limpeza descreve o roteiro completo.

| Tema | Base | Ação | Antes | Depois | Variação |
| --- | --- | --- | --- | --- | --- |
| Claro | pequena | Com resultado | 359 (358–366, n=3) | 359 (358–369, n=3) | +0,2% |
| Claro | pequena | Sem resultado | Sem conclusão | 350 (350–356, n=3) | — |
| Claro | pequena | Limpar pelo teclado | 529 (474–543, n=3) | 552 (517–566, n=3) | +4,5% |
| Claro | grande | Com resultado | 427 (424–434, n=3) | 397 (396–399, n=3) | -7,0% |
| Claro | grande | Sem resultado | Sem conclusão | 384 (378–386, n=3) | — |
| Claro | grande | Limpar pelo teclado | 547 (515–562, n=3) | 572 (567–580, n=3) | +4,6% |
| Escuro | pequena | Com resultado | 358 (354–369, n=3) | 358 (357–364, n=3) | -0,1% |
| Escuro | pequena | Sem resultado | Sem conclusão | 350 (344–351, n=3) | — |
| Escuro | pequena | Limpar pelo teclado | 516 (506–547, n=3) | 552 (510–553, n=3) | +7,0% |
| Escuro | grande | Com resultado | 414 (414–418, n=3) | 403 (393–405, n=3) | -2,7% |
| Escuro | grande | Sem resultado | Sem conclusão | 386 (385–391, n=3) | — |
| Escuro | grande | Limpar pelo teclado | 539 (520–586, n=3) | 600 (517–615, n=3) | +11,3% |

### Abertura como controle

| Perfil | Marco | Antes | Depois | Variação |
| --- | --- | --- | --- | --- |
| Desktop claro | Abertura fria até login | 286 (271–407, n=5) | 286 (274–415, n=5) | 0,0% |
| Desktop claro | Envio até painel | 262 (232–635, n=5) | 247 (192–750, n=5) | -5,6% |
| Desktop claro | Reabertura online | 697 (645–788, n=5) | 703 (660–742, n=5) | +0,9% |
| Mobile claro | Abertura fria até login | 9.540 (9.488–9.608, n=3) | 9.468 (9.454–9.554, n=3) | -0,8% |
| Mobile claro | Envio até painel | 1.963 (1.934–2.480, n=3) | 1.874 (1.801–2.124, n=3) | -4,5% |
| Mobile claro | Reabertura online | 2.957 (2.934–3.285, n=3) | 2.913 (2.873–3.103, n=3) | -1,5% |
| Mobile escuro | Abertura fria até login | 9.519 (9.509–9.524, n=3) | 9.493 (9.487–9.501, n=3) | -0,3% |
| Mobile escuro | Envio até painel | 1.965 (1.905–2.426, n=3) | 1.853 (1.852–2.014, n=3) | -5,7% |
| Mobile escuro | Reabertura online | 3.085 (3.071–3.730, n=3) | 2.902 (2.892–2.947, n=3) | -5,9% |
| Mobile claro, 1.200 produtos | Abertura fria até login | 9.522 (9.465–9.524, n=3) | 9.471 (9.452–9.575, n=3) | -0,5% |
| Mobile claro, 1.200 produtos | Envio até painel | 1.952 (1.929–2.439, n=3) | 1.850 (1.846–2.419, n=3) | -5,2% |
| Mobile claro, 1.200 produtos | Reabertura online | 3.671 (3.666–3.698, n=3) | 3.476 (3.469–3.511, n=3) | -5,3% |

A abertura fria continuou com 238 recursos em todos os perfis. A variação no login não demonstra um ganho do ajuste de datas. O desktop foi repetido com o mesmo ensaio de fechamento e reabertura de aba antes e depois. Medir os recursos removidos e a trajetória de autenticação é trabalho separado no carregamento progressivo.

## Testes e decisão

- **Navegador.** Passaram 16 sessões e 48 verificações de estado. A matriz original de navegação também completou 648 montagens sem erro ou falha de montagem. Foram 12 sessões de busca mobile, com três repetições por volume e tema, e quatro sessões desktop, uma por volume e tema. No mobile grande, confirmei a limpeza no intervalo do debounce, a sequência de entradas rápidas, o carregamento de mais cartões sem IDs duplicados, o resultado remoto vazio e respostas remotas fora de ordem. O caso de débito por espaço mostrou a mensagem local adequada. Na base, os 12 ensaios mobile de busca vazia reproduziram `scoped is not defined`.
- **Node.** A base teve 52/55 aprovações e a candidata 54/57, com os mesmos três casos falhando. As duas falhas de foco são `scoped list of 100 clients opens without Fiado proof fan-out` e `scoped list of 1000 clients opens without Fiado proof fan-out`. A terceira é `cache PWA publica a revisão da busca e das ações`, que procura um nome de cache anterior ao da V242.1. Converter datas passou nos dois novos testes. A suíte de serviço passou 29/29 e a de persistência PWA 1/1.
- **Escopo verificado por diff.** O frontend tocado se limita a `js/app.js`, `js/clientes-mobile.js`, `js/customer-metrics.js` e `js/crm-segment-engine-v2.js`. Checkout, código e contratos de sincronização, Functions, Rules, CSS, HTML de entrada e Service Worker seguem idênticos a `c643cc5`. Foram usadas origens de loopback, perfis Chrome isolados e registros sintéticos.
- **Commits.** `cd4f10a` corrige a busca e inclui o ensaio de navegador. `1add5a7` reutiliza formatadores e testa equivalência de datas. `9d14bee` reaplica exclusivamente o material de laboratório de `b665580` sobre a base verificada.
- **GO técnico para publicação do frontend pelo fluxo de release.** O carimbo da versão e da identidade do cache, seguido do smoke de atualização com uma instalação V242.1 sintética, faz parte da preparação da publicação. A fase de otimização não altera essa configuração. A decisão usa Chrome simulado e emuladores locais. Nenhuma publicação, merge ou modificação em armazenamento de usuário foi feita.

## Próxima fase A — Carregamento progressivo

**Antes da autenticação.** Manter o estilo, a marca e os controles de entrada necessários, o SDK Auth e o tratamento de callback, recuperação, convite e estados de erro. Vincular a dependência do Firestore e a associação ao ramo que já tem uma identidade resolvida. Hoje `js/firebase/auth.js` importa `sync.js`, e `firebase-config.js` carrega Auth, Firestore e Functions juntos. Primeiro traçar os imports transitivos e os efeitos executados ao carregar o módulo. No SDK local, o módulo completo de Firestore tem 113 kB gzip e Firestore Lite tem 31 kB gzip. Esses tamanhos indicam o que vale medir no grafo, sem somá-los automaticamente ao ganho. A separação de Auth e Firestore é uma segunda intervenção, com testes de sessão persistida, troca de conta, sinais de revogação, associação e geração. Manter essas verificações no caminho anterior à montagem autorizada.

**Recortes iniciais.** Validar pelo grafo de chamadas pequenos candidatos em `index.html`, como `csvImport.js` (4,2 kB brutos, acionado ao importar), `consignment-pdf.js` (8,9 kB, geração de recibo) e a camada de scanner de `barcode.js` (44,9 kB), separando seus ganchos de navegação se houver uso imediato. `zxing-browser.min.js` (441 kB) e XLSX (952 kB) já carregam sob demanda durante o uso, mas entram no precache do PWA. Juntos, ZXing e XLSX somam cerca de 447 kB gzip no laboratório. Medir esse custo na instalação separadamente do login. Planejar código dividido por tarefa com orçamento por recurso, sem estimar esses bytes como ganho automático.

**Após autenticar.** Carregar primeiro o shell da rota inicial, incluindo acesso ao IndexedDB e a proteção do escopo. Montar campanhas, importação e áreas administrativas sob demanda, após mapear chamadas compartilhadas. Usar o carregador do Financeiro em `js/app.js` como referência para registro sob demanda e adicionar cache de promessa e retentativa com a rota ainda ativa. Dar tratamento próprio a links diretos e a recursos compartilhados pelo Início, Clientes, checkout e exportação.

**PWA e aceitação.** Definir um manifesto de shell indispensável e pacotes por rota liberados pela mesma versão. Preservar a disponibilidade offline das rotas já instaladas, com estado claro se um pacote ainda não foi preparado. Comparar instalação nova, atualização de V242.1, reabertura, login por e-mail e Google, links diretos e rede interrompida durante o carregamento. Preservar IndexedDB, filas e escolha de tema. Medir bytes e requisições até o formulário, disponibilidade do painel e piores casos por rota. Fazer o primeiro piloto com os recortes de menor risco, separado da mudança de autenticação.

## Próxima fase B — Renderização do PDV

**Ponto inicial.** `js/desktop-sales.js:149` produz todos os cartões e `js/checkout.js:124` prepara a grade mobile. Busca e ordenação atuam sobre cartões já montados, e `js/checkout-mobile.js:39` os percorre para o filtro de recentes. Uma primeira intervenção deve filtrar e ordenar a lista completa no modelo do espaço, usando as mesmas regras de disponibilidade, busca, variantes, posição e estoque, e montar uma página de tamanho limitado, por exemplo 30–60 cartões. Um lote de 40 reduziria em cerca de 98% a quantidade de cartões montados na primeira pintura, como hipótese estrutural. O ganho em tempo precisa ser medido. Medir primeiro paginação com **Carregar mais** ou com sentinela. Essa opção reduz a necessidade de alterar posições durante foco ou rolagem.

**Quando virtualizar.** Se listas longas continuarem lentas ao rolar, limitar a janela de cartões com chaves por produto e variante e margem para itens vizinhos. Manter foco, navegação por teclado, anúncios de contagem, posição e ações de toque. Evitar selecionar pelo índice visual. Favoritos, recentes, leitura de código, troca de espaço, variações e execução de serviço precisam resolver o item pelo ID mesmo fora do DOM. O carrinho e os totais continuam trabalhando com o mesmo modelo operacional.

**PWA e aceitação.** Usar o catálogo local quando offline, com o mesmo escopo e os mesmos filtros. Revalidar resultados e posições em 2.006 produtos, temas e larguras, e verificar uma venda fictícia normal, serviço, Fiado, retry e rascunho após voltar à rota. As metas iniciais são medir a queda de nós, tarefas longas e renderização na primeira visita, no retorno e no toque no carrinho. Persistência, integração financeira, protocolo e permissão ficam fora desta intervenção. Medir a renderização do PDV separadamente do carregamento progressivo.

## Reprodução

Os benchmarks usam Chrome headless no Windows e as fixtures da auditoria, com 26 ou 2.001 clientes. O catálogo tem 31 ou 2.006 produtos, com até 5.001 vendas e 1.601 pagamentos. O perfil mobile é o mesmo de 390 × 844, CPU 4×, 80 ms de latência e 200 kB/s de download. Para o controle de abertura use Firebase Auth e Firestore Emulator no projeto `demo-veconi-perf` e o SDK 10.13.2 local.

```powershell
$env:PERF_ROUNDS = '3'
node scripts/audit-performance-runtime-c643cc5.cjs
node scripts/audit-client-search-quick-wins.cjs --baseline
node scripts/audit-client-search-quick-wins.cjs
firebase emulators:exec --config firebase.performance-qa.json --only firestore,auth --project demo-veconi-perf "node scripts/audit-performance-startup-c643cc5.cjs"
node --test tests/performance-quick-wins.test.cjs tests/customer-metrics.test.js tests/crm-segment-engine-v2.test.js
```

Para refazer a navegação e a abertura na base, use o worktree da auditoria `b665580`. Use o mesmo ambiente e execute uma matriz por vez. Resultados brutos ficam em `qa-artifacts/performance/`.
