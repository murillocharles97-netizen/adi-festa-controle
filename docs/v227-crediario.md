# V227 — crediário próprio, candidato local

## Base e isolamento

Auditoria iniciada em 05/11/2026. `main` remoto confirmado em `f812c583e8336b142799d0735334f5d2ea330889`, sobre `f1fa1fa574538a5129755ae3baf899ec1c4bcb93`. Branch local `codex/v227-crediario`, checkout `C:/Users/Murillo/Documents/VECONI-V227-Crediario`. O checkout antigo da área de trabalho contém alterações de outras frentes e não foi utilizado. O checkout de continuidade da assinatura permanece intacto. O gerenciador de worktrees recusou o repositório fora das pastas deste chat; foi criado worktree Git nativo a partir da base correta.

Não houve push, deploy, consulta de documentos comerciais, cobrança, alteração de assinatura, tolerância, permissões ou limpeza. A consulta remota foi somente da referência Git. QA exclusivamente sintético; Emulator em projeto `demo-veconi-owner-v219`, Auth/Firestore em loopback. Navegador descartável bloqueia rede externa.

## Auditoria da arquitetura

| Domínio | Módulos existentes e integração |
| --- | --- |
| Caixa | `js/checkout.js` prepara carrinho, cliente, espaço, tentativa persistida e confirmação; `js/vendas.js` calcula com `SaleMoney`, cria venda, débito e movimentos de estoque em uma operação write-ahead. |
| Fiado | `js/fiados.js`, `js/campaign-engine-v2.js`: saldo canônico em `clients.saldo`; venda com `creditOriginalAmount`, `creditPaidAmount`, `creditRemainingAmount`; recebimentos em `payments`, alocações em `paymentAllocations`. |
| Clientes | `js/clientes.js`, repositórios e contexto validam cliente/empresa; `prepareSaleCustomer` e `prepareCustomerForSale` preservados. |
| Sincronização | `js/firebase/sync.js`, `commercial-commit-engine.js`, `operational-commit-service.js`: fila write-ahead, versão financeira, transação, hash de payload, `processedOperations`, `balanceEvents` determinísticos. Nenhum segundo pipeline. |
| Estoque | `Vendas.registrar`, movimentos `saida_venda`, commit operacional e proteção de reservas existentes. Uma baixa na confirmação da venda; recebimentos não contêm movimentos de estoque. |
| Recibos | `js/recibos.js` mantém recibo de venda e acrescenta calendário em HTML, texto e imagem. `receipt-message-ui.js`, `receipt-messages.js` e leitor canônico de confirmação continuam responsáveis pelo comprovante de recebimento. |
| Financeiro | `financial-income-service.js` reconhece Fiado como venda não recebida; pagamento aplicado gera `credit_payment_{paymentId}` na data efetiva. Automação/configuração financeira já existente continua sendo respeitada. Não se habilita automação nem se faz backfill. |
| Dashboard/histórico | Venda mantém `data`, `valorFinal` e `formaPagamento:'fiado'`: faturamento na data comercial, dívida no mesmo saldo, caixa somente pelos recebimentos. Histórico mantém IDs/autoria e recibos; novo painel permite consultar parcelas inclusive quitadas. Não foram criados novos totais que somem parcelas ao Fiado. |
| Exportação | Backup existente preserva o objeto adicional da venda e recebimentos. CSV próprio contém parcelas, vencimentos, valores e saldos da visão carregada, com escape de células. Não é um extrato global de dados não hidratados. |

Autorizações preservadas: `sales.create` para vender; `customers.receiveDebt` para receber/consultar o painel; empresa, geração, cliente, espaço, autoria e entitlement no commit existente. Recebimento não concede edição da venda: somente os campos financeiros já permitidos. Rules, índices e política V3 não mudam. Os contextos restritivos cuja projeção não inclui parcelas ficam sem a nova modalidade/painel, sem ampliar a projeção ou as permissões.

## Modelo e invariantes

`sales.installmentPlan` é um contrato imutável versão 1: moeda BRL, total/entrada em centavos, quantidade, primeiro vencimento, data comercial e parcelas numeradas. Quantidade entre 1 e 60; parcelas de ao menos um centavo; entrada menor que o total, inclusive zero. Dias 29–31 são limitados ao último dia de cada mês sem perder a âncora original nos meses seguintes. Resíduo de centavos é distribuído nas primeiras parcelas. Sem juros e multas.

**Uma dívida:** venda continua `formaPagamento:'fiado'` e debita o total uma vez. Calendário não é um segundo ledger. Situação das parcelas deriva de `creditPaidAmount`, alocando primeiro à entrada e depois em ordem de vencimento. Exibe aberta, parcial, quitada ou vencida; uma parcial também informa atraso. Cancelamentos existentes mantêm a venda e o calendário legíveis como cancelados.

