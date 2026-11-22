# VECONI V242.1 — Linha de base de performance

Base auditada `c643cc528ada9bac22487b51288288c66480c3b1`, a ponta remota de `main` no início da auditoria. O laboratório está no worktree `veconi-performance-baseline`, na branch `codex/veconi-performance-baseline`.

## Escopo e leitura dos números

- Chrome 157.0.8103.80 headless no Windows em Ryzen 7 5700X. Desktop 1440 × 950. Mobile simulado 390 × 844, CPU 4× mais lenta, latência configurada em 80 ms, download de 200 kB/s e upload de 93,75 kB/s. O desktop usa CPU e rede sem limitação artificial. Os temas foram aplicados e conferidos no navegador nas rotas. Os números caracterizam o laboratório. Um Android real, uma rede móvel e o backend em produção podem apresentar latências diferentes.
- Abertura usa o HTML, a lógica de boot, o IndexedDB e o Service Worker do commit. Auth e Firestore reais do SDK apontam para emuladores locais usando o projeto `demo-veconi-perf`. A preparação de associação e a consulta de protocolo respondem com dados fictícios em memória. Os demais callables ficam indisponíveis nesse cenário. O servidor HTTP local comprime os arquivos e hospeda a cópia do SDK. O registro do worker é explícito porque o app o desativa em localhost.
- Navegação percorre as 18 rotas do Router (Fiado e Visitas são encaminhados para Clientes e Catálogo) em ordem fixa, com uma primeira visita e um retorno por contexto. A primeira visita pode herdar cálculos feitos por outra rota. Foram usadas duas bases fictícias locais. A pequena tem 31 produtos, 26 clientes, 51 vendas e 21 pagamentos. A grande tem 2.006 produtos, 2.001 clientes, 5.001 vendas e 1.601 pagamentos. São os mesmos componentes da aplicação com sessão de proprietário fictícia, escopo controlado e serviços simulados onde indicado. As medições de tela observam a montagem e duas oportunidades de pintura. A fixture mede a interface de Financeiro, Relatórios, Equipe, Pedidos e outras superfícies dependentes de backend com dados controlados. O ensaio de checkout utiliza emulador e a fonte do serviço para um relatório confirmado. O tempo do backend de produção e de provedores de pagamentos externos requer medição separada.
- Abertura fria usa um perfil limpo, sem sessão e sem armazenamento. Reabertura usa a mesma sessão, o cache e o IndexedDB da execução. A espera pelo login termina quando o formulário é visível. O painel termina quando a rota monta após o login. Hidratação tem marco independente quando o catálogo aparece e o sincronizador declara a primeira carga pronta. Isso não garante que todos os módulos tenham dados reconsultados.
- Os intervalos registram mediana e mínimo/máximo em milissegundos, inclusive quando a dispersão é alta. Chrome DevTools Protocol separa tempo de script, estilo, layout, heap JS e listeners DOM. PerformanceObserver registra tarefas de pelo menos 50 ms. Os perfis de CPU registram amostras de funções e incluem sobrecarga de instrumentação. Contagens HTTP incluem canais do SDK e tentativas. O contador do app cobre operações instrumentadas e documentos observados. Nenhuma dessas contagens mede cobrança do Firestore.
- No ensaio de armazenamento, a abertura, a gravação e a reabertura usam o cache IndexedDB do app. A conversão de JPEG usa `ProductImages.processImage`. O lote de imagens persistidas usa Cache Storage em origem fictícia e mede capacidade/custo de um cenário sintético. A imagem original e a miniatura do fluxo normal usam referências de Storage e o benchmark de lote não reproduz um upload.
- Os processos do laboratório usam origens de loopback, Chrome separado, dados fictícios e regras do commit carregadas exclusivamente no emulador. Nenhuma venda real, conta de produção ou fila de usuário foi usada. Os arquivos do app, Functions e Rules ficaram iguais ao commit auditado.

## Diagnóstico

O maior custo da primeira abertura foi carregar a página privada antes de liberar o login. Com uma base grande, Vender, Clientes e CRM dominaram a navegação mobile. Vender combina JavaScript, estilo e layout. Em Clientes e CRM, o processamento de datas dominou o CPU. A busca mobile tem um erro funcional ao exibir uma lista vazia.

### Abertura e sincronização

