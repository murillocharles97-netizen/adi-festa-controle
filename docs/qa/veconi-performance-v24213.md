# VECONI V242.13 — diagnóstico de desempenho

Base `f24c386c9ea5a34e192ba2bc8682ac6bba81feaf`, conferida em `origin/main`. A branch local `codex/perf-v24213` contém apenas o laboratório e este relatório.

## Método

- Chrome 158 headless no Windows, viewport 390 × 844, CPU 4× mais lenta, rede com 80 ms de latência e 200 kB/s de download.
- Abertura e sincronização no HTML real com Auth e Firestore Emulator locais. Três contextos novos. O servidor autentica um proprietário fictício e carrega 25 clientes e 1.200 produtos. As callables de autorização usadas pelo benchmark têm respostas locais. O laboratório bloqueia os domínios externos durante o teste. A latência mede o cenário simulado.
- Navegação e gravação no shell local com código e CSS da candidata, dados fictícios e IndexedDB real. A fixture fixa a sessão e o contexto de Espaço para separar os custos do navegador das consultas. A mudança de rota termina após a montagem e duas oportunidades de pintura. CDP registra script, estilos, layout, heap JS e listeners. Tarefa longa significa pelo menos 50 ms. A soma acima de 50 ms por tarefa estima o tempo acumulado de bloqueio durante o recorte.
- Arquivos brutos em `qa-artifacts/performance/`, com perfis `.cpuprofile`, JSON e logs. Medidas de Chrome simulado. A homologação no Android físico continua pendente.

## Abertura e sincronização

Valores em ms, mediana (mínimo–máximo), três execuções.

| Operação | Tempo de ponta a ponta | Script no navegador |
|---|---:|---:|
| Primeira abertura até o formulário de login após DOM pronto | 10.026 (9.960–10.132) | 500 (492–532) |
| Primeiro conteúdo visível na abertura fria | 2.744 (2.700–2.988) | — |
| Do clique em Entrar até o shell do Dashboard | 2.041 (2.025–2.609) | 517 (513–577) |
| Hidratação dos dados após montar o Dashboard | 6.229 (5.886–6.889) | 657 (654–694) |
| Reabertura com Service Worker instalado e sessão online | 3.924 (3.887–4.044) | 1.263 (1.257–1.333) |
| Alteração de um produto logo após reabrir online | 10.716 (10.690–10.809) | 2.127 (2.123–2.131) |
| Alteração de um produto após reconectar sessão já aberta | 7.305 (7.234–7.797) | 974 (959–1.222) |

A abertura fria transferiu 1,64 MB de 245 recursos locais, com 5,85 MB descomprimidos e zero requisições ao banco de teste antes do login. O evento DOMContentLoaded ocorreu entre 9,73 e 9,85 s. Na reabertura, o Service Worker atendeu os 246 recursos, com zero bytes transferidos para eles. Ainda houve aproximadamente 3,20 s de tarefas na thread principal até o shell.

O cenário de alteração de produto inclui uma leitura forçada pelo roteiro, a entrega do listener e a hidratação concorrente ao reabrir. O contador registrou 1.302 documentos observados no conjunto da fase, incluindo o snapshot inicial do catálogo e uma consulta paginada de produtos. Só um produto foi alterado. O caso confirma contenção entre o SDK, a hidratação e a preparação do IndexedDB. Ele não estima o custo de uma alteração com a sessão ociosa nem as leituras faturáveis. Nos três ensaios, a fase emitiu nove estados de sincronização e acumulou cerca de 3,60 s de bloqueio acima dos primeiros 50 ms por tarefa.