**Entrada em duas etapas explícitas:** a entrada combinada NÃO significa dinheiro recebido. Confirma-se a venda, depois registra-se o Pix externo/dinheiro efetivamente recebido pelo mesmo fluxo de recebimentos. A interface e o recibo informam isso. Até esse registro, o saldo inclui a entrada. Nenhuma captura Pix, cartão, boleto, Mercado Pago ou chamada SaaS é iniciada.

`payments.installmentSaleId` identifica recebimento direcionado. O evento existente reduz o saldo do cliente e aloca exatamente àquela venda, sem consumir dívida histórica ou outras vendas. Permite valor parcial ou quitação antecipada, limitado ao restante. O recebimento geral do Fiado continua alocando cronologicamente, inclusive às vendas parceladas. O calendário acompanha ambos sem gravar parcelas mutáveis.

O backend confere envelope, valor pedido/efetivo, método Pix/dinheiro, alocação integral, venda/cliente/espaço e plano; edição do calendário por recebimento é rejeitada. Repetição do ID reapresenta recibo, payload divergente é recusado e concorrência usa a versão financeira existente. Recebimento direcionado local pendente impede novo recebimento direcionado até confirmação. Troca de sessão é conferida nas ações e exportação. A fila original é preservada em falha; não se reprocessa histórico.

## Resultado local e limites

- Caixa com modalidade Crediário / Parcelado, cliente obrigatório, configuração persistida no rascunho e incluída no fingerprint.
- Fiado com painel de parcelas/quitados, recebimento parcial/integral/antecipado e histórico com acesso ao comprovante canônico.
- Recibo de venda HTML/texto/imagem com calendário; CSV próprio; nenhum preço financeiro local relacionado ao SaaS.
- Backend incremental: somente serviço de commit operacional e modelo puro adicional. Sem novas coleções, endpoints ou índices.
- Entrada é recebida em etapa explícita; não há pagamento retroativo editável nesta versão. Data do recebimento é o momento do registro — receber externamente hoje é a operação suportada.
- Antecipação amortiza em ordem de vencimento, sem desconto; não há escolha arbitrária de uma parcela futura nem renegociação de contrato.
- Não há juros, multas, geração de cobranças, lembretes automáticos ou estorno parcial novo. Cancelamento com recebimentos permanece sujeito à conciliação existente.
- QA não substitui homologação física Android/PWA, teste multiaparelho do negócio ou aprovação comercial. V3 restritiva excluída deste candidato.
- Publicação futura exige revisar implantação do commit operacional antes do frontend: o backend V226 não suporta recebimento direcionado que pula dívida histórica. Não publicar apenas o frontend.

## Testes e evidências

Evidências locais em `C:/Users/Murillo/.codex/visualizations/2026/11/05/`: `v227-unit.log`, `v227-regression.log`, `v227-emulator.log`, `v227-build.log`, `v227-browser/browser-results.json` e quatro screenshots.

Resultado: 166 testes de domínio/DOM/caixa/contenção + 120 regressões de recibos/migração/hotfixes aprovados, zero falhas/skips na seleção final. Emulator: 23 cenários aprovados; browser: duas larguras aprovadas. Pacote público: 256 arquivos.

Cobertura: valores fracionados, entrada zero, ano bissexto/fim de mês, plano inválido/adulterado, cliente/método errado, pagamento parcial/antecipado, dívida histórica preservada, tentativa repetida, perda de resposta, concorrência com IDs iguais/diferentes, permissão/espaço, uma baixa de estoque e um débito. Browser em 390/1366 px registra R$140 sintéticos numa venda de R$2.800, resultando em R$2.660 e um único recebimento.

A fixture antiga `financial-domain.test.js` foi atualizada para carregar o `SaleMoney` já exigido pela base. O gate histórico “release diff is limited” do hotfix V226 não se aplica a uma release posterior; os testes comportamentais do hotfix foram executados, e a preservação dos arquivos sensíveis é verificada separadamente pelo gate V227. A falha inicial de teste de valor adulterado motivou validação do envelope original antes da normalização; reteste no Emulator aprovado.

## Rollback compatível

Não retornar cegamente ao frontend V226 depois de registrar crediários. A referência local `codex/rollback-v227-compatible` deriva do candidato e pausa somente novos planos: `installmentCreationPaused:true` no frontend e `INSTALLMENT_CREATION_ENABLED=false` no commit operacional. Mantém leitura, calendário, recebimentos, hashes/IDs, filas, parcelas existentes, conciliação e validação de saldo. Não restaura dados, exclui registros, altera índices nem reexecuta pagamentos.

O bloqueio no backend é necessário para abas antigas; desligar somente a opção visual não bloqueia essas abas. Vendas novas ainda pendentes durante a contenção ficam preservadas para avaliação, nunca descartadas. Recebimentos já registrados continuam confirmáveis/idempotentes. Rollback depende de avaliação e autorização específica; nenhum foi publicado.

**GO para homologação local/sintética do candidato e avaliação visual controlada. NO-GO para produção**, até aprovação específica, revisão de implantação e homologação Android/PWA. A assinatura/migração continua fora do escopo.