Tempos em **mediana (mínimo–máximo), ms**. Três execuções por perfil mobile. O desktop claro teve cinco execuções na abertura.

| Etapa | Desktop claro | Mobile claro | Mobile escuro |
|---|---:|---:|---:|
| Abertura até o login | 332 (316–537) | 9.540 (9.488–9.608) | 9.519 (9.509–9.524) |
| Do envio das credenciais até o painel | 253 (238–797) | 1.963 (1.934–2.480) | 1.965 (1.905–2.426) |
| Reabertura online com sessão e cache | 623 (604–739) | 2.957 (2.934–3.285) | 3.085 (3.071–3.730) |
| Catálogo de 25 produtos, espera após montagem do painel | 10 (7–240) | 52 (38–785) | 62 (53–373) |
| Atualização visível de um produto após reconectar, com a sessão já aberta | — | 1.147 (1.133–1.160) | — |
| Reabrir sem rede até a tela de erro de acesso | — | 1.521 (1.509–1.585) | 1.570 (1.537–1.585) |
| Reabrir após reconectar até o painel | — | 3.017 (2.924–3.132) | 3.069 (3.052–3.647) |

- Antes do formulário, o navegador observou 238 recursos locais, aproximadamente 1,55 MB recebidos com cabeçalhos e 5,56 MB decodificados. A primeira pintura no mobile claro veio em 2.672 ms (2.620–2.752). O wrapper registrou zero operações Firestore nessa etapa. A árvore inicial de recursos explica a diferença entre a primeira pintura e o login, junto com o trabalho de script, estilo e layout.
- Na base de 1.200 produtos, a hidratação após a montagem do painel levou 6.128 ms (6.089–11.029, n=3), com 1.226 documentos instrumentados e pico de quatro listeners. O trecho de script nessa etapa ficou em 616 ms (606–1.317). Na atualização de um produto, o listener de um documento precedeu uma consulta explícita `listRecent` que leu 100 documentos nos três ensaios. O ensaio completo, que aguarda essa consulta e verifica o dado visível no final, levou 11.502 ms (11.312–11.561). O trace atribui de 8,9 a 10,0 s à chamada do wrapper e aproximadamente 0,45 a 0,58 s à persistência concorrente. A primeira chegada pelo listener pode ter ocorrido antes. A duração do wrapper inclui SDK, rede simulada e espera por CPU, e não representa apenas RTT.
- Com o app aberto e sem conexão, a ida a Produtos e volta ao painel ficou em 979 ms (889–1.386) no claro e 1.084 ms (916–1.314) no escuro. Após fechar e reabrir, o cache `veconi-v2421-sync-panel-v1` entregou o frontend, mas o bootstrap falhou ao consultar a rede em 3/3 por tema. Nos seis casos, reconectar permitiu abrir o painel e voltar a ver os dados fictícios. O teste bloqueou a rede da origem e registrou falhas de transporte. A conclusão diz respeito à autorização da sessão no cenário testado.
- Nenhuma variação medida justifica dispensar as verificações de usuário, espaço, associação, geração ou confirmação financeira. A resposta de aprovação dos callables do boot usou fixture; isto limita a extrapolação do tempo do login ao backend de produção.

### Navegação e interações

Tempos em ms, com mediana e intervalo. Cada célula tem três execuções. A matriz tem 648 montagens e 18 ensaios de armazenamento.

| Rota | Mobile claro | Mobile escuro | Desktop claro | Mobile claro, retorno |
|---|---:|---:|---:|---:|
| Vender | 7.275 (6.609–8.360) | 6.870 (6.803–8.044) | 1.785 (1.728–1.791) | 11.884 (11.440–12.445) |
| Clientes | 7.062 (6.571–7.256) | 6.503 (6.446–6.521) | 1.257 (1.250–1.271) | 564 (564–708) |
| CRM | 6.704 (5.801–6.750) | 6.368 (6.156–6.771) | 26 (26–29) | 6.764 (6.468–6.897) |
| Relatórios | 1.007 (965–1.166) | 994 (932–1.021) | 178 (171–220) | 366 (347–376) |
| Produtos | 444 (419–480) | 453 (436–494) | 67 (54–121) | 100 (99–114) |
| Financeiro | 303 (300–319) | 324 (276–376) | 54 (54–56) | 250 (225–281) |
| Histórico | 280 (277–306) | 286 (272–290) | 67 (67–81) | 252 (247–255) |
| Início | 153 (140–156) | 155 (154–163) | 78 (67–80) | 278 (153–1.035) |

