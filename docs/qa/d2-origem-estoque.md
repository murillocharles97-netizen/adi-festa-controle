# D2 — Origem da movimentação de estoque quando há vários espaços possíveis

- Branch `claude/d2-stock-origin`, base `557e365`.
- Independente da correção de produtos legados e da recuperação de testes. **Não publicado.**

## Regra aprovada
- Um espaço ativo **escolhido pelo usuário** vale como destino da movimentação.
- Com vários espaços elegíveis e nenhuma escolha explícita, o app **pede a seleção** antes de registrar. Nunca usa o primeiro espaço.
- Com um único espaço elegível, opera normalmente.

## Causa (V229.1, `14488fa`)
- `stockMovementOrigin` passou a usar `activeId()`. Sem preferência, `activeId()` cai em `spaces[0]`.
- Além disso, `setSpaces()` **grava** esse fallback como preferência de Vendas. Então o valor salvo no aparelho não prova que houve uma escolha.

## Correção (`js/spaces.js`)
- Novo marcador `explicitActiveId`, persistido por usuário e empresa na chave `veconi:space-context:v1:{uid}:{empresa}:explicit`. Só `selectActive` o grava, e é por ele que passam:
  - o seletor de espaço;
  - o picker do Início;
  - Renovações;
  - `selectHome`/`selectSales`.
- A escolha também é registrada quando o usuário seleciona o mesmo espaço que já estava ativo pelo fallback.
- `stockMovementOrigin` decide nesta ordem:
  1. destino informado no formulário;
  2. único espaço elegível;
  3. escolha explícita do usuário;
  4. caso contrário, o erro "Selecione um espaço autorizado para esta movimentação de estoque."
- As demais telas continuam usando o fallback normalmente: listas, Início e vendas, que sempre carregam o `spaceId` explícito da venda.

## Impacto
| Fluxo | Antes | Depois |
|---|---|---|
| Entrada/ajuste de estoque (modais `app.js`, `barcode.js`, `produtos-mobile.js`) | Hidden com o espaço do fallback | `<select required>` até o usuário escolher. Depois da escolha, hidden com o espaço escolhido |
| Produto ou variação nova com estoque inicial, disponível em vários espaços, sem escolha | Gravava no primeiro espaço | Erro pedindo a escolha. O usuário escolhe o espaço no seletor e salva de novo |
| Empresa com um espaço ou produto restrito a um espaço | Normal | Normal |
| Vendas, cancelamentos, pedidos online | `spaceId` da venda | Inalterado |
| Aparelhos que já têm o fallback gravado (V229.1+) | Usavam o fallback | Pedem a escolha uma vez, porque não existe o marcador explícito |
| Movimentações existentes | — | Não são lidas nem reescritas |

- **Rules, Functions e dados:** nada muda.
- **Ponto de atenção para homologação:** na criação de produto com estoque inicial em empresa com vários espaços, a mensagem aparece no salvamento. Sugestão futura: um seletor no próprio formulário. Não incluído, para manter a correção mínima.

## Testes
- `tests/stock-origin-explicit-space.test.cjs` (7 testes):
  - sem escolha, pede a seleção;
  - o fallback gravado não conta como escolha;
  - a escolha explícita vale após reabrir, inclusive a do mesmo espaço do fallback;
  - o destino do formulário vence e não altera a escolha global;
  - um único espaço opera sem perguntar;
  - o histórico é preservado;
  - produto novo com estoque inicial exige a escolha.
- **Na base `557e365`, 4 dos 7 falham**, o que prova que os testes pegam o defeito.
- `legacy-stock-space` (V176): os 3 que falhavam na base passam.
  - O teste "owner confirma destino explícito…" foi ajustado à decisão: uma seleção explícita em Vendas agora vale.
- `global-spaces-v1`: a asserção que exigia o espaço padrão sem escolha foi trocada pela regra aprovada (pede a escolha; com `selectHome` explícito, usa o escolhido).
- **Suíte completa:** as 3 falhas do V176 foram corrigidas e não há falha nova. A outra falha do `global-spaces-v1` é a preexistente regex de `?v=`.

## Publicação (não feita)
- Só o frontend: `js/spaces.js`.
- Exige o bump do cache do SW e o `?v=` de `spaces.js` no `index.html`, que é arquivo compartilhado; o bump tem de ser combinado.
- Rollback: reverter o commit.
