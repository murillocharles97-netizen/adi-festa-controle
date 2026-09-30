# V157 — investigação e correção do comparador

## Implementação e limites

A investigação com backup e nuvem descrita a seguir comprovou as causas antes
da remoção local. Nenhum saldo, venda, pagamento ou efeito real foi corrigido.
Os seis backfills históricos não foram executados.

- `js/integrity.js`: canonicalização única local/remoto, Timestamp/Date/ISO,
  ordem de propriedades e defaults documentados. Campos financeiros reais,
  valores não padrão e arrays ordenados continuam sendo comparados. Custos são
  recompostos com as projeções protegidas correspondentes de cada lado, que
  também são auditadas. Checksum antigo de recovery/idempotência preservado.
- `js/firebase/sync.js`: transferência separada da integridade, com níveis OK,
  INFORMATIVO, ATENÇÃO e CRÍTICO; diferenças por campo e contribuições por cliente
  no diagnóstico v5. Tombstones esperados não são documentos ativos perdidos.
- `js/firebase/firebase-ui.js`: sync concluído não é chamado de incompleto por
  contagens técnicas. Mostra motivos/gravidade e remove o CTA genérico de
  reconciliação de saldos dessa auditoria.
- `js/storage.js`: gerador demo removido e antiga entrada de restauração demo
  bloqueada em todas as builds. Restauração de backup real preservada.

Quarentena estrita dos demos: somente sync manual do owner após download completo
confirmado; business, timestamp, nome e checksum exatos, ausência remota, sem fila
ou referência financeira. Remove apenas da lista ativa e preserva os originais
em `localFixtureQuarantine` na mesma transação IndexedDB. `localFixtureCleanup`
registra IDs/motivo e cloudWrites=0. Payload parcial/modificado desses demos
também é bloqueado no preflight de upload. Se a prova não valer, não há remoção.
Três sequências antigas que contêm c1 permanecem intactas; o motor permite pular
cliente ausente. Nenhum delete/update financeiro é enfileirado pela quarentena.

Mantidos IndexedDB `veconi-local-records`/`records`, migração V156, fila, Equipe,
Auth/Rules e isolamento. Sem localStorage.clear(), limpeza global ou novo
listener. O sync manual reutiliza o download já feito. O comando isolado
“Comparar com a nuvem” consulta adicionalmente as três coleções protegidas,
conforme permissão; não há promessa de zero reads adicionais nesse comando.

Validações automatizadas: unitários 548/548; Rules 104/104; teste com cópia isolada do
backup real (cinco demos, -7866,50, financeiros e sequências inalterados), quota
com abort/retry/reload; persistência 652 documentos e escala 1.000 clientes/5.000
vendas; WhatsApp individual; sequência incluindo 80 clientes; Equipe e PWA.
Smoke Auth/Firestore/Functions emulados cobre owner, Home, Vender/fiado,
Clientes/receber, individual, sequência de três, Financeiro, Histórico, Equipe,
modal, espaços, reload e convergência entre dois contextos isolados.
O teste estrito também detectou defaults em cadastros mínimos; a projeção foi
completada sem ignorar valores preenchidos ou diferenças financeiras.
Smoke integrado final aprovado: fila 0/0/0 e Integridade OK. Comparação read-only
final das nove coleções (incluindo as três protegidas): zero diferenças semânticas
nos documentos comuns. Lint/build e git diff --check aprovados.

Android físico, WhatsApp externo real e dois aparelhos reais dependem do novo
teste do usuário após publicar; nenhum envio real ou venda de QA em produção.

APP_VERSION=157; SW=veconi-v157-integrity-audit. Deploy somente frontend pelo
GitHub Pages. Rollback V156: `0e2fe3f514cdb8a57cbd2ff3a4ad8479e5a1179b`.
URL: https://murillocharles97-netizen.github.io/adi-festa-controle/
No Android: confirmar V157, Sincronizar agora, esperar auditoria e exportar
diagnóstico. Não limpar armazenamento nem restaurar backup. Os originais dos
demos são preservados, sem reaplicar saldo ou executar os seis backfills.

## Evidência complementar — backup de 29/09 e leitura read-only às 22:09 UTC

