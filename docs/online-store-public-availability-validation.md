# Loja Online V2 — disponibilidade pública após reserva/liberação/baixa

14/10/2026 (America/Sao_Paulo). Correção LOCAL explicitamente autorizada pelo owner.
Base 2b4dd47c1825dbc3633df5b749750ab629a299a9. Nenhum push/deploy ou escrita em produção.

## Resultado

Bloqueador de disponibilidade corrigido. Pronto para a próxima etapa de smoke controlado
em nuvem após autorização, NÃO equivale a aprovação física Android/PWA nem a deploy.
APP_VERSION/SW continuam 169; próxima versão sugerida 170.

O problema era uma projeção pública estática feita apenas na publicação da loja.
A reserva e a venda já validavam o estoque canônico por transação. A correção não
repara/regrava estoques, vendas, clientes, pagamentos ou saldos reais.

## Arquitetura

- Dois gatilhos backend: products e productVariants dentro de businesses/{businessId}.
- Comparação dos campos relevantes evita consultas em alterações somente de preço,
  custo, updatedAt e demais metadados sem efeito de disponibilidade.
- Quantidade pública = estoque físico menos onlineReservedStock, no modelo compartilhado.
  Variações somam as quantidades líquidas dos IDs já publicados; sem subtração dupla.
- Cada execução relê o produto/variações ATUAIS dentro da transação. Um evento antigo,
  duplicado ou fora de ordem não reaplica o snapshot antigo; sem mudança não há write.
- Só lojas V2 publicadas, com binding/public token/empresa/espaço/generation compatíveis,
  espaço ativo autorizado e produto publicado podem receber atualização. Não cria documento,
  não ativa rascunho, não ressuscita legado e não publica novas variações silenciosamente.
- Epoch original do evento e fence de reset existentes são respeitados. Empresa bloqueada
  ou geração antiga não recebe projeção. Erros transitórios continuam retryable.
- Somente items/disponibilidade e availabilityUpdatedAt do documento público são atualizados.
  Preço, descrição, marca, imagens e demais personalizações publicadas são preservados;
  dados privados do produto não são copiados. ownerPublished distingue ocultação por estoque
  da decisão de publicação do owner, permitindo reativação segura do item já publicado.
- publishedProductIds guarda a seleção da última publicação, independente do rascunho.
  No primeiro save de loja V2 já publicada sem esse campo, lê somente seu publicCatalog
  validado para recuperar esses IDs. Não migra catálogo legado nem publica automaticamente.
- Queries indexadas por publishedProductIds + fallback selectedProductIds, paginadas em 100.
  Sem listener global, varredura de produtos ou novo índice composto. Há leitura dos candidatos
  retornados pelos dois índices, mais seis documentos/loja validada e suas variações publicadas.
  Em reentrega sem mudança há reads de validação, mas zero writes públicos adicionais.
- Frontend faz uma leitura pontual do próprio catálogo ao voltar à vitrine/ao retornar visível
  ou reconectar. Single-flight, sem polling/listener novo; IndexedDB mantém cache reconstruível.
  Não substitui formulário de checkout, não limpa carrinho, não altera tentativa pendente.
- A atualização no retorno foi registrada DEPOIS do handler de navegação. O smoke identificou
  que um microtask colocado antes dele podia rodar com view=checkout e não atualizar. Corrigido
  e coberto por teste + navegador (quantidade 2→1 sem reload, carrinho preservado).

## Consistência e limites

Gatilhos são assíncronos: a vitrine pode ter breve atraso até a projeção concluir. Um browser
que fica parado não recebe atualização contínua; nova abertura, retorno à vitrine/visibilidade
ou reload relê o catálogo. O checkout permanece validando o estoque canônico transacionalmente,
inclusive durante esse intervalo. Não criar polling agressivo para esconder atraso de trigger.
Durante baixa antes do acknowledge, a quantidade pode ficar temporariamente conservadora
(estoque já baixado menos reserva ainda retida); depois da liberação converge. Não há oversell.
Uma publicação V2 pré-hotfix sem nova movimentação continua precisando de republicação manual
para atualizar um snapshot que já estava antigo; nenhum backfill global foi executado.

## Evidências — SDKs, callables e gatilhos reais no Emulator

Projeto demo-veconi-online-qa; business online-integrated-qa-mv8845wu.
VECONI QA / qa-main-mv8845wu e VECONI QA — isolamento / qa-isolation-mv8845wu.
Não usou Firebase real da VECONI. Não usou dados reais nem assinatura/pagamento real.

