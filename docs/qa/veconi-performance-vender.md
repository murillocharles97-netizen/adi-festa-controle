# VECONI — Fase 2 de performance de Vender

Base V242.2, commit `65ea4bb`, conferido na `main`. Candidata local na branch `codex/veconi-performance-selling`. O ensaio usa dados fictícios em origens de loopback e Firestore Emulator.

## Causa e implementação

Na base, a tela convertia todos os produtos em cartões HTML, imagens, controles e ícones antes da primeira interação. Buscar ou ordenar percorria a grade, resolvia novamente cada ID na lista de produtos e movia os nós durante a ordenação. Um catálogo grande também aumentava o trabalho de atualização dos indicadores de quantidade do carrinho.

A grade agora monta até **36 cartões de início**. **Mostrar mais produtos** acrescenta o lote seguinte, usando os mesmos cartões e o estilo V242. A busca, o filtro e a ordenação partem dos dados de todo o catálogo disponível no espaço. Os índices de variações, IDs, texto normalizado e vendas são locais à visualização. A montagem e a navegação usam o mesmo conjunto completo de dados. A busca encontra, por exemplo, um SKU ou nome de variante cujo cartão ainda não existe no DOM.

Ao voltar à tela no mesmo contexto, o catálogo restaura quantidade de itens abertos, filtros e rolagem. Um lote novo recebe as quantidades atuais do carrinho. O leitor e o atalho de repetir venda acionam a seleção pelo ID e passam pela lógica de seleção existente, com disponibilidade e estoque verificados. No desktop, uma atualização dos produtos passa a atualizar grade, recentes e filtros no lugar. A apresentação do carrinho, que pode conter campos preenchidos, continua montada. Ao concluir uma venda, a UI atualiza os cartões a partir da base já gravada.

A escolha foi **renderização progressiva com ação explícita**. Append preserva os cartões anteriores, posicionamento, toque e navegação por teclado. Uma janela virtual exigiria lidar com alturas variáveis, foco, favoritos, modais e restauração de rolagem. O custo desta opção aumenta se o usuário carregar muitos lotes sucessivos. Selecionar pelo nome ou código mantém a grade pequena.

## Medições

As 36 execuções na V242.2 e as 36 na candidata concluíram sem falhas. A tabela mostra medianas e intervalos observados com 2.006 produtos no mobile claro. Cada linha tem três amostras por versão.

| Medida | V242.2 | Candidata | Variação |
| --- | ---: | ---: | ---: |
| Primeira abertura | 12.463 ms (12.247–12.665) | 507 ms (496–534) | −95,9% |
| Segunda abertura | 10.900 ms (10.849–11.249) | 422 ms (392–444) | −96,1% |
| Foco no campo após abrir | 58 ms (55–98) | 32 ms (22–32) | −44,8% |
| Busca com resultado | 1.204 ms (1.194–1.230) | 233 ms (226–324) | −80,6% |
| Busca sem resultado | 886 ms (827–902) | 206 ms (206–220) | −76,7% |
| Selecionar e incluir no carrinho | 1.124 ms (992–1.144) | 74 ms (67–80) | −93,4% |
| Abrir o carrinho | 729 ms (713–730) | 191 ms (190–196) | −73,8% |
| Remover do carrinho | 1.126 ms (1.112–1.167) | 60 ms (60–60) | −94,7% |
| Finalização fictícia, recibo e gravação | 3.774 ms (3.733–3.901) | 1.637 ms (1.592–1.644) | −56,6% |
| Cartões na primeira abertura | 2.006 | 36 | −98,2% |
| Nós em `#app` na primeira abertura | 40.600 | 2.952 | −92,7% |

Na primeira abertura do mobile claro, o CDP registrou 8.741 → 259 ms em cálculo de estilo e layout, 2.862 → 185 ms em script e 5 → 1 tarefas de pelo menos 50 ms. A tarefa mais longa caiu de 5.847 para 295 ms. O cálculo de estilo e layout foi o maior custo medido.

Na base grande, as primeiras aberturas no mobile escuro passaram de 12.793 para 526 ms. No desktop, passaram de 1.638 para 83 ms no claro e de 1.741 para 81 ms no escuro. Na base média, as quatro medianas caíram entre 81% e 82%. Com 31 produtos, as diferenças da primeira abertura ficaram entre −37 e +17 ms. A busca com resultado no mobile claro pequeno variou de 205 ms (178–288) para 262 ms (212–371), com sobreposição dos intervalos.

Chrome headless no Windows, 1440 × 950 no desktop, 390 × 844 no mobile, CPU 4× mais lenta e perfil de 80 ms/200 kB/s na rota mobile. Os volumes de 31 e 2.006 produtos vêm da auditoria. A base média acrescenta um recorte de 406 produtos. Ambas as versões usam a mesma fixture com códigos, marca e palavras-chave sintéticas e a mesma distribuição de vendas. O shell inicial é carregado antes do cronômetro, com a limitação de rede aplicada ao entrar em Vender. O cronômetro espera duas oportunidades de pintura. O custo de autenticação fica fora deste estudo. Os 7.275 ms da auditoria anterior dão contexto histórico. Os percentuais usam a V242.2 executada no mesmo roteiro da candidata. [Tabelas completas](veconi-performance-vender-metricas.md).