- As tabelas foram geradas a partir das 18 rotas em dois volumes e dois momentos. Elas incluem heap JS, listeners DOM, tarefas de pelo menos 50 ms e latência de buscas, filtros e carrinho. Células com controle ausente ou sem atualização observável são identificadas. Ver [tabelas de referência](veconi-performance-metricas-c643cc5.md).
- Na base grande, Vender montou 2.006 cartões e 40.600 nós do conteúdo no mobile, além dos elementos da estrutura geral do app. No desktop, os mesmos cartões geraram 58.641 nós. Os tempos CDP de script, layout e estilo podem se sobrepor. O perfil capturou seleção de nós e substituição de ícones. O caminho de atualizar o carrinho continua com a grade grande montada. Escolher dinheiro no mobile claro levou 100 (96–118) ms na base pequena e 2.186 (1.956–2.295) ms na base grande.
- No checkout mobile com Firestore Emulator, concluir até o recibo local e a gravação durável levou 380 ms (343–385, n=3). Drenar a fila de teste e confirmar após uma perda simulada de resposta tomou 387 ms (387–394, n=3). O relatório confirmou o faturamento em 536 ms (522–540, n=3). Cada cenário conferiu 10 km, R$ 30 de venda, R$ 15 de custo, uma venda, uma entrada financeira e zero movimentações de estoque. Foi usado o serviço de commit do repositório e um adaptador de fila fictício. No desktop, os mesmos marcos tiveram medianas de 114 ms para o recibo, 386 ms para a confirmação e 173 ms para o relatório, em três repetições válidas após estabilizar o acionamento da fixture. O teste usou pagamento local em dinheiro.

### Armazenamento, imagens e movimento

| IndexedDB | Gravar a base | Alterar um produto | Reabrir e conferir |
|---|---:|---:|---:|
| Desktop claro, grande | 668 (642–706) | 222 (210–224) | 219 (213–250) |
| Mobile claro, grande | 2.646 (2.183–2.717) | 1.012 (1.009–1.026) | 711 (711–916) |
| Mobile claro, pequeno | 38 (36–41) | 18 (16–44) | 16 (16–21) |

- A base grande ocupou cerca de 6,16 MB de JSON antes do armazenamento e 10.642 linhas no cache IndexedDB. Alterar um produto escreveu uma linha de negócio. A medição separa a gravação inicial, a alteração unitária e a reabertura com conferência. O heap e o número de listeners são amostras na transição, sujeitas a coleta de lixo. Um teste de sessão prolongada seria necessário para investigar vazamento.
- No mobile claro, processar o JPEG levou 258 (257–266) ms. O JPEG sintético de 2,25 MB gerou imagem principal de cerca de 371 kB e miniatura de 27 kB. Em outro ensaio, foram gravadas 30 imagens de 2,25 MB no Cache Storage da origem fictícia em 137 (130–142) ms. O lote soma cerca de 67,6 MB lógicos. O perfil de disco e as cotas de um Android real podem ser diferentes. O teste não mede upload ou o desempenho de uma galeria que exiba todas as cópias completas simultaneamente.
- No Início mobile, a preferência normal iniciou 20 animações do redesign por repetição, com 221–232 ms de recálculo de estilos registrados após a montagem. A preferência de movimento reduzido suprimiu as animações `vf-*` nos três ensaios. Esse ensaio mede uma janela de 1,5 s após a montagem local e não atribui às animações a espera antes do login.

### Testes e limites

- `test:service-sync` passou 29/29. Os testes de revisão e compartilhamento de recebimento passaram 9/9. A seleção de performance, privacidade, PWA, cache e pagamentos teve 74/77 aprovações com a lógica da base. Falharam as asserções de foco de `scoped list of 100 clients opens without Fiado proof fan-out` e `scoped list of 1000 clients opens without Fiado proof fan-out`, além do teste estático `sync revalida o efeito antes de campanhas e preserva resolução auditável`.
- As rodadas com folhas de estilo duplicadas na fixture foram descartadas. A matriz de referência usa somente as folhas do HTML de produção. Timeouts de instrumentação e interações interrompidas aparecem separados dos tempos válidos. Houve sobreposição pontual com outras rotinas de QA no computador. Para comparar diferenças pequenas com a próxima etapa, execute as rodadas em sequência e repita no mesmo aparelho.
- As métricas não cobrem pagamentos de adquirente, produção autenticada, cobrança do Firestore, o custo de atualização a partir de outra versão ou um Android físico. A linha de base não mede a disponibilidade de todos os callables em produção. O código de autorização e a política de atualização foram inspecionados sem contornar seus controles.