| Cenário | Resultado |
| --- | --- |
| Reserva pelo checkout/browser | Produto físico 2, reserva 1, vitrine 1; trigger automático |
| Cancelamento visual inline | Pedido 5c92f8f6-f1f8-4faf-bad6-22c2fa6abd9e cancelado; físico 2, reserva 0, vitrine 2; nenhuma venda |
| Confirmado → Preparando → Pronto → concluir | Pedido ba5f3515-cfa7-4426-bc7a-075e32b52a74; UMA venda online_ba5f3515-cfa7-4426-bc7a-075e32b52a74, UM movimento; físico 1, reserva 0, vitrine 1 |
| Expiração/replay | 38f38f4b-4f57-4e27-b9dd-ad6684dc9dd1; fixture envelhecido 30min, relógio real; release uma vez; vitrine cancel-product 1→2 sem venda |
| Última unidade A/B | 854144f6-e1b7-41f3-90a3-fb59c5d54a02; uma tentativa aceita, outra FAILED_PRECONDITION; ambas vitrines 0 durante reserva, 1 após cancelamento/replay |
| Variação | c8f13bfd-a927-4e93-8971-110b9d86926a; variante 2→1→2; agregado igual; não aparece em B |
| Retorno sem reload | 4dd1db33-8eea-4426-9adb-123d57d83a98 reservado por outra sessão; retorno checkout→vitrine atualiza 2→1 e mantém carrinho; cancelado visualmente depois |
| Eventos duplicados/fora de ordem | Transação relê físico atual; documento público não regravado quando já correto |
| Draft publicado/seleção alterada | Estoque da publicação continua atualizado sem publicar mudanças do rascunho |
| Isolamento | Manager A permitido em A; loja B, leitura e edição produto B negadas (Rules/SDK Auth reais) |
| Sync e cache | dataSynced=true; integrity=completed; IndexedDB; queue pending/errors/total=0 |
| Auth/reload/service worker local | authorized; swControlled=true; standalone=false; NÃO é Android instalado |
| Mobile/browser | 320/360/375/390/412/430/768/1366, sem overflow horizontal |
| Legado | Nenhum novo bootstrap, migração, catálogo global ou fallback; histórico antigo read-only preservado |

## Testes

- App: 663/663; backend: 138/138.
- Firestore/Auth/Storage Emulator e Rules: 170/170 (inclui sete novos testes de projeção).
- Sete unitários backend + cinco frontend cobrem disponibilidade, controle de estoque,
  variações, metadados, idempotência, zero reads em evento irrelevante, retorno/offline e geração.
- Lint, build e git diff --check: aprovados.
- Smoke automático local usa callables HTTP e espera a projeção pelo TRIGGER; não chama
  o serviço de projeção diretamente para fingir atualização automática.
- Nas primeiras execuções dos novos fixtures faltavam capabilities.sales e revision privada,
  e o ID composto da variação estava incorreto. Fixtures corrigidos, não regras relaxadas.

## Estado QA final e artefatos

Cinco produtos sintéticos (inclui novo qa-variable-availability e qa-variant-availability),
duas vendas canônicas QA e dois movimentos, nenhuma reserva ativa.
12 pedidos V2 + 1 histórico sintético. Estoques main=1, cancel=2, isolation=2, shared=1,
variant=2. Todos os IDs de negócio/espaço/ator das vendas foram preservados.

O export pelo hub antigo falhou e encerrou Auth/Functions do Emulator. Os dados Firestore
QA foram exportados pelo endpoint local antes de reiniciar esse processo; checkpoint
importado, sete pedidos/uma venda/quatro produtos anteriores preservados. Dois usuários
SINTÉTICOS foram recriados no Auth Emulator com os mesmos UIDs, sem alterar memberships.
Reentrada de QA necessária por esse reinício de infraestrutura, não por regressão de login
em reload normal. Nada exportado/apagado/restaurado em produção.

Harness, checkpoint e script smoke ficam fora do commit operacional. Capturas verificadas:
artifacts/online-store-no-legacy-final/verified-public-stock-desktop-fixed.jpg e
verified-public-stock-mobile-fixed.jpg. Comparar com o antigo verified-public-stock-desktop.jpg.

## Arquivos operacionais

- functions/src/services/online-store-stock-projection.js
- functions/src/index.js
- functions/src/services/online-store-service.js
- functions/src/shared/online-store.js
- js/catalogo-publico.js
- functions/test/online-store-stock-projection.test.js
- tests/emulator/online-store-stock-projection.rules.test.js
- tests/public-availability-refresh.test.js
- Este relatório e online-store-no-legacy-final-validation.md.

Rules, autenticação, assinaturas, pagamentos e infraestrutura de produção não foram alterados.

## Pendências antes de publicação

- Android/PWA físico e leitura QR por câmera indisponíveis, conforme informado pelo usuário.
- Confirmação nativa de publicação não comprovada pela extensão na etapa anterior; publicação
  QA explícita via callable owner validada. Não alegar teste visual nativo que não foi executado.
- Scheduler real/30min reais e latência/retry de Eventarc em nuvem ainda exigem smoke controlado.
- Autorização para publicar obrigatória. Não preparar um deploy que deixe só frontend atualizado
  sem os dois gatilhos backend. Rollback frontend V169 b5c1aed4066c569d2665ad43749ecffd934b9f86;
  não restaurar legado nem reverter cegamente Rules/reservas/expiração de pedidos V2.
