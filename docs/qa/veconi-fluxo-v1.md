# VECONI Fluxo V1 — Redesign visual, Fase 1 (tokens, tema, Início)

Branch `claude/veconi-visual-v1`, a partir de `350d2b8` (main com V241). Sem deploy, push ou merge.
Capturas com dados fictícios (fixture local, servidor loopback, sem rede): `docs/screenshots/veconi-fluxo-v1/`.

## Decisões visuais
- **Assinatura "Fluxo"**: linhas curvas que convergem num ponto em V (eco da logo), nós conectados por traços finos e brilho só no nó central. SVG inline com cores do tema, sem imagem de segmento.
- **Cabeçalho do Início**: saudação pelo horário (+ primeiro nome quando a sessão tiver), resumo real do dia ("N vendas hoje, a última às HH:MM"), seletor de espaço e meta diária no mesmo bloco. ~160 px no desktop; os indicadores continuam na primeira dobra (verificado em 360–1440).
- **Meta**: barra como trajetória, com nó luminoso na ponta do progresso. A barra cresce na entrada. Mostra quanto falta, calculado com os mesmos números de antes.
- **Indicadores**: 4 principais (Vendas hoje, Recebido hoje, A receber, Lucro estimado) com número grande e tabular. Clientes ativos e Produtos cadastrados ficam numa faixa secundária compacta. "Em revisão" e "A conferir" têm contorno tracejado, ícone de relógio e cor de alerta, então não dependem só da cor. Os textos continuam exatamente os mesmos.
- **Gráfico**: curva monotônica (não cria picos que os dados não têm), escala em R$, grade tracejada, ponto ativo, tooltip por ponteiro e por teclado (setas). Período sem vendas: estado vazio com ação "Registrar venda", sem curva.
- **Painel financeiro**: cada linha tem ícone e papel escrito (entrada / ainda não pago / fora deste cálculo / resultado). O Saldo previsto explica a fórmula que já existia: "Vendas do período − total a receber".
- **Avisos**: agrupados logo abaixo do cabeçalho, com ícone e rótulo. Nenhum foi removido; o de vendas antigas sem espaço continua com o texto completo.
- **Ações rápidas**: as mesmas rotas, mais "Ver histórico" (rota existente, filtrada por `TeamAccess.canRoute`).
- **Menu lateral**: rótulos de seção em caixa normal, item ativo com nó luminoso e gradiente, hover no ícone. Nenhum módulo ou permissão foi alterado.
- **Tema**: claro premium e escuro azul-petróleo. Alternador no topo (cápsula sol/lua no desktop, botão único de 40 px no celular). A escolha fica em `localStorage["veconi-theme"]`; sem escolha, segue o sistema (e acompanha mudanças).
- **Movimento**: uma única sequência de entrada por sessão: o fluxo se desenha, o pulso percorre a trajetória 2× e para, os cartões sobem em cascata e a meta cresce. Depois disso, só o gráfico reanima ao trocar o período. `prefers-reduced-motion` desliga tudo (verificado: 0 animações rodando). Só CSS/SVG; nenhuma animação infinita.

## Arquivos
- novo `css/veconi-fluxo.css`: tokens `--vf-*` claro/escuro, ponte dos tokens legados no escopo escuro, cabeçalho, menu, Início desktop e mobile, movimento.
- novo `js/veconi-fluxo.js`: tema (aplicado no `<head>`, sem piscar), alternador, arte do fluxo, saudação, curva monotônica e tooltip do gráfico. Não lê nem grava dados do negócio.
- `js/desktop-dashboard.js`: só funções de apresentação (`kpi`, `chart`, `legacyNotice`, `goalCard`, `hero`, `financePanel`, `render`). `aggregate()` e todas as fórmulas ficaram intactas.
- `js/home-mobile.js`: cabeçalho Fluxo no `render()`; `model()` intacto.
- `index.html`: CSS e JS novos, além do botão do tema na topbar.
- `service-worker.js`: arquivos novos na lista de precache. **A versão `CACHE` não foi alterada**; decidir na publicação.
- `public-site.manifest.json`: arquivos novos na allowlist do pacote público.
- `scripts/audit-veconi-fluxo-v1.cjs`: auditoria visual (5 larguras × 2 temas, estado vazio, persistência do tema, foco, movimento reduzido, tooltip por teclado, contraste ≥ 4,5:1 em 56 textos por tema).

## Testes
- `node --test tests/*.test.js` e `tests/*.test.cjs`: mesmo resultado da base `350d2b8` (js 1160/104, cjs 988/100). **Nenhuma falha nova.** As falhas que já existiam vêm de refs e fixtures antigos e afetam igualmente a base.
- `scripts/check-project.js`: lint ok.
- `audit-home-v158`, `audit-desktop-browser` e `audit-mobile-home-clients` falham **igualmente na base** (fixtures desatualizados: `Consignments.mountHome` e espaço autorizado). Não é regressão.
- `audit-veconi-fluxo-v1.cjs`: ok. Sem rolagem horizontal em 360/390/768/1024/1440; alternador visível ≥ 40 px; indicadores na primeira dobra; aviso de vendas antigas presente no desktop.

