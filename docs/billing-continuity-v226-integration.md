# Migração da 3 Lindas sobre a V226 homologada

## Base e isolamento

Produção confirmada em 04/11/2026 às 15h15, Brasília: `f1fa1fa574538a5129755ae3baf899ec1c4bcb93`, workflow `41864992826` concluído; build `2026-11-04T16:24:04Z`. Domínio, metadados, worker, dois recursos do modal e plans.js conferidos por hash.

Branch de integração: `codex/billing-continuity-on-v226`, checkout isolado `C:/Users/Murillo/Documents/VECONI-Billing-Continuity`. Fonte `0c37c1161677a57cbdb74a3c2e35125c6f7ebc0c` aplicada sem conflitos. A branch original `codex/billing-continuity-3l` continua apontando para esse commit.

Hotfixes `c06402d…` e `f1fa1fa…` inteiramente preservados na base. Não mudam caixa, modal retroativo, espaços, lucro, estoque, Sync, filas, Google, Rules, índices ou V3. O relatório anterior permanece como registro histórico, sem substituir este estado atualizado.

## Diagnóstico remoto — somente leitura

Consulta em **04/11/2026 às 15h10, Brasília**, empresa `biz_WWyiExJw9INyUjElqsIo28ozS403`:

| Recurso | Situação comprovada |
| --- | --- |
| Acesso | Owner canônico e funcionária ativos no Auth, perfil e membership corretos. Ambos podem vender nos espaços já autorizados pela avaliação do entitlement e permissões existentes; nenhuma venda foi realizada para testar. |
| Tolerância | Até **06/11 às 23h59min59s, Brasília**, `2026-11-07T02:59:59Z`; `canMutate:true`, `readOnly:false`, `financialConfirmation:false`, `paymentCreated:false`. |
| Financeiro | Legado `pending`, último pagamento `rejected`, vencimento financeiro preservado; Pro V2 não ativado. |
| Contrato antigo | `fa11e5556a2544849724a18edbbee363`, cancelado, R$50,34. |
| Fatura antiga | `7033459293`, cancelada; `next_retry_date` permanece em 03/11 às 23h13min56s, Brasília, contador 1. |
| Pagamento de novembro | `186156222417`, recusado, sem aprovação/alteração desde 01/11. |
| Busca por referência exata | Somente aprovações de setembro/outubro e recusa de novembro; nenhuma nova cobrança pendente/processando/aprovada encontrada nesse recorte. |
| Reserva | `f58b3ecf-95b2-4c99-922b-4627eb89304c`, `creating`; tentativa `failed`, request hashes coincidentes. |
| Vínculos | Sem Order, Payment ID, replacement, aprovação ou ativação. Busca Orders da referência exata: zero; índices/eventos/provas de conciliação relacionados: zero. |
| Provas | Ausentes tanto a prova privada de não executabilidade da retentativa quanto a autorização administrativa de reparação. |

Hash original: `987d3b0eccb7eaf84a7da0c642cfbaf61cb3e666baa3162fc174f1ebf6fc0b7e`.

As buscas cobrem IDs e referências canônicos; não comprovam ausência universal de contratos órfãos ou eventos tardios fora desse recorte. A extensão já aplicada não foi repetida ou modificada.

## Bloqueadores financeiros preservados

O guard publicado retorna `legacy-source-retry-scheduled`; o candidato distingue cancelamento com data retida usando `legacy-source-retry-unverified`, mas **mantém a contratação e a reparação bloqueadas**.

A [documentação oficial](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management) descreve o cancelamento, sem especificar a garantia desse campo residual. Nem a passagem do horário nem a ausência de novo débito são usadas como prova de não executabilidade.

Aceitar a data como residual exige confirmação real do Mercado Pago, protocolo/evidência verificável e autorização administrativa específica. A prova privada vincula empresa, owner, contrato, fatura, pagamento, hash do snapshot e prazo máximo de 24 horas. GETs independentes antes/depois da varredura devem continuar concordando. Agendamento efetivo, aprovação tardia, estado desconhecido, divergência ou prova expirada continuam bloqueando.

O candidato foi avaliado localmente com GETs reais: prova ausente, resposta bloqueada, nenhuma mutação. Isso não representa publicação do novo endpoint nem autenticação em nome do proprietário.

A reserva antiga não persistiu `creationOutcome/providerCreateHttpStatus`. O log histórico HTTP400 `unsupported_properties` precisa sustentar um atestado administrativo auditado e curto; ausência de Order não o substitui. `scripts/plan-billing-reservation-proof.cjs` continua apenas preparando rascunho.

Após as provas e autorização específica, o único caminho de reparação continua `createSubscription(action:'recover_failed_migration')`, com owner autenticado, confirmação, GETs, lease, nova verificação final e histórico/auditoria idempotentes. Não reaplicar o payload antigo nem repetir criação financeira.

## Aviso e preço

- Owner canônico ativo e coerente com UID, perfil, membership e empresa vê o aviso. Seller, manager, loading/error e contexto divergente não recebem seus controles.
- O aviso não bloqueia caixa, abre cobrança ou inicia checkout automaticamente. “Consultar migração” usa o novo parâmetro opcional de leitura de `getBillingCheckoutConfig`.
- A oferta vem do catálogo backend (`requirePlan('premium')`, `planBilling`), sem valor antigo ou fallback local. Catálogo do candidato: Pro mensal **R$119,90**, sem desconto aplicado. Não foi gerada cotação financeira real ou cobrança.
- Oferta consultiva válida por cinco minutos. Dados inválidos/expirados não mostram preço; nova consulta/falha remove a anterior, e expiração retira o valor. Troca de conta/empresa descarta resposta; cliques repetidos são coalescidos.
- A oferta não autoriza pagamento nem libera o guard. Cotação final, cupons, meio e consentimento continuam no checkout existente, validados no servidor. O valor R$50,34 jamais quita o novo Pro.
- Clientes V225/V226 que não enviam o novo parâmetro mantêm o contrato padrão da callable.
- Pendência/recusa e webhook antigo preservam a tolerância; aprovação legítima do plano novo segue exclusivamente a conciliação existente.

