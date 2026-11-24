# Clientes: fluidez, velocidade e recebimento simplificado (referência V242.7)

- **Branch:** `claude/clientes-fluidez`, a partir de `origin/main` `326cd18`.
- **Escopo:** tela de Clientes (celular e desktop) e formulário de recebimento.
- **Sem alteração:** Functions, Rules, dados reais, versão do app, `CACHE` do service worker, `?v=` do `index.html`, módulos de mensagens e cobrança (`js/mensagens*.js`, `js/message-sequence*.js`, `js/campanhas-ui.js`, `js/fiado-conditions.js`, `js/receipt-messages.js`).
- **Dados:** todos fictícios (laboratório de desempenho com 2.001 clientes, 5.000 vendas, 1.600 pagamentos e 667 contas de Fiado parceladas geradas no próprio teste).

## 1. Causas confirmadas das piscadas

Reproduzidas no Chrome com Android emulado (390 px, CPU 4× mais lenta) antes de qualquer alteração (`scripts/audit-clientes-fluidez.cjs`, rótulos `antes*`).

1. **A tela inteira era recriada a cada atualização automática.** `ClientesMobile.refresh()` e `ClientesPage.refresh()` faziam `#app.innerHTML = render()`. Cada evento de dados recriava a página, o campo de busca e todos os cartões (até 131 cartões removidos e recriados por evento).
2. **A animação de entrada voltava a cada recriação.** `.mobile-swipe-shell` tem `animation: mobileCardIn .42s both` com atraso escalonado de até 336 ms. Com `both`, todo cartão recriado começa transparente: até 112 animações e 51 quadros com cartões transparentes por evento.
3. **Várias fontes disparavam recriações sobre o mesmo evento.** Um `financial-state-updated` gerava até duas recriações da página (paginação da nuvem e condições de Fiado) e uma recriação da lista:
   - `ClientCloudPagination.dataChanged` chamava `ClientesPage.refresh()`;
   - `FiadoConditions` invalidava, consultava o servidor e emitia `fiado-conditions-updated`, que chamava `ClientesMobile.refresh()`;
   - a página nova era detectada pelo `MutationObserver` da paginação, que renderizava a lista de novo com `list.innerHTML` (cache de 30 s ou nova leitura da nuvem). Assim a lista trocava de local para nuvem e os cartões animavam outra vez;
   - `message-history-updated` e `firebase-sync-status` também recriavam a página ou a lista.
4. **Foco, teclado e cursor se perdiam.** O campo de busca era substituído, então o teclado do celular fechava em 5 de 6 eventos automáticos. No desktop, a própria busca (debounce de 150 ms) reconstruía a página e tirava o foco do campo enquanto se digitava; um evento no meio do debounce descartava o que tinha sido digitado.
5. **Cartões editados em lote custavam segundos.** Em `financial-state-updated`, `InstallmentCredit.recheck()` repintava cada cartão visível, e cada repintura invalidava (`prepareList`) e recalculava o saldo local da lista inteira (`listBalances`, com `assertSale` de todas as vendas parceladas): de 7,4 a 8,2 s de CPU no celular emulado.
6. **`lucide.createIcons()` recria todos os ícones da página** a cada chamada (lucide 0.468), inclusive os já desenhados.

Causa de lentidão fora da piscada, também confirmada por perfil de CPU:

- `client-smart-mode.js` calculava o painel inteiro de CRM (`CRMDashboard.snapshot()`) a cada `bind` da tela. O painel tem cache por assinatura dos dados, então o custo de cerca de 1,9 s no celular emulado com a base grande volta na primeira montagem e depois de cada mudança de dados. Isso acontecia mesmo com Fiado ativo, quando o resultado não é usado.

## 2. Melhorias implementadas

### Lista estável (`js/clientes-mobile.js`, `css/clientes-mobile.css`)
- Atualizações automáticas, filtros, ordenação e a folha de filtros **corrigem a página montada** em vez de recriá-la:
  - o campo de busca nunca é trocado, então foco, cursor e teclado permanecem;
  - os cartões têm chave pelo id do cliente e são comparados com a marcação que os gerou; só o cartão cujos dados mudaram é substituído;
  - os demais blocos (indicadores, filtros, avisos) só são trocados se mudaram;
  - a folha de filtros mantém o nó e apenas alterna a classe `open`, com a transição do CSS.
