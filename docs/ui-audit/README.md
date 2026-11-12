# VECONI — Auditoria de UI/UX (rodada 1)

> Base: `main` em `95497d9` (V231). **Somente auditoria, propostas e protótipos.**
> Nenhum arquivo do app foi alterado. Os protótipos são folhas CSS injetadas apenas no harness local, com dados sintéticos.

## 1. Como foi feito

- **Mapa real das telas** (`js/app.js → views`): `inicio`, `vender`, `clientes`, `crm`, `cobrancas`, `fiados`, `produtos`, `equipe`, `campanhas`, `financeiro`, `catalogo`, `pedidos`, `historico`, `relatorios` (Desempenho), `configuracoes`, `planos` e `cupons`.
  - Estoque e movimentações ficam em modais dentro de Produtos.
  - `fiados` redireciona para Clientes.
  - Despesas fazem parte de Financeiro.
- **Harness** (`harness/`): o `index.html` real, com todos os CSS e JS de produção, sem os módulos Firebase e com uma sessão de proprietária sintética ("Doceria Aurora": 8 clientes, 8 produtos, 41 vendas em 14 dias, Fiado, estoque baixo, variações e um serviço recorrente). Requisições externas são bloqueadas.
- **Não auditáveis offline:** Financeiro (avaliado pela fixture `tests/financial-module.fixture.html`), Catálogo e Equipe, que dependem da nuvem e mostram apenas os estados de erro.
- **Métricas** (`harness/metrics.cjs`, resultado em `metrics-before.json`): tamanhos de fonte, textos abaixo de 11px, alvos de toque, raios, sombras, cores de texto e variantes de botão, por tela, em 390px e 1440px.

## 2. Diagnóstico geral

A VECONI tem uma base visual forte: o cabeçalho escuro com a marca turquesa, a barra inferior, os cards e os fluxos de venda recentes. O problema não é falta de design system. Ele **existe, mas não foi adotado**:

| Medida no código (`css/`) | Valor |
|---|---|
| Arquivos / linhas de CSS | 71 / 11.374 |
| Cores hexadecimais distintas | **2.301** |
| Valores distintos de `font-size` | **194** |
| `border-radius` / `box-shadow` distintos | 69 / 258 |
| `!important` | 407 |
| Tons diferentes de "verde primário" | 12 ou mais |
| Conjuntos de tokens concorrentes | 2 (`--af-*` e `--veconi-*`), com primários diferentes (#0caf82 × #16cdbb) |

O que isso produz na tela renderizada:
- 36 tamanhos de fonte diferentes no app, de 8 a 34px;
- 20 raios de borda diferentes;
- até 29 cores de texto numa única tela;
- 105 textos abaixo de 11px no Início desktop.

Cada tela foi estilizada isoladamente, e é daí que vem a sensação de pouca consistência.

**Acessibilidade (WCAG 2.1 AA):**
- Turquesa da marca com texto branco: **2,0:1**. Verdes dos botões atuais: 2,8–3,4:1 (é preciso 4,5:1).
- Texto secundário #758195: 3,9:1. Âmbar de aviso #c87900 como texto: 3,4:1.
- A fonte Inter é declarada mas **não é carregada** (não há `@font-face`), então cada aparelho mostra uma fonte diferente.

## 3. Problemas priorizados

Legenda de risco: **B** baixo (só CSS), **M** médio (marcação ou texto), **A** alto (toca fluxo sensível).
⚠️ indica área do Codex (Clientes e WhatsApp): só registrado, sem protótipo.

### P0 — usabilidade

| # | Tela | Problema | Por que prejudica | Solução | Benefício | Risco | Arquivos |
|---|---|---|---|---|---|---|---|
| 1 | Global | Ações primárias e textos secundários abaixo do contraste AA | Leitura difícil ao sol, no balcão; exclui baixa visão | Tokens de ação #08786f (5,35:1), texto secundário #64748b (4,76:1), aviso #b45309 | Legibilidade e confiança | B | `css/design-system/*`, folhas por tela |
| 2 | Início, Desempenho, CRM, Financeiro, Clientes⚠️ | Rótulos e ajudas de 8–10px (105 no Início desktop, 49 no Desempenho mobile, 56 em Clientes) | Valores financeiros sem contexto legível | Piso de 12px; ajuda com no máximo 1 linha | Leitura sem zoom | B | `home-mobile.css`, `desktop-dashboard.css`, `performance-dashboard.css`, `crm*.css`, `financial*.css` |
| 3 | Clientes⚠️, Produtos e Vender desktop | Alvos de toque < 40px (43 em Clientes mobile, 32 em Produtos desktop) | Toques errados durante o atendimento | Mínimo de 44px no mobile e 36px no desktop | Menos erro operacional | B | `clientes-mobile.css`⚠️, `produtos-desktop.css`, `desktop-sales.css` |
| 4 | Equipe, Desempenho | Erro técnico exposto ("Cannot read properties of undefined (reading 'listMembers')", "…consulta. offline-audit") | Assusta e não orienta | Mensagem humana + "Tentar novamente"; código só no diagnóstico | Confiança | M | `team-page.js`, `performance-dashboard.js` |
| 5 | Início desktop | A palavra "placeholder" aparece em "Despesas R$ 0,00" | Parece produto inacabado | Remover o texto ou trocar por "Em breve" | Credibilidade | M (JS com cálculo) | `js/desktop-dashboard.js` |

### P1 — inconsistências

| # | Tela | Problema | Solução | Risco | Arquivos |
|---|---|---|---|---|---|
| 6 | Histórico, Desempenho, Planos, Pedidos, Equipe, Cobranças, CRM, Campanhas, Produtos | **Títulos duplicados** e 7 componentes de cabeçalho diferentes (H1 de 21,7 a 34px, com ou sem rótulo em maiúsculas). No mobile, Produtos, Campanhas e CRM já escondem o título interno, e os demais não | **Protótipo 2:** um título por tela, um único estilo | B | CSS de cada página e `desktop.css` |
| 7 | Início, Vender, Produtos, Clientes⚠️ | Barra de **espaço único** ocupa 46–64px sem oferecer escolha | Linha discreta quando há um espaço só (botão de filtros preservado) | B | `spaces.css`, `home-mobile.css` |
| 8 | Vender e Produtos | Produto **sem foto** gasta cerca de 50% do card com iniciais | **Protótipo 3:** faixa compacta | B | `produtos-mobile.css`, `checkout-mobile.css`, `produtos-desktop.css` |
| 9 | Vender × Produtos | O mesmo card de produto mostra o estoque como texto em um e como selo no outro | Um único padrão de estoque (texto + cor semântica) | B | os mesmos |
| 10 | Início, Pedidos, Campanhas, Financeiro | 5–6 cores de ícone por tela, sem significado | Ícone neutro e cor só para risco (falta, baixo, devendo) | B | CSS por tela |
| 11 | Financeiro | "Contas a pagar R$ 0,00" e resultado zero em **vermelho** | Vermelho só para valor negativo ou atrasado; zero em neutro | M | `financial-home-v2.css`/JS de classe |
| 12 | Início | Mesma mensagem 2× ("Custos e lucro em revisão…" + "Confirmando ajustes de troca…") | Uma nota só | M | `home-mobile.js` |
| 13 | Desempenho | "Sem período anterior para comparação" repetido em 4 cards | Mostrar uma vez, na barra de período | M | `performance-dashboard.js` |
| 14 | Clientes desktop⚠️ | 6 botões de topo com 3 estilos (escuro, verde e contorno) | 1 primário + menu "Mais ações" | M | Codex |
| 15 | Barra inferior | A mesma ação aparece como "Escanear" (Vender) e "Ler código" (Produtos) | Um único rótulo | B | `mobile-navigation.js` |
| 16 | Global | Inter não carregada | Hospedar Inter (woff2, subset latino) ou assumir a fonte do sistema | B | `index.html`, `assets/` |

### P2 — refinamento

| # | Tema | Proposta |
|---|---|---|
| 17 | Raios (20 valores) | 8 / 12 / 16 + pill |
| 18 | Sombras (258 no código) | 2 níveis: card e sobreposição |
| 19 | Rótulos em maiúsculas ("VISÃO DO NEGÓCIO", "CENTRAL DE PEDIDOS", "META DESTE ESPAÇO") | Usar só em cabeçalhos de grupo de navegação |
| 20 | Chips de filtro (3 estilos) | Um chip: 36px, pill; selecionado em tom claro de ação |
| 21 | Barra superior desktop | Data como subtítulo em todas as telas (pouco útil). Com o protótipo 2, a barra fica vazia: usar breadcrumb ou busca global |
| 22 | Movimento | Transições de 150ms só em estados (hover/press); respeitar `prefers-reduced-motion` (já existe em parte) |

## 4. Design system proposto (VECONI DS v2)

Tokens em `prototypes/tokens.css`. **Sem nova camada:** a implementação unifica `--af-*` e `--veconi-*` num único conjunto, mantém aliases durante a migração e migra tela por tela.

| Item | Proposta |
|---|---|
| **Cor de marca** | Turquesa `#16cdbb`: logo, foco, progresso e destaques (nunca texto sobre branco) |
| **Cor de ação** | `#08786f` (texto branco 5,35:1); hover `#0d6b64`; link `#08786f` |
| **Texto** | 3 níveis: `#152033`, `#475467`, `#64748b` (todos ≥ 4,7:1) |
| **Semânticas** | sucesso `#0f7a55`, aviso `#b45309`, perigo `#c0262d`, informação `#2563a8`, cada uma com fundo suave |
| **Tipografia** | 12 · 13 · 14 · 16 · 18 · 22 · 28 (7 passos); pesos 450/550/650/750; **mínimo 12px**; números tabulares |
| **Espaço** | 4 · 8 · 12 · 16 · 20 · 24 · 32 |
| **Controles** | 36 (desktop compacto) · 44 (padrão; mínimo no mobile) · 52 (CTA mobile) |
| **Raios** | 8 (chips e controles pequenos) · 12 (cards, campos) · 16 (sheets, destaque) · pill |
| **Elevação** | `shadow-1` (card) e `shadow-2` (sheet, menu) |
| **Botões** | Primário (ação), Secundário (branco + borda), Terciário (texto), Destrutivo. **No máximo 1 primário por região** |
| **Busca** | 44px, raio 12, ícone de 18px, borda, sem sombra |
| **Chips e filtros** | 36px pill; contagem discreta; selecionado = fundo claro de ação + texto de ação |
| **Cards** | Branco, borda de 1px, raio 12, `shadow-1`, padding 16. **Sem card dentro de card**: listas usam divisórias |
| **Indicadores financeiros** | Rótulo 12/550 secundário → valor 18–22/750 tabular → variação 12 semântica com seta → ajuda 12, no máximo 1 linha |
| **Modais e menus** | Sheet com raio 16 no topo, título 16/650, até 90dvh, ação principal fixa no rodapé |
| **Estados** | Carregando = skeleton; erro = frase humana + tentar de novo (sem código); sucesso = toast curto; vazio = 1 ícone + 1 frase + 1 ação |
| **Alertas** | Estoque: em estoque (sucesso) · baixo (aviso) · esgotado (perigo) · sem controle (neutro). Fiado: devendo (perigo) · crédito (informação) · em dia (neutro) |

**Governança:** uma checagem no `scripts/check-project.js` que rejeite `font-size` < 12px e cores hexadecimais novas fora dos tokens nos arquivos alterados.

## 5. Protótipos (antes/depois em 390 e 1440px)

Os três estão fora da área do Codex (Clientes e WhatsApp). São só CSS e não removem elementos interativos.

1. **Início** (`prototypes/p1-inicio.css`)
   - **Celular:** espaço único em linha discreta; meta com menos altura; indicadores sem ícone decorativo e com ajudas em 12px; vendas, itens e clientes num bloco com divisórias; prioridades numa lista com cor só para risco; nota de totais provisórios em estilo informativo.
   - **Desktop:** mesmos tokens e cards.
   - Resultado: no celular, textos < 11px 10 → 1, tamanhos de fonte 10 → 7, sombras 5 → 2. No desktop, textos < 11px 105 → 82 (sobram eixos de gráfico e ranking).
2. **Cabeçalho único** (`prototypes/p2-page-header.css`)
   - **Celular:** o título fica no cabeçalho do app, e o cabeçalho interno guarda só as ações.
   - **Desktop:** um título, um estilo.
   - Resultado: −97px em Pedidos; Histórico e Desempenho com o conteúdo útil mais alto na tela.
   - Pontos abertos: no Desempenho mobile o botão de atualizar fica sozinho numa linha, e a barra superior desktop fica vazia (item 21).
3. **Produto sem foto** (`prototypes/p3-product-no-photo.css`)
   - **Celular:** faixa de 64px com iniciais e favorito.
   - **Desktop:** ladrilho de 48px.
   - Resultado: grade 14% mais curta em Vender (982 → 847px) e 11% em Produtos, com 2 de 8 produtos com foto; textos < 11px em Produtos mobile 8 → 0.
   - Limite: numa linha mista, o card sem foto se estica até a altura do vizinho com foto. No desktop, o ganho é visual (altura −1%).

Reprodução: `node docs/ui-audit/harness/shoot.cjs . <saída> inicio --proto p1-inicio.css`.

## 6. Recomendação

1. **Fundação (P0, só tokens):** unificar os tokens, corrigir o contraste das ações e dos textos e adotar o piso de 12px. Baixo risco, afeta tudo e não depende de layout.
2. **Primeira tela: Início.** É a mais acessada, concentra os textos pequenos e não conflita com o Codex. O protótipo 1 já define o padrão de indicadores e listas que as outras telas vão reaproveitar.
3. Depois: cabeçalho único (protótipo 2), card de produto sem foto (protótipo 3), Desempenho, Financeiro e, por fim, Clientes, quando o Codex concluir.
