# 3 Lindas — continuidade operacional e migração simplificada

> Registro histórico da preparação em 03/11. O estado atual, a extensão já aplicada, a base visual publicada, o manifesto integrado e as decisões vigentes estão em [billing-continuity-v226-integration.md](billing-continuity-v226-integration.md). As propostas abaixo não devem ser executadas a partir deste snapshot.

Preparação local, sem autorização para executar alterações remotas.

- Worktree: `C:/Users/Murillo/Documents/VECONI-Billing-Continuity`.
- Branch: `codex/billing-continuity-3l`.
- Base: V226 publicada, `5957fb9b1e78481f940f58766e17257cc1b0336f`, preservando a cobrança V225 `e83635c0fee645ffeaf1a4dea9c6480cc153a2f9`.
- Hotfix visual isolado e preservado: `c06402d494b1e529ea7d8498f6406499873bfacf`. Nenhum arquivo desse hotfix foi incorporado nesta branch.
- Nenhum push, deploy, pagamento, cancelamento, reparação, extensão ou mudança de permissão foi executado.

## 1. Extensão administrativa: operação pronta para autorização

Empresa canônica: **3 Lindas Cosméticos**, `biz_WWyiExJw9INyUjElqsIo28ozS403`.

Leitura de **03/11/2026 às 23:34:44, Brasília**:

- Empresa ativa, owner canônico e funcionária ativos no Auth, perfil e membership da empresa correta.
- Owner com todos os espaços; seller limitado ao espaço empresarial já autorizado, com `sales.create` preservado.
- `canMutate: true`, `readOnly: false` pelo mesmo código de entitlement publicado. Não foi feito login em nome de nenhum deles nem uma venda real de teste.
- A tolerância **continua terminando em 04/11/2026 às 12:07:44**, Brasília. Não foi prorrogada.
- Financeiro verdadeiro: assinatura `pending`, pagamento de novembro `rejected`; vencimento financeiro anterior em 01/11 permanece inalterado.

### Operação proposta

Prorrogar exclusivamente essa empresa até **06/11/2026 às 23:59:59, Brasília**, equivalente a **`2026-11-07T02:59:59.000Z`**.

Usar a ponte administrativa legada existente, com uma única transação/commit condicionado ao `updateTime` fresco do documento da empresa, mais um novo registro de auditoria com precondição de inexistência. Não há deploy necessário para essa alteração administrativa.

Atualizações exatas:

| Campo | Novo valor / regra |
| --- | --- |
| `subscription.legacyTransition.paidThrough` | `2026-11-07T02:59:59.000Z` |
| `subscription.legacyTransition.paidThroughAt` | Firestore Timestamp do mesmo instante |
| `subscription.legacyTransition.administrativeGrantId` | `renewal_20261103_3l_until_20261106` |
| `subscription.administrativeAccess` | Nova concessão administrativa com empresa exata, início obtido de `readTime` fresco do servidor, término fixo acima, motivo, administrador autenticado, referência da autorização específica, `financialConfirmation:false`, `paymentCreated:false` e referência à concessão anterior |

Auditoria proposta: `businesses/{businessId}/auditLogs/subscription_emergency_renewal_20261103_3l_until_20261106`, criada no mesmo commit, com concessão anterior preservada, hashes antes/depois, campos alterados, instante `REQUEST_TIME`, identidade administrativa e autorização. A auditoria original de 02/11 permanece intacta.

A nova solicitação excede o prazo original de 48 horas. Por isso a proposta é uma **nova extensão com limite absoluto**, e não uma alteração silenciosa da concessão de 48 horas. A duração máxima registrada será recalculada no instante da execução; o término obrigatório permanece fixo em 06/11 às 23:59:59. O limite original continua preservado no histórico.

Não alterar status financeiro, plano, valor, descontos, métodos, `currentPeriodStart/End`, `expiresAt`, `nextBillingDate`, `lastPaymentDate`, `lastPaymentStatus`, contratos do provedor, `legacyTransition.financialPaidThrough`, usuários, memberships, permissões, espaços, vendas ou filas.

O compilador `scripts/plan-subscription-extension.cjs` é puro: não possui cliente de rede nem modo de aplicação. A prévia exata foi compilada a partir do documento real em leitura e armazenada somente no diretório privado de suporte. Ela é uma proposta, não uma autorização executável.

### Verificações e riscos