- Um `MutationObserver` marca para nova renderização o cartão que outro módulo editou no próprio lugar (consulta de saldo, prova de Fiado).
- A **animação de entrada roda uma vez por montagem da tela**:
  - o atraso vem da posição no CSS (`nth-child`), e não mais da marcação;
  - depois da entrada, `data-cards-settled` desliga a animação;
  - busca, atualização e "carregar mais" não fazem cartões sumirem e reaparecerem.
- Controles da página por **delegação de eventos**: blocos substituídos continuam funcionando e um segundo `bind` não duplica ações.
- Ícones novos são desenhados só nos nós novos, sem recriar os ícones da página.

### Paginação da nuvem (`js/client-cloud-pagination.js`)
- No celular, o resultado da nuvem passa pela **mesma atualização por chave**. Cartões iguais permanecem e não há troca local → nuvem.
- `ClientCloudPagination.items()` expõe os cartões da nuvem já exibidos. Uma atualização local da página os mantém, em vez de voltar para a lista local.
- Uma mudança financeira no celular atualiza a página no lugar e então relê a nuvem, como antes: a mesma leitura, agora sem piscar.

### Desktop (`js/clientes-page.js`)
- `refresh()` no celular delega para a atualização no lugar.
- No desktop, a reconstrução preserva:
  - o campo focado, o cursor e a rolagem;
  - o texto digitado durante o debounce da busca.

### Velocidade
- `js/installment-credit.js`:
  - repinturas em lote preparam o saldo local da lista **uma vez por lote**, e não uma vez por cartão;
  - as funções afetadas são `recheck`, `expireDisplayedProofs` e `hydrateVisible`;
  - a regra de cada cartão não mudou.
- `js/client-smart-mode.js`:
  - o painel de CRM só é calculado quando é usado (modo sem Fiado ou selos de recompensa);
  - os ouvintes do cartão não se duplicam;
  - no celular não há segundo ouvinte de clique, porque a lista já abre o perfil;
  - cartões novos recebem a mesma adaptação por `afterPatch`.

### Recebimento (`js/fiados.js`, `css/clientes-page.css`)
- Removidos os seletores visuais "Pagamento total" e "Parcial".
- **Função do seletor, conferida antes da remoção:**
  - o rádio `kind` **não era lido no envio**;
  - o `paymentMode` já era calculado comparando o valor digitado com o devido: `total` se for igual, senão `partial`; e sempre `partial` para conta parcelada ou venda;
  - o rádio só fazia duas coisas na interface:
    1. "Pagamento total" repunha o valor máximo;
    2. com "total" marcado, ao ativar a antecipação, o valor acompanhava o novo máximo.
  - O item 2 foi preservado: o valor acompanha o novo máximo enquanto for igual ao máximo anterior.
- **Novo comportamento:**
  - "Valor recebido" abre com o valor devido permitido;
  - o texto "Recebeu só uma parte? Altere o valor." orienta quem recebe parte;
  - um quadro (`role=status`) identifica o tipo pelo valor digitado: "Pagamento total", "Pagamento parcial", "Quitar valor exigível", "Quitar dívida total" ou valor inválido;
  - o quadro mostra quanto fica em aberto: com parcelas, mostra exigível, futuras e o novo **total em aberto após receber**.
- **Sem alteração:**
  - contrato de `receiptAttempt`/`createPayment`, `paymentMode`, `allowAdvance`, limites (`max`), permissões, identidade da operação (`operationId`), rota canônica (`fiado_receipt_route`), conferência do recibo do servidor e prevenção de duplicidade;
  - o sucesso continua aparecendo só com o recibo do servidor.

## 3. Medições antes/depois

Duas amostras independentes de cada lado, com o mesmo script e a mesma fixture: `antes-2`/`antes-3` em `326cd18` e `depois-2`/`depois-3` nesta branch. Os relatórios JSON ficam em `qa-artifacts/clientes-fluidez/`, pasta ignorada pelo Git.

