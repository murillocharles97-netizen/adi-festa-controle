# Visão consolidada dos negócios — auditoria, proposta e plano

Base: V237 (`c94f60a`). Branch: `claude/consolidado-desempenho`. Escopo: Dashboard/Desempenho.

## 1. Auditoria

| Superfície | Arquivo | "Todos os espaços" | Períodos | Fonte | Observação |
|---|---|---|---|---|---|
| Início mobile | `js/home-mobile.js` | sim (`SpaceContext.contextualData('home')`) | Hoje x ontem, 7 dias fixos | local (`DB`) | Visão operacional do dia. Não tem quebra por espaço. |
| Início desktop | `js/desktop-dashboard.js` | sim | Hoje, 7d, 30d, mês | local | "Recebido hoje" soma `pagamentos` do dia, sem separar das vendas pagas no ato. |
| **Desempenho** | `js/performance-model.js` + `js/performance-dashboard.js` | sim (`spaceId:'all'`, respeita `allowedSpaceIds`) | Hoje, 7/30/90d, mês, mês passado, ano, personalizado | **nuvem** (`getPerformancePage`, paginada, campos projetados) + prévia local | Já tem filtro por espaço, comparação com período anterior, tabela por espaço, lucro estimado com permissões. Base certa para a consolidação. |
| Desempenho do dia (equipe) | `js/performance-access.js` | sim | só hoje | callable `getDailySalesPerformance` | Perfil restrito. Fica como está. |
| CRM | `js/crm-dashboard.js`, `js/customer-metrics.js` | — | — | — | Métricas de cliente, fora do faturamento. |
| Finanças | `js/firebase/financial-space-service.js`, `js/financial-engine.js` | por espaço financeiro | `periodKey` mensal | Firestore `financialSpaces/*` | `summarize()` já separa entradas, saídas, despesas reconhecidas e resultado. |

O que faltava na consolidação:
- Período **Ontem**.
- **Recebido** (dinheiro que entrou) separado de **faturamento** (vendas na competência).
- No celular, a contribuição por espaço era uma tabela larga, e não dava para abrir um espaço a partir dela.
- **Despesas** e **resultado** só existem no módulo Finanças. O Desempenho não os mostra.

Regras de contagem verificadas no código:
- Renovação gera venda (`saleId` em `customer-subscriptions.js`). Entra uma vez no faturamento.
- A venda fiado conta no faturamento no dia da venda (`creditOriginalAmount = valorFinal`). O pagamento posterior é um `pagamentos{tipo:'pagamento'}` e conta só em **Recebido**. Somar faturamento + recebimentos de fiado conta duas vezes. A UI agora avisa isso.
- Recebido = vendas pagas no ato (não fiado/crediário) + recebimentos de fiado, deduplicados por `id`. Ficam de fora estornos, excluídos, outra empresa e espaços não autorizados.
- Limitação: `pagamentos` vem da base local. O sync inicial traz só os 200 mais recentes e `getPerformancePage` não devolve pagamentos. Em períodos longos, o recebido de fiado pode sair incompleto, e a UI avisa.

## 2. Multiempresa ou espaços?

A sessão tem um único `businessId` (`userProfile.businessId`), e todas as consultas e regras são `businesses/{bid}/...`. Os espaços já têm tipo (`unit`, `operation`…), meta diária, capacidade financeira, permissão por membro (`allowedSpaceIds`) e filtro no servidor (`where(spaceId in …)`).

**Recomendação: representar Táxi e transportes, PrimeLine 3D, Venda de doces, Assinaturas e Outras atividades como espaços da empresa principal.** Isso funciona sem mudar Rules nem Functions, e a consolidação já existe.

Empresas separadas só se justificam se houver CNPJ ou equipe distintos e com isolamento total. Nesse caso, a visão multiempresa de leitura pede um callable novo (`getPortfolioPerformance`) que valide `owner` em cada `businesses/{bid}` e devolva só agregados. Isso exige Functions e índices e está **fora deste escopo, aguardando aprovação**.

## 3. Proposta visual (dentro do Desempenho, sem painel novo)

Ordem no celular (390px):
1. Filtros: Espaço (Todos / cada negócio) · Período (Hoje, **Ontem**, 7 dias, 30 dias, Este mês, …, Personalizado).
2. KPIs existentes: Faturamento, Lucro estimado, Ticket, Vendas.
3. Gráfico existente.
4. **Recebido no período** (com `financial.view`): Vendas pagas no ato · Recebimentos de fiado · Total recebido, com o aviso "nunca some as duas".
5. **Contribuição por espaço** (com "Todos" selecionado): uma linha por negócio com faturamento, % do total, barra, vendas, lucro (se permitido) e recebido (se permitido). Tocar numa linha filtra aquele espaço.
6. Fiado em aberto (existente).

## 4. Plano

| Fase | Item | Depende de | Status |
|---|---|---|---|
| A | Período Ontem; recebido separado (modelo + UI); contribuição por espaço em lista tocável; testes | — | **feito nesta branch** |
| B | Despesas e resultado por espaço no Desempenho, reaproveitando `FinancialEngine.summarize` dos lançamentos do mês dos espaços financeiros vinculados (`capabilities.finance`), com leitura sob demanda e cache por `periodKey` | Finanças, nenhuma mudança em Rules | proposta |
| C | Recebido de fiado completo no servidor: incluir `payments` projetados em `getPerformancePage` (ou um callable irmão) | **Functions + índice**, aprovação | proposta |
| D | Receita de serviços flexíveis (corridas/km) e custos variáveis no lucro por espaço | **V238 (Codex)**: confirmar os campos `valorFinal`/`custoTotal`/`lucro` da venda de serviço | aguardando integração |
| E | Visão multiempresa de leitura (só se empresas separadas) | Functions + Rules | só com aprovação |

## 5. Dependências e integração
- Arquivos alterados: `js/performance-model.js`, `js/performance-dashboard.js`, `css/performance-dashboard.css`, os testes e este documento. Nenhum deles é tocado pela V238.
- **Não alterei** `service-worker.js` nem `index.html`, porque a V238 mexe nos dois. Na integração, o Codex precisa subir a versão de cache/assets do SW para que o PWA baixe os JS/CSS novos.
- A V238 deve manter `formaPagamento:'fiado'`/`installmentPlan` nas vendas a prazo de serviço. O cálculo de "pago no ato" depende disso.
