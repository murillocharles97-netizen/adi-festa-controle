# Trocas V1 — arquitetura e validação local

Base operacional: V193, `41b192c49d60279a7b621d60db50683f334732ac`. Proposta: V194, sujeita à autorização de publicação. Nenhum deploy, commit, migração ou operação real neste trabalho.

## Auditoria e decisões

O fluxo atual registra vendas e movimentos via DB/Sync, preserva namespaces por usuário e protege operações com processedOperations e quarentena. Cancelamento existente é uma reversão comercial, não uma troca. Financeiro é projetado por triggers idempotentes e roteado por empresa/espaço. Recebimentos e Fiado possuem eventos e saldos próprios. Dashboard/metas usam vendas, não eventos de troca.

A implementação local cria uma operação online separada, sem entrar na fila comercial existente. A venda original não é atualizada. Uma transação lê venda, vínculo, plano, espaço, produtos, variações, reservas e quantidades previamente devolvidas. Valida preço atual, quantidade, estoque e fingerprint da revisão antes de gravar todos os efeitos de estoque. Confirmação concorrente com outro ID exige nova revisão. Mesmo ID/conteúdo retorna o resultado anterior; conteúdo diferente é recusado.

### Modelo

- businesses/{businessId}/saleExchanges/{operationId}: evento imutável, originalSaleId, empresa/espaço/geração/ator, itens originais, novos, condição, motivo, valores em centavos, pagamento e timestamps.
- saleExchangeSummaries/{saleId}: quantidades cumulativas devolvidas por índice da linha original; evita devolução repetida.
- exchangeCredits/{exchangeId}: crédito nominal separado do Fiado, vinculado a cliente + empresa + espaço + geração, com saldo restante.
- exchangeCreditEvents/{eventId}: consumo/restauração imutável, alocação original, venda, ator, saldo anterior/posterior e operação.
- saleExchangeMetrics/{operationId}: projeção mínima de faturamento, com devolvido, novos itens e diferença assinada; sem cliente, custos ou lucro.
- stockMovements/{operationId}_{linha}_{tipo}: entrada apta para revenda e saída dos novos itens, com businessId + spaceId.
- processedOperations/{operationId}: recibo idempotente validado junto ao evento.
- financialIncomeRoutes e financialSpaces/{spaceId}/entries: roteamento financeiro existente, somente complemento positivo, finance=true e automação habilitada.

### Efeitos

- Apto: entrada física; avaria: condição registrada sem entrada disponível.
- Novo: saída; reserva de outros pedidos preservada; saldo nunca negativo.
- Variações: saldo da variante e agregado do pai na mesma transação.
- Mesmo valor: nenhum recebimento.
- Maior valor: recebimento manual explicitamente confirmado. Não integra TEF/gateway.
- Menor valor: crédito separado, cliente identificado obrigatório; nenhum reembolso ou redução de Fiado.
- Financeiro: projeção assíncrona pelo mecanismo existente, idempotente; NÃO é parte da mesma transação de estoque. Falhas exigem monitoramento antes de liberação.
- Metas/faturamento: venda original mantida e ajuste econômico assinado aplicado na data da troca; contagem de vendas preservada. Crédito emitido/consumido não cria recebimento financeiro novo.

### Restrições conservadoras

V1 local aceita venda manual paga confirmada remotamente e produtos físicos com associação explícita de espaço. Não aceita Fiado, pagamentos integrados, pedidos online, descontos históricos não alocados, produtos legados ambíguos ou uma nova troca de venda já paga com crédito de troca. Essas restrições não representam suporte aos casos bloqueados. Cancelamento da troca está bloqueado. Permissão transitória: owner ou combinação explícita sales.create + sales.cancel no espaço autorizado; nenhuma permissão existente é concedida. Recomenda-se sales.exchange em fase futura.

## Interface

Histórico → venda → Trocar itens / ver trocas. Quantidades, aptidão, novos itens/variações, motivo, pagamento manual, revisão e confirmação. Tentativa é preservada por usuário/empresa/geração/venda com o mesmo ID; não existe reenvio automático. Troca de identidade invalida respostas antigas. Fixture QA isolada: /tests/fixtures/sale-exchanges.html, sem Firebase.

## Histórico de desenvolvimento (superado pela validação final abaixo)