### JavaScript, DOM e V242

- Em `js/customer-metrics.js:48`, cada chamada de `brazilDayNumber` cria um `Intl.DateTimeFormat` para São Paulo. O perfil de CPU de Clientes mostrou cerca de 733 ms de amostras próprias no desktop e 3.957 ms no mobile claro em primeiras visitas com dados grandes. Em CRM mobile, `dayNumber` de `js/crm-segment-engine-v2.js:109` usa a mesma estratégia e somou 5.620 ms de amostras próprias em uma execução. Esse segundo ponto é independente do cache de agregação de Clientes. `js/client-smart-mode.js` e `js/clientes-mobile.js` podem disparar cálculos de CRM durante a navegação para Clientes. `js/crm-dashboard.js:31` ainda recalcula uma assinatura percorrendo coleções antes de aproveitar o cache. A hipótese de reusar o formatador é direta. Afirmar um ganho em produção exige reproduzir o resultado e provar igualdade nas fronteiras de dia.
- Vender no desktop renderizou 2.006 cartões e cerca de 58,6 mil nós na primeira visita grande. O perfil registrou seleção de nós, atribuição de atributos e substituição de ícones junto a `lucide.createIcons`. `js/desktop-sales.js:149` faz o mapeamento de todos os cartões. `js/checkout.js:220` em diante pesquisa, ordena e atualiza os cartões pelo DOM. O custo aumenta na abertura e em ações que voltam a percorrer esses nós.
- Uma busca em Clientes mobile sem correspondências lança `ReferenceError: scoped is not defined` em `js/clientes-mobile.js:172`. O identificador tem declarações locais em outros renderizadores, mas é usado sem declaração em `renderSearch`. A exceção impede a atualização para o estado vazio. A fixture também reproduziu uma busca com correspondências e retorno normal. As tentativas afetadas são falhas de interface. Reproduzir após a correção e medir novamente com o resultado realmente exibido.
- O CSS inicial tem 73 arquivos, 1.207.969 bytes brutos e 241.191 bytes em gzip estimado. `css/veconi-fluxo.css` representa 315.612 bytes brutos (26%) ou 36.296 bytes gzip (15%). Há transições com escopo de tema e preferências de movimento em `css/veconi-fluxo.css:193`. Os tempos de estilo/layout confirmam custo no DOM grande. Eles incluem todo o CSS, de modo que não isolam o efeito da ponte escura nem provam que as animações sejam o gargalo.
- O Início mobile percorre vendas para os sete pontos do gráfico em `js/home-mobile.js:38`. Relatórios usa o modelo local antes ou ao lado dos resultados do servidor em `js/performance-dashboard.js:24`. Histórico monta e filtra sua própria lista de eventos em `js/activity-center.js:631`. Esses trechos são oportunidades secundárias, condicionadas aos perfis por rota e às métricas do relatório.

### Inicialização, cache, banco e rede