Recebido `backup-adi-festa-2026-09-29T22-06-41.json`. Comparação autorizada por
GETs Firestore, somente `businesses/adi-festa`, usando a sessão Firebase CLI
existente: 1.060 documentos de 9 coleções por execução; três execuções, 3.180
documentos retornados ao todo, nenhuma gravação. Artefato privado
local `artifacts/v157-readonly.json` registra campos/tipos diferentes e cinco
amostras reais por entidade, sem conteúdo de contato ou credenciais.
Revalidações: `artifacts/v157-canonical-readonly.json` e
`artifacts/v157-final-readonly.json`; esta última inclui as coleções protegidas.

Resultados que substituem as pendências correspondentes abaixo:

1. As 338 vendas diferem por `custoTotal`, `lucro` e custos/lucro em 467 itens.
   Esses campos pertencem a `saleFinancials` e são enriquecidos localmente.
   `criadoEm/atualizadoEm` também existem somente localmente, mas o hash antigo
   já os ignora. Os hashes remotos das 338 vendas continuam iguais ao diagnóstico;
   os locais do backup também coincidem. Não regravar nenhuma dessas vendas.
2. As 21 variantes diferem por `cost`, separado em `variantFinancials`; 14
   também têm defaults de imagem. `operationId=id` é acrescentado pelo EXPORTADOR
   de backup para variantes, portanto não deve ser atribuído ao cache original.
   Os 21 hashes remotos coincidem com o diagnóstico original.
3. Os 111 clientes divergentes diferem pelos campos/defaults: apelido, cidade,
   estado, etiquetas, financialVersion, consentimento/flags/datas, telefone
   normalizado, origemCadastro, portalRefToken, promessaPagamento e lastCharge*.
   124/124 hashes locais e remotos dos clientes comuns coincidem com o diagnóstico,
   confirmando que a comparação não está usando registros alterados posteriormente.
   PortalRefToken merece tratamento próprio: token gerado apenas no cache não
   pode ser tratado como mudança financeira, mas tokens remotos conflitantes não
   devem ser ignorados indiscriminadamente.
4. Conteúdo dos cinco IDs coincide com a demonstração legada: c1 Mariana Silva
   (-36), c2 Carlos Souza (0), p1 Brigadeiro gourmet (preço 6, custo 2,1,
   estoque 38), p2 Brownie recheado (10/4/22), p3 Bolo no pote (14/5,5/15).
   Nenhum existe na nuvem; nenhuma referência financeira local encontrada.
   Há três seleções legadas de mensagens contendo c1, ainda marcadas active;
   preservar integralmente essas sequências/históricos, nunca fazer limpeza
   ampla ou recalcular sua posição.
5. Todos os 37 onlyRemote são tombstones confirmados, como descrito abaixo.
6. Composição EXATA, por cliente: somente c1 contribui -36 (local=-36,
   remoto ausente, ativo local, não excluído). c2 contribui 0; todos os clientes
   comuns e todos os clientes remotos ausentes localmente contribuem zero.
   -7866,50 + (-36) = -7902,50. Não existe saldo real a reconciliar por esse total.
7. Não foi identificada perda financeira nestas diferenças: nenhuma venda,
   pagamento ou ajuste somente local; 108 pagamentos e 33 ajustes iguais;
   diferença agregada integralmente explicada pelo demo. Isso não transforma
   o algoritmo do ledger em prova universal da completude de todo o histórico.

Correção segura autorizada pelo escopo: comparar projeções equivalentes sem
ignorar custos financeiros; distinguir tombstones e metadados; bloquear criação
de demo em produção; remover apenas fixtures de conteúdo confirmado, sem
referência financeira nem fila e com ausência remota confirmada, mantendo cópia
local reversível e histórico das sequências. Nenhum saldo, venda, pagamento ou
efeito financeiro real deve ser criado/alterado para esta correção.

Estado histórico ANTES da implementação: análise do código da produção V156 (`0e2fe3f514cdb8a57cbd2ff3a4ad8479e5a1179b`).
O teste físico informado pelo usuário confirma a correção de armazenamento.
Não reabrir a migração IndexedDB. Nenhuma alteração de dados, backfill, limpeza,
commit ou deploy V157 foi executado nesta investigação.

## Análise preliminar arquivada — antes do backup (pendências resolvidas acima)

Recebido e analisado o JSON `diagnostico-sync-adi-festa-1790701112998.json`,
gerado em `2026-09-29T16:58:32.833Z`, build V156/0e2fe3f. Ele contém metadados,
checksums e agregados, não os documentos locais/remotos completos. Não é
possível atribuir campos de negócio divergentes a 5 documentos reais de cada
tipo ou certificar todas as contribuições de R$ 36 só por totais/checksums.

