# V238 — Serviços flexíveis, MVP local

Base: V237 `c94f60ac341745f952630948efd97342a5ed6072`.
Branch/worktree: `codex/v238-flexible-services`, `C:/Users/Murillo/Documents/VECONI-V238-Services`.
Nenhum push, merge, deploy, acesso financeiro de produção ou escrita real foi executado nesta tarefa.

## Reutilização e resultado

| Fluxo existente | Tratamento no MVP |
|---|---|
| Cadastro `itemKind: service` | Continua no cadastro de Produtos, sem estoque. Configuração opcional para serviços simples: preço fixo, livre, por km ou por hora. |
| Custos privados | Um modelo fixo/km/hora, taxa percentual opcional e custos adicionais por execução. Reutiliza `productFinancials` e `saleFinancials`. |
| PDV | Tocar no serviço configurado abre a execução. Valor efetivamente cobrado pode diferir da sugestão. Cliente e pagamento continuam no carrinho existente. |
| Carrinho | Cada execução tem identidade própria e quantidade 1; duas corridas do mesmo serviço ficam separadas. Produtos físicos conservam suas quantidades. |
| Venda | Snapshot de preço efetivo, tarifa/modelo, km, minutos, origem, custos e configuração. Alterar o cadastro não recalcula vendas. |
| Histórico e recibos | Exibem os dados de execução junto ao item existente. Sem painel de transportes. |
| Início e Desempenho | Receita/margem continuam nos cálculos existentes. Desempenho acrescenta quantidade de execuções V238, km e minutos no período autorizado. |
| Financeiro | Projeta apenas a receita pelo mecanismo existente. Custo estimado do serviço não cria despesa nem saída de caixa. Combustível realmente pago continua sendo despesa real no Financeiro, sem somar novamente o custo estimado. |

Configurar um serviço não altera estoque, dívidas ou vendas anteriores. Serviços antigos sem configuração, produtos físicos, variações e recorrências conservam seu fluxo. Os modelos novos ficam restritos a serviços simples; um item já configurado não pode ser convertido em produto físico/recorrente/variável, para não mudar a interpretação histórica de estoque.

## Integridade e funcionamento offline

- A execução reutiliza a criação de venda, a fila e o `operationId` existentes. Não há outro executor ou mecanismo de reenvio.
- Mudanças de empresa, sessão, permissões ou espaço invalidam o formulário aberto.
- Custos e taxa ficam em projeções privadas, sem exposição a vendedores sem `cost.view`. Campos monetários/medidas inválidos são recusados.
- Cada versão de configuração permanece em `productFinancials.serviceCostConfigs`. Uma venda offline mantém a versão original, mesmo após alteração posterior do cadastro.
- O gateway valida o serviço autorizado e a configuração, e grava venda, marcador e snapshot privado na mesma transação. Repetição usa o comprovante original; não recalcula custos nem cria outra receita.
- O snapshot privado é imutável por versão; não se sobrescreve um snapshot de outra venda. Configuração ausente ou conflitante mantém a operação preservada e bloqueada.
- O classificador de integridade recompõe os novos campos privados antes da comparação. Não ignora divergências financeiras reais.
- As duas condições adicionais nas Rules apenas proíbem armazenar `serviceCostConfig` no documento público do produto; demais permissões não foram ampliadas.

## Todos os espaços

Os painéis agregam espaços autorizados **da empresa ativa**, conforme `BusinessContext`, namespace local, período e permissões. Não consolidam negócios com `businessId` diferentes. Uma mesma empresa pode ter Adi Festa e outro espaço; outra empresa/assinante continua isolada. Os testes incluem linhas de uma empresa estrangeira, excluídas da agregação.

## Testes e evidências