- `index.html` referencia 127 scripts locais em 2.897.350 bytes brutos (814.385 gzip estimado). Ainda entram imports transitivos e SDK. A cópia local do Firestore completo e Lite soma 558.795 bytes brutos. Na abertura fria, o login depende do carregamento da página privada e de sua árvore de módulos. O Lighthouse de uma página anônima ou um teste de rede sozinho não captura o tempo até o formulário responder.
- `js/firebase/auth.js:515` valida perfil, associação, empresa e geração antes da interface autorizada. O Financeiro carrega três scripts e um módulo por etapas sequenciais em `js/app.js:1495`, antes dos dados em `js/firebase/financial-space-service.js:2735`. O código confirma que essas fases se encadeiam. O peso de cada etapa de backend em produção ainda precisa de mensuração por trace.
- `service-worker.js:72` prepara 263 URLs distintas (7,70 MB brutos, 2,69 MB com estimativa gzip). Entre os maiores itens está o XLSX de cerca de 952 kB, mesmo para quem nunca abre importação. São 179 URLs versionadas no HTML com outro URL correspondente, sem a versão, no precache. Em `service-worker.js:88`–106, navegação, JS e CSS usam caminho network-first e armazenam as respostas online; offline a busca ignora o parâmetro. É necessário medir as reutilizações por recurso antes de mudar a política. Retenção de caches antigos é deliberada neste release. `js/pwa-update.js` aguarda a gravação local antes de enviar `SKIP_WAITING` e antes da recarga. O ensaio usa a V242.1 e seu próprio cache; a transição entre duas versões não foi medida.
- `js/business-cache.js:125` transforma o estado em linhas e calcula a impressão de todas elas antes de achar o delta. Depois do commit, cria outro mapa de impressões. `js/business-cache.js:240` decodifica e valida todas as linhas na abertura. A medição de uma única alteração confirma que a amplificação observada vem do processamento em memória em conjunto com a transação, com apenas uma linha de negócio escrita.
- `js/firebase/sync.js:5341` respeita o escopo, o marcador de sincronização e o tipo de leitura. Algumas coleções do pull são percorridas sequencialmente. `js/firebase/firestore-repository.js:432` e :518 escolhem leitura incremental e paginada. Houve sobreposição comprovada entre a chegada via listener e a consulta explícita de atualização logo após reabrir. Uma única atualização visível pode ser entregue pelo listener antes de o pull terminar. A contagem de listeners é do wrapper e não implica duplicação de assinaturas.

## Plano priorizado

| Ordem | Problema e evidência | Proposta e arquivos | Ganho esperado, como hipótese | Risco | Esforço |
|---|---|---|---|---|---|
| P0 | Busca mobile de Clientes interrompida | Corrigir o escopo em `clientes-mobile.js` e testar busca/filtros em conta geral e por espaço | Recuperar o resultado e medir a latência real | Baixo, com casos de saldos pendentes e restritos | Pequeno |
| P1 | Agregação de CRM tem conversão de fuso dominante e pode rodar durante Clientes | Reusar os formatadores em `customer-metrics.js` e `crm-segment-engine-v2.js`, separar cálculo do momento de montar em `client-smart-mode.js`, `clientes-mobile.js` e `crm-dashboard.js` | Cortar centenas de ms no desktop e parte dos segundos no mobile com base grande | Baixo para reuso do formatador. Médio para adiar cálculo sem mudar estados | Pequeno a médio |
| P1 | Vender desktop e mobile montam a lista toda e converte milhares de ícones | Montar lotes limitados ou virtualizar, filtrar dados antes do render, atualizar só o carrinho/grade afetada em `desktop-sales.js`, `checkout.js` e `checkout-mobile.js` | DOM inicial uma ordem de grandeza menor. Meta inicial de 50% de redução na mediana de primeira visita grande | Alto. Busca, leitor, atalhos, variações, serviço, estoque e rascunhos precisam de paridade | Médio |
| P1 | Primeira abertura presa à árvore inicial de recursos | Medir cobertura por rota, extrair dependências que não bloqueiam o login e testar carregamento gradual em `index.html`, `app.js` e módulo de boot | Primeira hipótese de 20–35% a menos na mediana mobile fria | Médio. Ordem de scripts, login, navegação direta e offline | Médio |
| P2 | CSS do redesign e troca de rota sobre uma árvore grande | Depois de reduzir DOM, isolar custo do CSS em ensaio controlado. Dividir recursos por módulo apenas se comprovado, preservando tokens e identidade | Menor transferência e recálculo. Quantificar o delta antes de propor a mudança | Médio. Escopo de tema, cores operacionais, PWA | Médio |
| P2 | Gravação de um item percorre toda a base IndexedDB | Primeiro cronometrar clone, encode, comparação e transação. Em etapa arquitetural, registrar mudanças por coleção/ID e validar em paralelo com as impressões completas | Gravações pequenas mais proporcionais ao delta | Alto. Concorrência, geração, origem, atomicidade, idempotência e recuperação | Alto |
| P2 | Finanças abre com quatro cargas em série; histórico, Início e Relatórios agregam localmente | Identificar dependências reais no carregador, acrescentar marcas de prontidão e consolidar passagens equivalentes nos modelos | Reduzir esperas de módulo e evitar varrer as mesmas vendas repetidamente | Médio. Saldos confirmados, trocas, fuso e filtros por espaço | Médio |
| P2 | Após reabrir, a consulta explícita a Produtos leu 100 registros mesmo após um delta via listener | Instrumentar cursor, confirmar proveniência e escopo e simular reutilização de snapshot em `firebase/sync.js` e `firebase/firestore-repository.js` | Reduzir trabalho sobreposto e o tempo de retorno do pull. Medir separadamente a primeira chegada do produto | Alto para qualquer mudança de cursor. Tombstones, múltiplos espaços, ordenação e retentativa são obrigatórios | Médio a alto |
| P3 | Precache amplo e variantes de URL | Medir reutilização por recurso. Definir pacotes offline e chaves por release sem misturar recursos | Menos bytes de preparação e transferência na abertura | Alto. Uma falha pode misturar versões ou atrasar confirmação. Contratos e limites financeiros são invariantes | Alto |