O exportador V156 (`exportLocalDiagnostic`) inclui `auditRecord`, não o conteúdo
completo de cada documento. Mesmo com o JSON, a comparação campo a campo pode
exigir backup local do mesmo aparelho e leitura autorizada da nuvem ou um
diagnóstico específico de diferenças feito no aparelho. Não inferir conteúdos
a partir do hash. Não publicar dados pessoais no repositório/relatório público.

## Confirmações do JSON real

- `syncFailure=null`, fila pending/errors/total=0, orphanOperations=0,
  `dataSynced=true`, `integrityStatus=completed`.
- IndexedDB `veconi-local-records`/`records`; 2.080 registros reportados;
  migração `verified=true`, `removed=true`.
- TODOS os onlyRemote são históricos excluídos: 13 produtos, 19 clientes e
  5 vendas, cada um com `deleted=true`, `active=false` e `deletedAt` preenchido.
  Total: 37 tombstones; zero onlyRemote ativo nas coleções auditadas.
- Zero vendas/pagamentos/ajustes onlyLocal. Zero possíveis duplicidades
  financeiras reportadas. 108 pagamentos e 33 ajustes têm checksums iguais.
- Únicos onlyLocal: p1/p2/p3 e c1/c2, sem operationId/revision/fila, criados no
  mesmo instante informado. O conteúdo de negócio desses registros não está
  exportado: identidade de fixture ainda precisa de confirmação de conteúdo.
- Nos 481 pares divergentes (338 vendas, 111 clientes, 11 produtos e 21
  variantes), os campos documentId, operationId, businessId, createdAt,
  updatedAt, revision, active, deleted e deletedAt coincidem. Foram conferidos
  todos os pares e selecionadas as primeiras 5 ocorrências de cada coleção;
  isso é comparação dos METADADOS exportados, não dos documentos completos.
- Os 6 backfills têm status `safe_effect_backfill`, diferença zero e
  `balanceAlreadyApplied=true`; não são seis saldos a corrigir.
- Total local -7902,50; remoto -7866,50. Nenhum saldo individual de c1/c2 ou
  dos 19 clientes tombstone está presente. Não atribuir a diferença por cliente
  como fato consumado a partir desses agregados.

## As sete perguntas obrigatórias

| Pergunta | Evidência de código / conclusão atual |
|---|---|
| Por que 338 sales divergem? | Há assimetria comprovada entre projeção local e documento remoto: `applyProtectedMetadata` acrescenta `custoTotal`, `lucro`, custos/lucro por item e `costSnapshot` de `saleFinancials`; o writer remove esses campos de `sales`. O checksum inclui esses campos. Além disso, a normalização adiciona defaults e há `syncConfirmedAt` local. Explica um mecanismo sistemático; os campos efetivos das 338 vendas ainda precisam de amostras reais. |
| Por que 21/21 variants divergem? | `variantFinancials.cost` é incorporado localmente, enquanto é separado do documento público na gravação. O normalizador também acrescenta defaults de estoque/imagem/schema. O comparador não recompõe o mesmo documento remoto enriquecido. Precisa verificar as 21 instâncias, não apenas assumir que todas diferem pelo custo. |
| Por que 111 clients divergem e 13 não? | `DB.prepare` acrescenta defaults como contatos vazios, flags de consentimento, arrays, `financialVersion`, telefone normalizado e token de portal. O remoto é comparado sem esse mesmo tratamento. Não foi identificado ainda o conjunto exato de campos que distingue os dois grupos reais. |
| Origem de p1/p2/p3/c1/c2? | Todos são criados por `exemplo()` em `js/storage.js`. Na V155, `carregar()` chamava `exemplo()` em cache ausente ou exceção para `adi-festa`, inclusive após falha de persistência. Não existe guarda de ambiente nessa função. A V156 já retirou esse fallback automático, mas `DB.restaurar()` ainda oferece carga demo. Não há prova de execução de teste automatizado contra o aparelho; origem mais forte é o fallback legado. O timestamp informado é compatível com `agora()` da criação, mas não prova qual caminho foi executado. |
| O que são os onlyRemote? | Confirmado no JSON: todos os 13 produtos, 19 clientes e 5 vendas são tombstones, inativos e com deletedAt. O contrato do pull remove a cópia local (salvo operação pendente), mas o comparador os coloca em onlyRemote. São históricos esperados, não documentos ativos perdidos. `active=false` sozinho continua não equivalendo a exclusão. |
| Composição exata dos R$ 36? | A fixture `c1` tem saldo -36, `c2` tem saldo 0. Hipótese diretamente sustentada pelo código: -7866,50 + (-36) + 0 = -7902,50. Não é ainda prova de que todos os demais clientes têm contribuição zero; exige conferir os saldos dos dois lados por ID, incluindo tombstones, créditos e fixtures. Não ajustar saldo. |
| Existe perda financeira real? | Não há perda comprovada nas evidências recebidas, mas tampouco prova suficiente para certificar ausência de qualquer perda. Fila/orphans zerados e auditoria de saldo sem divergências são evidências favoráveis. Os documentos reais continuam necessários. |

