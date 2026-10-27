# V206 — Produtos — publicação controlada

Base sanitizada publicada: V205 `9b0702a7e56bc20685450520f2a384e092d3301f`.
Branch local: `codex/v206-product-selection`. Publicação frontend/PWA autorizada pelo usuário após a entrega local. Não há autorização para excluir/arquivar produtos reais ou executar operações comerciais no smoke.

## Diagnóstico e mudança

O menu mobile permanecia em `state.menuId` enquanto a confirmação genérica era aberta. A confirmação usava z-index 60, abaixo da folha/overlay de Produtos (70/71), e não aguardava a Promise da exclusão. O fluxo ainda tentava remover imagens antes de confirmar a gravação remota.

A confirmação específica encerra o menu e limpa seu estado antes de abrir, usa uma única camada acima da página, prende foco, permite rolagem interna, mantém o rodapé acessível e restaura foco/rolagem ao fechar. Cancelar não inicia nenhuma escrita. Cliques repetidos não empilham janelas nem enviam a mesma intenção duas vezes. Voltar fecha as camadas da interface, não desfaz uma operação já confirmada pelo operador.

Mobile: long press de 500 ms, cancelado por deslocamento maior que 8 px, rolagem, fim/cancelamento do toque ou segundo ponteiro. O clique de liberação não abre detalhes/menu. Também existe botão Selecionar, acessível por teclado/leitor de tela. Desktop: botão Selecionar e Selecionar exibidos; considera somente os cards exibidos, não produtos ocultos pelos filtros nem páginas ainda não carregadas. A seleção pode conter itens escolhidos antes da troca de filtro; a confirmação sempre enumera todos os selecionados.

## Exclusão e arquivamento seguros

Não há exclusão física nesta V1. Excluir desativa com `active:false`, `ativo:false`, `deletedAt`; Arquivar desativa com `archivedAt`. As duas ações preservam produtos/IDs, variações, imagens, vendas, movimentações, reservas registradas e demais referências. Não zeram estoque nem apagam valores históricos. Arquivar é retirada reversível do uso comercial; não foi acrescentada uma tela de reativação nesta demanda. Excluir também preserva evidência canônica e não promete remoção definitiva.

Antes da alteração: autenticação, vínculo/plano, permissão existente `products.edit`, namespace UID/empresa/geração, espaço selecionado/autorizado e leitura do produto diretamente do servidor. Produto com outra operação local não resolvida é bloqueado. Não se tenta corrigir ou reenviar essa operação.

Apenas um patch de metadados por produto é capturado pelo `DB.alterar()` e pelo Sync autorizado existente, com um operationId novo para a ação explicitamente confirmada. O protocolo, auto-retry, checksums e recibos existentes não foram alterados. Não há Function nova nem escrita Firestore direta ou canal paralelo.

`catalogAction` guarda a identidade da nova ação de catálogo no produto. O acompanhamento local fica em chave `adiFesta:productActions:<empresa>:<uid>:generation:<geração>` no key/value do IndexedDB já particionado e protegido por revisão/aba escritora. Diário e fila são persistidos pelo mecanismo atual. Ele não toca em operações históricas, recuperações ou quarentenas. Estados não confirmados não são removidos silenciosamente.

Sucesso exige `getDocFromServer` no produto correto, inativo e com o mesmo `catalogAction.operationId/kind`. Não basta esconder o card ou esvaziar a fila. Uma leitura atrasada não escreve na sessão seguinte. Se a resposta se perder, `Verificar confirmação` somente lê o servidor e não cria outra operação. O Sync original continua responsável por seu retry/idempotência. Erros permanentes não são forçados pela interface. A ação inicial requer conexão; não promete exclusão offline confirmada.

Lote é sequencial. Cada item tem resultado confirmado/pendente/falhou; uma falha independente não apaga sucessos. Mudança de sessão/espaço/permissão interrompe o restante. A interface não gera sucesso global em falha parcial.

Enquanto a nuvem não confirmar, o card continua visível em Produtos com `Aguardando confirmação`. Essa projeção não reativa o registro no DB nem o oferece a novas vendas. Alterações concorrentes pela interface do card são bloqueadas; o botão de verificação apenas lê. Somente após a confirmação remota ele sai da listagem.