- Reconsultar empresa, owner/seller e provedor imediatamente antes da execução. Interromper se houver aprovação, migração ativada, alteração de plano, identidade/vínculos divergentes, tolerância já expirada ou alteração concorrente do documento.
- Atualizar a prévia com horário do servidor e identidade administrativa atuais; não aplicar um snapshot antigo.
- Preservar as features/limites anteriores. O código e as Rules publicadas usam vigência explícita; o acesso cessa no instante final, independentemente do status `pending` ou de um scheduler.
- No Emulator, owner e seller autorizado registram venda/Fiado com estoque uma vez; retry não duplica o efeito. Fora do espaço autorizado continua bloqueado.
- Webhook do contrato antigo retorna `legacy-transition-frozen`, preservando a ponte administrativa. Pix/cartão pendentes ou recusados preservam o prazo, plano e contabilidade. Aprovação oficial legítima de um novo plano segue o fluxo de ativação e pode substituir a tolerância por acesso pago, sem que isso represente encerramento indevido.
- A extensão não neutraliza uma cobrança no Mercado Pago e não quita fatura. Se chegar aprovação antiga, deve ser conferida separadamente; não representa pagamento do novo Pro.
- Após a mudança autorizada, consultar novamente o documento e o entitlement. O cliente pode receber o contexto pelo listener/reabertura normal; não limpar, reinstalar, sair da conta ou reenviar filas.

**GO técnico condicionado à autorização específica para essa extensão e a um preflight fresco. Não executada.**

## 2. Migração: diagnóstico financeiro e implementação local

### Situação real

- Contrato `fa11e5556a2544849724a18edbbee363`: **cancelled**, valor antigo R$50,34.
- Fatura `7033459293`: **cancelled**; `next_retry_date` ainda contém **03/11/2026 às 23:13:56, Brasília**.
- Pagamento `186156222417`: **rejected**, sem data de aprovação e sem mudança desde 01/11. Motivo confirmado do provedor: `cc_rejected_insufficient_amount`.
- A busca paginada pela referência externa exata continua mostrando somente duas aprovações antigas de setembro/outubro e a recusa de novembro. Nenhum pagamento novo pendente/processando/aprovado foi encontrado nesse recorte.
- A última leitura foi posterior ao horário da retentativa, mas isso **não comprova que a data seja inofensiva** nem garante ausência de execução tardia.
- O proprietário informou que **ainda não há confirmação do suporte Mercado Pago** sobre a não executabilidade dessa data após o cancelamento.
- O guard publicado continua bloqueando a nova contratação. O código local agora distingue “retentativa ativa/agendada” de “contrato/fatura cancelados com data ainda não comprovada”. Ambos bloqueiam sem evidência suficiente.

