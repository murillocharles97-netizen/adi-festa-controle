# V227 — Parcelado integrado ao Fiado por vencimento

## Estado e base

Ajuste local sobre `34d0f28e89cdc1ea0365032785d2480130ecf5d0`, branch `codex/v227-crediario`. A implementação anterior e seu rollback continuam preservados no Git. A base publicada permanece referência `f812c583e8336b142799d0735334f5d2ea330889`. Sem push, deploy, dados comerciais, Mercado Pago, assinatura ou alterações de Rules/índices/V3.

## Arquitetura final

Há **uma conta e um ledger**, os existentes. `clients.saldo` conserva o saldo contábil do total contratado ainda não recebido, com sinal negativo para dívida. Isso preserva IDs, débitos originais, conciliação, cancelamentos, registros antigos e confirmação de recebimentos. Esse campo bruto não é mais usado como valor exigível nas telas adaptadas de Fiado/clientes/dashboard/cobrança. Backup bruto continua preservando o saldo contábil total; não deve ser interpretado como dívida vencida.

O saldo **exigível** é uma projeção determinística, calculada no servidor pelo contrato imutável `sales.installmentPlan`, pelas alocações de pagamentos já existentes e pelo dia em `America/Sao_Paulo`:

- Exigível agora: Fiado tradicional em aberto + entrada vencida + parcelas com vencimento menor ou igual ao dia corrente, descontando alocações.
- Futuras: parcelas não pagas com vencimento posterior.
- Total ainda devido: exigível + futuras. Crédito positivo existente é apresentado separadamente.

Não se cria outro débito ao vencer uma parcela. Cada número de parcela existe uma única vez no plano validado e contribui uma vez para a fórmula. Portanto não há cron, materialização diária, corrida de lançamentos, dependência de abrir o aplicativo ou tarefa que precise recuperar dias perdidos. Uma consulta servidor no primeiro segundo do novo dia já calcula o novo exigível, mesmo sem sessões de aplicativo. Leituras não escrevem dados.

`getOperationalSyncReceipt(kind:'fiado_account')` expõe essa apuração dentro da transação/autorização existente. `commitOperationalSync` refaz a apuração sobre dados canônicos antes de aceitar o pagamento; não confia no saldo ou relógio do navegador. O leitor verifica que o `creditPaidAmount` dos contratos parcelados coincide com os registros imutáveis de `paymentAllocations`. Divergência interrompe, sem reparar ou apagar nada.

O módulo puro `functions/src/shared/fiado-account.js` compartilha as fórmulas com a prévia local. A consulta remota é obrigatória antes de preparar um novo recebimento parcelado. Uma prévia local não é prova financeira; comprovantes continuam dependendo do leitor canônico.

## Recebimento agregado

O botão existente do Fiado recebe o valor do cliente, sem seleção de venda ou parcela. Pix e dinheiro são registros externos; não há iniciação de cobrança. O fluxo write-ahead, `payments`, `paymentAllocations`, `balanceEvents`, `processedOperations`, versão financeira, transação e hash original permanecem.

Alocação determinística: dívida legada sem origem datada primeiro; depois vencimento, data comercial, ID da venda e número da parcela. Fiado tradicional participa pela data comercial; parcelas futuras não são consumidas pelo recebimento comum. Cada alocação registra valor, venda, parcela, vencimento e indicação de antecipação, dentro do evento já existente. A confirmação de campanhas continua no motor existente.

Antecipar exige marcar a opção explícita no mesmo formulário. O valor quita primeiro o exigível mais antigo e somente então as futuras mais antigas; não há desconto, juros ou multa. A antecipação reduz o total e as parcelas futuras sem transformá-las em exigível.

O total recebido reduz o ledger contábil uma vez. O novo exigível é reapurado; nunca se soma o contrato novamente. Duplo clique usa a mesma tentativa; mesmo ID/payload reapresenta o recibo; payload diferente é rejeitado. Concorrência com IDs diferentes e versão financeira antiga não aplica um segundo efeito. Uma tentativa já preparada pode atravessar a virada do mês e ser aplicada com a alocação original, desde que não tenha havido outro movimento financeiro; a data de apuração não pode ser futura. Em conflito, a operação original fica preservada para revisão.

## Exemplo obrigatório comprovado

| Momento | Exigível | Futuras | Total ainda devido |
| --- | ---: | ---: | ---: |
| Antes do primeiro vencimento, com R$50 tradicionais | R$50 | R$2.800 | R$2.850 |
| Primeira parcela de R$280 vence | R$330 | R$2.520 | R$2.850 |
| Recebimento parcial de R$100 | R$230 | R$2.520 | R$2.750 |
| Segunda parcela vence | R$510 | R$2.240 | R$2.750 |

Nesse cenário, os R$100 pagam os R$50 tradicionais mais antigos e R$50 da primeira parcela. Consultar novamente não cria evento de vencimento nem altera saldo ou versão financeira.

## Integração e interface