## Escopo seletivo

1. `getBillingCheckoutConfig`: leitura opcional de elegibilidade/oferta.
2. `createSubscription`: handler idêntico ao publicado; atualização somente pela dependência do guard.

Runtime: `functions/src/index.js`, `legacy-source-billing-guard.js`, novos `legacy-cancellation-evidence.js` e `billing-migration-status-service.js`, e `js/plans.js`. Demais handlers e 94 exports do fonte preservados; não remover endpoints históricos existentes no projeto.

Revisões observadas ACTIVE: `getbillingcheckoutconfig-00009-nid`, `createsubscription-00028-wir`, `receivewebhook-00026-wem`.

Os dez hashes originais e manifests corretivos V225 permanecem imutáveis como referência. Webhooks Orders/HMAC, capitalização, timestamps 10/13 dígitos, janela, comparação constante, antirreplay, payloads financeiros, ativação e conciliação não mudam. Não há patch de Rules, índices, Auth ou V3; clientes não conseguem gravar/ler as provas administrativas privadas pelas Rules existentes.

## Testes

- **334 testes unitários/DOM** aprovados, zero falhas/skips, incluindo preço vindo da resposta backend, oferta inválida/expirada, owner/seller, concorrência, guard, provas, Pix/cartão e Orders.
- **95 regressões V226/contensão pública** aprovadas. Gates estáticos de releases anteriores, que por definição não aceitam um diff financeiro posterior, foram excluídos da seleção; o gate integrado substitui a verificação de escopo e protege os fontes V226 publicados. Cenários comportamentais e cinco declarações obrigatórias foram executados.
- **60 cenários Emulator** aprovados: nove continuidade/Rules/provas, dezessete legado e trinta e quatro callable autenticada/migração, reserva, recusa/aprovação, resposta perdida, duplicidade e conciliação. Somente identidades sintéticas e provedor mockado; nenhum pedido financeiro real.
- Lint/build aprovados, 484 arquivos JavaScript; gate integrado/diff-check aprovados.
- A homologação física V226 informada permanece preservada. O novo aviso ainda requer conferência própria Android/PWA; não se declara essa etapa concluída.

Evidências: `C:/Users/Murillo/.codex/visualizations/2026/11/04/billing-continuity-v226/`: `CURRENT.json`, `PRODUCTION.json`, `LOCAL-GUARD-READONLY.json`, testes e `ARTIFACTS.json`. Sem senhas/tokens nos relatórios.

## Plano de publicação — não executado

1. Obter autorização específica e fazer preflight fresco de main/domínio, fontes, revisões, configuração/IAM/variáveis/secrets e ZIPs sem `.env*`/arquivos inesperados.
2. Atualizar apenas `getBillingCheckoutConfig`; conferir ACTIVE, compatibilidade do contrato padrão e consulta owner-only em QA sem gravação.
3. Atualizar apenas `createSubscription`; conferir revisão e dependência do guard. Não iniciar contratação real para validar.
4. QA autenticado de leitura com identidades QA; efeitos financeiros somente no Emulator. Interromper por divergência, autorização indevida ou regressão.
5. Publicar frontend alterando apenas `js/plans.js`, via Pages, com carimbo de commit do index. Preservar worker e armazenamento V226. Conferir hashes e aviso owner/seller no Android/PWA.
6. Aguardar comprovação do Mercado Pago; depois solicitar autorização distinta para atestados e reparação individual, com leituras imediatamente anteriores.
7. Só então o proprietário escolhe Pro, confere cotação/cupons/método e confirma uma única contratação. Resposta perdida: consultar a mesma operação.

Filtros preparados, **não executados**:

```powershell
firebase deploy --project adi-festa-controle --only functions:getBillingCheckoutConfig
firebase deploy --project adi-festa-controle --only functions:createSubscription
```

Os filtros não dispensam preservar configurações históricas e verificar os pacotes no preflight. Sem Rules, índices, outras Functions ou V3.

## Rollback e decisão

Base compatível: **`f1fa1fa574538a5129755ae3baf899ec1c4bcb93`**, com ambos os hotfixes visuais, backend V226 e cobrança V225.

Após avaliação/autorização: reverter somente o frontend do aviso primeiro; depois, se necessário, os mesmos dois alvos backend com fontes/configurações da base. Não sobrescrever Functions V226 com ZIP antigo de V225. O guard anterior volta a bloquear conservadoramente a data retida. Webhooks, consultas e conciliação permanecem intactos; preservar provas, reservas, IDs e pagamentos já legítimos. Nenhuma restauração de dados, limpeza ou replay; sem rollback automático.

**GO técnico para solicitar publicação seletiva controlada**, condicionado a preflight e autorização. **NO-GO para reparação/contratação real** enquanto faltarem comprovação da retentativa, provas e autorização específica.

Nenhum push, deploy, pagamento, cancelamento, reparação, extensão, alteração de empresa/permissões ou limpeza foi realizado nesta execução.