A rodada anterior, ainda sem resgate, passou 15 testes de domínio e 27 cenários Emulator (12 de Trocas + 15 regressões de vendas/Sync). Esses resultados não substituem a rodada final que inclui resgate e cancelamento. A negativa anterior da edição da venda atingiu também o limite de expressões das Rules; a comprovação específica do novo guard e o cancelamento legítimo sem troca precisam ser consolidados na rodada final.

UI fictícia: seleção, revisão, confirmação e histórico vinculado exercitados no Chrome; screenshot mobile 390 px e desktop. Não substitui teste integrado Auth/Functions/Sync/PWA.

## Checklist final local

1. Passou: cancelamento manual normal autorizado para owner e seller; venda já trocada, crédito e movimentos server-only não admitem escrita direta. Testes positivos evitam confundir proibição intencional com indisponibilidade geral das Rules.
2. Implementado: `checkSaleExchangeUndo` consulta o vínculo antes de qualquer reversão local e novamente ao confirmar; o guard canônico nas Rules é a proteção definitiva contra concorrência. Venda com crédito nunca passa pelo undo local genérico.
3. Passou: fluxo integrado troca → emissão → uso parcial → complemento → cancelamento → restauração das mesmas alocações. Recebimento canônico limitado ao dinheiro novo.
4. Implementado: tentativa persistida antes do envio, exclusão entre abas, consulta de recibo e repetição explícita dos mesmos IDs. Re-revisão exige rejeição determinística e confirmação de ausência de commit, preservando o envelope rejeitado separadamente.
5. Passou: callbacks de outra conta não concluem a UI nem removem o envelope; testes locais de reload, duas abas, permissão, reserva e idempotência. Smoke visual usa fixtures fictícias; não substitui Auth/Functions/PWA em nuvem.
6. Decisão V1: reset simples fica explicitamente bloqueado com `exchange-evidence-requires-controlled-reset` quando houver trocas/créditos. Não se apagam passivos nem evidências implicitamente.
7. Assets adicionados ao PWA. Na preparação autorizada de 22/10, número/cache e imports das entradas foram alinhados à V194. O conteúdo comercial de Sync e Fiado permanece idêntico à base. Rollback deve preservar os novos fences de segurança e serviços compatíveis.

## Arquivos

functions/src/shared/sale-exchange.js; functions/src/services/sale-exchange-service.js; functions/src/services/financial-income-service.js; functions/src/index.js; firestore.rules; js/sale-exchanges.js; js/activity-center.js; css/sale-exchanges.css; index.html; tests/sale-exchanges.test.js; tests/emulator/sale-exchanges.rules.test.js; tests/fixtures/sale-exchanges.html.

## Crédito utilizável e cancelamento da venda futura

No checkout, o cliente identificado consulta crédito autorizado e escolhe uso total ou parcial. A venda exige conexão e validação transacional no servidor. O preço e estoque atuais, reservas, saldo dos créditos e fingerprint da revisão são conferidos novamente no commit.

| Crédito antes | Valor da venda | Crédito usado | Complemento cobrado | Crédito depois |
|---:|---:|---:|---:|---:|
| R$50 | R$30 | R$30 | R$0 | R$20 |
| R$50 | R$70 | R$50 | R$20 | R$0 |
| R$50 | R$50 | R$50 | R$0 | R$0 |

O servidor seleciona alocações por ordem de emissão. Mesma transação consome créditos, grava os eventos de consumo, baixa estoque, cria venda e recibo. Duas abas não podem gastar o mesmo saldo. Dinheiro, Pix e cartão manual existentes recebem somente o complemento. Resgate com desconto/campanha, maquininha integrada ou Fiado está bloqueado nesta V1.

O cancelamento da venda com crédito é específico: confere os movimentos e alocações originais, restaura exatamente esses créditos e o estoque da venda e cria recibo de cancelamento. Repetir a chamada não restaura novamente. A parcela monetária é estornada pelo projetor canônico, limitada à entrada original. Venda inteiramente coberta por crédito não cria receita nem estorno monetário artificial. O cancelamento da troca permanece bloqueado, pois desfazer emissão de crédito já usado exige outra política.

## Efeitos canônicos: mercadoria, recebimento e metas

O valor original da venda, o valor devolvido, os novos itens, o complemento recebido, o crédito emitido e o crédito consumido são grandezas separadas. Uma venda futura de R$70 com crédito R$50 mantém R$70 no valor dos itens e apenas R$20 no Financeiro. Cancelar essa venda devolve R$50 de crédito e estorna somente os R$20 recebidos.

