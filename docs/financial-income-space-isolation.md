# Isolamento de receitas por empresa e espaço — correção local

Escopo: código local sobre `6a9bb4b97d326a8d159d1950be4de815dc20f2ef`, sem deploy,
push, reprocessamento ou gravação em produção. Produção continua V169
`b5c1aed4066c569d2665ad43749ecffd934b9f86`. Não foi incrementada a versão.

## Causa comprovada e caminhos auditados

O `financial-income-service` calculava `business_${businessId}` em
`spaceIdFor`/`spaceRefFor`. `linkedSpace` lia exclusivamente esse documento,
ignorando `sale.spaceId`, `payment.spaceId` e `capabilities.finance`.
Não havia literal `business_adi-festa`: ele resultava da concatenação com a
empresa atual. A automação ativa desse destino global acabava recebendo
inclusive vendas QA de espaços sem Financeiro.

| Caminho | Fonte canônica e problema | Tratamento local |
| --- | --- | --- |
| Venda manual | `Vendas.registrar` já grava empresa/espaço e baixa estoque na operação canônica | Mesmo fluxo; trigger resolve exatamente o espaço da venda |
| Loja V2 | Finalização usa a mesma venda canônica (`online-sale:*`, `onlineOrderId`) | Mesma regra; agora respeita também `autoIncome.onlineOrders` |
| Renovação comercial | Checkout + `CustomerSubscriptions.applySaleInData` criam venda e eventos de vigência | Receita somente pela venda canônica, nunca pelo evento de renovação |
| Recebimento de fiado | `Fiados.receber` não persistia espaço de origem | Formulários mostram espaço; pagamento e movimento preservam essa origem |
| Cancelamento/estorno | Receita e atualização da reversão original eram transações separadas | Entrada, evento, conta e marca da reversão na mesma transação |
| Reconciliação de receitas | Abrir Financeiro podia varrer vendas/pagamentos antigos e recriar receitas | Sem reprocessamento automático; callable compatível retorna necessidade de autorização |
| Evidência de saldo faltante | Serviço podia modificar pagamento/criar efeito histórico automaticamente | Removido desse serviço de projeção; nenhuma escrita em cliente/pagamento/balanceEvent |
| Custos/margens | `sale-cost-service` cria snapshot protegido de custo/lucro | Preservado: não é receita, lançamento bancário nem saldo disponível |
| Lançamentos manuais, recorrências financeiras e transferências | Serviço financeiro existente recebe espaço explícito autorizado | Sem mudança de arquitetura ou de regras de negócio |
| Cobrança da VECONI | Assinaturas SaaS/Mercado Pago têm serviços separados | Não alterados |

Não foi identificado outro produtor backend de `automatic_income`.
O provisionamento do primeiro espaço ainda pode dar a ele um ID determinístico;
isso não o transforma em destino de vendas de outros espaços.

## Regra final

1. Origem deve conter `spaceId` concreto; `all`, `all_spaces`, ausência e alias
   `financialSpaceId` conflitante são recusados. Não inferir por cliente/produto.
2. Documento `financialSpaces/{source.spaceId}` deve existir, estar ativo,
   pertencer inequivocamente à empresa e ter o mesmo proprietário da empresa.
3. `finance=false` bloqueia imediatamente qualquer projeção automática.
   No schema moderno exige `finance=true` e `sales=true`. O schema antigo sem
   mapa de capacidades só permanece compatível quando é `type=business`, possui
   vínculo explícito com a empresa e a origem nomeia exatamente esse espaço.
4. Receita também respeita automação habilitada, flags por tipo e ativação já
   configuradas naquele espaço. Nenhuma configuração foi habilitada automaticamente.
5. Fiado não quitado não vira receita. Cartão integrado continua recebível;
   não inventa dinheiro em conta bancária. Pedido/carrinho/reserva não gera receita.
6. Dentro da transação, reler espaço, fonte canônica, geração e recibo de rota.
   Mudança concorrente de capacidade/origem/estado aborta a projeção.
7. Destino da entrada e do evento é sempre o próprio espaço da origem.
   Conta bancária compartilhada só pode ser usada se foi explicitamente configurada
   naquela automação, é do mesmo owner e permite o espaço. A entrada não muda de espaço.
8. Sem espaço/evidência segura: pular com motivo técnico; nunca usar fallback global.

## Idempotência e preservação histórica

Entradas mantêm IDs `sale_<saleId>` / `credit_payment_<paymentId>`.
O recibo server-only `businesses/{businessId}/financialIncomeRoutes/{sha256}`
fixa a rota por fonte e impede reaplicá-la em outro espaço. Entrada, evento,
recibo e saldo da conta são atômicos. Rules impedem escrita frontend no recibo,
fixam espaço dos pagamentos e respeitam acesso do funcionário.
A coleção foi classificada como operacional na política de reset; nenhum reset foi executado.

