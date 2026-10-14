# V169 — Loja Online V2, publicação controlada

14/10/2026, America/Sao_Paulo. Preparação em base isolada da produção.

## Base / rollback

Produção anterior: V168, `9110001568028754a6f45d63426f0083ecff489c`.
URL oficial preservada: https://veconi.app.br/.

Reversão de interface: publicar o artefato desse commit pelo mesmo workflow Pages.
Depois de criar pedidos V2, NÃO restaurar cegamente submitCatalogOrder, as Rules
antigas ou apagar as novas coleções. Pausar novos checkouts dos pilotos pela
publicação/checkout da loja; manter handlers V2, reservas e expiração para recuperar
operações em andamento. A reativação ou correção mantém os mesmos IDs/operationIds.
Não excluir índices em rollback. A reversão não é limpeza de dados nem migração inversa.

## Controle de ativação

OnlineStore.v2Enabled exige true no servidor para um NOVO checkout. Documento novo
exige action=activate, confirmed=true e owner; action=migrate também exige confirmação
explícita e owner. GET/load não grava nem cria loja. Configurar não publica por si só.
activation registra confirmedBy/confirmedAt/mode=manual_space_pilot. Campos não são
graváveis diretamente pelo cliente, segundo as Rules.

Lojas antigas não são migradas no deploy ou bootstrap. Links e checkout legado
continuam no caminho anterior enquanto não há binding. Pedidos sem espaço ficam
separados. Publicação global por cliente antigo é negada para impedir mix de espaços.
Interface mantém acesso ao fluxo legado; republicação exige revisão/associação.

Migração com checkout antigo aberto é bloqueada. Pausa opcional é uma ação distinta
do owner, confirmada explicitamente: altera apenas acceptingOrders/closedBehavior e
metadata de pausa da loja escolhida. Não atribui espaço, não remove item/pedido,
não conclui pedido, não faz migração. Pedidos em atendimento ainda bloqueiam vínculo.
Nenhuma loja real será pausada/migrada pelo smoke.

## Auditoria e expiração

Logs ONLINE_V2 após commit: criação/status/claim/conclusão/expiração, com IDs de empresa,
espaço, pedido, operação, revisão e estado de reserva; sem buyer/address/token/body.
Histórico do pedido, marcadores transacionais e movimentos canônicos permanecem.
Novo expira 30 minutos após criação server-side. Confirmado não expira. Casos de
pagamento/finalização incerta vão a revisão mantendo reserva. Job duplicado não libera
duas vezes. Expiração não baixa estoque físico nem altera saldo.

## Escopo do deploy planejado

Índices adicionais (sem apagar existentes); Firestore e Storage Rules; apenas funções
getOnlineStore, saveOnlineStore, getOnlineOrderStatus, changeOnlineOrderStatus,
claimOnlineOrderFinalization, acknowledgeOnlineOrderFinalization,
expireOnlineOrderReservations, submitCatalogOrder, identifyCatalogCustomer e
deleteWorkspaceAsset. Não publicar billing, Auth, reset, webhooks ou Mercado Pago.
Frontend/SW V169 via workflow Pages existente. Sem DNS/CNAME/hosting change.

## QA / limites

Espaço preexistente VECONI QA: 3488517b-872d-4836-9796-aa488c1437f1, empresa adi-festa.
Somente produtos/pedidos QA novos e claramente identificados. Nenhuma venda/produto
real será usado. Um segundo espaço de controle pode ser necessário para isolamento.
Não criar usuário/membership nem modificar assinatura. Testar expiração com prazo
real, sem backdating ou liberação manual disfarçada de job.

Limites previamente observados: uma aba privada por usuário/origin (CAS IndexedDB);
PWA Android instalado depende do teste físico; catálogo é projeção de publicação,
preço/estoque revalidados no checkout, sem promessa de estoque público live.
Portais de clientes/campanhas na V2 não estão liberados; legado permanece separado.
Paginação acima de 100 pedidos/1000 produtos ou variantes pede evolução futura.

Resultado de publicação/smoke será anexado quando efetivamente observado.