O perfil de CPU dessa fase aponta `ordered` e `clone` em [business-cache.js](../../js/business-cache.js#L33), `snapshot` em [business-context.js](../../js/firebase/business-context.js#L40) e ordenação do SDK do Firestore. O contexto usa `structuredClone` a cada `get()`. Vale compartilhar uma única captura durante a mesma operação síncrona, depois de localizar os chamadores frequentes. Uma operação assíncrona continua precisando conferir a sessão e o Espaço quando termina.

O monitor registrou quatro listeners durante as fases autenticadas. O código encerra as inscrições antes de reconstruí-las e usa registros de escopo em [sync.js](../../js/firebase/sync.js#L5213). Isso não descarta reconexões desnecessárias entre contextos ou custo excessivo dentro de um callback.

A reabertura inteiramente offline, com o emulador indisponível, terminou em `network_error` nos três ensaios. A troca de tela com sessão já aberta funcionou em todos. O roteiro não modela o comportamento de credenciais offline em um Android instalado. Esses ensaios de desempenho não reavaliam a homologação da atualização do PWA.

## Troca de telas e travamentos

Tema claro, três repetições por volume. Base pequena com 26 clientes, 31 produtos, 51 vendas e 21 pagamentos. Base grande com 2.001 clientes, 2.006 produtos, 5.001 vendas, 1.601 pagamentos e 1.600 registros de cobrança. Tempo em ms, mediana (mínimo–máximo), em ordem de primeira visita na base grande.

| Tela | Primeira, base grande | Retorno, base grande | Primeira, base pequena |
|---|---:|---:|---:|
| Cobranças em lote | 6.344 (6.276–6.358) | 6.180 (6.158–6.341) | 204 (192–216) |
| Relatórios | 1.026 (1.004–1.087) | 282 (225–283) | 308 (305–316) |
| Vender | 585 (575–607) | 434 (430–441) | 424 (420–483) |
| Clientes | 577 (569–578) | 441 (423–448) | 486 (478–487) |
| Produtos | 462 (460–473) | 340 (332–340) | 338 (337–352) |
| Início | 371 (370–377) | 348 (336–353) | 179 (167–184) |
| Histórico, shell da fixture | 293 (293–352) | 265 (264–300) | 72 (72–75) |

As 126 montagens medidas nas sete rotas terminaram sem erro de página. No tema escuro e base grande, Cobranças levou 6.392 (6.264–6.406) ms e Início, 368 (362–370) ms na primeira visita. Os dois temas apresentaram os mesmos 44.848 elementos em Cobranças.

Em Cobranças, 1.600 cartões geraram 44.848 elementos sob `#app`. Na primeira visita, a mediana de script foi 2.572 ms e a de estilos mais layout foi 3.348 ms. Foram duas tarefas longas com 6.220 ms acumulados acima de 50 ms. O perfil aponta cartões, histórico e formatação de datas (`dataHora`). Reduzir só a ordenação não elimina o trabalho de montagem.

A preparação da lista fez 30.847 chamadas a `financialStatus` para 2.001 clientes. Em uma segunda medição dentro da mesma sessão, reutilizar a resposta da função por cliente durante a mesma montagem preservou a lista em ordem idêntica e reduziu a preparação de 425 (423–438) para 158 (157–158) ms, com 2.001 chamadas. A medição cobre a preparação em memória, logo após a primeira passagem da lista.

No Dashboard, só o modelo e o HTML levaram 102 (101–104) ms e fizeram 3.601 consultas a `financialStatus`, contra 8 ms e 46 consultas na base pequena. O perfil de CPU mostra `model` e `dayKey`. A abertura real também gastou tempo em remontagens do Início enquanto a autenticação terminava.

Três notificações sintéticas de produtos disparadas juntas remontaram uma vez a página inteira em cada ensaio. A raiz anterior saiu do DOM. O tempo entre a primeira notificação e a pintura foi de 6.189 (6.151–6.404) ms em Cobranças e 938 (528–984) ms no Início. O ensaio mede o efeito visual do evento com os dados estáveis.

Após alternar Clientes e Início cinco vezes, os contadores dos listeners globais inspecionados permaneceram estáveis. No tema claro, o heap caiu de 99,3 MB no roteiro que incluía montar e desmontar a grade de Cobranças para 29,8–30,3 MB nos quatro ciclos seguintes com coleta forçada. A diferença mostra pressão temporária de alocação. A análise de vazamentos em sessões longas fica em aberto.

## Gravação local

Na base grande, a alteração de nome de um produto levou 1.399 (1.379–1.406) ms até `DB.flush()`. Somente 38 (37–42) ms decorreram entre a abertura e o fim da transação. A base sintética ocupava 6,54 MB em JSON. O cache verificou 12.242 linhas, gravou uma linha comercial e o metadado da revisão. Os três ensaios reabriram o banco e confirmaram o produto alterado.

Uma chamada a `DB.alterar` com uma função que não muda os dados levou 1.052 (1.018–1.100) ms e abriu zero transações de escrita. Os perfis mostram as cópias e impressões digitais em primeiro plano. Eliminar o segundo cálculo de impressão digital em gravações efetivas e reduzir o processamento dos casos sem mudança são oportunidades distintas.

Na base pequena, a mesma escrita levou 62 (59–62) ms, dos quais 35 (30–36) ms dentro da transação. A chamada sem mudança levou 17 (17–18) ms. O tempo fora da transação cresceu com o volume de dados, enquanto a janela medida da transação foi parecida.

## Pontos no código

- [Gravação local](../../js/storage.js#L119). `DB.alterar` clona o banco em memória, normaliza em `salvar` e passa para [`stage`](../../js/business-cache.js#L404), que clona novamente. [O commit](../../js/business-cache.js#L125) codifica o conjunto, faz uma impressão digital por linha e grava só as diferenças. Depois recalcula a impressão digital de todas as linhas para montar a próxima referência. O caminho sem alteração ainda faz a primeira comparação completa.
- [Central de Cobranças](../../js/cobrancas.js#L7). O comparador chama a mesma consulta de saldo repetidamente e repassa pelo histórico para cada cliente. [A montagem dos cartões](../../js/app.js#L403) busca o último registro mais de uma vez. O caminho medido é a rota `#/cobrancas` de cobrança em lote. O compositor por mensagem e os mecanismos de autorização financeira ficam fora da otimização.
- [Dashboard mobile](../../js/home-mobile.js#L20). O modelo percorre vendas por dia para hoje e ontem e percorre a mesma lista mais sete vezes para o gráfico. Também consulta a posição financeira dos clientes. A atualização de troca refaz toda a árvore via [`refresh`](../../js/home-mobile.js#L134).
- [Atualização da tela](../../js/app.js#L1373). Um debounce reúne eventos remotos, mas a maioria das rotas remonta toda a página mesmo se a coleção não alimenta a tela atual. O tratamento localizado de Clientes, Vender e Consignados já existente deve ser preservado.
- [Indicadores de sincronização](../../js/firebase/sync.js#L2351). Cada emissão monta o diagnóstico e confirma contadores, mesmo com o painel fechado. O [badge](../../js/firebase/auth.js#L310) reescreve HTML e atualiza ícones. A [UI técnica](../../js/firebase/firebase-ui.js#L514) constrói o HTML dos detalhes mesmo sem um alvo visível. Há custo repetido comprovável no código. O perfil desta rodada não isolou a parcela de cada consumidor.

## Ordem recomendada

| Prioridade | Oportunidade e ganho esperado | Impacto | Risco | Esforço |
|---|---|---|---|---|
| 1 | Cobranças. Calcular o saldo usado pela ordenação uma vez por cliente, indexar a última ocorrência e montar cartões em lotes. Preservar a consulta estrita dos cartões e os totais sobre a lista inteira. Deve reduzir os bloqueios de script, estilos e layout. | Alto na tela | Baixo a médio | Baixo e médio, em dois commits |
| 2 | Gravação local. Reaproveitar a impressão digital já calculada após o commit. Medir o ganho antes de introduzir alterações localizadas por coleção. Um caminho de atualização por registro tem alcance maior e exige testes de interrupção, disputa entre abas e gravação atômica de dados e fila. | Alto em todo o app | Baixo no primeiro passo, alto no caminho localizado | Baixo e alto, em fases |
| 3 | Dashboard. Agregar vendas por dia em uma passagem, derivar o gráfico e os cartões do mesmo resultado e reaproveitar cada consulta de cliente dentro do render. Validar fuso, virada do dia, Espaço, cancelamentos e ajustes sem mudar o cálculo. | Médio a alto | Baixo a médio | Baixo |
| 4 | Atualizações remotas. Evitar remontagem quando a coleção não alimenta a rota. Deduplicar alterações visuais do badge e preencher diagnóstico visual quando aberto. Medir o contexto por operação síncrona, com revalidação após awaits. Manter a decisão sobre integridade, envio, recibos e permissões nos caminhos atuais. | Alto em sessões com sincronização ativa | Médio a alto | Médio |
| 5 | Abertura. Separar os recursos indispensáveis ao login e à retomada do PWA dos módulos usados depois. Medir por pacote e preservar disponibilidade offline, controle de versão e dependências de autenticação. | Alto na primeira abertura | Médio a alto | Médio a alto |

Primeiro lote sugerido: consulta de Cobranças uma vez por cliente, índice de histórico por montagem e reaproveitamento da impressão digital no IndexedDB. Comparar o antes e depois no mesmo roteiro e conferir listas, totais, recibos, fila, reabertura e concorrência antes de mudar o contrato de persistência. O agrupamento de cartões e a atualização seletiva da interface ficam em commits próprios. A execução repetida constatada no caminho genérico de persistência e na tela de Cobranças já justifica essa priorização. O fallback financeiro fica fora dela.

## Reprodução

Use Node, Chrome e `puppeteer-core`. Para a abertura, use o SDK 10.13.2 em `qa-artifacts/performance/sdk/` e disponibilize `firebase-admin` a partir de `functions/node_modules`. O projeto de teste é `demo-veconi-perf`. Rode um benchmark por vez para evitar contenção.

```powershell
$env:PERF_PROFILE = 'mobile-light'
$env:PERF_PRODUCTS = '1200'
$env:PERF_ROUNDS = '3'
$env:PERF_STARTUP_OUTPUT = 'v24213-startup.json'
firebase emulators:exec --config firebase.performance-qa.json --only firestore,auth --project demo-veconi-perf 'node scripts/audit-performance-startup-c643cc5.cjs'
Remove-Item Env:PERF_PROFILE
node scripts/audit-performance-v24213.cjs
$env:PERF_PROFILE = 'light-large,light-small'
$env:PERF_STORAGE_ONLY = '1'
node scripts/audit-performance-v24213.cjs
Remove-Item Env:PERF_PROFILE
Remove-Item Env:PERF_STORAGE_ONLY
node scripts/summarize-performance-v24213.cjs
```

O resumo em `v24213-summary.json` guarda cada intervalo como `[mediana, mínimo, máximo]`. A rodada de gravação mede o intervalo da transação IndexedDB separadamente.
