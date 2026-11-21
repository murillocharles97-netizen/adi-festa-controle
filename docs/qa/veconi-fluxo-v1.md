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