## Proposta de execução

Os ajustes de escopo na busca e de reuso dos formatadores são intervenções pequenas. A redução do DOM e do carregamento inicial requer validação de componentes. Mudanças de persistência, escopos e cache offline formam uma etapa arquitetural própria.

1. Corrigir a busca mobile em alteração independente. Otimizar criação de formatadores com teste de equivalência em viradas de dia/mês, horários e entradas antigas. Repetir a matriz Clientes/CRM e acompanhar heap e tarefas longas.
2. Medir eventos e filas do PDV antes de limitar o DOM. Comparar primeira visita, busca, variações e carrinho. Exigir paridade de IDs, valores, custos, permissões, pagamento e ordenação. Repetir testes de venda comum e serviço, Fiado, queda de conexão, retentativa e resposta perdida com IDs originais em ambiente sintético.
3. Tratar entrada do PWA e carregamento por rota. Usar o mesmo perfil e os mesmos tamanhos antes/depois. Testar instalação nova e atualização desde V242.1, nas duas preferências de tema, pós-reabertura e offline, mantendo filas fictícias intactas.
4. Medir durabilidade, retomada e consultas com perfis distintos antes de mudar persistência ou sincronização. Para qualquer novo algoritmo, provar ordem das escritas e proteção entre empresas, usuários e espaços, inclusive após concorrência, falha e troca de geração. Medir primeiro com shadow comparison no laboratório. Separar cada entrega para poder reverter por commit.

## Reprodução

Use Node, Chrome, `puppeteer-core`, `firebase-admin` e Firebase CLI com os emuladores instalados. O runtime também aceita `CHROME_PATH`. O SDK oficial da versão referenciada no commit (10.13.2) deve estar em `qa-artifacts/performance/sdk/`, com os arquivos app, auth, firestore, firestore-lite, functions e storage. O laboratório só serve esses arquivos localmente durante o teste. Execute um benchmark por vez para evitar contenção artificial.

```powershell
node scripts/audit-performance-static-c643cc5.cjs
node scripts/audit-performance-runtime-c643cc5.cjs
node scripts/audit-performance-motion-c643cc5.cjs
firebase emulators:exec --config firebase.performance-qa.json --only firestore,auth --project demo-veconi-perf "node scripts/audit-performance-startup-c643cc5.cjs"
firebase emulators:exec --config firebase.v240-qa.json --only firestore --project demo-veconi-v238-homologation "node scripts/audit-performance-checkout-c643cc5.cjs"
node scripts/summarize-performance-c643cc5.cjs
npm run test:service-sync
```

`PERF_ROUNDS`, `PERF_PROFILE`, `PERF_VOLUME` e `PERF_ROUTES` permitem repetir recortes de navegação. `PERF_PRODUCTS` ajusta o catálogo do emulador. Nesta referência foram usados 25 e 1.200, com cinco rodadas desktop na primeira matriz e três em cada cenário mobile. `PERF_STARTUP_OUTPUT` e `PERF_CHECKOUT_OUTPUT` permitem salvar os recortes com nomes distintos, conforme as entradas de `summarize-performance-c643cc5.cjs`. Resultados brutos e logs saem em `qa-artifacts/performance/`.
