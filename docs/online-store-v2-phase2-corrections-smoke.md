# Loja Online V2 — correções e smoke integrado

13/10/2026. Somente local/Emulator. **Pronto para smoke em nuvem/staging; não é aprovação para produção.**

## Escopo preservado

Nenhum deploy, alteração de Firebase real, DNS, Auth de produção, assinatura, Mercado Pago ou dado real. Não houve alteração de APP_VERSION/SW_VERSION, commit ou publicação nesta etapa. IndexedDB/veconi-local-records e a migração V156 foram preservados. Não foi executada limpeza global de storage/origin.

O app completo foi servido em localhost com SDKs reais conectados ao projeto simulado `demo-veconi-online-qa`. O proxy de teste somente conecta os endpoints ao Emulator e injeta perda de resposta após commit; não substitui Auth, Sync, normalizador, Vendas ou Rules. A regressão de Rules/Storage usou uma segunda instância isolada, `demo-veconi-rules-qa`, para não interferir no smoke. Os nomes demo são namespaces de Emulator, não novos projetos Firebase na nuvem. A instância preexistente 8080/9099 não foi alterada.

## Quatro bloqueadores

| Bloqueador | Correção | Comprovação |
|---|---|---|
| Pedido V2 convertido em legado | DB.prepare preserva source, schemaVersion, spaceId e demais campos; somente registro sem source recebe o default legado | Auditoria do normalizador passou; ações da UI real ficaram disponíveis |
| Incremental ignora pedidos | Novos pedidos, status, reservas e alterações de estoque usam Timestamp; DTOs HTTP continuam ISO. Leitura de catalogOrders consulta também o cursor ISO para compatibilidade, sem regravar legados | Query Timestamp passou; repositório real encontrou Timestamp + ISO sem duplicidade/inferência |
| Produtos de B acessíveis em A | Rules validam empresa + escopo persistido, leitura/edição/criação/soft-delete; hard-delete continua negado. Variantes e custos herdam o escopo do pai, projeções/movimentos seguem o escopo autorizado | Gerente A lê/edita A; B nega leitura, edição, soft-delete, hard-delete, variante e custo |
| Bootstrap publica catálogo global | Não chama ensure/publish global. Publicação de catálogo passa a ser server-side após associação explícita. Rules negam publicação por cliente antigo, inclusive owner | Bootstrap novo não gerou catálogo global; tentativa de cliente antigo foi negada |

Imagens de produtos também passaram a validar o pai/espaço. Exclusão pelo backend valida escopo antes de consultar Storage. Marca da loja V2 continua em caminho empresarial/por espaço. Assets de catálogo legado sem vínculo ficam sob revisão do proprietário; não são atribuídos por inferência.

Links e documentos antigos não foram apagados nem reassociados automaticamente. Pedidos antigos sem spaceId continuam separados. O acompanhamento legado agora usa o mesmo callable de status, em caminho somente leitura, validando o segredo existente do pedido; não expõe o segredo, não libera leitura pública direta de pedidos e não infere espaço. Associação/migração continua exigindo confirmação do proprietário.

## Sync, cache e permissões

- Bootstrap passou a buscar pedidos recentes/incrementais para recuperar a operação após reload.
- Transições importantes publicam o sinal de Sync já existente, somente para as coleções afetadas. Não foi criado listener global de histórico de pedidos.
- Não foi introduzida varredura global de variantes no boot: pedidos alterados refrescam os pais variáveis afetados com paginação de irmãos, conforme o fluxo canônico de estoque.
- Consultas de produtos são filtradas por empresa/escopo; grupos acima do limite de disjunções são divididos. Variantes/projeções usam grupos limitados de pais autorizados; não baixam B para filtrar somente na UI.
- Guardas de empresa/usuário interrompem consultas se a sessão mudar durante o await.
- Índices locais cobrem as consultas novas e o job de expiração. O Emulator não comprova criação/prontidão desses índices em nuvem; devem ser implantados e verificados no staging antes do smoke cloud.
- Queries scoped e compatibilidade ISO acrescentam leituras necessárias à segurança/recuperação; não foi feita medição de custo em produção e não se afirma impacto zero.

## Expiração implementada

