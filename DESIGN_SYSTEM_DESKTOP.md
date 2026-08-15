# Adi Festa Desktop UI System V1

O Desktop UI System V1 é a fonte oficial de estilos para telas desktop do Adi Festa. Ele aproxima o produto desktop da identidade mobile sem copiar o layout compacto do celular e sem alterar regras de negócio.

> **Regra obrigatória:** um novo componente desktop deve primeiro verificar se existe equivalente no Design System. Não crie outro input, botão, card, modal ou badge sem necessidade comprovada.

## Arquivos e escopo

- `css/design-system/tokens.css`: tokens globais de cor, espaçamento, tipografia, raios, sombras, alturas e foco.
- `css/design-system/desktop.css`: componentes oficiais e aliases de migração. Todo o arquivo visual está limitado a `@media (min-width: 768px)`.
- `tests/desktop-design-system.fixture.html`: galeria local de desenvolvimento e regressão visual.

O mobile continua sob os estilos existentes. Classes `af-*` podem aparecer no HTML compartilhado, mas suas regras de layout desktop só são ativadas a partir de 768 px.

## Auditoria inicial

A base possuía implementações equivalentes e concorrentes, entre elas:

- botões: `.btn`, `.primary-button`, `.campaign-details-button`, `.product-*`, `.crm-icon-button` e botões locais de toolbar;
- cards: `.panel`, `.metric-card`, `.entity-card`, `.client-kpi`, `.campaign-admin-card`, `.coupon-card` e cards de página;
- formulários: `.field`, `.form-grid`, controles diretos por módulo e campos do wizard;
- modais: `.modal-box`, variações de largura e estruturas específicas por tela;
- filtros, tabs, badges, empty states e menus com cores, raios e alturas próprios.

O inventário estático da base anterior ao Design System encontrou estas famílias de seletores legados:

| Família visual | Seletores distintos encontrados |
| --- | ---: |
| Botões | 21 |
| Cards e painéis | 62 |
| Modais e diálogos | 20 |
| Campos e estruturas de formulário | 24 |
| Badges, status e pills | 51 |
| Tabs | 3 |
| Chips e filtros | 23 |
| Empty states | 21 |
| Toasts e alertas | 5 |
| Loading e skeletons | 5 |
| Menus e dropdowns | 9 |
| Wizards e etapas | 25 |

A contagem considera seletores distintos nos arquivos CSS existentes, excluindo `css/design-system/`. Alguns são partes internas do mesmo componente, mas o volume evidencia a ausência de uma fonte visual única. A V1 consolida essas famílias em componentes oficiais `af-*` e mantém aliases somente onde são necessários para migrar páginas existentes sem tocar em sua lógica.

Os aliases em `desktop.css` permitem a migração mecânica sem reescrever a lógica de cada página. Novos componentes devem usar as classes `af-*` diretamente.

## Tokens

Use somente os tokens `--af-*`. Os grupos principais são:

- cores: `--af-color-primary`, `--af-color-navy`, `--af-color-text`, estados e superfícies;
- espaçamento: `--af-space-1` a `--af-space-8`;
- raios: `--af-radius-sm`, `md`, `lg`, `xl` e `pill`;
- sombras: `--af-shadow-sm`, `md` e `lg`;
- tipografia: `--af-font-xs` a `--af-font-page`;
- controles: `--af-control-height-sm`, `md` e `lg`;
- layout: `--af-page-max`, `--af-page-padding`;
- estados: `--af-focus-ring`, `--af-transition`.

Evite introduzir valores isolados quando a escala existente atende ao caso.

## Estrutura de página

```html
<section class="af-page">
  <header class="af-page-header">
    <div>
      <h2>Produtos</h2>
      <p>Preços, custos e estoque.</p>
    </div>
    <button class="af-button af-button--primary">Novo produto</button>
  </header>
</section>
```

O conteúdo usa a largura central `--af-page-max` e o espaçamento `--af-page-padding`. Páginas internas usam `.af-breadcrumb`.