- 45 testes unitários/regressão: modelos, arredondamento, snapshots, preços/custos, estoque, privacidade, integridade, desempenho e apresentação de renovação.
- 29 testes de sincronização e identidade de versão: recuperação automática, rejeições, aliases, filas, geração e empresas.
- 56 testes de contenção pública/Service Worker.
- 10 testes novos no Firestore Emulator: transação/idempotência, receita única, concorrência entre dispositivos, configuração offline anterior, permissões, empresa/espaço, PWA antigo, catálogo/versionamento, Rules, Pix/dinheiro/cartão/Fiado e carrinho misto.
- Regressão operacional no Emulator: 48 aprovados e 2 explicitamente desabilitados na suíte existente, incluindo os 7 testes V238 então presentes. Abrange campanhas, recebimentos, parcelas, cancelamentos, renovação e vencimento personalizado. Os dois skips são casos do leitor de clientes compartilhados; não são contados como aprovados.
- Chrome headless em 320/360/390/1366 px: formulário real de cadastro, modelos, duas execuções, carrinho, finalização offline, persistência em IndexedDB/reabertura, bloqueio por troca de espaço/sessão e custo oculto para vendedor. Adaptador de persistência sintético no navegador; confirmação transacional testada separadamente no gateway real com Firestore Emulator. Não é homologação no Android físico.
- Demonstração: corrida de 12 km/30 min, tarifa R$ 3/km, sugestão R$ 36, cobrança R$ 40, custo R$ 0,75/km + 10% + R$ 2 = R$ 15; margem estimada R$ 25. Segunda corrida: 5 km, R$ 15, custo R$ 5,25. Carrinho total R$ 55; custo estimado R$ 20,25.
- Capturas e logs locais: `qa-artifacts/v238/` (ignorados pelo Git, exclusivamente dados fictícios).
- Lint/build aprovados. Pacote público: 276 recursos (273 da base + módulo compartilhado, interface e CSS). SW preparado: `veconi-v238-flexible-services-qa-v1`.

## Arquivos e impacto

- Núcleo novo: `functions/src/shared/flexible-service.js`, `functions/src/services/flexible-service-validation.js`, `js/flexible-service-ui.js`, `css/flexible-service.css`.
- Cadastro/PDV: `functions/src/shared/product-model.js`, `js/product-images.js`, `js/product-variations.js`, `js/checkout.js`, `js/desktop-sales.js`, `js/vendas.js`.
- Integração privada/validação: `functions/src/services/operational-commit-service.js`, `functions/src/services/sale-cost-service.js`, `functions/src/shared/commercial-commit-engine.js` (gerado), `functions/src/shared/operational-privacy-policy.js`, `js/firebase/sync.js`, `js/team-access.js`, `js/integrity.js`, `firestore.rules`.
- Apresentação: `js/activity-center.js`, `js/recibos.js`, `js/performance-model.js`, `js/performance-dashboard.js`.
- PWA/pacote: `index.html`, `js/build-info.js`, `service-worker.js`, `public-site.manifest.json`, `scripts/build-public-site.cjs`, `.gitignore`.
- QA: `tests/flexible-service-v238.test.cjs`, `tests/emulator/flexible-services-v238.test.cjs`, `scripts/audit-flexible-services-v238.cjs`, este relatório.

As mudanças em `js/firebase/sync.js` limitam-se a separar/recompor metadados privados; não alteram ordem, agendamento, quarentena, recuperação, limites de estoque ou políticas de reenvio. O engine foi regenerado pelo script existente e sua identidade foi conferida.

## Prontidão e riscos restantes

**GO para revisão/homologação do MVP local. Publicação não executada nem autorizada.**

Antes de eventual publicação: comparar main/fontes ativas, coordenar os arquivos compartilhados com Claude, montar pacotes seletivos e rollback. O gateway `commitOperationalSync` precisa da validação nova; o leitor operacional precisa preservar os dados públicos da execução. Avaliar o empacotamento do trigger `projectSaleFinancialIncome`, que preserva snapshots já existentes e não deve recalcular serviços após o commit. Nunca publicar Functions indiscriminadamente.

PWA antigo continua atendendo produtos e serviços não configurados. Para **serviços configurados V238**, ausência de execução é recusada com orientação de atualização, evitando vender uma tarifa por km como preço fixo. Antes de converter um serviço antigo, conferir se há operações antigas pendentes; não converter automaticamente cadastros ou filas.

Rollback deve manter o validador/snapshots de vendas V238 já aceitas. Suspender novas configurações/execuções flexíveis se necessário; não voltar a um backend que interprete uma execução como produto físico nem apagar configurações usadas por filas offline. A comparação e o empacotamento contra as revisões reais ficam para o GO de publicação.
