# V231.1 — auditoria de vendas, estoque e sincronização + produtos legados sem controle de estoque

Base: `557e3650b7d87513fcfd9d7952c831734a8bfa69` (V231.1 publicada). Branch local `claude/v231-audit-stock-legacy`.
Nada foi publicado, nenhum dado real foi lido ou alterado, nada foi enviado ao GitHub.

## 1. Produtos legados (`controlaEstoque: false` sem `semControleEstoque`)

### Reprodução
- **Carga local normal: não reproduz.** `DB.carregar()` passa por `normalizarParaMemoria`, que já converte
  `controlaEstoque:false` em `semControleEstoque:true`. Testado com o editor real (`ProductImages.openForm`)
  carregando `storage.js` + `produtos.js` no jsdom: a caixa abre desmarcada, e salvar mantém a quantidade e não cria movimento.
- **O documento legado cru chegando ao editor ou ao modelo canônico: reproduz.**
  - Editor: a caixa é marcada por `product.semControleEstoque` apenas → abre **marcada**.
  - Salvar: envia `semControleEstoque:false` → `ProductModel.build` devolve `controlaEstoque:true` (**reativa**).
  - `ProductModel.build` com edição parcial (`d` sem `semControleEstoque`) e `atual = {controlaEstoque:false}`
    também reativava: o ramo simples consultava só `atual.semControleEstoque`. Um `d.controlaEstoque:false` explícito era ignorado.

### Causa raiz
A regra "este produto controla estoque?" tinha duas fontes: `semControleEstoque` (atual) e `controlaEstoque` (legado).
O editor de produto, o assistente de produto variável e o modelo canônico (`functions/src/shared/product-model.js`, carregado também pelo app)
liam **só** `semControleEstoque`. O resto do app (venda, checkout, baixa, catálogo, Functions de venda) já lê as duas.
Assim, o produto só fica correto enquanto o objeto passa pela normalização local antes de chegar ao editor ou ao modelo.

**Limite da evidência:** no código da V231.1 não encontrei um caminho de produção que entregue ao editor o documento sem normalizar.
Os pontos revisados foram `DB.carregar`, `useBusiness`, `reconcileLocalAndCloud`, `applyCloudCollection`, `hydrateOperation`, `stageProductFavorites` e `diffWrites`.
Se o sintoma foi visto em aparelho, convém confirmar a versão do Service Worker desse aparelho no momento.
A correção vale nos dois casos, porque remove a dependência da normalização.

### Correção (3 linhas)
| Arquivo | Mudança |
|---|---|
| `functions/src/shared/product-model.js` | Produto simples: vale primeiro `d.semControleEstoque` (a escolha explícita do editor), depois `d.controlaEstoque`, depois `atual` com as duas marcas. Recorrente: com `atual`, só controla se `controlaEstoque===true` e sem `semControleEstoque`. |
| `js/product-images.js` | A caixa "Controlar estoque" fica desmarcada também quando `controlaEstoque===false`. |
| `js/produtos-mobile.js` | O mesmo no passo 1 do assistente de produto variável. |

Compatibilidade:
- Produtos atuais e produtos novos (`atual = null` → controla) têm o mesmo resultado de antes.
- Serviços continuam sem controle.
- A quantidade nunca é tocada, porque o editor já remove `estoqueAtual` em edições e `Produtos.salvar` preserva as projeções de estoque.
- Nenhum movimento é gerado.
- Na Function `product-spreadsheet-service`, o modelo só é usado em criação (`atual = null`), então o comportamento do servidor não muda e **não é preciso publicar Functions**.

### Testes de regressão — `tests/legacy-stock-control.test.cjs` (6)
1. Modelo: legado em edição parcial, com `controlaEstoque:false` explícito, e recorrente legado → continua sem controle.
2. Modelo: produtos atuais e novos, escolha explícita (ligar e desligar), serviço e recorrente → sem mudança de comportamento.
3. Editor com documento legado cru → caixa desmarcada; o envio leva `semControleEstoque:true` e não leva `estoqueAtual`.
4. Editor + `storage.js` + `produtos.js` reais, com 3 formatos legados → continua sem controle, quantidade 3 e 0 movimentos.
5. Produto atual continua controlado. O legado só volta a controlar marcando a caixa: quantidade preservada e 0 movimentos.
6. O assistente de produto variável usa as duas marcas.

Na base 557e365, os testes 1, 3 e 6 **falham**; com a correção, os 6 passam.

## 2. Auditoria técnica da V231.1

Revisei os commits `3940f91`, `d891dd1`, `8f04211`, `6350bb3`, `5db5afa` e `557e365`.

| Fluxo | Situação | Evidência / observação |
|---|---|---|
| Venda normal | OK | Testes de checkout e recuperação verdes. A baixa só ocorre com as duas marcas de controle checadas (cliente e `operational-commit-service`). |
| Produto recorrente | OK | O servidor agora exige variação também para recorrente com `hasVariations` (`hasVariants`), e o agregado de variações também é validado. |
| Vencimento personalizado | OK (somente leitura) | Coberto por `checkout-sale-original-recovery` (modo `custom`). Não mexi em Renovações nem em assinaturas. |
| Venda offline / reconexão | OK | O pacote fica na fila (IndexedDB). Uma venda retida por pendência de estoque só é reconhecida com o recibo `applied` do servidor + `verifySaleQueueCommit` + o original intacto (`assertOriginal`). |
| Reabertura do app | OK | A resolução `queued_sale_receipt` fica gravada e é revalidada por hash/checksum do pacote. A classificação passa a `resolved`, sem nova consulta ao servidor. |
| Baixa de estoque | OK, com ressalva (R1) | O servidor regrava `estoqueAnterior/estoqueNovo` dos movimentos de venda contra o snapshot do servidor e exige o espaço da venda e o sinal correto. |
| Idempotência | OK | `operationId` único, recibo antes de reenviar, pacote retido nunca é reenviado automaticamente. `pendingIds` libera o documento oficial só depois da resolução verificada. |
| Histórico × financeiro × estoque | OK, com ressalvas (R2, R3) | Veja abaixo. |