## Grid e utilidades

- `.af-grid` com `.af-grid-2`, `.af-grid-3` ou `.af-grid-4`;
- `.af-span-2` para campo largo;
- `.af-stack` para fluxo vertical;
- `.af-inline` para ações em linha; `.af-check` e `.af-radio` para opções alinhadas.

Em largura desktop intermediária as grades reduzem colunas automaticamente. Não force largura fixa de formulário.

## Botões

Base: `.af-button`.

- `.af-button--primary`: ação principal verde;
- `.af-button--secondary`: ação neutra;
- `.af-button--ghost`: baixa ênfase;
- `.af-button--danger`: ação destrutiva;
- `.af-button--sm` e `.af-button--lg`: tamanhos;
- `.af-icon-button`: botão de ícone com área oficial de 40×40.

Estados hover, focus-visible, active e disabled são fornecidos pelo sistema.

## Cards e métricas

Use `.af-card` e as partes `.af-card__header`, `.af-card__body` e `.af-card__footer`.

Variações:

- `.af-card--interactive`;
- `.af-card--attention`;
- `.af-card--danger`;
- `.af-metric-card` com `.af-metric-card__icon`.

Evite aninhar cards apenas para criar espaçamento.

## Formulários

```html
<section class="af-form-section">
  <header><h4>Informações</h4><p>Descrição curta.</p></header>
  <div class="af-form-grid">
    <label class="af-field">Nome<input></label>
    <label class="af-field">Categoria<select></select></label>
    <label class="af-field af-field--full">Observação<textarea></textarea></label>
  </div>
</section>
```

Inputs, selects, textareas, datas e números compartilham altura, borda, raio, foco, erro e disabled. Checkboxes e radios usam o acento oficial. Opções em card usam `.af-option-card`; switches usam `.af-switch`.

## Search, filtros, tabs e badges

- busca: `.af-search`;
- chips: `.af-chips` + `.af-chip`;
- tabs: `.af-tabs`;
- badges: `.af-badge` com `--success`, `--warning`, `--danger`, `--info` ou `--neutral`.

O estado ativo usa a mesma cor e hierarquia em todos os módulos.

## Modal

Use `.af-modal` e os tamanhos `--sm`, `--lg` ou `--xl`.

Estrutura:

```html
<section class="af-modal af-modal--lg">
  <header class="af-modal__header">...</header>
  <div class="af-modal__body">...</div>
  <footer class="af-modal__footer">...</footer>
</section>
```

O corpo é a única região rolável. Cabeçalho e rodapé permanecem acessíveis.

## Wizard

Use `.af-wizard` com `.af-wizard__header`, `__steps`, `__content` e `__footer`. Etapas recebem `completed`, `active` ou `future`. O Campaign Wizard V2 é o consumidor de referência.

Em 1366×768 o wizard cabe na viewport e rola somente o conteúdo interno. Formulários condicionais não reservam espaço quando não se aplicam.

## Tabelas, menus e feedback

- `.af-table`: container rolável de tabela;
- `.af-menu`: menu de ações;
- `.af-empty`: estado vazio compacto;
- `.toast` e `.toast-error`: feedback global;
- `.af-skeleton`: carregamento;
- `[data-tooltip]`: tooltip acessível por hover e focus.

## Breakpoints

- mobile: até 767 px, sem redesenho por este sistema;
- desktop: a partir de 768 px;
- desktop intermediário: até 1180 px, grades e wizard reduzem colunas;
- notebook estreito: até 980 px, formulários passam a uma coluna.

Os viewports oficiais de QA são 1024×768, 1280×720, 1366×768, 1440×900, 1536×864 e 1920×1080. A regressão mobile usa 390×844.

## Acessibilidade e performance

- mantenha `label`, `aria-label` e semântica nativa;
- todos os controles devem funcionar por teclado;
- use `:focus-visible` e contraste de estado;
- respeite `prefers-reduced-motion`;
- componentes visuais não podem adicionar leituras, listeners ou consultas Firebase.
