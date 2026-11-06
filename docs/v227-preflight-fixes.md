# V227 — correções exclusivas do preflight

Base: `2da941ca0def0b31acbcff0b3d8c94e9ec7a9ddc`. Sem publicação.

## Data comercial

O dia era extraído por `slice(0,10)` do timestamp UTC, enquanto a data de apuração usa São Paulo. A função `FiadoAccount.commercialDay` agora prioriza `priorSale.commercialDate` (V226) ou `commercialDate`; registros antigos usam o instante comercial `occurredAt`/`data`, convertido para `America/Sao_Paulo`, o fuso canônico existente do negócio. `createdAt` não é usado, pois representa registro técnico, especialmente nas vendas retroativas.

Datas civis históricas sem horário mantêm o dia; strings históricas sem offset são tratadas como horário local do negócio, independentes do fuso da máquina. Timestamp Firestore é suportado. Dívida histórica sem data permanece imediatamente exigível; data inválida falha sem alterar dados. Não foi adicionada configuração de fuso por empresa nem reprocessado histórico.

## Calendário exclusivamente no servidor

O calendário canônico é `businesses/{businessId}/sales/{saleId}.installmentPlan`, incluindo entrada, datas, valores e array `installments`. As linhas de recebimento/alocação referenciam esse calendário, não o substituem.

`firestore.v227.rules` é cópia da base publicada `firestore.prior-sales.rules` com uma proteção mínima no bloco de vendas: negar create se o campo existir (inclusive null); negar update se o documento anterior ou posterior contiver o campo. Delete já era negado. Isso cobre inserção aninhada em venda tradicional, alteração de arrays, remoção do campo, substituição integral do documento e alteração direta dos valores pagos numa venda parcelada. Subcoleções alternativas continuam sem allow.

Leituras permanecem idênticas. Os serviços backend autorizados continuam criando contratos e atualizando recebimentos com Admin, após sua validação de permissão e transação. Os caminhos de Fiado tradicional, estoque e clientes não receberam mudanças de Rules. Em particular, o bloqueio preexistente de edição direta de clientes V2 continua ativo: esse fluxo usa backend. Nenhuma política V3 foi ativada. Não se trata de uma reformulação geral das regras históricas de pagamentos.

O patch não remove proteção V226: um teste exige que, retirando exatamente as novas cláusulas, o arquivo seja idêntico à base publicada. Não editar nem publicar `firestore.rules` por engano. Configuração seletiva: `firebase.v227.json`; manifesto: `releases/v227/deploy-manifest.json`.

## Validação

- 265 testes locais/DOM/regressões, sem falhas ou skips; inclui 14 novos casos de datas e fusos.
- 105 testes Emulator finais, sem falhas ou skips: permissões de proprietário/funcionário, usuário sem autorização e proprietário de outra empresa; dez formas de escrita indevida para cada perfil; leituras, Fiado tradicional e fluxo canônico; estoque, financeiro, idempotência, concorrência, resposta perdida, reconexão e V226.
- Cenário às 22h São Paulo: exigível 330, pagamento 100, exigível 230, próximo vencimento 510.
- Lint e build aprovados. Empacotamento: 257 recursos; após alterar o identificador do Service Worker, 47 testes de contenção passaram novamente. Gate de 15 arquivos protegidos e diff-check aprovados.
- A primeira rodada tinha uma expectativa de teste incorreta sobre edição direta de clientes V2; foi corrigida para manter a negação já existente. Um teste V226 também apresentou `Transaction is invalid or closed` no Emulator. O log original foi preservado; a execução final integral passou, sem modificar o serviço V226 nem remover testes de concorrência. A causa dessa ocorrência não foi atribuída definitivamente.

## Publicação e rollback

Manifesto seletivo: após novo preflight e autorização, proteção de calendário nas Rules primeiro, depois apenas `getOperationalSyncReceipt` e `commitOperationalSync`, nessa ordem; frontend em etapa separada. Zero novas Functions. Sem Storage, índices, billing ou migração de dados. Conferir hashes, baseline e revisões ACTIVE imediatamente antes; interromper por divergência, regressão ou escrita indevida permitida.

O rollback novo em `codex/rollback-v227-preflight-fixes` deriva deste candidato e pausa somente a criação de novos contratos no frontend e no commit backend. Mantém estas Rules, a correção de data, consultas, recebimentos, alocações, filas, IDs e dados. Não voltar às Rules anteriores nem às referências antigas de rollback. Testar a referência de contenção antes de considerar aplicação; não executar recuo automático.

**GO para novo preflight e homologação local; publicação não autorizada.** Coexistência com clientes V226 em cache, limites de volume e homologação física Android/PWA e multiaparelho seguem pendentes conforme o preflight anterior. Esta correção não amplia escopo para esses temas.