## Arquivos

Runtime novo: `js/product-actions.js`, `js/product-selection.js`, `css/product-selection.css`.
Integrações: `js/app.js`, `js/produtos-mobile.js`, `js/produtos.js`, `js/product-images.js`.
Única mudança no repositório Firestore: método **somente leitura** `getProductStatusFromServer`, que retorna identidade/estado operacional sem custos.
Pacote local V206: `index.html`, `js/build-info.js`, `service-worker.js`, `public-site.manifest.json` (somente três novos assets públicos).
Testes: `tests/product-actions-v206.test.cjs`, `tests/product-selection-v206.dom.test.cjs`, `tests/emulator/product-actions-v206.rules.test.cjs`, fixture local e seu suporte. `jsdom` é dependência exclusiva de desenvolvimento, sem execução de rede/browser e sem inclusão no pacote público.
Testes de contenção: somente número da versão/nome do cache atualizado, preservando todas as asserções. Gate: `scripts/verify-v206-release.cjs`.

## Validação e limitações

Resultado local: **189 testes Node/DOM aprovados**, **8 cenários Emulator aprovados**, lint e build (2.029 arquivos JS), `git diff --check` e gate de isolamento aprovados. Pacote público gerado e inspecionado: 227 recursos explicitamente permitidos, sem fixtures, testes, diário local, evidências privadas ou arquivos históricos sensíveis. Não foi executada a suíte global inteira; foram repetidas as regressões relevantes de Produtos, permissões de clientes V205, protocolo, quarentena e isolamento de sessão/cache.

Testes de DOM usam o renderer mobile real e o renderer dos cards desktop da produção com dados fictícios; não validam pixels, viewport, teclado Android ou gestos nativos de um aparelho físico. Gestos PointerEvent, foco, retorno/histórico, seleção, duplo clique, confirmação e falha parcial são verificados no DOM offline. O Emulator valida o serviço publicado, autorização owner/seller/empresa/espaço, metadados apenas, recibos, resposta perdida e retry concorrente, sem alterar servidor de produção.

Fixture navegável privada: `tests/product-selection-v206.fixture.html?visual=produtos#/produtos`. Usar somente servidor local do checkout sanitizado, sem conta Firebase. `?visual=produtos&role=seller` testa perfil sem products.edit; `role=editor` testa vendedor com essa permissão. CSP bloqueia conexões de rede e a fixture não importa Firebase. Não está no manifest público.

**Capturas reais e validação visual 320/360/390/430 px, tablet e desktop pendentes:** o navegador recusou a origem localhost por política de segurança persistente. Não houve tentativa por outro navegador, porta ou CDP. Nenhuma captura simulada será apresentada como evidência real. O usuário autorizou a publicação com os testes automatizados aprovados e assumiu a homologação física no Android após o deploy; essa limitação não será apresentada como teste visual concluído.

## Rollback e publicação futura

Rollback compatível local: tag `rollback/v206-compatible-products` → V205 `9b0702a7e56bc20685450520f2a384e092d3301f`. Sem alteração de Functions, Rules, estruturas financeiras, Trocas ou protocolo; V205 já entende produtos inativos/deletedAt. Registros/filas da nova ação permanecem na mesma estrutura existente, e o diário adicional não é apagado. Um rollback não reativa produtos nem desfaz ações de catálogo já autorizadas.

Não publicar Functions, Rules ou índices para V206. Na publicação agora autorizada: repetir gate/testes essenciais e build; criar commit isolado e publicar main + tag de rollback usando exclusivamente a chave temporária de manutenção, com leases individuais e os dois rulesets ativos; frontend/PWA apenas. Confirmar Actions, domínio, hashes dos recursos e Service Worker por consultas não destrutivas, sem controlar o navegador bloqueado. Nenhuma alteração de permissão real, migração, limpeza de cache/fila ou operação comercial no smoke. As três vendas da funcionária, as quatro ocorrências antigas e a venda do gestor com erro de total ficam fora desta entrega.
