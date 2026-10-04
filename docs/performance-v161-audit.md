# Desempenho V161 — auditoria e contrato

Base/rollback: V160 / 4b4e269cd93d2e695c88763da85364a6edb691a9. Release: V161. Este documento acompanha o commit coeso da implementação; o SHA definitivo é o commit que contém este arquivo. Publicação após as verificações abaixo.

## Arquitetura encontrada

- JavaScript vanilla, views HTML via `app.js`, CSS/token design system, ícones Lucide, Firebase modular, Functions Admin e cache IndexedDB V156. Não há React/Recharts/Tailwind na aplicação.
- Desempenho anterior: `app.js → relatorios()`, soma de `valorFinal ?? valorTotal`, `custoTotal`, `lucro`, quantidade de vendas e média, mais saldo negativo de clientes. Sem período e sem gráficos; mobile mostrava aviso de desktop.
- `vendas.js` guarda `data`, itens, `subtotalFinal`, descontos já distribuídos no preço final, snapshots de custo/categoria, spaceId e actor. Lucro estimado = receita após descontos − custo dos itens, não lucro líquido.
- `saleFinancials` separa custo/lucro do documento operacional; sync reidrata somente campos autorizados. `sale-cost-service` preserva projeção já existente. Analytics NÃO executa projeção/backfill nem consulta custo atual de produtos.
- Sync inicial de sales tem limite 200. Cache local isolado não prova que todo um período está disponível. Análise nova não confunde cache parcial com total confirmado.
- Referência recebida: screenshot de dashboard escuro + especificação textual. O código React mencionado e screenshot da tela antiga não vieram neste anexo; a tela antiga foi auditada pelo código.

## Solução

`performance-model.js` é a única definição de números para KPIs e gráficos desta aba. SVG nativo para séries e barras HTML para rankings: sem dependências/CDN adicionais, tooltip mouse/touch e seletor por teclado. Tokens `--af-*`, botões `.btn` e Lucide reutilizados; CSS restrito a `.analytics-*`.

`getPerformancePage` é callable somente leitura. Confirma Auth, membership ativo, reports.view, espaços e geração/lock; confirma novamente depois de consultar. Não escreve em coleções, não usa listeners, não altera vendas/custos, Payment Engine, reset, billing ou sync.

Consulta range em `sales.data`, ordenado por data e documentId; suporta ISO string e Timestamp em duas etapas. Usa índices compostos spaceId/data e financialSpaceId/data para consulta restrita. A etapa de alias inclui apenas documentos sem spaceId primário, sem duplicar registros modernos; documentos de outro espaço primário não escapam pela presença do alias. Contrato atual de vendas sempre tem data; não varre vendas sem data e não inventa data a partir de metadados. Tais registros legados exigiriam auditoria específica, sem reparo nesta tela.

Resposta allowlist: IDs operacionais, data, status, valor, forma/provider e itens reduzidos (nome, quantidade, categoria histórica e valor). Sem nome/contato do cliente, imagens, observações, recibo ou segredo. Custo e lucro saem somente com permissão específica. Owner permitido; reports.view não concede cost.view/profit.view. Restricted all significa somente allowedSpaceIds, nunca todos do business.

## Métricas

- Faturamento: soma do valor final das vendas válidas, incluindo fiado uma única vez.
- Vendas: número de IDs únicos válidos. Exclui active/ativo false, tombstone, desfeita e status cancelado/estornado equivalentes.
- Custo: snapshot da venda/projeção histórica, nunca preço atual do produto.
- Lucro estimado: snapshot histórico; fallback somente receita menos custo histórico existente. Ausência/partial de custo sinaliza indisponibilidade de lucro/margem; não supõe custo zero.
- Ticket: faturamento / número de vendas. Margem: lucro / faturamento.
- Itens: soma das quantidades, incluindo variantes agrupadas no produto.
- Rankings: categoria gravada no item, ou “Sem categoria histórica”. Não busca produtos para preencher retrospectivamente. Valor de desconto/arrendondamento de venda alocado proporcionalmente aos itens; somas dos rankings batem com faturamento.
- Formas: Pix, Dinheiro, Cartão manual, Fiado, Maquininha integrada ou outros somente com registros; integrada mantém forma Cartão e origem/provider separado.
- Fiado: saldo negativo atual dos clientes ativos no cache compartilhado já existente. Apenas financial.view + customers.view + acesso integral aos espaços. Rotulado saldo da empresa/todos os espaços/última sincronização; independente do período e sem estimar vencimento. Não atribui dívida global a um espaço arbitrário.
- Espaços: filtro próprio não muda o seletor do checkout/Home. Sem espaço histórico é categoria explícita para acesso irrestrito. Usuários restritos não recebem dados sem espaço. Tabela quando há dois ou mais espaços com vendas no recorte.
- Períodos: hoje/7/30/90 dias, mês/mês anterior/ano/custom até 366 dias. Comparação com mesmo número de dias anterior; sem base ou denominador zero não inventa +100%. Comparação só habilitada após paginação completa.
- Timezone: business.timezone quando existente, senão America/Sao_Paulo. Limites por calendário local; consultas ISO UTC derivadas desses limites. Hoje/hora, até100dias/dia, acima100dias/mês.

## Leituras e escala

Antes: 0 queries próprias da aba (reutilizava cache potencialmente limitado a 200 vendas); os reads de sync existem independentemente dela.

Depois: 0 listeners e 0 writes adicionais; consulta consolidada paginada ao abrir/atualizar/mudar filtros. Cada página tem até250 sales + até250 saleFinancials para quem pode ver custo/lucro, 3 reads de autorização inicial e2 revalidações. Páginas vazias têm o custo mínimo Firestore; consultas com múltiplos campos de range/ordenação também podem ter cobrança de índice. Não se promete reads exatos de produção a partir do emulador.

