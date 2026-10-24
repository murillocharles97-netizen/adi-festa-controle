# Autorização operacional — candidato local após V201

Base sanitizada: `66e6969ba3b8cdc16053466ab2ae6c80e286ba78`, descendente de `3265f375a6bcd6276e202646725ce63e06a8d20c`.
Sem deploy, migração, consulta a clientes reais, alteração de grants, fila ou cache. Este documento registra a base inicial; a conclusão dos bloqueadores operacionais, testes e plano atual estão em `security-v202-operational-compatibility.md`. A release ainda exige autorização.

## Reprodução dirigida, não nova auditoria geral

Os probes fictícios da V198 foram repetidos contra as Rules da V201 intacta, em `demo-veconi-security-v202`, exclusivamente nos Emulators de loopback. Os 14 casos observados ainda foram reproduzidos; os cinco controles de acesso também se mantiveram. Não é evidência de exploração real.

Já existiam proteções server-only para Trocas/créditos/recuperação/arquivamento e cancelamento canônico. A V200/V201 impede sobrescrever uma venda que já tem `cancellationMode=canonical_transaction`, mas não eliminava as autorizações genéricas de venda, saldo, estoque e recibos.

## Mapa de escritas legítimas e destino

| Fluxo | Caminho V201 | Caminho candidato |
|---|---|---|
| Venda manual, à vista ou Fiado | `commitQueueItem` → transação no navegador | Mesmo envelope/IDs → `commitOperationalSync` → aritmética transacional bufferizada + validação independente → commit atômico |
| Recebimento e ajuste explícito | Sync → cliente, payment/adjustment, balanceEvent e recibo | Mesmo canal autenticado; grants específicos, saldo/versão atuais, fonte e delta conferidos; evento e recibo emitidos juntos |
| Entrada/ajuste de estoque | Sync → produto/variação + movimento | `inventory.adjust`, espaço, produto, reserva e delta conferidos; movimento imutável |
| Cadastro/edição de cliente | Patch genérico | Cadastro não modifica saldo/projeções; alterações cadastrais continuam permitidas |
| Cadastro de produto com estoque inicial | Snapshot sem trilha obrigatória | Entrada inicial determinística e auditável; o espaço deve ser inequívoco |
| Desfazer em até cinco minutos | Snapshot/delta do cliente | Mesmo envelope; servidor exige prazo, última venda, baixas originais e ausência de dependências; preserva ator/ID originais |
| Cancelar venda antiga | `previewSaleCancellation` / `confirmSaleCancellation` | Serviço V201 preservado, sem alteração financeira ou de guards |
| Trocas e crédito | Serviços dedicados | Intactos; o canal genérico não aceita suas coleções, nem contorna suas dependências |
| Recuperação/quarentena | Serviços dedicados | Intactos; revisão/arquivo/recibo terminal impedem replay pelo novo canal |
| Reparo administrativo legado | Transações fora de `commitQueueItem` | `commitFinancialMaintenance`: quatro comandos tipados, autorização administrativa no servidor, auditoria privada e eventos compensatórios |

## Controles implementados

- Rules negam gravações diretas em vendas, pagamentos, balanceEvents, balanceAdjustments, stockMovements, paymentAllocations e processedOperations, inclusive para owner. Não há desligamento dos serviços comerciais: os caminhos autorizados são server-side.
- Cadastro não altera campos financeiros, estatísticas comerciais ou estoque por um patch isolado.
- Servidor autentica UID, vínculo ativo, empresa, geração, plano e espaços; não confia em role/grants enviados pelo cliente.
- Cada efeito primário é tipado; `sales.cancel` não permite create/edição/reativação de venda. Uma operação `simple` também não pode disfarçar edição de venda histórica.
- Eventos financeiros e movimentos são append-only. Recibo usa hash SHA-256 do payload original; conteúdo divergente no mesmo ID é rejeitado. O hash não muda entre retries internos do Firestore.
- Estoque utiliza delta sobre o estado atual, valida variação/pai, aliases, reserva e correspondência integral dos movimentos.
- Confirmação Fiado usa `getOperationalSyncReceipt`, retornando apenas confirmação operacional, sem conceder leitura financeira ao vendedor.
- Frontend mantém envelope/IDs/checksum locais, invalida respostas de sessão antiga e não faz fallback para escrita direta quando a Function falha. Códigos `functions/permission-denied` são normalizados para não criar loop de retry.
- Payments, allocations, adjustments, events e charges exigem permissão e escopo; consultas do repositório passam a incluir espaços autorizados. Seller sem acesso financeiro não puxa allocations.
- Storage exige permissão financeira e espaço autorizado, além de vínculo/plano já existentes.
- Grants do perfil legado não autorizam acesso. Autoedição de grants é proibida. A inicialização vazia preexistente do bootstrap é preservada; não é migração nem concessão.
- Allowlist pública da V199/V201 permanece idêntica; engine, testes e este relatório não entram no pacote público.

## Arquivos deste trabalho

