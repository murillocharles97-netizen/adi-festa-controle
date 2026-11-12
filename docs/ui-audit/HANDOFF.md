# Handoff — VECONI Design System v2 (branch `claude/ui-audit`)

Estado em 12/11/2026. Branch **local**, sem push, merge ou deploy.
Base: `95497d9` (V231, "Refine mobile controls across sales, products and customers").
Auditoria completa, princípios do DS v2 e protótipos: [`README.md`](README.md).

## Aprovações

| Item | Situação |
|---|---|
| Direção do Design System v2 | Aprovada |
| Refinamento do Início | Aprovado |
| Correções da Etapa 3 (erros técnicos, placeholder, zeros vermelhos) | Aprovadas |
| Protótipo 2b — título único por tela | Aprovado no conceito; **implementação adiada** |
| Protótipo 3 — produtos sem foto | **Não implementar** ainda |

## Commits (10, na ordem; 9 de produto e testes e 1 deste handoff)

| Commit | O quê | Arquivos |
|---|---|---|
| `6996141` | Auditoria UI/UX, DS v2 proposto, protótipos e harness | `docs/ui-audit/**` |
| `db616eb` | Fundação: tokens unificados, cores AA, Inter própria | `assets/fonts/inter-latin-wght-normal.woff2`, `assets/fonts/Inter-OFL.txt`, `css/design-system/tokens.css`, `css/design-system/veconi-theme.css`, `tests/veconi-visual-system.test.js` |
| `4dbd2ab` | Tokens de tipo em px (a raiz do app é 14 px) | `css/design-system/tokens.css` |
| `fc9a7ac` | Início refinado sobre o DS v2 | `css/home-mobile.css`, `css/desktop-dashboard.css`, `js/home-mobile.js`, `js/desktop-dashboard.js` |
| `7146e53` | Erros do SDK em português (Equipe, Desempenho, Catálogo) | `js/utils.js`, `js/team-page.js`, `js/performance-dashboard.js`, `js/online-store-ui.js`, `tests/friendly-error.test.js` |
| `f362930` | Despesas: "Não incluídas" em vez de `R$ 0,00 placeholder` | `js/desktop-dashboard.js`, `css/desktop-dashboard.css` |
| `283917e` | Zeros neutros no resumo do Financeiro | `js/financial-ui.js`, `css/financial-home-v2.css` |
| `0a04754` | Contador de prioridades com contraste AA | `css/home-mobile.css` |
| `27a2a9f` | Teste de regressão visual e protótipo 2b | `scripts/audit-ui-ds-v2.cjs`, `docs/ui-audit/harness/harness.cjs`, `docs/ui-audit/prototypes/p2b-page-header.css` |
| (este) | Handoff e capturas | `docs/ui-audit/HANDOFF.md`, `docs/ui-audit/captures/*.webp` |

Total dos 9 primeiros: 29 arquivos, +2217 / −239.

**Nenhuma mudança em:** Clientes, WhatsApp, Receber, regras ou cálculos financeiros, estoque, checkout, sync, permissões, Functions, Firestore Rules, índices, Service Worker, `index.html`, regularização do Fiado.
As mudanças em JS mudam só texto exibido ou classe CSS: o saldo previsto continua `receita − em aberto`, e o valor dos zeros não muda, só a cor.

## Resultados dos testes

| Verificação | Branch | `main` (95497d9) |
|---|---|---|
| `node scripts/audit-ui-ds-v2.cjs` | **10/10** | 2/10 (falha onde este trabalho atua) |
| `npm test` | 1138 testes, 93 falhas | mesmas 93 falhas (preexistentes, incl. teste do SW v136) |
| Lint (`npm test` inclui) | 499 arquivos JS válidos | idem |

O que o `audit-ui-ds-v2.cjs` garante (roda localmente, sem rede e sem Firebase, com dados sintéticos):
- Início em 320/390/430/1440 px: nenhum texto < 12 px, 0 falhas de contraste AA, sem rolagem horizontal, sem erros de página e todos os blocos presentes (meta, métricas, atalhos, 4 prioridades, resumo, filtro; no desktop: 6 KPIs, 8 painéis, 6 ações, sem "placeholder").
- Buscas compactas da V231: Vender 46 px, Produtos 48 px, Clientes 48 px.
- Inter própria carregada e em uso.
- Equipe e Desempenho mostram texto para o comerciante e o erro continua visível; a mensagem do servidor no Catálogo é preservada.
- Financeiro: zero neutro, valores diferentes de zero continuam vermelhos.

Métricas da auditoria: falhas de contraste no app todo caíram de 464 para 284; no Início, textos < 12 px caíram de 18 para 0 (celular) e de 120 para 0 (desktop). Nas outras 28 combinações de tela e largura, a estrutura ficou idêntica (alturas, número de controles e texto).

## Integração com a V232 (para o Codex)

Na data deste handoff, a branch está 9 commits à frente e 0 atrás do último `origin/main` buscado, com `git merge-tree` sem conflitos. A V232 chegou depois: **refaça o rebase e a checagem de conflitos sobre a V232**. Arquivos com mais chance de conflito: `css/home-mobile.css`, `css/desktop-dashboard.css`, `js/desktop-dashboard.js`, `js/home-mobile.js` e `js/utils.js`, porque a V232 pode mexer neles.

### 1. Parâmetros de versão (`?v=`)
Sem incrementar o `?v=`, aparelhos com cache HTTP podem continuar com o CSS/JS antigo. Valores na base `95497d9`:

| Arquivo | Onde | `?v=` atual |
|---|---|---|
| `css/design-system/tokens.css` | `index.html` | 94 |
| `css/design-system/veconi-theme.css` | `index.html` | 123 |
| `css/home-mobile.css` | `index.html` | 158 |
| `css/desktop-dashboard.css` | `index.html` | visual-pr3-1 |
| `css/financial-home-v2.css` | `index.html` | 132 |
| `js/utils.js` | `index.html` | 175 |
| `js/desktop-dashboard.js` | `index.html` | 224 |
| `js/team-page.js` | `index.html` | 228 |
| `js/home-mobile.js` | `index.html` | 22913 |
| `js/online-store-ui.js` | `index.html` | 177 |
| `js/performance-dashboard.js` | `index.html` | 224 |
| `js/financial-ui.js` | `js/app.js` (`loadScript("./js/financial-ui.js?v=163")`) | 163 |

Use o rótulo de release que a V232 adotar. Na base, só o `index.html` carrega `tokens.css` e `veconi-theme.css`; os apelidos `--af-*` têm valor de reserva e funcionam mesmo numa página que carregue só `tokens.css`.

### 2. Service Worker
- Troque `CACHE` (hoje `veconi-v231-mobile-controls-v1`) pelo nome da V232, para limpar o cache antigo na ativação.
- CSS e JS são `network-first` (`fetch` com `no-store`) e caem no cache com `ignoreSearch` quando offline. Com isso, a atualização chega online mesmo sem mudar `ARQUIVOS`. Os arquivos alterados aqui já estão em `ARQUIVOS` ou carregam por `index.html`.
- Se a V232 tiver um teste que fixa o nome do cache ou a lista de arquivos, atualize-o junto (existe hoje uma falha preexistente no teste do SW v136).

### 3. Cache da fonte Inter
- Adicione ao precache: `ARQUIVOS.push('./assets/fonts/inter-latin-wght-normal.woff2');`
  - Fonte (`destination: font`) usa o ramo `cache-first` do SW: online ela é baixada e guardada no primeiro uso mesmo sem precache, mas **o primeiro uso offline** cai no fallback. Com o precache, a fonte fica disponível offline desde a instalação.
- A URL da fonte no `@font-face` (`tokens.css`) não tem `?v=`. O arquivo deve ser tratado como imutável: se a fonte mudar, **troque o nome do arquivo**, não o conteúdo.
- Opcional: `<link rel="preload" href="./assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>` no `<head>` do `index.html`, para evitar a troca visível da fonte no primeiro carregamento.
- `font-display: swap` + face `"VECONI Inter Fallback"` (Arial/Helvetica/Roboto com métricas ajustadas) evitam texto invisível e salto de layout.
- Licença: `assets/fonts/Inter-OFL.txt` deve acompanhar o arquivo.

### 4. Revisão de código sugerida
- `js/utils.js` → `Utils.friendlyError(error, fallback)`: só reescreve texto em inglês do SDK (por código: `permission-denied`, `unauthenticated`, `unavailable`, `deadline-exceeded`, `resource-exhausted`). Mensagens em português do servidor passam intactas. Erros continuam aparecendo; `team-page.js` também registra `console.warn("[TEAM] load failed", {code})`.
- `js/financial-ui.js`: adiciona a classe `is-zero` quando o valor é 0; não toca em cálculo.
- `js/desktop-dashboard.js` / `js/home-mobile.js`: atributo `data-state` no aviso de câmbio (`warning` para indisponível, histórico ou erro), para que a falha nunca pareça só informativa.

## Pendências visuais (próxima sessão)

1. **Protótipo 2b — título único** (aprovado no conceito, adiado). CSS pronto em `prototypes/p2b-page-header.css`. Ao implementar: preencher a barra superior do desktop (título 22 px e descrição da página; hoje o `app.js` só define a descrição no mobile, e Produtos mostra a data) e levar o botão "Atualizar análise" para dentro do cartão de filtros do Desempenho (conferido em 320 px sem sobrepor o seletor de período).
2. **Protótipo 3 — produtos sem foto**: não implementar até nova aprovação.
3. Desktop, Top produtos: nomes cortam um pouco mais com a Inter; avaliar duas linhas ou tooltip.
4. Gráfico de Desempenho: o texto dos eixos escala com o `viewBox` do SVG; trocar por rótulos em HTML ou tamanho fixo.
5. Migrar as demais telas para a escala do DS v2, uma por vez (Clientes só depois de terminar o trabalho do Codex). As falhas de contraste restantes (284) estão fora do Início.
6. Clientes muda de aparência só pelos tokens globais (cores e raios), sem mudança de layout: confirmar com o Codex após a V232.

## Capturas

Início antes (`main`) × depois (DS v2), dados sintéticos idênticos:
- [320 px](captures/inicio-antes-depois-320.webp) · [390 px](captures/inicio-antes-depois-390.webp) · [430 px](captures/inicio-antes-depois-430.webp) · [1440 px](captures/inicio-antes-depois-1440.webp)

Protótipo 2b (não aplicado): [mobile 320 px](captures/p2b-m320.webp) · [desktop Desempenho](captures/p2b-desktop-relatorios.webp) · [desktop Produtos](captures/p2b-desktop-produtos.webp)

Para regerar as capturas "depois":
```bash
node scripts/audit-ui-ds-v2.cjs --shots /caminho/para/saida
```

## Como retomar

```bash
cd /home/user/adi-festa-ui-audit
git log --oneline 95497d9..claude/ui-audit
node scripts/audit-ui-ds-v2.cjs
npm test
```
O harness (`docs/ui-audit/harness/`) serve o `index.html` real sem `js/firebase/*`, com sessão sintética de dono e dados de `seed.js`; ele bloqueia toda requisição fora de `127.0.0.1`.
Observação: o container tem Inter instalada no sistema; em aparelhos reais a fonte vem do arquivo próprio (`VECONI Inter`).
