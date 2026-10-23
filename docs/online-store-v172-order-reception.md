# V172 — recebimento explícito de pedidos por espaço

Preparação local em 15/10/2026. **Sem deploy e sem ativação de pedidos reais.**
Base/rollback: V171 `f8207dd70f2546fcbff04b1201b8662238bff44d`.
Branch de preparação: `codex/store-order-reception-v172`.

## Causa comprovada em produção — somente leitura

Empresa `adi-festa`, espaço `business_adi-festa` (nome exibido: Adi festa),
loja `store_33ecf081ce13175474f8461f18545aa5`, slug `adifesta-iguatemi`.

| Sinal | Estado observado |
| --- | --- |
| V2 ativada / publicação | true / true |
| Produtos selecionados / publicados | 11 / 11 |
| Retirada / entrega | true / false |
| onlineStores.checkoutEnabled | false |
| onlineStores.catalogSettings.checkoutEnabled | false |
| publicCatalogs.acceptingOrders | false |
| publicCatalogs.active / catalogVisible | true / true |
| status / closedBehavior público | paused / view_only |
| Plano permite mutação/pedidos | sim |

Não é bloqueio de estoque, Rules, Auth ou uma trava global de lançamento.
Publicar o catálogo e aceitar pedidos são estados distintos. O frontend público
interpreta corretamente acceptingOrders=false: informa "Pedidos pausados" e
desabilita compras. O submitCatalogOrder também rejeita novos pedidos com essa
configuração, antes de reservar estoque. Preservado esse comportamento.

O checkbox existente na V171 está escondido na aba "Pagamentos", com rótulo
técnico "Habilitar checkout e reserva de estoque". Há ainda uma inconsistência
no salvamento: `saveOnlineStore(action=save)` grava o flag no documento privado,
mas só `action=publish` atualiza acceptingOrders no documento público. Assim,
salvar o checkbox não garante que a loja comece/pare efetivamente de receber.

## Correção restrita

- Painel "Recebimento de pedidos" visível abaixo do seletor de espaço, em todas
  as abas: "Recebendo pedidos" ou "Pedidos pausados", com motivo operacional.
- Botão "Ativar pedidos" / "Pausar pedidos"; somente owner. Confirmação inline
  cita o nome do espaço e explica reserva/cobrança e preservação de pedidos.
- Removido o checkbox duplicado da aba Pagamentos; mantidas preferências atuais.
- Nova ação **no callable existente** saveOnlineStore:
  `action=set_order_reception`, `enabled`, `confirmed=true`, `revision`,
  businessId, spaceId e workspaceGeneration.
- Backend revalida Auth, membership owner ativa, empresa, espaço, plano,
  geração/reset, V2 publicada, vínculo e projeção pública da mesma empresa/espaço.
- Ativação exige vendas habilitadas no espaço, entrega/retirada configurada e
  preferência de pagamento. Não ativa nem cria lojas de outros espaços.
- Transação atualiza somente flags/metadata de recebimento em **dois documentos**:
  onlineStores desta loja e publicCatalogs desta loja. Não republica rascunhos de
  tema/catálogo, não muda produtos/preços/estoque e não toca pedidos/reservas.
- Estado desejado já persistido retorna replay sem gravar; revisão protege contra
  requisição atrasada que tentaria desfazer uma pausa posterior. Duplo toque fica
  bloqueado também na UI; falha de rede nunca exibe sucesso presumido.
- action=save não pode mais mudar checkoutEnabled deixando projeção pública
  defasada. Clientes V171 recebem instrução para usar o controle/publicação.
- Auditoria técnica existente recebe action, checkoutEnabled, ator, empresa,
  espaço, revisão e timestamp; sem tokens, corpo de pedido ou dados de comprador.
- Texto de reserva corrigido: ocorre ao finalizar checkout, não ao confirmar o
  atendimento do pedido. Baixa definitiva continua na venda canônica.