Faturamento operacional = vendas válidas + diferenças econômicas assinadas das trocas concluídas. O ajuste entra na data da troca; a venda original não é reescrita e troca não é contada como venda adicional. Exemplo: original R$80 → troca por R$50 e crédito R$30 → compra futura R$30 coberta pelo crédito. Faturamento = 80 - 30 + 30 = R$80; recebimento monetário = R$80 da origem, sem receita nova pelo crédito. As metas mantêm suas configurações atuais e acompanham esse total líquido.

`ExchangeEconomics` consulta a projeção mínima pelo callable autenticado `listSaleExchangeAdjustments`, com paginação completa. Cache somente em memória por UID, empresa, geração, permissões e espaços; nenhuma chamada a DB.alterar ou criação de operação Sync. Falha de consulta mantém “Totais provisórios”, sem confirmar valores incompletos. Callbacks de outra sessão não publicam dados. O evento `sale-exchange-metrics-updated` atualiza Dashboard e Desempenho. Consulta cobre espaços ativos autorizados; métricas de espaços posteriormente arquivados exigem uma consulta histórica própria.

Dashboard desktop/mobile, metas, resumo de fechamento e Desempenho usam os mesmos ajustes. Desempenho apresenta o valor em “Ajustes de troca”, sem inventar vendas de produtos. Rankings preservam os itens originais. Custos/lucro estimado de períodos com trocas ficam indisponíveis enquanto não houver projeção canônica de custo da devolução apta versus avariada; não se calcula margem incorreta com custos antigos inalterados. Nenhum campo privado é exposto ao seller.

Financeiro permanece assíncrono, idempotente e roteado por espaço. Finance=false impede lançamento. Não se cria payment duplicado quando a venda é a fonte canônica do recebimento. A falha de uma projeção exige monitoramento; não existe reparo financeiro retroativo automático.

## Testes adicionais e arquivos

`tests/exchange-economics.test.js`: dez cenários aprovados localmente, incluindo escopo/geração, crédito emitido/consumido, cancelamento, data da troca, paginação, troca de sessão, falha de consulta e Dashboard/metas desktop/mobile. Rodada conjunta com regressões de Dashboard, espaços e Desempenho: 40 aprovados antes de adicionar o último cenário, seguido de 10/10 do arquivo novo. Resultados finais de app, Emulator, lint/build e screenshots devem ser consolidados ao concluir o trabalho.

Adicionados também: functions/src/shared/exchange-credit.js; functions/src/services/exchange-credit-service.js; js/exchange-economics.js; integração de resgate no checkout. Relatórios alterados: js/home-mobile.js, js/desktop-dashboard.js, js/performance-model.js, js/performance-dashboard.js e resumos de js/app.js. Rules/Functions novas são necessárias para escrita transacional e para impedir clientes antigos de modificar registros com crédito/troca; não ampliam concessões existentes.

## Publicação e rollback propostos

Preservar V193 e seu commit como rollback. Após autorização: publicar índices necessários se houver, aguardar disponibilidade, publicar os bloqueios de Rules e Functions necessárias, depois frontend/PWA; smoke com dados QA. Não executar troca real no deploy.

Rollback deve manter os fences de Rules e os serviços/recibos compatíveis enquanto existirem créditos ou trocas. Um cliente antigo não pode recuperar permissão de alterar venda já trocada ou venda com crédito. Recuar frontend não apaga eventos, créditos, filas ou efeitos. Não usar restauração de dados como rollback.

## Resultado local anterior — 21/10/2026 (histórico; substituído pelo preflight de 22/10)

- 108 testes direcionados de app/backend passaram, sem falhas ou skips: domínio, UI, crédito, recibo, metas, preferências locais, permissões, custo privado, roteamento e reset.
- 65 cenários Firestore Emulator passaram, sem falhas ou skips: 26 crédito, 14 troca/integração, 10 fences de Rules e 15 regressões de venda/Sync de vendedor.
- Suíte completa do app: 997 testes, 963 aprovados, 34 falhas. As MESMAS 34 falham na base V193 intacta (931 testes: 897 aprovados/34 falhas). Incluem contratos de releases antigas e harnesses de Sync desatualizados. Não declarar suíte global verde. Nenhuma dessas falhas foi ocultada ou corrigida fora do escopo.
- O contrato de checkout foi atualizado para retirar somente os ganchos aprovados de crédito em memória; o digest histórico ainda prova que o caminho normal não sofreu outras mudanças. Fiado não foi otimizado nem instrumentado.
- Lint, build e `git diff --check` aprovados na rodada final.
- Chrome local: revisão de troca, confirmação, histórico vinculado, uso de crédito R$50, complemento R$20, revisão e confirmação fictícias. Larguras 320/360/390/430 px verificadas sem overflow horizontal. Android/PWA físico e smoke QA em nuvem pendentes de etapa autorizada.