A documentação oficial descreve o [cancelamento da assinatura](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management) e informa que [cancelar o assinante interrompe seus pagamentos](https://www.mercadopago.com.br/developers/pt/docs/subscription-plans/manage-subscription-plan). Não foi encontrada garantia explícita de que todo `next_retry_date` retido em uma fatura cancelada seja não executável. Não inferir essa garantia de documentação de Orders/Point ou apenas da passagem do horário.

As buscas atuais estão limitadas aos IDs canônicos e referências exatas conferidas. Não se afirma descoberta exaustiva de possíveis contratos órfãos por filtros que o provedor não garante. O novo guard não transforma ausência de evidência em autorização.

### Guard corrigido localmente, sem liberação indevida

Novo módulo `legacy-cancellation-evidence.js`, chamado somente pelos caminhos de intake/consulta:

1. `scheduled`, `recycling`, contrato não cancelado, pagamento aprovado/em processamento, resposta incompleta/desconhecida e divergência de identidade continuam bloqueados.
2. Contrato e fatura ambos cancelados com pagamento rejeitado/cancelado e data retida passam a **`legacy-source-retry-unverified`**, sem declarar agendamento ativo nem liberar contratação.
3. Aceitar a data como residual exige documento administrativo privado em `billingLegacyCancellationProofs/{hash}`, contendo confirmação real do suporte Mercado Pago, referência/protocolo, hash da evidência, administrador, empresa/owner/contrato/fatura/pagamento exatos, datas observadas, hash da fatura (incluindo o contador de tentativas) e validade máxima de 24 horas. O documento precisa de autorização administrativa específica; não foi criado.
4. Prova isolada não basta: consultas GET independentes à fatura e pagamento, antes e depois da varredura completa das faturas, devem continuar coincidindo com a prova e com o contrato. Uma aprovação tardia, valor/moeda divergente, data alterada, prova vencida ou mudança de estado interrompe o fluxo.
5. O check de intake continua vinculado à empresa/owner, fingerprint e janela máxima de 15 segundos; a validade da prova também é testada antes da transação. Não há exceção por ID da 3 Lindas nem flag enviada pelo navegador que libere cobrança.

O namespace privado foi testado contra as Rules publicadas: owner, seller, outro usuário e anônimo não podem ler nem gravar a prova. **Nenhum patch de Rules é necessário ou está proposto.** Não houve alteração de IAM ou infraestrutura.

### Reserva `creating`

Operação preservada: `f58b3ecf-95b2-4c99-922b-4627eb89304c`.
Hash original: `987d3b0eccb7eaf84a7da0c642cfbaf61cb3e666baa3162fc174f1ebf6fc0b7e`.

- Reserva `creating`, tentativa `failed`, hashes coincidentes.
- Sem replacement, ativação, Order/Payment ID ou pagamento aprovado vinculado.
- Busca Orders pela referência exata: zero. Índices/eventos/recibos de conciliação relacionados encontrados: zero.
- A versão antiga não persistiu `creationOutcome/providerCreateHttpStatus`. A prova administrativa exigida pelo fluxo continua ausente.
- O log original preservado comprova HTTP400 `unsupported_properties` na revisão `createsubscription-00027-yub`; uma prévia privada de atestado foi preparada com hash desse conjunto de logs. **Prévia não é atestado aplicado**, e não foi criada autorização no Firestore.

`scripts/plan-billing-reservation-proof.cjs` prepara um rascunho de curta duração, sem gravar nem reparar. O fluxo publicado `createSubscription(action:'recover_failed_migration')` continua sendo o único caminho para fechar a reserva: autorização do owner, GETs, prova administrativa, lease, checagem final, histórico e auditoria idempotentes. A prova da rejeição HTTP400 e a prova sobre a retentativa cancelada são **distintas e não se substituem**.

**NO-GO para reparar ou iniciar nova contratação agora:** falta confirmação do Mercado Pago e sua comprovação administrativa, além da autorização específica para o atestado/reparação. Não foi reenviada a tentativa original.

### Aviso e checkout

- `js/plans.js`: aviso de regularização ao abrir a VECONI, somente para owner canônico autenticado, ativo e coerente com a empresa. Seller/manager não recebem controles de contratação por esse aviso.
- O aviso mostra o prazo administrativo sem chamar a tolerância de pagamento; não bloqueia o caixa nem cria modal de cobrança automaticamente.
- “Consultar migração” chama `getBillingCheckoutConfig` com `catalogOnly:true, checkMigrationEligibility:true`. Resposta somente leitura, sem token que autorize pagamento, sem criação de cotação/reserva, cobrança ou reparação.
- Empresa/conta alterada durante a consulta invalida a resposta. Cliques repetidos são bloqueados, falha restaura o botão e o texto é apresentado inline.
- A consulta pode orientar a verificar a reserva, aguardar pagamento já existente ou abrir Planos para revisar a cotação. Nunca abre/cria checkout automaticamente.
- O contrato padrão de `getBillingCheckoutConfig` para V225/V226 permanece inalterado quando o novo parâmetro não é enviado. Apenas o novo pedido explícito chama a consulta adicional.
- Reutilizado integralmente o checkout atual, com cotação/validação no servidor, consentimento e IDs idempotentes. Nenhum preço antigo ou desconto foi reaproveitado como pagamento do novo plano.
- O catálogo V2 identifica **Pro por `premium`**, preço mensal de tabela **R$119,90**. O valor final depende da cotação vigente, período e eventual cupom autorizado. Não foi emitida uma cotação financeira real nem escolhido um desconto para o proprietário nesta tarefa.

### Escopo e publicação futura

O único corpo de Function alterado é `getBillingCheckoutConfig`. `createSubscription` mantém seu handler, mas precisa ser republicada para incluir a dependência corrigida do guard, comum à contratação e reparação. Nenhuma Function nova.

Manifesto exato: `releases/billing-continuity/deploy-manifest.json`.

Sequência proposta, **não executada**:

1. Priorizar a extensão administrativa separada, após autorização, sem depender de deploy.
2. Obter a confirmação Mercado Pago. Se ela não existir, preservar o bloqueio; a correção diagnóstica não deve ser apresentada como migração liberada.
3. Homologar aviso e checkout em Android/PWA QA; preparar metadados/cache da versão isolada antes de autorizar a publicação. Este commit é candidato funcional local, não artefato comercial final liberado.
4. Preflight de produção e autorização seletiva. Publicar `getBillingCheckoutConfig`, validar leitura/compatibilidade, depois `createSubscription` com a dependência corrigida; conferir revisão, pacote, variáveis e secrets a cada etapa. Não publicar outras Functions.
5. QA autenticado com mocks/identidades sintéticas, nenhuma operação financeira em produção. Somente depois, frontend/PWA isolado de cobrança, sem cherry-pick do hotfix visual V226 e sem Rules/índices/V3/Google.
6. Após autorização administrativa específica, registrar a comprovação do cancelamento/retentativa e o atestado da falha HTTP400, com auditoria e validade curta. Owner usa “Verificar tentativa interrompida” no fluxo existente. Não alterar payload/hash original.
7. Owner escolhe Pro no catálogo, confere valor e meio, confirma uma única contratação. Pix: aguardar QR/pagamento e webhook/conciliação oficial. Cartão: somente SDK/Device ID legítimos e consentimento. Resposta perdida exige consulta da mesma tentativa, não nova cobrança.
8. Confirmar ativação oficial, idempotência, período contratado, situação final do contrato antigo e preservação da operação da funcionária. Não contabilizar a tolerância como período pago.

Rollback: fonte base `5957fb9…` compatível com V226 e cobrança V225, por publicação seletiva dos mesmos dois alvos, sem restaurar Rules antigas. Se necessário, suspender somente novos checkouts mediante autorização específica, preservando consultas, webhooks e conciliação. O guard antigo é mais conservador para a data retida, não permissivo. Preservar provas, histórico de reparação, IDs, pagamentos e assinaturas já legítimos; não apagar documentos nem repetir operações. Não usar um ZIP de V225 que sobrescreva as Functions V226. Nenhum rollback foi executado.

## 3. Testes e preservação

- **323 testes unitários/DOM aprovados**, zero falhas, incluindo webhook Orders/HMAC, janelas temporais, antirreplay, Pix/cartão, cotações, concorrência, mensagens, provas privadas e prévias administrativas.
- **60 cenários Emulator aprovados**, zero falhas: nove de continuidade/tolerância, Rules e prova privada, dezessete de migração e trinta e quatro de integração autenticada/Auth, fluxo de reparação, resposta perdida, duplicação e conciliação. Todos os recursos são fictícios e os pedidos financeiros usam mocks locais.
- A consulta nova foi exercitada com token real do Auth Emulator, owner/seller QA e as callable handlers do candidato. Não foi declarado teste de pagamento real/Sandbox nem confirmação do suporte.
- Lint, build, diff-check e gate seletivo aprovados; devem ser revalidados no preflight de publicação.
- Os dez hashes originais V225 e os demais manifests corretivos permanecem imutáveis como referência. As novas correções estão documentadas separadamente.
- Guard, status e aviso não mudam webhooks, ativação, cancelamento, preços, Pix/card payloads ou mecanismo de prova da recuperação. O corpo das demais Functions é idêntico à base. Sync, Rules, Google, permissões, caixas, dados comerciais e artefatos locais existentes preservados.

## 4. Hotfix visual V226 e próximas autorizações

`c06402d494b1e529ea7d8498f6406499873bfacf` permanece na branch original, sem alterações. Continua **NO-GO para publicação**, pois a causa do lucro no Android original não foi comprovada e falta homologação visual/física. Não incluído neste pacote financeiro.

Roteiro Android/PWA preservado no relatório do hotfix: conferir conta/empresa, espaços autorizados, lucro/estado de revisão, carrinho, entrada de venda anterior após sessão tardia e seletor com múltiplos espaços. Sem venda real de teste, limpeza, logout, reenvio ou manipulação de filas. Uma futura autorização de cobrança não autoriza publicar esse hotfix visual.

Próximas autorizações, separadas:

1. **Prorrogar a tolerância exclusivamente da 3 Lindas até 06/11/2026 às 23:59:59, Brasília**, nos quatro campos e auditoria descritos, após preflight fresco.
2. Após confirmação Mercado Pago e QA físico, autorizar o deploy seletivo do pacote de migração. **NO-GO para contratação real enquanto a retentativa estiver indeterminada.**
3. Autorizar as provas administrativas e a reparação individual da reserva; confirmação pelo owner no aplicativo.
4. O owner confere a cotação Pro e confirma o pagamento por conta própria. Nenhuma autorização genérica deste preparo cria cobrança.
5. Hotfix visual: autorização própria somente após resolver seu NO-GO e homologar o candidato.