- **Servidor e nuvem simulados:** 350 ms por chamada. A "espera do servidor" medida inclui o tempo em que a resposta ficou na fila da thread principal ocupada. Por isso ela cai quando o trabalho local diminui.
- **Rotas de rede:** as consultas `getOperationalSyncReceipt` e `queryClientsPage` são as mesmas antes e depois.
- **Confirmações financeiras:** continuam todas. A releitura da rota antes de gravar, o recibo do servidor e a tela "Aguardando confirmação" permanecem.

### Android emulado 390 px (CPU 4×, rede 80 ms) — tempos em ms (média das amostras; valores individuais entre parênteses)

| Etapa | Medida | Antes | Depois |
|---|---|---:|---:|
| Abrir Clientes | até o 1º cartão | 3784 (3878/3691) | 1100 (1049/1152) |
| Abrir Clientes | até pintar | 4608 (4711/4506) | 1856 (1600/2113) |
| Abrir Clientes | cartões criados | 60 (60/60) | 20 (20/20) |
| Abrir Clientes | quadros com cartão transparente | 55 (59/51) | 2 (2/2) |
| Pesquisar (debounce de 300 ms incluso) | até o resultado | 631 (626/636) | 609 (603/615) |
| Abrir cadastro | até pintar | 255 (281/230) | 210 (245/176) |
| Consultar saldo (perfil) | processamento local | 1920 (2016/1823) | 1814 (1782/1845) |
| Consultar saldo (perfil) | espera do servidor simulado | 361 (361/360) | 359 (355/363) |
| Consultar saldo (perfil) | total | 2799 (2919/2679) | 2658 (2621/2694) |
| Abrir recebimento | espera do servidor simulado | 699 (666/732) | 359 (360/357) |
| Abrir recebimento | processamento e renderização locais | 390 (374/405) | 196 (208/184) |
| Abrir recebimento | total | 1091 (1044/1139) | 558 (571/544) |
| Confirmar pagamento | processamento local síncrono | 177 (137/218) | 110 (105/115) |
| Confirmar pagamento | até "Aguardando confirmação" | 3766 (2881/4651) | 2813 (2445/3181) |
| Confirmar pagamento | espera do servidor simulado | 3095 (3367/2822) | 714 (718/710) |
| Confirmar pagamento | até o recibo do servidor | 5422 (5713/5132) | 3251 (2895/3608) |

**Estabilidade por evento automático** (android-390): soma de todas as amostras por evento — cartões recriados / animações / quadros transparentes / foco mantido

| Evento | Antes | Depois |
|---|---|---|
| busca+financial-state-updated | 242 / 220 / 8 · foco perdido | 0 / 0 / 0 · foco mantido |
| busca+cloud-clients-updated | 151 / 5 / 20 · foco perdido | 0 / 0 / 0 · foco mantido |
| busca+cloud-payments-updated | 262 / 6 / 32 · foco perdido | 0 / 0 / 0 · foco mantido |
| busca+fiado-conditions-updated | 80 / 10 / 29 · foco perdido | 0 / 0 / 0 · foco mantido |
| busca+message-history-updated | 262 / 119 / 59 · foco perdido | 0 / 0 / 0 · foco mantido |
| busca+firebase-sync-status | 222 / 122 / 65 · foco mantido | 0 / 0 / 0 · foco mantido |
| rolagem+saldo-atualizado | 80 / 0 / 6 · rolagem Δ0/0 | 0 / 0 / 0 · rolagem Δ0/0 |
| rolagem+cloud-clients | 80 / 5 / 40 · rolagem Δ0/0 | 0 / 0 / 0 · rolagem Δ0/0 |
| modal+atualizacoes | 524 / 0 / 6 · modal aberto e preenchido | 0 / 0 / 0 · modal aberto e preenchido |
| apos-recibo | 0 / 0 / 0 | 1 / 0 / 0 |
| mudanca-de-espaco | 222 / 0 / 0 | 248 / 0 / 2 |
| filtro+financial | 42 / 0 / 7 | 0 / 0 / 0 |