### Arquivos finais

Backend: `functions/src/shared/sale-exchange.js`, `functions/src/shared/exchange-credit.js`, `functions/src/services/sale-exchange-service.js`, `functions/src/services/exchange-credit-service.js`, `functions/src/services/financial-income-service.js`, `functions/src/services/workspace-reset-policy.js`, `functions/src/index.js`, `firestore.rules`.

Frontend/PWA: `js/sale-exchanges.js`, `js/exchange-credit-checkout.js`, `js/exchange-economics.js`, `js/checkout.js`, `js/vendas.js`, `js/recibos.js`, `js/activity-center.js`, `js/app.js`, `js/home-mobile.js`, `js/desktop-dashboard.js`, `js/performance-model.js`, `js/performance-dashboard.js`, `css/sale-exchanges.css`, `css/exchange-credit-checkout.css`, `index.html`, `service-worker.js`.

Testes: `tests/sale-exchanges.test.js`, `tests/sale-exchanges-ui.test.js`, `tests/exchange-credit.test.js`, `tests/exchange-credit-checkout.test.js`, `tests/exchange-economics.test.js`, `tests/team-sync-release-v179.test.js`, três arquivos novos `tests/emulator/*exchange*.rules.test.js` e duas fixtures HTML.

### Limites e riscos remanescentes

- Operação online; sem Fiado, reembolso automático, TEF, pedidos online ou desconto/campanha no resgate. Troca de uma venda já paga com crédito permanece bloqueada. Cancelar a troca permanece bloqueado.
- Cliente precisa estar disponível no contexto; associação ausente só é aceita no path da empresa em geração zero, sem vínculo conflitante. Produto precisa de associação explícita ao espaço; não há migração automática de legado ambíguo.
- Custos/lucro líquido de períodos com troca não são fabricados; ficam em revisão. CRM/rankings de produto preservam as compras e itens históricos, não representam inventário líquido pós-troca. Não há reprocessamento retroativo de campanhas/benefícios.
- Financeiro é projeção assíncrona pelo mecanismo existente: monitorar entrega/retry do trigger no primeiro smoke QA. Créditos/passivos ficam no ledger próprio, não em saldo de Fiado.
- Consulta de ajustes cobre espaços ativos; histórico de espaços arquivados exige evolução específica. Até 400 créditos consultados por cliente e 100 alocações por venda; exceder limite falha sem efeitos.
- Tentativas locais usam armazenamento durável e Web Locks. Navegador sem exclusão entre abas não confirma o crédito/troca; deve ser atualizado. Não há limpeza de IndexedDB, fila ou namespaces.
- Ordem causal: pendência legítima/erro ativo anterior bloqueia novos efeitos de troca/crédito; não se chama retry ou reprocessamento para desbloquear. Ocorrências históricas resolvidas/quarentena inerte não são tratadas como erro ativo. A transação canônica continua protegendo estoque mesmo diante de outros aparelhos.

## Preparação V194 — 22/10/2026

O [preflight final](v194-preflight.md) e o [manifesto de publicação](v194-release-package.json) substituem as contagens e os metadados de release históricos acima. Resultado direcionado: 117/117 app/backend e 65/65 Firestore Emulator. A comparação reproduz exatamente as 34 falhas globais da V193 antes do empacotamento; o pacote final tem 32 falhas preexistentes porque o alinhamento dos metadados da release resolve duas delas, sem introduzir outras. Nenhum teste específico de Trocas falha.

O preflight também fechou a janela de lucro incorreto durante consulta de ajustes ainda não confirmada, em andamento, com falha ou offline. Custos/lucro/margem ficam em revisão nessas situações e nos períodos com troca.

Preparação local autorizada, **sem deploy ou push**. Base histórica V193 `41b192c49d60279a7b621d60db50683f334732ac`; rollback integral para essa base só é seguro antes de qualquer efeito V194. Depois de emitir troca/crédito, exige pacote compatível preservando fences, ledger, recibos e projeções. Esse build compatível ainda precisa ser preparado e validado; não confundir a tag histórica com uma reversão integral segura.

Nenhum dado real foi alterado. Loja V3 independente e operações reais preservadas de recuperação/Sync não foram tocadas.