### Achados
- **A1 (corrigido)** — produtos legados sem controle de estoque (seção 1).
- **R1 (médio, operacional)** — o movimento local do aparelho guarda saldos calculados no aparelho até o pull trazer o documento oficial.
  Quem olha o histórico de estoque no aparelho original antes de sincronizar pode ver saldos diferentes dos da nuvem.
  Isso não afeta a quantidade aplicada no servidor, que vem do delta.
- **R2 (médio, operacional)** — enquanto existir uma venda retida em revisão, `assertSaleQueueDependencies` bloqueia **novas vendas do mesmo produto** naquele aparelho.
  É intencional, porque evita uma baixa dupla, mas o vendedor precisa ser orientado a resolver em Sincronização → Ver detalhes.
- **R3 (baixo)** — `recognizeSaleHeldByStock` não reconhece automaticamente vendas com `payments`/`balanceAdjustments` (fiado).
  Essas continuam exigindo revisão manual, por desenho.
- **R4 (baixo, inalcançável hoje)** — a checagem de conflito de estoque de recompensa (`sync.js` ~3542 e `commercial-commit-engine.js` ~1022) olha só `semControleEstoque`.
  Para produto legado sem controle, nenhum delta de estoque é gerado (`campaign-engine-v2` checa as duas marcas), então não há efeito. Fica registrado para alinhar no futuro.
- **R5 (baixo)** — documentos legados na nuvem continuam só com `controlaEstoque:false`.
  Uma edição só envia os campos alterados, então `semControleEstoque` não é gravado. Todos os leitores tratam as duas marcas, então não há efeito funcional.

## 3. Resultados de testes
- Suíte unitária completa (`node --test tests/*.test.js tests/*.test.cjs`): **2182 testes, 2040 ok, 141 falhas**.
- Base 557e365 no mesmo ambiente: 2176 testes, 2034 ok, **141 falhas**.
- **O conjunto de falhas é idêntico**, comparado nome a nome, inclusive nos subtestes. Ou seja, 0 regressões.
- Arquivos direcionados: `checkout-sale-original-recovery` 15/15, `sync-automatic-recovery` 12/12, `product-variations` 9/9, `mobile-products-selling-fixes` 6/6, `storage-bootstrap-performance` 3/3, `product-spreadsheet-v2` 6/6, `legacy-stock-control` 6/6.
- **Emulator: não rodado.** A mudança não toca Rules, índices nem caminhos de Function além da criação por planilha, coberta por teste unitário com `atual = null`.

## 4. Publicação (não feita) e rollback
Para publicar só o frontend:
- subir o `CACHE` do `service-worker.js`;
- adicionar `?v=` em `index.html` para `product-images.js`, `produtos-mobile.js` e `functions/src/shared/product-model.js` (este hoje está sem `?v=`).

**Atenção:** `index.html` e `service-worker.js` são arquivos compartilhados com as releases do Codex, então o bump deve ser combinado.
Não é preciso publicar Functions.

Rollback: reverter o commit desta correção (3 linhas) com novo bump de cache. Não há migração de dados nem gravação em produção a desfazer.

## 5. Roteiro de homologação física no Android
Use um produto de teste e um cliente de teste. Não use clientes ou produtos reais.
1. **Legado:** num produto de teste sem controle de estoque, abra Editar.
   - A caixa "Controlar estoque" deve estar **desmarcada**.
   - Mude só o nome e salve. Reabra: continua desmarcada, a quantidade é a mesma e o histórico de estoque não ganhou linha.
2. **Produto controlado:** edite o nome e salve. A caixa continua marcada e a quantidade não muda.
3. **Venda normal online:** venda 1 unidade no Pix.
   - O estoque cai 1.
   - O histórico mostra a venda.
   - O financeiro mostra o valor uma única vez.
   - Sincronização fica sem pendências.
4. **Venda offline:** ative o modo avião e venda 1 unidade.
   - O app avisa que a venda está salva no aparelho.
   - Feche o app por completo e reabra (ainda offline): a venda continua lá.
5. **Reconexão:** desative o modo avião e aguarde, ou toque em Sincronizar.
   - A venda aparece **uma vez** em outro aparelho ou no navegador.
   - O estoque fica igual nos dois.
   - Não há venda duplicada no financeiro.
6. **Recorrente:** venda um produto recorrente de teste com vencimento personalizado.
   - A renovação aparece com a data escolhida, uma única vez.
7. **Toque duplo:** toque duas vezes rápido em Concluir. Deve existir só uma venda.
8. **Produto sem controle:** venda o produto de teste do passo 1. A quantidade dele não muda.
9. **Fechamento:** em Sincronização → Ver detalhes não deve haver pendência.
   - Se houver, **não** apague dados do app. Exporte o diagnóstico e envie para análise.