- Novo (`recebido`): prazo server-side de 30 minutos, em reservationExpiresAt.
- Confirmado/Preparando/Pronto/Enviado: não expiram automaticamente.
- Job exportado `expireOnlineOrderReservations`, a cada minuto, com consulta paginada/bounded (100 por página, até 5 páginas por execução). Não existe Cloud Scheduler publicado nesta etapa.
- Transação relê empresa/geração, pedido, marcador e estoque reservado. Confirmação e expiração disputam o mesmo pedido. Somente um commit vence.
- Liberação altera reserva/agregados, não estoque físico, venda, pagamento ou saldo.
- Estado Expirado, expiredAt, expirationReason=reservation_timeout e operationId determinístico online-expire:{orderId}; histórico registra a expiração uma vez.
- Retry/job duplicado não libera novamente e não recria reserva para a mesma tentativa expirada.
- Pagamento/finalização incerta: reserva preservada e encaminhada a revisão; não é tratada como expirada/liberada. Elegibilidade explícita impede repetição desses casos no início de todas as páginas do job. Cancelamento de pedido com intent integrado também exige verificação antes de liberar.
- Pedidos antigos sem prazo/eligibilidade não são expirados retroativamente pelo job.
- UI interna e pública mostram a liberação ou a necessidade de revisão. Expirado é terminal, sem confirmação/conversão em venda.

## Smoke do app completo

Empresa artificial `online-integrated-qa-mv776c9h`, owner `qa-owner-mv776c9h`; espaço A `qa-main-mv776c9h` (VECONI QA), B `qa-isolation-mv776c9h` (VECONI QA — isolamento).

| Cenário | Resultado |
|---|---|
| Auth owner + sessão ao reabrir | Passou no SDK/Auth Emulator e UI completa |
| Sync completo/manual | Passou: dataSynced=true, integridade completed, fila 0/0/0, IndexedDB |
| Pedido novo/estado após reload sem botão Atualizar | Passou: Novo e Concluído recuperados automaticamente |
| Checkout público + spaceId | Passou: pedidos nasceram no espaço do token/binding |
| Carrinho | Não criou reserva/venda nem baixou estoque |
| Duplo clique no envio | Um pedido/uma reserva para a tentativa |
| Resposta perdida após criar pedido | UI Verificar envio pendente; reload recuperou o mesmo pedido |
| Cancelamento visual A | Passou: confirmação em dois passos, reserva 1→0, físico 2→2, sem venda |
| Status Novo→Confirmado→Preparando→Pronto | Passou pela UI, sem baixa definitiva antes da venda |
| Conclusão visual canônica | Passou: uma venda e um movimento por pedido, actorUid/spaceId corretos |
| Resposta perdida após ack de conclusão | Servidor concluiu uma vez; reabertura/pull mostrou Concluído, sem nova venda |
| Segunda conclusão com clique duplicado | Passou, sem terceira venda nem terceira baixa |
| Cancelamento visual B | Passou: estoque de B preservado/liberado, sem afetar A |
| Última unidade A/B simultânea | Rodada final: um sucesso e um FAILED_PRECONDITION; reserva única |
| Expiração/duplicidade/retry | Passou no serviço real em Emulator com relógio controlado |
| Corrida confirmação×expiração | Passou; não houve dupla transição/liberação |
| Confirmado depois de 30 minutos | Reserva permaneceu; cancelamento explícito liberou |
| Pagamento desconhecido | Preservou reserva, sem liberação financeira/estoque indevida |
| Isolamento público | Projeções/tokens/links separados; item exclusivo B não aparece/reserva na A |
| Isolamento privado/Rules | Gerente A não lê/altera/exclui B; edição A continua permitida |
| Storage/serviço de delete | A permitido; B nega leitura/upload/delete; backend nega antes de acessar GCS |
| Legacy | Cliente antigo não publica global; segredo correto lê recibo sem alteração/inferência; segredo errado negado |

Uma rodada inicial de concorrência retornou erro transitório do Emulator (transaction invalid/closed) para o perdedor, sem criar outro pedido ou reserva. A repetição com handlers aquecidos retornou corretamente estoque insuficiente. Isso foi registrado, não mascarado como internet nem convertido em aprovação; comportamento sob latência cloud continua parte do staging.

### Evidência de vendas/estoque

- Cancelamento visual A: `e60cf555-aeeb-432b-87e2-d22c2ab97c21`, Cancelado.
- Primeira conversão: `0a300aff-050e-4a7d-b7ca-2c0be845f6e2` → `online_0a300aff-050e-4a7d-b7ca-2c0be845f6e2`, Concluído. Resposta do ack foi perdida propositalmente depois do commit.
- Checkout perdido/reload/segunda conversão: `80018aa9-7468-4d5f-b89a-f1cf877f903e` → `online_80018aa9-7468-4d5f-b89a-f1cf877f903e`, Concluído.
- Cancelamento visual B: `182ecab3-a466-4bdd-b138-3846469f7025`, Cancelado.
- Disputa final de unidade: `8dfccab5-2eb8-45a4-aece-dcd05fdc92f7` venceu e depois foi cancelado visualmente, liberando a unidade.
- Expiração demonstrada na UI: `863a3a39-ca9c-4458-8fb7-ffd072fd7c0d`, Expirado, sem ação de concluir.