Até4 páginas por rodada automática (≤1000 sales e1000 projeções); etapas Timestamp e alias legado fazem parte desse orçamento. Consulta restrita pode reler documentos que carreguem tanto spaceId como financialSpaceId, mas não retransmite nem consulta novamente custos dessas duplicatas. Volumes maiores exigem “Carregar próximo lote” e continuam claramente parciais até terminar. Não há download automático de50mil vendas completas, nem relatório truncado declarado completo.

Resumo reutilizado em memória por5min para mesma empresa/usuário/permissões/geração/período/espaço; resize/hover são zero queries. Sem novo banco, coleção ou blob localStorage. Offline usa cache IndexedDB atual com aviso de prévia parcial. Não persiste mais uma cópia financeira: reset e saída de sessão invalidam a memória. Agregação incremental materializada é uma evolução futura para volumes onde mesmo páginas limitadas não atendam ao orçamento; requer contrato próprio com reset/permissões, fora deste consumo read-only.

## QA / publicação

Testes numéricos incluem fixture150/60/90/margem60/ticket75/2vendas, desconto, fiado, cancelamentos, custo ausente/zero, variantes, business/spaces, timezone, comparação, categoria histórica e50mil registros em memória. Segurança testa allowlist e gates individuais de campos. Browser/emulator valida paginação real, seller autorizado/restrito/negado, outra empresa, geração, filtros, vazio, tooltip sem queries e12larguras.

Resultados em 04/10/2026:

- Aplicativo: 587/587 testes. Backend: 105/105. Firestore/Storage Rules no emulador: 118/118. Nenhuma Rule foi alterada.
- Lint e build: 286 arquivos JavaScript. `git diff --check` aprovado.
- Browser com Auth/Functions/Firestore locais: 274 vendas no intervalo atual + anterior, três páginas consolidadas. No período atual: 154 vendas, R$ 8.925,00 de faturamento, R$ 3.569,00 de custo e R$ 5.356,00 de lucro estimado. A soma dos pontos do gráfico é exatamente R$ 8.925,00.
- Owner e manager com permissões; seller sem custo/lucro recebe payload sem esses campos. Outra empresa, espaço não autorizado, acesso revogado e geração inválida são recusados. Alias legado financialSpaceId incluído; alias conflitante não atravessa o espaço primário, nem duplica a venda.
- Filtros de período/espaço/custom, estado vazio, tooltip e 12 larguras passaram: 320, 360, 375, 390, 412, 430, 1024, 1280, 1366, 1440, 1600 e 1920. Hover não dispara consulta. Fixture de 50 mil linhas reduzidas valida agregação em memória, NÃO representa download automático desse volume.
- Login, Home, Vender, Clientes, Produtos, Financeiro, Histórico, Desempenho, Equipe, Configurações e reload passaram. O timeout anterior era a espera por requestAnimationFrame no teste; a sessão já estava autorizada. Polling por timer verifica conjuntamente sessão, gate oculto e dashboard visível, sem alteração de auth.
- Regressão adicional `audit-payment-engine-v1.cjs`: venda canônica/estoque/recebível, duplo clique, recusa, aprovação duplicada, recovery, fiado, recebimento, WhatsApp individual e sequência de três contatos com retorno/confirmar/próximo, dois contextos isolados convergindo, Equipe cancel/reopen, integridade e fila zero. O campo `release:159` no relatório desse script é rótulo fixo legado, não a versão do código executado.
- PWA Chromium: service worker instalado/controlando a página, três assets analytics em cache, reload autenticado e atualização offline com aviso de prévia. Android físico e envio real ao WhatsApp NÃO foram executados; os envios de QA são interceptados e as escritas de dados ocorrem apenas nos emuladores.
- Logs incluem rejeições esperadas dos testes negativos de Rules e aviso do listener de catálogo no ambiente isolado; não foram usados como evidência de sucesso. Os asserts e pageerrors do smoke passaram.

Capturas finais: `docs/screenshots/performance-v161/1440-performance.png`, `1920-performance.png` e `390-performance.png`. Comparação visual: a estrutura da referência foi mantida (4 KPIs, gráfico principal e rankings), mas preto substituído pelos tokens claros, teal e navy da VECONI. Desktop ocupa a largura útil, mobile usa KPIs em duas colunas e cards empilhados. Tabela tem scroll próprio, não overflow da página. Não foram inseridos dados demo em produção.

### Arquivos e publicação

Implementação: `js/performance-model.js`, `js/performance-dashboard.js`, `css/performance-dashboard.css`, `functions/src/services/performance-read-service.js`. Integração mínima: `js/app.js`, `index.html`, `functions/src/index.js`, `firestore.indexes.json`. Release/cache: `js/build-info.js`, `service-worker.js` (veconi-v161-performance). Testes: `tests/performance-model.test.js`, `functions/test/performance-read-service.test.js`, `scripts/audit-performance-v161.cjs`; testes antigos receberam somente novos identificadores de versão/cache. Este relatório e as três capturas completam a entrega.

Deploy planejado: somente callable `getPerformancePage` e dois índices de sales, seguidos pelo único push oficial do frontend no GitHub Pages. Nenhuma implantação de Rules, reset, Payment Engine, billing ou dados financeiros. URL: https://murillocharles97-netizen.github.io/adi-festa-controle/ . O resultado real do deploy e o SHA serão informados na conversa após verificação pública; este registro não declara deploy concluído antecipadamente.

Rollback de frontend: V160. O novo callable é read-only e pode ser retirado sem mexer nas barreiras de geração da V160. Não fazer rollback de Rules/reset para versões anteriores à V160.