A ação **rolagem e acesso aos itens seguintes** na base V242.2 leva ao cartão 72 que já estava montado. Na candidata, inclui rolar e solicitar a montagem de mais 36 cartões. No mobile claro grande, o trecho passou de 114 para 299 ms. Na base pequena, ambos os ensaios rolam até o último cartão. Tempos de interação têm a latência introduzida pelo harness e o debounce existente na busca. Os nós são contados em `#app` e incluem o seletor oculto de clientes quando a massa é grande.

## Regressão funcional

- A matriz de navegação abre Vender duas vezes por contexto, foca a busca, procura por nome e código, valida o estado vazio, percorre a lista, seleciona o produto, abre e remove do carrinho e conclui uma venda fictícia. Nas bases com mais de um lote, a candidata restaura 72 produtos e a rolagem ao voltar. As repetições alternam dinheiro, Pix e cartão, verificam valor, espaço, estoque e quantidade de vendas.
- A matriz funcional adicional cobriu desktop e mobile claro/escuro. O leitor adicionou um produto fora do lote. Um produto de outro espaço ficou fora da pesquisa e da venda. O produto esgotado foi encontrado, mas não entrou no carrinho. Filtros de categoria e de marca/favoritos, recentes no mobile, busca por variação, desconto, Fiado e atualização de estoque passaram. O Fiado usa adaptador de confirmação no laboratório e verifica saldo, valor, variante e estoque após concluir.
- Homologação de serviço no Firestore Emulator em 360 e 390 px. Cada cenário confirmou três corridas únicas, três entradas e zero movimentos de estoque. Os totais conferidos por cenário foram R$ 99,50 de receita, R$ 52,15 de custo e 33,5 km. A rotina reapresentou a fila offline após reiniciar, perdeu a primeira resposta simulada e confirmou por recibo sem duplicar. A suíte de serviço, com casos de combustível estimado, passou 29/29.
- A suíte direcionada teve 65/78 aprovações na base e na candidata. As 13 falhas têm os mesmos nomes, no harness de recuperação de venda original que extrai código e encontra `checksumValue` ausente. O browser audit legado de desktop falha nos dois por uma dependência `MESSAGE` ausente da fixture. O audit mobile existente passa nos dois. O lint e o pacote público de 279 arquivos passaram. Os casos novos usam a fixture de performance com dependências da página.
- O diff de produção se limita ao catálogo e às suas ligações de interface em `js/checkout.js`, `js/checkout-mobile.js`, `js/desktop-sales.js`, `js/app.js`, `js/barcode.js` e `css/checkout-mobile.css`. Pipeline de venda, regras de estoque e cálculo, sincronização, Firebase Functions e Rules permanecem com os contratos da V242.2. As três rejeições históricas não foram consultadas ou tocadas. A interface foi testada em Chromium, com serviço transacional no emulador e pagamentos fictícios.

## Capturas, riscos e decisão

Capturas de 2.006 produtos estão em `qa-artifacts/performance/vender-desktop-light.png`, `vender-desktop-dark.png`, `vender-mobile-light.png` e `vender-mobile-dark.png`. O laboratório simula rede e CPU e não mede um Android físico, câmera ou adquirente. A abordagem mantém mais DOM conforme os lotes são solicitados. Um histórico muito grande ainda exige agregação de vendas por espaço. Esses custos ficam explícitos na matriz.

**GO técnico para preparar a publicação.** Ao abrir a etapa de release, incrementar a versão e a identidade de cache conforme a convenção do PWA. Validar a atualização de uma instalação V242.2 e a reabertura offline com IndexedDB, preferências e fila sintética preservados. Em caso de regressão crítica após uma publicação autorizada, usar um novo commit revertendo a mudança e uma nova identidade de cache.

## Reprodução

```powershell
$env:PERF_ROUNDS = '3'
node scripts/audit-performance-selling.cjs --baseline
node scripts/audit-performance-selling.cjs
node scripts/summarize-performance-selling.cjs
$env:PERF_ROUNDS = '1'
$env:PERF_VOLUME = 'medium'
node scripts/audit-performance-selling.cjs --functional
$env:PERF_VOLUME = 'large'
node scripts/audit-performance-selling.cjs --captures
npm run test:service-sync
```

Para as corridas offline, repetir `scripts/homologate-flexible-services-v238.cjs` com a configuração `firebase.v240-qa.json`, projeto `demo-veconi-v238-homologation` e somente Firestore Emulator. Os JSON de navegação, interações e capturas ficam em `qa-artifacts/performance`. Os logs de comparação ficam em `qa-artifacts/selling`.