- Caixa: opção **Parcelado**, cliente obrigatório, entrada zero/opcional, calendário mensal consistente em centavos e meses curtos. Contrato inteiro registrado na data comercial e estoque baixado uma vez.
- Fiado: lista, total e ordenação usam exigível; futuras não aparecem como dívida vencida. Acesso à lista completa de contratos/quitados permanece.
- Cliente/CRM: exigível, futuras, total devido e próximos vencimentos; consulta canônica ao abrir o resumo quando possível. Filtros, cartões, dashboard e mensagens de cobrança passam a usar o exigível nas integrações adaptadas.
- Recibo da venda: valor total contratado e calendário; indicação explícita quando o total inclui futuras. Comprovante do recebimento: saldo exigível atual, futuras e total; existência de futuras impede a classificação de conta totalmente quitada.
- Financeiro: venda Fiado não cria entrada de caixa; o recebimento aplicado gera a entrada existente por ID/data efetiva uma vez, respeitando automação já configurada. Não se ativa automação nem se faz backfill.
- Histórico/CSV: contratos, pagamentos e alocações permanecem; CSV de parcelas continua separado do backup contábil. Nenhuma receita extra surge no vencimento.

## Autorização e escopo técnico

Nenhuma permissão nova, expansão de V3, Rule ou índice. `sales.create`, `customers.receiveDebt`, `customers.view`, empresa, geração, vínculo ativo, entitlement e espaços existentes continuam valendo. Contextos V3 restritivos continuam fora da nova modalidade, sem modificar sua política/projeção. Apuração de conta com venda fora dos espaços autorizados é bloqueada, sem expor ou modificar a dívida alheia.

Backend incremental: serviço de commit operacional, leitor de comprovante e novo serviço de apuração; dois módulos puros de parcelas/conta. Nenhuma coleção nova e nenhum endpoint novo: são extensões dos dois handlers operacionais existentes. O frontend V226 e a migração SaaS não foram publicados ou modificados remotamente. `functions/src/index.js`, `js/plans.js`, motor transacional gerado, módulos SaaS, permissões e Rules permanecem intactos.

Uma publicação futura deve revisar/pacotar as dependências dos handlers operacionais antes de disponibilizar o frontend. Não é uma publicação estática independente.

## Testes e limites

Emulator isolado Auth/Firestore, projeto demo e loopback: exemplo 330→230→510, antecipação, mudança de mês, repetição de leitura sem escrita, concorrência, resposta perdida, reconexão, adulteração, empresa/espaço/permissões/V3, comprovação das alocações, venda/estoque únicos, recibos, projeção de caixa e vendas retroativas V226. O teste de financeiro verifica que a venda mantém R$2.800 na data comercial e somente o recebimento cria caixa, mesmo com entrega duplicada.

Tests de unidade/DOM cobrem calendário, centavos, saldo agregado, contratos inválidos, UI, filtros, recibos e regressões de caixa, Fiado, migração SaaS e hotfixes visuais. O gate histórico de escopo exclusivo do hotfix V226 é substituído pelo gate V227, mantendo os testes comportamentais. Os mocks incompletos do dashboard motivaram chamadas opcionais ao helper de saldo, preservando o fallback tradicional.

Limites explícitos: 350 vendas e 2.000 alocações para apurar uma conta parcelada nesta versão; acima disso interrompe para uma implementação paginada. Fiado sem parcelamento não ganha esse bloqueio de quantidade. Novo recebimento parcelado requer conexão para obter a apuração; os já preparados continuam na fila para reconexão. Divergências preexistentes entre total contábil e alocações exigem conciliação autorizada, sem reparação automática. Não há renegociação, edição de calendário, juros, multa ou desconto automático. Homologação física Android/PWA e multiaparelho real continua pendente. Integrações externas que leiam `clients.saldo` devem tratá-lo como total contábil, usando a apuração para exigível.

## Rollback compatível

A referência nova `codex/rollback-v227-due-account` deriva deste candidato e pausa apenas novos contratos no frontend (`installmentCreationPaused:true`) e no backend (`INSTALLMENT_CREATION_ENABLED=false`). Conserva apuração por vencimento, futuro/total, recebimento agregado, alocações, recibos, IDs, filas e validações. Isso evita voltar à semântica inicial que tratava todas as futuras como exigíveis.

Não usar o rollback antigo `4015cd6…` para este novo modelo. Ele permanece como referência histórica do primeiro candidato. A contenção atual precisa ser homologada com o mesmo exemplo e com recebimentos existentes; nunca restaura dados ou reprocessa movimentos. Aba antiga é contida pelo backend. Operações pendentes ficam preservadas para avaliação.

**GO para homologação local controlada**, condicionado aos resultados finais registrados na entrega. **NO-GO para produção** sem nova autorização, preflight e homologação de implantação. Nenhum push/deploy executado.

## Evidência final do candidato

251 testes locais/DOM/regressões e 57 cenários Emulator aprovados, sem falhas ou skips. QA sintético em 390 e 1366 px aprovou exigível 330, recebimento 100, saldo 230 e opção explícita de antecipação. Pacote público: 257 recursos com manifesto SHA-256 externo; gate preservou 15 arquivos protegidos. Uma execução com suítes simultâneas apresentou transação fechada no Emulator; a execução final serializa os arquivos de suíte, mantendo os testes explícitos de concorrência dentro deles, e passou integralmente. A evidência dessa ocorrência foi conservada.