Nenhuma mudança em Rules, submit/reserva/baixa/cancelamento/expiração, Financeiro,
Sync, Auth, assinatura, pagamentos, domínio ou Storage.

## Leituras/gravações

getOnlineStore adiciona uma leitura da projeção pública da loja para mostrar o
estado persistido. Sem listener novo. Ativação/pausa faz 7 leituras de documentos
por tentativa de transação (contexto, loja, catálogo, vínculo), 2 updates quando
muda o estado; replay coerente tem zero updates. Sem varrer produtos/pedidos ou
criar Scheduler/custo recorrente novo. Firestore pode repetir a transação em
concorrência, como de costume.

## Testes direcionados

- App/UI/modelo/checkout e contratos de versão: **74/74**.
- Emulator Firestore + Rules/serviços: **29/29**, incluindo 9 casos de recebimento,
  isolamento V2 existente e transações V171 simples/variações com operador restrito.
- Backend/projeção de disponibilidade: **7/7**.
- Lint app: 345 arquivos JavaScript; lint backend e build passaram.
- git diff --check passou.
- Sem ciclo de auditoria extensa ou testes destrutivos de produção.

Casos novos: publicação sem recebimento; checkout pausado sem reserva; ativação
atômica mantendo outra loja intacta; rascunho não publicado; owner/boolean/
confirmação/espaço/empresa; duplicado/retry; revisão antiga após pausa; pausa
preservando pedido e reserva; retry de pedido aceito mesmo com loja pausada;
cancelamento ainda libera reserva; geração antiga negada; serviço de entrega,
capability vendas e pagamento obrigatórios; escrita direta frontend negada,
inclusive para owner. Nenhuma Rule relaxada.

Logs locais: `artifacts/v172-targeted-app-tests.txt`,
`artifacts/v172-reception-emulator.txt`, `artifacts/v172-lint.txt`,
`artifacts/v172-backend-lint.txt`, `artifacts/v172-build.txt`,
`artifacts/v172-targeted-backend-tests.txt`.

## Smoke visual local concluído

O skill computer-use foi usado para operar a UI real, não para acionar funções
internas da página. Endereço `http://127.0.0.1:8188/#/catalogo`, projeto
`demo-veconi-online-qa`. Somente loja `VECONI QA` local.

- Painel visível na visão geral, separado da publicação: passou.
- Confirmação inline mostra o espaço exato e exige segundo toque: passou.
- Pausar pedidos pelo painel: confirmou no callable/Firestore do Emulator e no
  catálogo público local, que exibiu Pedidos pausados/botão de compra desabilitado.
- Reload da administração manteve a pausa: passou.
- Ativar pedidos pelo mesmo painel: confirmou no backend e liberou o botão de
  compra no catálogo público local após reload.
- Uma segunda aba autenticada carregou o estado Recebendo pedidos.
- Troca QA A → QA B → QA A: estado de cada loja preservado.
- Comparação antes/depois: produtos, estoque físico, reservas, 7 pedidos e 1 venda
  do checkpoint local inalterados; loja B manteve a mesma revisão/configuração.
  O teste visual de recebimento não criou pedido/venda nem ajustou estoque.
- Layout do controle em 320/360/390/430px: sem overflow horizontal da página,
  com botões e rótulos legíveis. Viewport temporário restaurado ao terminar.
- Auditoria local registrou ação set_order_reception, ator, espaço, revisão e
  checkoutEnabled, sem conteúdo de compradores/tokens.

Entre sessões os processos locais haviam encerrado; a primeira tentativa no
front em cache falhou com erro interno de conexão, sem confirmação de sucesso.
Verificado ECONNREFUSED nos serviços locais. Reiniciados exclusivamente Emulator
e servidor loopback; retomado o checkpoint Firestore QA preservado, sem regravar
suas coleções. Identidades Auth **sintéticas locais** recompostas com os mesmos
UIDs, pois o checkpoint era Firestore-only. Nenhuma alteração de Auth real.
O teste completo acima foi executado depois desse reinício, com handlers reais.