## Limitações e próximos passos
- O tema escuro cobre o cabeçalho global, o menu, a navegação inferior e o Início. As demais telas mantêm a superfície clara até migrarem para os tokens `--vf-*`. Modais abertos a partir do Início (meta, espaço) também seguem claros.
- Celular: o Início mobile ainda não mostra "Recebido hoje" nem "A receber" como cartões, porque o modelo mobile não os calcula. Incluí-los exige acrescentar cálculo (fora desta fase); "A receber" segue nas prioridades.
- O nome do usuário depende de `FirebaseSession.profile/user`; sem nome, a saudação fica só "Bom dia/Boa tarde/Boa noite".
- Falta validar num Android físico modesto (fluidez da entrada) e num iPhone (barra de status).
- Na publicação, avaliar o aumento da versão do cache do service worker.

---

# Proposta 1B — Geometria em camadas

Mesma estrutura da 1A (organização, quatro indicadores, temas, alternador, gráfico, estados "Em revisão"/"A conferir", avisos, painel financeiro). Cálculos e regras intactos. Muda só a direção artística e três correções de layout.
Capturas 1B: `docs/screenshots/veconi-fluxo-v1/proposta-1b/` (as da 1A continuam em `depois/` para comparar).

## Decisões
- **Assinatura**: as linhas luminosas e os nós saíram. Agora é uma composição isométrica em SVG gerada no `veconi-fluxo.js`: poucos cubos de alturas diferentes, recortados nas bordas do cabeçalho, um pedestal com linhas de camada finas (a influência da impressão 3D) e o V da marca extrudado em turquesa fosco.
- **V em 3D**: o V fica num plano de frente para quem olha (a diagonal que a isometria projeta sem inclinação). Assim ele continua legível como a letra da marca, e a espessura aparece só nas faces de cima, como uma peça impressa. Não há biblioteca 3D, só polígonos.
- **Textura**: cubos "tumbling blocks" em CSS (`--vf-texture`, SVG embutido de ~2 KB) com máscara em gradiente. Some atrás do texto e só aparece de perto, à direita do cabeçalho.
- **Materiais**: o brilho foi removido de toda parte (halo, pulso, nó luminoso do menu e da meta, linha gradiente no topo dos cartões). Agora há sombras naturais (contato curto + difusão longa) e um realce interno de 1 px. A meta usa uma fita com linhas de camada e a ponta em losango.
- **Claro**: fundo gelo, faces brancas e cinza, turquesa só no V e em um cubo.
- **Escuro**: grafite-petróleo, faces muito próximas do fundo e o V num turquesa mais fechado, sem neon.
- **Menu lateral**: o item ativo usa um losango pequeno no lugar do ponto luminoso.

## Correções das capturas
1. **Data no cabeçalho mobile**: agora ocupa uma linha inteira, sem corte, em 360 e em 390. Para isso:
   - botões de 40 px;
   - abaixo de 380 px, o símbolo pequeno do topo some só no Início, porque o V já aparece no cabeçalho da página.
2. **Meta no celular**: virou o bloco de maior peso (material petróleo fosco nos dois temas, com relevo de cubos no canto). Ficou mais compacta: o "Faltam…" cabe numa linha, ao lado de "Editar".
3. **Prioridades**: em 390 px, aparecem a 589 px do topo. Na 1A era 630 px, e antes da 1A, 548 px.
4. **Avisos e informações**: todos preservados, verificados na auditoria.

## Movimento (uma vez por sessão)
Os cubos assentam em cascata (~28 ms entre eles), o V sobe do pedestal e a luz no V acomoda. A meta cresce. Depois disso, nada se move: a auditoria confirma 0 animações rodando após a entrada, no desktop e no celular. Com `prefers-reduced-motion`, nada anima.

## Testes
- `audit-veconi-fluxo-v1.cjs`: ok. Novas verificações da 1B:
  - assinatura geométrica presente e sem linhas da 1A;
  - data numa linha;
  - prioridades na primeira tela;
  - nenhuma animação após a entrada;
  - contraste ≥ 4,5:1 também no celular, incluindo a meta (16 textos por tema), além dos 56 do desktop.
- Unitários: js 1160/104 e cjs 988/100, os mesmos números da base e da 1A. Lint ok.

## Limitações
- A escultura é a mesma em todas as larguras. De 768 a 1023 px ela fica menor, na faixa da saudação.
- Os blocos foram compostos à mão (coordenadas no `veconi-fluxo.js`). Trocar a composição é trocar a lista `BLOCKS`.