### Desktop 1366 px — tempos em ms (média das amostras; valores individuais entre parênteses)

| Etapa | Medida | Antes | Depois |
|---|---|---:|---:|
| Abrir Clientes | até o 1º cartão | 561 (592/531) | 273 (352/194) |
| Abrir Clientes | até pintar | 725 (741/709) | 291 (374/208) |
| Abrir Clientes | cartões criados | 60 (60/60) | 60 (60/60) |
| Abrir Clientes | quadros com cartão transparente | 0 (0/0) | 0 (0/0) |
| Pesquisar (debounce de 300 ms incluso) | até o resultado | 413 (406/420) | 391 (401/382) |
| Abrir cadastro | até pintar | 35 (36/34) | 29 (27/32) |
| Consultar saldo (perfil) | processamento local | 329 (330/329) | 290 (289/291) |
| Consultar saldo (perfil) | espera do servidor simulado | 355 (355/354) | 353 (351/355) |
| Consultar saldo (perfil) | total | 832 (830/833) | 803 (795/811) |
| Abrir recebimento | espera do servidor simulado | 352 (351/352) | 354 (352/355) |
| Abrir recebimento | processamento e renderização locais | 38 (39/36) | 35 (36/33) |
| Abrir recebimento | total | 390 (391/389) | 389 (389/389) |
| Confirmar pagamento | processamento local síncrono | 11 (13/10) | 8 (10/7) |
| Confirmar pagamento | até "Aguardando confirmação" | 742 (761/724) | 762 (767/757) |
| Confirmar pagamento | espera do servidor simulado | 707 (707/707) | 706 (706/706) |
| Confirmar pagamento | até o recibo do servidor | 1126 (1155/1097) | 1131 (1136/1126) |

**Estabilidade por evento automático** (desktop-1366): soma de todas as amostras por evento — cartões recriados / animações / quadros transparentes / foco mantido

| Evento | Antes | Depois |
|---|---|---|
| busca+financial-state-updated | 302 / 0 / 0 · foco perdido | 302 / 0 / 0 · foco mantido |
| busca+cloud-clients-updated | 302 / 0 / 0 · foco perdido | 302 / 0 / 0 · foco mantido |
| busca+cloud-payments-updated | 302 / 0 / 0 · foco perdido | 302 / 0 / 0 · foco mantido |
| busca+fiado-conditions-updated | 222 / 0 / 0 · foco perdido | 222 / 0 / 0 · foco mantido |
| busca+message-history-updated | 0 / 0 / 0 · foco mantido | 0 / 0 / 0 · foco mantido |
| busca+firebase-sync-status | 0 / 0 / 0 · foco mantido | 0 / 0 / 0 · foco mantido |
| rolagem+saldo-atualizado | 120 / 0 / 0 · rolagem Δ0/0 | 120 / 0 / 0 · rolagem Δ0/0 |
| rolagem+cloud-clients | 120 / 0 / 0 · rolagem Δ0/0 | 120 / 0 / 0 · rolagem Δ0/0 |
| modal+atualizacoes | 444 / 0 / 0 · modal aberto e preenchido | 444 / 0 / 0 · modal aberto e preenchido |
| apos-recibo | 0 / 0 / 0 | 0 / 0 / 0 |
| mudanca-de-espaco | 302 / 0 / 0 | 302 / 0 / 0 |
| filtro+financial | 78 / 0 / 0 | 78 / 0 / 0 |

### Leitura
- **Piscadas, Android:**
  - eventos automáticos: de 80 a 524 cartões recriados (soma das amostras), até 122 animações e 65 quadros transparentes, contra 0, 0 e 0 em todos os eventos medidos;
  - foco da busca: perdido em 5 de 6 eventos, agora mantido em todos;
  - rolagem e modal preenchido: preservados nas duas versões.
- **Piscadas, desktop:** o desktop não tem animação de entrada e continua reconstruindo a página, que é o mesmo número de nós na tabela. O foco, o cursor e o texto da busca passaram a ser preservados.
- **Velocidade, Android:**
  - abrir Clientes: de 3,8 s para 1,1 s até o primeiro cartão;
  - abrir o recebimento: de 1,09 s para 0,56 s;
  - até o recibo do servidor: de 5,4 s para 3,3 s.