Evidências: `artifacts/v172-local-paused.jpg`,
`artifacts/v172-local-receiving-desktop.jpg`,
`artifacts/v172-local-receiving-mobile.jpg`, `artifacts/v172-ui-verification.txt`.
Não confundir validação em Emulator/viewport com Android físico.

## Arquivos de runtime/release

- js/online-store-ui.js — controle/estado/confirmação por espaço.
- css/online-store.css — painel responsivo usando componentes atuais.
- functions/src/services/online-store-service.js — ação transacional e estado live.
- functions/src/shared/online-audit.js — metadata da mudança de recebimento.
- js/build-info.js — release 172 local.
- service-worker.js — cache `veconi-v172-scoped-order-reception`, release172.
- index.html — versões dos assets alterados.
- catalogo.html — versão do build-info; compra pública não reimplementada.
- tests/online-store-reception.test.js e
  tests/emulator/online-store-reception.rules.test.js — casos novos.
- Sete testes existentes ajustados somente nos contratos APP/SW/URL de build:
  desktop-workspace-sync, financial-module-v1, global-spaces-v1,
  mobile-navigation-safe-area, team-access-v150, veconi-pwa-branding-v133,
  veconi-visual-system.
- Este relatório.

## Plano de deploy — depende de autorização

1. Preservar referência V171 acima para rollback; não restaurar dados/filas.
2. Publicar somente Functions `getOnlineStore` e `saveOnlineStore`, depois frontend
   pelo workflow GitHub Pages existente. Não publicar Rules, outros handlers,
   índices ou Scheduler sem alteração necessária.
3. Verificar commit/release172/cache no domínio oficial e que o novo painel
   representa o estado público. Publicar código NÃO ativa pedidos automaticamente.
4. Só com autorização específica, confirmar "Ativar pedidos" no Adi festa,
   businessId=adi-festa, spaceId=business_adi-festa. Conferir flags privadas e
   públicas, botões/carrinho/checkout e recebimento no espaço correto.
5. Comparar metadados das outras lojas antes/depois: sem ativação indevida.
6. Fazer pedido técnico ponta a ponta somente em QA; pedido real e eventual baixa
   de produto real devem ter item/quantidade explicitamente escolhidos pelo
   proprietário. Não inventar compra real apenas para alegar smoke completo.
7. Testes manuais do proprietário, incluindo Android/PWA físico. HTTP200 isolado
   não comprova compra nem recebimento.

Rollback: pausar novos pedidos pelo mesmo controle antes de voltar código, quando
necessário. Isso preserva pedidos/reservas atuais. Reimplantar os dois callables e
frontend da V171, sem restaurar Firestore, reabrir fila, apagar cache financeiro ou
reprocessar vendas. Voltar código sozinho não desfaz uma ativação já persistida.

## Limitações / decisões do proprietário

- Android físico ainda não disponível nesta validação.
- V171 registrou intermitência de listeners; Sync manual/reload posteriores
  funcionaram, mas a causa daquele evento não foi comprovada. Esta correção
  restrita não declara o Sync definitivamente resolvido. Se reaparecer falha que
  impeça receber/concluir pedidos, pausar testes reais e capturar diagnóstico
  imediatamente, sem limpar/recriar filas ou pedidos.
- Aviso minStock das variantes QA e navegação desktop "Meus pedidos" da V171
  não são reimplementados nesta mudança de recebimento. Não há perda financeira
  comprovada por esses avisos. Mencioná-los antes da autorização.
- Permissões restritas passaram no Emulator; nenhuma conta owner será convertida
  em seller apenas para completar um teste cloud.
- Não houve gravação em produção nesta preparação. Nenhum catálogo real ativado,
  estoque modificado, pedido recriado ou venda histórica alterada.
