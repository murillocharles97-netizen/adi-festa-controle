# Revisão independente: candidata visual VECONI 1A + 1B + 1C

**Pedido ao revisor (Codex)**: revisar a candidata visual completa antes da publicação. Ela não foi publicada nem mesclada. Não publique, não faça merge e não altere a versão do service worker.

## Onde está
- Branch: `claude/veconi-visual-v1` (local).
- Base: `350d2b8` (main com V241).
- Commits da candidata:

| Etapa | Commit | O que é |
|---|---|---|
| 1A | `ed218dd` | Tokens, tema claro e escuro, alternador e Início redesenhado |
| 1B | `c7c0a8e` | Assinatura "geometria em camadas", aprovada pelo usuário |
| 1C | `d1e6035` | Vender, Clientes, Produtos e Financeiro nos dois temas |

Para ver tudo: `git diff 350d2b8..claude/veconi-visual-v1 --stat`.

## Arquivos de código alterados
- `css/veconi-fluxo.css`: todo o CSS novo.
  - Tokens, Início e telas 1C desenhados à mão.
  - O bloco entre `/* @veconi-dark-bridge:start */` e `:end` é gerado.
- `js/veconi-fluxo.js`: tema, alternador, arte SVG e marcadores `vf-area-1c`, `vf-dark-1c` e `data-vf-route` no `<html>`. Não lê nem grava dados do negócio.
- `js/desktop-dashboard.js` e `js/home-mobile.js`: só apresentação do Início. `aggregate()` e `model()` estão intactos.
- `index.html`, `service-worker.js` e `public-site.manifest.json`: só a inclusão dos dois arquivos novos, na 1A. A versão `CACHE` não foi alterada.
- `scripts/build-veconi-dark-bridge.cjs`: gerador da ponte de cores, que roda em tempo de desenvolvimento.
- `scripts/audit-veconi-fluxo-v1.cjs` e `scripts/audit-veconi-telas-1c.cjs`: auditorias visuais com fixtures locais.

## Como reproduzir
```
node scripts/build-veconi-dark-bridge.cjs            # deve gerar ~1760 regras, sem diff se o CSS legado não mudou
node scripts/audit-veconi-fluxo-v1.cjs <saida>        # Início: 5 larguras × 2 temas, movimento reduzido, contraste
node scripts/audit-veconi-telas-1c.cjs <saida>        # 4 telas × 2 temas × 390/1440 + modais
VF_EMPTY=1 VF_MODALS=0 node scripts/audit-veconi-telas-1c.cjs <saida>
VF_MODALS=0 VF_W=360,768,1024 node scripts/audit-veconi-telas-1c.cjs <saida>
node --test tests/*.test.js; node --test tests/*.test.cjs; node scripts/check-project.js
```
As falhas dos testes unitários já existem em `350d2b8`, com os mesmos nomes (fixtures e refs antigos).

## Onde olhar com mais atenção
1. **Gaveta de venda no desktop**: o carrinho mostra só "Continuar venda", e o pagamento mostra só "Concluir venda". A 1C mexeu no layout de `.desktop-checkout-fields` e houve uma regressão corrigida durante o trabalho; a auditoria tem uma guarda.
2. **Botão principal**: agora é turquesa com texto escuro em todas as quatro telas. O estado de erro `#finish-sale[data-sale-state="error"]` foi restaurado para vermelho. Vale procurar outros estados semânticos que usem `.btn-primary` e possam ter perdido a cor.
3. **Ponte gerada**:
   - escopo só em `html.vf-dark-1c` (escuro) e `html.vf-area-1c:not(.vf-dark-1c)` (claro, só contraste);
   - confirmar que outras telas, como CRM e Configurações, não mudam;
   - confirmar que os cartões de banco (`.vac-card`) mantêm as cores.
4. **Estados profundos não capturados**: perfil do cliente, histórico do produto, subpáginas do Financeiro (contas, cartões, faturas, fluxo), assistente de pagamento de fatura e modais de importação.
5. **Desempenho**: o CSS ficou com cerca de 330 KB, sendo uns 210 KB da ponte gerada. Comprimido, fica em torno de 35 KB. As animações acontecem só uma vez, na entrada do Início, e respeitam `prefers-reduced-motion`.
6. **Acessibilidade**:
   - foco visível nos campos;
   - contraste de 4,5:1 auditado nas combinações capturadas;
   - alternador de tema com `aria-pressed`.
7. **Privacidade**: o repositório é público. As capturas usam só dados fictícios ("Cliente QA", "Item QA", "Espaço Demonstração", "Empresa QA"). Vale conferir se nenhum dado real escapou.

## O que não deve ter mudado
Regras de negócio, cálculos, validações financeiras, sincronização, Firebase Functions, Firestore Rules, checkout, numeração e status. Qualquer diff fora dos arquivos listados acima é um achado.