O único uso de `business_${businessId}` no novo serviço é uma **leitura defensiva**
de entrada histórica já existente, nunca destino alternativo de escrita. Se a
mesma fonte já gerou entrada ali e agora aponta para outro espaço, não copiar,
não mover e não estornar automaticamente. Registrar `historical-entry-in-other-space`.

Atualização de metadados de fonte já paga não autoriza gerar uma receita antiga.
Não existem scans/backfills históricos nesta correção. Pagamentos legados sem
origem permanecem intactos e não ganham espaço por inferência; clientes antigos
devem atualizar o PWA para produzir novos recebimentos com origem explícita.

A entrada histórica real de R$25 e as vendas reais não foram acessadas/escritas
nesta tarefa. O teste cria uma réplica **sintética** no Emulator e verifica que
o conteúdo é exatamente igual após projeções, retries e tentativa de nova rota.

Reversão limita o acumulado ao valor original e é idempotente por operação.
Se o Financeiro do espaço foi desabilitado, não cria lançamento de reversão.
Se a conta original não pode mais ser usada, retorna
`original-account-requires-review`, sem alterar outra conta. Essas exceções
exigem revisão específica, não correção genérica.

## Consumo e auditoria

Sem listener, job ou varredura global novos. Há um recibo adicional por fonte
projetada (não por retry). Caminho com `finance=false`: somente leitura do
espaço, zero escrita financeira. Uma receita sem conta faz normalmente 8 leituras
de documentos (incluindo fence/validação transacional e guarda histórica) e 3
escritas (entrada/evento/recibo); conta configurada soma uma leitura e uma atualização.
Em espaço cujo ID já coincide com o antigo default, a guarda histórica não faz
leitura adicional. Retries de transação podem repetir leituras.

Os dois triggers existentes ganham retry para falha transitória. Logs contêm
empresa/espaço/fonte/destino, resultado e motivo; não contêm cliente completo,
token, senha ou valores financeiros completos do documento.

## Validação local

- App: 666 testes unitários/integração, incluindo recebimento por espaço,
  fiado preservado, retry e bloqueio de origem não autorizada.
- Backend: 140 testes.
- Emulator: 172 testes, incluindo roteamento/estoque canônico e Rules, além da regressão
  completa de Auth, loja, estoque, espaços, equipe, pagamentos e Storage.
- Fixture QA sem Financeiro: estoque 2 → 1; uma venda; nenhuma receita e saldo
  bancário inalterado. Recorrência comercial, recebimento e online também bloqueados.
- Financeiro ativo: estoque 2 → 1; três entregas concorrentes → uma receita de
  R$25 no espaço correto; outro espaço recebe somente sua receita de R$25.
  Consolidação pelo `FinancialEngine` existente soma R$50, sem QA.
- Cancelamento: uma reversão, conta retorna ao valor anterior; pedido/venda já
  cancelado sem entrada anterior não cria receita; aprovação atrasada é descartada.
- Falha antes do commit e resposta perdida depois do commit: retry sem duplicação.
- Roteamento cruzado, empresa errada, origem ausente, capability alterada durante
  operação e conta compartilhada foram cobertos.
- Lint, build e `git diff --check` executados. Sem deploy nesta etapa.

Os resultados exatos e a execução final do Emulator constam em
`artifacts/financial-scope-{app-tests,functions-tests,emulator-full,emulator-targeted}.txt`.
Navegador/Android físico e produção ainda dependem do smoke controlado posterior
da V170. Esta validação não é uma certificação de produção.

## Arquivos alterados nesta correção

- `functions/src/services/financial-income-service.js`: roteamento, validação,
  recibo idempotente, reversão atômica e remoção de backfill automático.
- `functions/src/index.js`: contexto before/after, logs por espaço e retry nos dois triggers existentes.
- `functions/src/services/workspace-reset-policy.js`: classifica os recibos de projeção.
- `firestore.rules`: origem imutável dos recebimentos e proteção server-only dos recibos.
- `js/fiados.js`: preserva origem em recebimentos/retries/confirmações.
- `js/clientes-page.js` e `js/app.js`: escolha explícita do espaço nos dois formulários de recebimento.
- `js/firebase/financial-space-service.js`: não solicita reconciliação retroativa ao abrir o módulo.
- `functions/test/financial-income.test.js`: contratos de roteamento e origem online V2.
- `functions/test/financial-income-emulator.js`: cenário financeiro integrado sintético,
  protegido para executar/limpar somente no Emulator loopback.
- `tests/emulator/financial-routing.rules.test.js`: integração, concorrência e Rules.
- `tests/financial-space-routing.test.js`: regressão de recebimentos e limites da projeção.
- `tests/financial-home-v129.test.js` e `tests/financial-module-v1.test.js`:
  atualizam o contrato esperado de não reprocessamento retroativo.
- `docs/financial-income-space-isolation.md`: este relatório.

Arquivos e artefatos locais preexistentes de outras etapas foram preservados,
sem incluí-los nesta correção. Nenhuma alteração em APP_VERSION, service worker,
domínio, Auth, assinaturas, Mercado Pago ou configuração de produção.