Estado final observado: **2 vendas, 2 operationIds distintos, 2 movimentos de saída -1, 0 reservas ativas**. Produto principal: físico 3→1; cancelamento A: 2→2; exclusivo B: 2→2; última unidade: 1→1. Nenhum estoque físico negativo ou perda/duplicidade financeira observada. Dois eventos canônicos de venda no Histórico, com owner/space A corretos.

A automação financeira opcional não estava habilitada/configurada nesse fixture; não foram inventadas entradas nem saldo bancário para alegar sucesso. A venda/estoque/Histórico são do pipeline atual. Cenários financeiros com automação habilitada passaram nas regressões dedicadas; UI/automação financeira específica da empresa devem ser incluídas no smoke staging.

### Alerta de multiaba

Dois contextos privados com o MESMO usuário/origin acionaram a proteção CAS já existente do cache IndexedDB: local-cache-conflict. A proteção impede sobrescrever dados de outra aba e pede reabertura. Não foi removida nem contornada com limpeza de dados.

Após fechar o segundo contexto privado e abrir uma nova aba, Auth/cache retomaram corretamente, o pedido da corrida foi encontrado, cancelado uma vez e Sync terminou sem erros. **Não se afirma suporte a edição privada simultânea na mesma origem/usuário com o cache compartilhado.** Até um projeto específico de coordenação multiaba, usar uma aba privada por usuário/origin. Dois dispositivos reais têm caches independentes, mas ainda precisam do smoke cloud.

## Testes e limites

- App: 659/659; backend: 131/131; regressão Emulator/Rules/Storage: 158/158 em namespace de teste novo.
- Lint/build passaram; git diff --check passou (avisos de conversão CRLF não são erro).
- Auditorias do normalizador, incremental, repositório scoped real, legacy dates, legacy status/Rules, assets, projeções públicas e expiração passaram.
- Fixtures que reutilizavam recibos imutáveis de rodadas anteriores passaram a ser isolados no runner; Storage usa o mesmo projeto demo que o CLI para que os lookups cross-service sejam reais. Não houve flexibilização de Rules para obter verde.
- Viewports 320, 360, 375, 390, 412, 430, 768 e 1366: documento sem overflow horizontal e modal dentro do viewport. Cancelamento/conclusão/expiração tiveram evidências visuais desktop/mobile.
- SW original controlou a página em localhost; standalone=false. **Não comprova PWA instalado, Android físico, teclado real, background longo ou rede móvel.**
- Runtime host Node 23 versus Functions configuradas Node 22: advertência do Emulator. Smoke staging deve usar o runtime configurado.
- Não foi feita validação na nuvem, nem implantação de índices/Scheduler/IAM. O projeto de staging ainda precisa ser definido/autorizado; não será criado nem usada produção automaticamente.

Os fixtures de expiração incluem produtos QA adicionais e rodadas interrompidas/repetidas, todos no Emulator. Um fixture residual com prazo explícito foi encerrado pela UI owner e virou Expirado; não houve reparo de dado real ou inferência de legado. Os dados de QA não foram enviados à nuvem nem apagados do dispositivo de produção.

## Arquivos desta correção

Aplicação/backend:

- js/storage.js
- js/firebase/sync.js
- js/firebase/firestore-repository.js
- js/firebase/catalog-bridge.js
- js/online-orders-ui.js
- js/catalogo-publico.js
- functions/src/shared/online-order.js
- functions/src/shared/online-time.js (novo)
- functions/src/shared/online-order-signal.js (novo)
- functions/src/services/online-order-service.js
- functions/src/services/online-stock-reservation.js
- functions/src/services/online-order-expiry.js (novo)
- functions/src/services/online-legacy-order-status.js (novo)
- functions/src/services/workspace-assets-service.js
- functions/src/index.js
- firestore.rules / firestore.indexes.json / storage.rules

QA: firebase.online-store-rules.json; scripts/isolate-online-rules-tests.cjs; tests/emulator/online-store-functions/index.cjs; tests/fixtures/online-store-integrated-controls.js; novas auditorias online-store-expiry, scoped-repository, legacy-security, legacy-dates, product-assets; ajustes dos fixtures/contratos em tests/online-orders-v2.test.js, universal-catalog, hardening, team-access e testes Storage. Alterações preexistentes de outras tarefas foram preservadas; esta lista não atribui o worktree inteiro a esta correção.

## Screenshots

- artifacts/online-store-integrated-fixed/cancelled-desktop.jpg
- artifacts/online-store-integrated-fixed/mobile-response-lost.jpg
- artifacts/online-store-integrated-fixed/completed-mobile.jpg
- artifacts/online-store-integrated-fixed/expired-mobile.jpg
- artifacts/online-store-integrated-fixed/isolation-b-mobile.jpg
- artifacts/online-store-integrated-fixed/final-desktop.jpg

**Decisão: pronto para smoke em nuvem/staging, com a limitação multiaba e as verificações cloud/Android explicitamente pendentes. Nenhum deploy autorizado ou executado.**