- **Velocidade, desktop:** abrir Clientes foi de 0,73 s para 0,29 s; o resto ficou estável.
- **De onde vem o ganho:**
  - fim das recriações duplicadas;
  - repintura de Fiado em lote: num `financial-state-updated` com 2.001 clientes, a CPU gasta no cálculo de saldos da lista (`listStatus` → `listBalances`) caiu de 9,4 s para 1,7 s no celular emulado (perfil de CPU, mesma fixture). A janela medida caiu de 11,6 s para 3,0 s, dos quais 2,5 s são espera fixa do teste;
  - painel de CRM fora do caminho da tela com Fiado.
- **Sem ganho relevante:**
  - pesquisar: o custo é o debounce de 300 ms mais a filtragem;
  - abrir o cadastro.
- **Consultar saldo pelo perfil** continua em cerca de 1,8 s de processamento local no celular emulado. O custo está em `CRMCliente.build` → `CustomerMetricsService.build`, que calcula as métricas de toda a base para exibir um cliente. É outro módulo (CRM) e não foi alterado. Fica como sugestão de continuação.
- **Mudança de espaço:** continua sendo uma remontagem completa, o comportamento esperado. A diferença entre as versões é ruído da fixture: a nuvem simulada devolve outra seleção que a local.

## 4. Capturas e testes desktop/mobile

### Ferramentas
- `scripts/audit-clientes-fluidez.cjs` — auditoria em Chrome headless sobre o laboratório de desempenho (app real e dados fictícios gerados no teste). Simula servidor e nuvem com latência fixa de 350 ms por chamada, sem acesso externo.
  - Mede tempos por fase e conta cartões recriados, animações de entrada iniciadas e quadros com cartão visível transparente.
  - Confere a preservação de foco, cursor, rolagem, modal e filtro.
  - Uso: `node scripts/audit-clientes-fluidez.cjs [--root <worktree>] [--label nome] [--screenshots]`. Para a base, o mesmo script foi copiado para uma worktree de `326cd18`.
- `scripts/capture-clientes-fluidez.cjs` — capturas em 360, 390, 412, 768 e 1366 px, temas claro e escuro.

### Cenários cobertos (Android emulado 390 px com CPU 4× e desktop 1366 px)
- **Busca com muitos clientes:** 2.001 clientes, busca com 111 resultados.
- **Atualização de saldo com a lista aberta:** lista rolada a 1.500 px, saldo alterado e `financial-state-updated`.
- **Eventos automáticos com a busca digitada e o teclado aberto:** `financial-state-updated`, `cloud-data-updated` (clientes e pagamentos), `fiado-conditions-updated`, `message-history-updated` e `firebase-sync-status`.
- **Modal aberto durante atualizações:** valor digitado preservado.
- **Recebimento:**
  - integral: o valor abre cheio e é identificado como "Pagamento total";
  - parcial: confirmado até o recibo do servidor; o saldo restante (R$ 12,16) aparece no recibo;
  - parcelas futuras com antecipação;
  - falha de conexão no envio: o formulário continua aberto, com erro visível e sem sucesso falso;
  - resposta pendente: aparece "Aguardando confirmação" e nenhum sucesso antes do recibo.
- **Mudança de espaço:** uma remontagem.
- **Filtro "Devendo":** preservado após atualização financeira.

### Capturas (dados fictícios) em `docs/screenshots/clientes-fluidez-v2427/`
- **Lista e recebimento:** `clientes-*`, `recebimento-integral-*`, `recebimento-parcial-*` e `recebimento-parcelas-futuras-*`, nas larguras 360, 390, 412, 768 e 1366, temas `light` e `dark`.
- **Antes e depois:**
  - `antes-piscada-durante-atualizacao-390.png`: cartões ainda transparentes no meio de uma atualização;
  - `antes-recebimento-390.png`: seletores "Pagamento total" e "Parcial";
  - `depois-recebimento-390.png`.