## Por que a interface ainda alerta após sync bem-sucedido

`compareLocalAndCloud()` compara contagens e total de débitos local contra os
contadores/saldo do pull. `runManualSync()` define `complete` com esse booleano
e emite `status:error` antes de executar `compareDeviceWithCloud()`.

Assim, o texto "Dados atualizados. A comparação de integridade identificou
diferenças" NÃO é determinado diretamente pelo hash das 338 vendas. Uma fixture
a mais ou um saldo local extra basta para esse alerta. A auditoria detalhada
concluída depois não recalcula esse resultado por severidade.

O relatório detalhado ainda soma todos os clientes de cada lado em
`localBalance`/`remoteBalance`, sem separar explicitamente ativos, tombstones,
fixtures e créditos. Esse total não autoriza reparo financeiro.

## Limitação importante da auditoria de saldo existente

`buildFinancialBalanceAudit()` usa os documentos remotos e compara o saldo do
cliente com `after` do último evento elegível. Quando não há evento, define
`expected = actual`. No ramo de igualdade, não valida toda a cadeia nem exige
todos os efeitos históricos. `effectsConfirmed` é a contagem de IDs de efeitos,
e o backfill nessa condição verifica o último efeito.

Portanto `divergentCount=0` significa "nenhuma diferença segundo esse algoritmo",
não uma prova independente de completude e correção de todas as operações.
Os 6 `safe_effect_backfill` com diferença zero não autorizam reaplicar saldo.
Nenhum backfill foi executado.

## Direção de correção, depois de validar evidências

1. Separar resultado da transferência de dados e severidade da auditoria.
2. Comparar o mesmo modelo de negócio dos dois lados: incluir documentos
   financeiros protegidos conforme permissões, em vez de ignorar custo/lucro.
3. Canonicalização única por entidade com defaults documentados, timestamps e
   metadados explicitamente permitidos. Não converter todo null/ausente/string
   indiscriminadamente; não ordenar arrays cujo significado depende da ordem.
4. Não alterar `checksumValue` indiscriminadamente: hoje também protege
   reconciliações, recovery, revisão de órfãs e checksums de efeitos. Separar
   hash de integridade semântica dos contratos de recuperação existentes.
5. Classificar tombstone ausente como histórico esperado; ativo ausente continua
   acionável. Venda/pagamento real somente local sem fila continua crítico.
6. Eliminar a entrada de demonstração em produção. Só remover fixtures do
   armazenamento local após validar conteúdo, vínculos, fila e ausência remota;
   IDs curtos isoladamente não são prova e a remoção não deve gerar delete cloud.
7. Exportar contribuições de saldo por ID e diferenças por caminho de campo,
   minimizando valores pessoais, sem writes de negócio.

## Solicitação histórica de evidência — já atendida pelo backup de 29/09

O diagnóstico V156 foi recebido. Falta o backup local atual desse mesmo Android;
o exportador padrão recebido não inclui os conteúdos dos documentos. O backup
de 22/09 disponível em Downloads é anterior ao timestamp de criação dos
registros suspeitos (24/09), portanto não prova seu conteúdo neste caso. Depois
do backup atual, decidir a leitura complementar de documentos remotos
necessária às amostras, mantendo-a manual e read-only. Não regravar registros
ou solicitar restauração/importação de backup para obter essas evidências.

Essas eram as limitações da análise preliminar; o backup e a comparação read-only
posteriores resolveram as sete perguntas, conforme a seção de evidência acima.