- `firestore.rules`, `storage.rules`: proteção de campos/canais e isolamento das leituras.
- `functions/src/services/operational-commit-service.js`: nova autorização transacional e confirmação mínima.
- `functions/src/shared/commercial-commit-engine.js`: engine gerado mecanicamente da aritmética existente; não avalia código em runtime.
- `functions/src/index.js`: novos callables `commitOperationalSync` e `getOperationalSyncReceipt`; serviços comerciais anteriores não foram modificados.
- `scripts/generate-commercial-commit-engine.cjs`: geração e verificação de paridade da aritmética.
- `js/firebase/sync.js`: bridge autenticada, confirmação sem leitura financeira extra, códigos de erro normalizados e proteção de callback.
- `js/firebase/firestore-repository.js`, `js/workspace-callables.js`: consultas e geração/sessão das chamadas operacionais.
- `tests/emulator/authorization-hardening.rules.test.js`, `tests/operational-commit-client.test.cjs`: regressões novas, negativas e permitidas.
- `tests/emulator/sale-cancellation.rules.test.js`, `tests/emulator/sync-incident-archive.rules.test.js`: contrato atualizado — cliente direto negado, caminho servidor permitido.
- `firebase.security.json`: portas isoladas e somente Emulators locais.
- Este relatório. Nenhum arquivo da Loja V3 ou de outras demandas foi integrado.

## Bloqueadores identificados na base inicial (resolução no relatório complementar)

1. As quatro transações administrativas foram substituídas por comandos server-side; não foi reaberta escrita genérica.
2. Novas entradas iniciais capturam a origem na ação. Filas antigas ambíguas e recuperação de produtos históricos sem origem continuam preservadas para revisão, sem entrada inventada.
3. Campanhas/renovações foram validadas pelo domínio canônico no servidor; a finalização V2 passou a validar itens, cliente e modalidade congelados, além de reserva/estoque. Integrações cobertas no Emulator.
4. Auditoria financeira de escopo parcial não oferece reconciliação global nem representa fontes não autorizadas como saldo zero.
5. Os outros dois probes reproduzidos — custo aninhado em vendas históricas e markup de campanhas — não foram tratados como corrigidos nesta etapa. Exigem pacotes próprios; nenhuma migração de dados foi feita.
6. Tokens de download antigos de anexos, se existirem, não são revogados por Storage Rules. Inventário/revogação requer etapa explícita; não foi feito acesso a anexos reais.

## Deploy futuro (somente após eliminar bloqueadores e nova autorização)

1. Preservar rulesets de branches/tags e usar apenas a genealogia sanitizada.
2. Publicar primeiro os novos serviços/callables, mantendo os serviços V201 de cancelamento/Trocas/crédito e o projetor financeiro.
3. Publicar frontend/PWA com bridge autenticada e versionamento de recursos; validar somente QA.
4. Atualizar as sessões operacionais antes de aplicar as Rules restritivas de Firestore/Storage; coordenar a janela. Clientes antigos devem falhar sem descartar suas operações, nunca receber permissão ampla temporária.
5. Publicar Rules; repetir testes negativos anon/owner/seller e smoke QA de venda, recebimento, cancelamento, estoque, Trocas, créditos, reload e Sync.

### Rollback compatível

Não restaurar Rules permissivas da V201 nem voltar ao Sync antigo após fechar as escritas. O rollback deve manter a bridge, callables autorizadoras, Rules endurecidas, ledger/recibos e consultas escopadas. Corrigir/reverter somente o componente defeituoso sobre esse piso de segurança. Nunca apagar eventos, filas ou efeitos já confirmados. O rollback comercial anterior de V200 continua preservado como evidência, mas não substitui esse novo piso de autorização.

Sem commit/tag de release nem deploy nesta etapa. A proposta de numeração é V202; o aplicativo publicado segue V201.

## Verificação local registrada

- Reprodução da V201 intacta: 19 testes (14 achados reproduzidos e cinco controles), todos confirmados.
- Regressões selecionadas do app: 148 aprovadas.
- Backend existente (Financeiro, Equipe/concorrência, proteção de geração): 35 aprovadas.
- Suíte crítica de Firestore/Storage Emulator: 153 aprovadas, incluindo o novo serviço, cancelamento V201, Trocas, créditos, single_space e arquivamento anti-replay.
- Lint/build e diff-check aprovados; engine gerado conferido contra as fontes.
- Build público validado em diretório novo dentro de `dist-public`, sem sobrescrever o artefato anterior: 224 arquivos da allowlist existente.
- Rulesets 25744131 (branches) e 25744311 (tags): `active`, verificação somente leitura. Nenhuma escrita GitHub, mudança de credencial ou deploy.

Evidências técnicas fictícias e logs ficam fora da publicação, em `C:/Users/Murillo/.codex/visualizations/2026/10/24/security-authorization-v202/`. Isso não substitui a resolução dos bloqueadores de compatibilidade acima nem um smoke de release autorizado.