- As capturas escondem a área de avisos (`#toasts`). A fixture não tem servidor de pagamentos por maquininha, e o aviso de conexão desse módulo, que não tem relação com esta tarefa, cobriria a tela.

### Testes automatizados novos
- `tests/clientes-stable-refresh-v2427.test.cjs` (jsdom, 4 testes):
  - uma atualização mantém o mesmo campo de busca, com foco e cursor, e os mesmos nós dos cartões inalterados; só o cartão alterado é trocado e a animação não volta;
  - ordenação e filtro reordenam sem recriar; a folha de filtros mantém o nó;
  - um cartão editado por outro módulo é renderizado de novo;
  - no desktop, o texto digitado no debounce, o foco e o cursor sobrevivem à reconstrução.
- `tests/receive-form-v2427.test.cjs` (4 testes):
  - o valor abre cheio e não há seletor;
  - o valor parcial é identificado e o que fica em aberto aparece; valores inválidos são sinalizados;
  - `paymentMode` continua `total`/`partial` conforme o valor;
  - com parcelas futuras, o exigível, as futuras e o total em aberto aparecem, e a antecipação acompanha o valor cheio.
- Na base `326cd18`, 6 dos 8 falham, o que confirma que detectam o problema. Os 2 que passam nas duas versões provam o que não podia mudar: o contrato de `paymentMode` e a nova renderização de um cartão editado.

### Não verificado
- Aparelho físico.
- Firebase real: servidor e nuvem foram simulados com latência fixa.
- O caminho com vários espaços em `scopesCustomers` não passou pela auditoria de navegador; está coberto pelos testes jsdom existentes de `clientes-performance-v2291`, que agora passam.
- Leitores de tela.

## 5. Arquivos e commits

### Commits (só locais; sem push, merge ou deploy)
- `d611228` fix(clientes): update the mounted client list in place instead of rebuilding it.
- `580de3f` perf(clientes): batch Fiado card repaints and compute the CRM snapshot only when used.
- `6db3b45` feat(recebimento): remove the total/partial selector and show what stays open.
- Um último commit traz este relatório, os scripts de auditoria e captura e as capturas.

### Arquivos do app
- `js/clientes-mobile.js`, `css/clientes-mobile.css`
- `js/clientes-page.js`
- `js/client-cloud-pagination.js`
- `js/installment-credit.js`
- `js/client-smart-mode.js`
- `js/fiados.js`, `css/clientes-page.css`

### Testes, scripts e documentação
- **Testes:**
  - novos: `tests/clientes-stable-refresh-v2427.test.cjs` e `tests/receive-form-v2427.test.cjs`;
  - ajustado: `tests/owner-receipt-v219.dom.test.cjs`.
- **Scripts:**
  - novos: `scripts/audit-clientes-fluidez.cjs` e `scripts/capture-clientes-fluidez.cjs`;
  - ajustado: `scripts/audit-owner-receipt-v219.cjs`.
- **Documentação:** `docs/qa/clientes-fluidez-v2427.md` e `docs/screenshots/clientes-fluidez-v2427/`.

### Para quem preparar a release
- **`?v=` no `index.html`:** precisa ser atualizado para os arquivos alterados. Hoje estão em:
  - `clientes-mobile.js?v=2422`;
  - `clientes-page.js?v=space-regularization-1` e `css/clientes-page.css?v=space-regularization-1`;
  - `client-cloud-pagination.js?v=2291-client-nav-1`;
  - `client-smart-mode.js?v=57`;
  - `installment-credit.js?v=space-regularization-1`;
  - `fiados.js?v=mensagens-escopo-1`.
- **`css/clientes-mobile.css`:** não tem `?v`; depende do novo `CACHE`.
- **Nenhum arquivo novo do app:** `ARQUIVOS` e `public-site.manifest.json` não mudam.
- **Rollback:** voltar o frontend é seguro. Nada muda em IndexedDB, filas, recibos ou contratos; o formulário envia os mesmos campos.
- **Coordenação:** `js/installment-credit.js` e `js/fiados.js` são arquivos de Fiado compartilhados. As mudanças são de apresentação e de lote de repintura, sem regra financeira. Confira se outra branch altera esses arquivos antes de integrar.

## 6. Regressões

Comparação nome a nome com a base `326cd18` (`node --test tests/*.test.js tests/*.test.cjs`, com `functions/node_modules` instalado):

| | Base `326cd18` | Candidata |
|---|---:|---:|
| Testes | 2472 | 2480 (+8 novos) |
| Passaram | 2305 | 2315 |
| Falharam | 166 | 164 |
| **Falhas novas** | — | **0** |

- **Duas falhas antigas passaram a passar:** `scoped list of 100/1000 clients opens without Fiado proof fan-out` (`tests/clientes-performance-v2291.test.cjs`). Na base, elas falhavam porque o campo de busca perdia o foco depois de consultar o saldo, que é o defeito corrigido aqui.
- **Testes ajustados ao novo formulário:**
  - `tests/owner-receipt-v219.dom.test.cjs` lia `f.elements.kind`. Agora confere que o seletor não existe e que o tipo identificado é "Pagamento parcial".
  - `scripts/audit-owner-receipt-v219.cjs` recebeu a mesma troca.
- **Falhas antigas ligadas a Clientes:** `bottom sheet mobile compartilha todas as ações operacionais` e `Clientes preserva paginação, busca robusta e contexto condicional de renovação` falham na base e na candidata pelo mesmo motivo: um texto e uma regex antigos. As demais asserções do segundo teste foram conferidas à parte e continuam válidas.
- **Outras verificações:** `npm run lint`, `npm run build`, `npm run build:public` e `npm run test:public-containment` passaram nas duas versões; `tests/sync-version-identity.test.js` passou (5 de 5).
- **Emulator:** não se aplica, porque não há mudança em Functions nem em Rules.

## 7. GO/NO-GO

- **GO para auditoria independente.**
  - Piscadas e perda de foco eliminadas nos cenários medidos.
  - Ganhos de tempo comprovados por perfil de CPU e medição antes/depois.
  - Recebimento simplificado, com o contrato financeiro intacto e coberto por testes.
  - Nenhuma falha nova na suíte.
- **NO-GO para publicação direta.** Faltam:
  - homologação em aparelho Android físico com dados reais de uma conta de teste: digitar na busca enquanto chegam atualizações, rolar uma lista longa, receber pagamento parcial e integral, e conferir em espaço com vários espaços de clientes (`scopesCustomers`);
  - versão, `CACHE` e `?v=` definidos pelo responsável pela release.
- **Pontos para a auditoria olhar com atenção:**
  1. `patchPage`/`patchList` em `clientes-mobile.js`: chaves das seções, cartões em arraste e o `MutationObserver` que invalida cartões editados por outros módulos.
  2. `client-cloud-pagination.js`: `items()` e o novo caminho de `dataChanged` no celular, que atualiza no lugar e então relê a nuvem.
  3. `installment-credit.js`: `paintAll`; `expireDisplayedProofs` agora remove primeiro e repinta depois.
  4. `fiados.js`: o valor acompanha o novo máximo ao marcar a antecipação somente quando estava cheio.
- **Sugestões de continuação (fora do escopo):**
  - perfil do cliente mais rápido, com métricas de CRM calculadas só para o cliente aberto;
  - `fiado-conditions.js`: avisar a lista só quando as condições mudarem, o que evita uma renderização extra por evento financeiro. Combinar com o Codex, porque é área de cobrança.

## 8. Publicação V242.8

O responsável pela VECONI autorizou publicar esta melhoria sem a auditoria do Codex. A homologação no Android físico fica com ele, depois da publicação, e não está concluída.

### Release

- **Branch:** `claude/release-v2428-clientes-fluidez`, a partir de `origin/main` `326cd18`. Os quatro commits aprovados entraram por fast-forward, com os mesmos SHAs e sem conflito.
- **Commit de versão:** `debc208`.
  - `APP_VERSION` passa a 242.8; `release` e `clientRelease` continuam 242.
  - `CACHE` passa a `veconi-v2428-clientes-fluidez-v1`, e `GET_VERSION` informa 242.8.
  - `?v=2428-fluidez` vale para os oito arquivos alterados e para as entradas da sincronização: `auth.js`, `firebase-ui.js` e `sync.js`. O teste de identidade da release exige essa marcação.
  - `build-info.js` recebe `?v=2428` no `index.html` e no `catalogo.html`.
  - Cada URL versionada está no precache.
- **Fora da release:** Functions, Rules, protocolo de sincronização (1), formato dos pacotes (4), `public-site.manifest.json`, mensagens e cobrança.

### Verificações na candidata

- **Comandos:** `npm run lint`, `npm run build`, `npm run build:public` (284 arquivos permitidos) e `npm run test:public-containment` (56 de 56) passaram.
- **Versão:** `tests/sync-version-identity.test.js` passou (5 de 5). O teste de precache das entradas versionadas, em `sync-session-alert`, também passou. `scripts/release-version-check.cjs` respondeu "OK: versão 242.8".
- **Suíte completa:**

  | | Base `326cd18` | Candidata |
  |---|---:|---:|
  | Testes | 2472 | 2480 |
  | Falhas | 166 | 164 |

  Nenhuma falha é nova, na comparação nome a nome. As duas que deixaram de falhar são as de `clientes-performance-v2291`.
- **Contrato financeiro:** o `onsubmit` do recebimento em `fiados.js` é idêntico, byte a byte, ao da base. Os testes direcionados passaram: recebimento novo (4 de 4), lista estável (4 de 4) e recibo do dono (6 de 6).
- **Navegador:** `audit-clientes-fluidez`, com dados fictícios, em Android 390 px (CPU 4×) e desktop 1366 px. Uma amostra.

  | Medida (Android) | Resultado |
  |---|---|
  | Abrir Clientes, até o 1º cartão | 1,18 s |
  | Abrir Clientes, até pintar | 2,0 s |
  | Abrir o recebimento | 0,55 s |
  | Confirmar até o recibo do servidor | 2,5 s |
  | Cartões recriados, animações e piscadas, nos 11 eventos automáticos | 0 |
  | Mudança de espaço | uma remontagem, sem animação |

  - Busca, foco, cursor, rolagem, modal preenchido e filtro "Devendo" ficaram preservados no celular e no desktop.
  - Os recebimentos integral, parcial (saldo restante de R$ 12,16) e com parcelas futuras funcionaram, inclusive marcando e desmarcando a antecipação.
  - Na falha de conexão, o formulário ficou aberto, mostrou o erro e não deu sucesso.
  - Com a resposta pendente, apareceu "Aguardando confirmação" e nenhum sucesso antes do recibo.
- **Pacote público servido localmente:** os hosts externos estavam bloqueados. As 233 requisições de mesma origem responderam 200, incluindo as 12 URLs versionadas 2428. O único erro de console foi o CDN do Firebase bloqueado. O service worker instalou `veconi-v2428-clientes-fluidez-v1` com as 304 entradas do precache.

### Rollback

- **Compatibilidade:** a release só muda o frontend. IndexedDB, filas, recibos, protocolo e formato dos pacotes são os mesmos da 242.7. O service worker não apaga caches nem dados locais. Voltar o código antigo, portanto, não invalida operações pendentes nem pagamentos registrados na 242.8, que usam o mesmo contrato.
- **Procedimento:** publicar uma release nova que reverte o código. Não force a `main` de volta: é proibido, e o nome do cache não mudaria.
  1. No repositório sanitizado, rodar `git fetch origin` e criar uma worktree a partir da `origin/main` atual.
  2. Rodar `git revert --no-edit c6d0c0d 6db3b45 580de3f d611228`, nessa ordem. Isso devolve o código e os testes de `326cd18`, mas mantém o commit de versão.
  3. Subir a versão para 242.9, com `CACHE` `veconi-v2429-<assunto>-v1`, `GET_VERSION` igual e `?v=` novos para os arquivos revertidos e as entradas da sincronização, como em `debc208`.
  4. Rodar as verificações obrigatórias e publicar por fast-forward, pelo mecanismo autorizado.
