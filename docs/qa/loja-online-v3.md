# VECONI — Loja Online V3

- **Branch:** `claude/loja-online-v3` sobre a main `2817d50` (V242.3). Worktree `Documents/VECONI-Loja`.
- **Nada publicado.** Sem push, merge ou deploy, e sem mudança em Functions, Firestore Rules, Storage Rules ou contratos de dados.
- **Arquivos compartilhados tocados:**
  - `index.html`: os `?v=` do painel e uma tag `<script>` para `js/loja/store-kit.js`.
  - `service-worker.js`: um arquivo novo na lista `ARQUIVOS`. **A versão do `CACHE` não mudou**; ela deve ser trocada na publicação.
  - `public-site.manifest.json`: um arquivo novo.
- **Dados:** todos os dados das capturas e dos testes são fictícios (a "Doceria Aurora" e números `(11) 9000…`).

## 1. Problemas do módulo atual (auditoria)

Capturas do estado anterior em `docs/screenshots/loja-online-v3/antes/`.

**Tema escuro**
- O painel ignorava o tema e ficava com a superfície clara dentro do app escuro.
- A loja pública não seguia nenhuma das identidades (fonte do sistema e cores fixas).

**Métricas e organização**
- "Taxa de conversão" e "Cliques no link" apareciam com "—" e "Ainda não medido", sem nenhuma função.
- O painel tinha seis abas e três botões de salvar ("Salvar alterações", "Desativar loja" e "Atualizar publicação"). Nada indicava o que já tinha sido salvo e o que já estava publicado.

**Seleção de produtos**
- Era uma lista de checkboxes com campos de texto para categoria e campos numéricos de ordem (0, 1, 2…) em todos os itens.
- Não havia busca, filtro nem ação em lote.
- O formulário montava todos os produtos de uma só vez.

**Imagens e prévia**
- Logo, banner e capa pediam uma "URL HTTPS" digitada à mão, com envio de arquivo à parte.
- A prévia era um desenho estático de quatro itens. Não usava a loja de verdade, não tinha carrinho e não mostrava a mensagem.

**Loja pública**
- Era um monólito de 74 KB, e a maior parte era o portal legado (identificação, benefícios, conta) que não roda mais: a página só aceita `schemaVersion 6`.
- Sem pedidos registrados ativos, a loja ficava só de vitrine: os botões "+" vinham desativados e não havia como comprar.
- Não existia finalização pelo WhatsApp.
- O modo de demonstração tinha um número de WhatsApp fixo no código.

## 2. Nova estrutura da experiência

**Painel do lojista** (rota `#/catalogo`, linguagem V242, claro e escuro)
- **Cabeçalho:** identidade da loja (logo ou iniciais nas cores da marca), situação (Nova, Rascunho, Publicada, Pausada, "Alterações não publicadas"), link e a ação principal do momento: Publicar, Publicar alterações, Retomar ou Divulgar.
- **Painel**, com a prévia real ao lado:
  - "Prepare sua loja" em 4 etapas reais: identidade, produtos, WhatsApp, publicar e compartilhar.
  - "Resumo da vitrine" só com números verdadeiros: produtos na loja, destaques, sem foto, esgotados e a forma como o cliente finaliza. Cada número leva ao filtro correspondente.
  - "Mais opções": endereço da loja, pedidos registrados (fluxo existente) e pausar.
- **Produtos:**
  - Cartões com foto, nome, preço, categoria e disponibilidade.
  - Um toque no cartão inclui ou retira o produto (`role="switch"`). A estrela destaca o produto.
  - Busca no catálogo inteiro e filtros: Todos, Na loja, Fora da loja, Destaques, Sem foto, Esgotados e categoria.
  - "Selecionar vários" com ações em lote: incluir, retirar, destacar e "selecionar os N resultados".
  - **Organizar a vitrine:** ordem e nome exibido das categorias e ordem dos produtos. Funciona arrastando pela alça, pelas setas ou com Alt+↑/↓.
- **Aparência**, com a prévia ao vivo ao lado no desktop ou o botão "Ver prévia" no celular:
  - Identidade: nome, descrição, logo e capa por envio.
  - Estilo: 9 estilos prontos e cores personalizadas com aviso de contraste.
  - Atendimento: WhatsApp validado (com "Testar este número"), retirada e local, entrega e área, horário, endereço e Instagram. As formas de pagamento ficam recolhidas.
- **Criação da loja:**
  - Um formulário curto com nome, endereço sugerido a partir do nome, WhatsApp opcional e "Começar com todos os produtos" (marcado quando o espaço tem até 60 produtos).
  - Aproveita a identidade do espaço (`SpaceBranding`) para o nome, o Instagram e o endereço.
- **Salvamento e publicação:**
  - Toda alteração vai para o rascunho na nuvem por uma fila. A barra inferior mostra o estado: pendente, salvando, "Rascunho salvo às…", "Não salvo" (com Tentar de novo e Descartar) e "Publicado às…".
  - O cliente só vê a mudança depois de "Publicar". A folha de publicação mostra o que está pronto, o que falta e o que vai mudar.

**Loja pública** (`catalogo.html?loja=<endereço>`)
- **Vitrine:**
  - Faixa da marca com logo, nome, descrição, capa, horário, retirada, entrega e Instagram.
  - Busca e categorias fixas no topo ao rolar, "Destaques" em carrossel e seções por categoria.
  - Cartões com foto 1:1, preço e "+". No desktop, o pedido fica numa coluna lateral.
- **Produto:** folha no celular e diálogo no desktop. Tem foto grande, descrição, opções por atributo (ex.: Sabor) com as esgotadas desativadas, quantidade limitada ao estoque e "Adicionar R$ X".
- **Pedido:**
  - Carrinho com observações.
  - Finalização com retirada ou entrega, nome, endereço (só para entrega), pagamento preferido (opcional) e a **mensagem exata** em formato de conversa do WhatsApp.
  - O botão "Enviar pedido pelo WhatsApp" fecha o fluxo.
- **Depois de abrir o WhatsApp:**
  - A tela diz "Agora é só enviar no WhatsApp" e "Seu pedido ainda não foi confirmado".
  - Opções: "Abrir o WhatsApp de novo", "Já enviei, limpar o carrinho" e "Voltar à loja".
  - O botão voltar do celular fecha a folha ou volta uma etapa.
- **Pedidos registrados:** se o lojista ativou o recebimento, o fluxo existente continua igual (tentativa durável, reserva de estoque e verificação), com "Avisar a loja pelo WhatsApp" na confirmação.
- **Loja pausada:** mostra a marca, o aviso e "Falar com a loja". Os casos "não encontrada", sem produtos e sem WhatsApp têm telas próprias.

## 3. Decisões de design

**Painel**
- Segue estritamente a V242. Usa só os tokens `--vf-*` (sem segunda paleta), a assinatura geométrica no cabeçalho (`--vf-geo-head` e `--vf-texture`), os raios de 10 a 22 px e a fonte Inter.
- O tema escuro vem dos mesmos tokens e não precisou da ponte legada.

**Loja pública**
- A marca é do lojista, mas a superfície é neutra e fria, para as fotos aparecerem.
- O lojista escolhe só **duas cores**:
  - **faixa da marca**: o topo da loja;
  - **destaque**: botões e preços.
- O texto sobre cada cor é calculado por contraste WCAG (`StoreKit.theme`). Os 9 estilos prontos passam nos testes: faixa ≥ 4,5:1, preço ≥ 4,5:1 e botão ≥ 3:1.
- Isso resolve "estilo visual entre opções bem projetadas" sem criar campos novos no servidor.

**Momento central**
- A finalização mostra a mensagem que será enviada como uma bolha do WhatsApp, e o botão é o verde do WhatsApp com texto escuro, que é legível. O cliente vê o que vai mandar e entende que a loja confirma pela conversa.
- **Prévia = loja real:** o painel embute `catalogo.html?preview=1` e envia o rascunho por `postMessage`, só para a mesma origem e só para a janela que embute a página. Na prévia não há Firebase e nada é enviado: o botão do WhatsApp abre uma "Prévia da mensagem".
- **Textos:** honestos sobre o que acontece. "Rascunho salvo" nunca vira "publicado". "Abrir o WhatsApp" nunca vira "pedido recebido". O frete é sempre "a combinar".

## 4. Funcionalidades implementadas (por etapa)

**A e B (painel e aparência)**
- Commit `cccc575`: `js/online-store-ui.js`, `css/online-store.css` e o novo `js/loja/store-kit.js`, com helpers puros compartilhados: paletas, contraste, endereço, rascunho, mensagem e URL.
- `js/firebase/catalog-bridge.js` ganhou uma leitura única do documento **público** (`FirebasePublicCatalogReader`), usada para dizer o que ainda não foi publicado.

**C e D (loja pública e WhatsApp)**
- Commit `2c8f387`: `js/catalogo-publico.js`, `css/catalogo.css` e `catalogo.html`.

**E (QA)**
- Testes no commit `05f75b5`.
- Auditoria e capturas no último commit: `scripts/audit-loja-online-v3.cjs` e `scripts/loja-qa-kit.cjs`.

Pontos de contrato preservados:
- `saveOnlineStore`: `save`, `publish` com `confirmed`, `set_order_reception`, cerca por `revision` e `checkoutEnabled` inalterado no `save`.
- A apresentação é enviada só para os itens selecionados.
- Os 7 testes de invariantes do recebimento de pedidos (`tests/online-store-reception.test.js`) passam **sem alteração**.

## 5. Capturas

Pasta `docs/screenshots/loja-online-v3/`, com 62 capturas mais 5 em `antes/`. O arquivo `results.json` traz as checagens de cada captura.

**Painel**
- `painel-{light,dark}-{360,390,412,768,1366,1440}`
- `produtos-*`
- `aparencia-*`
- `produtos-ativando-390` e `produtos-salvo-390`
- `produtos-selecao-em-lote-390`
- `organizar-390`
- `publicar-390` e `publicado-390`
- `compartilhar-390` (com QR Code)
- `erro-salvamento-390`
- `aparencia-validacao-390`
- `previa-tela-cheia-390`

**Estados do painel**
- `estado-new-{390,1366}`
- `estado-new-link-ocupado-390` e `estado-new-criada-390`
- `estado-draft-1366`, `estado-paused-390`, `estado-nophone-390`, `estado-readonly-390`, `estado-overlimit-390`
- `desempenho-2000-produtos-1366`

**Loja**
- `loja-vitrine-{360,390,412,768,1366,1440}` e as versões completas
- `loja-produto-variacao-*`, `loja-com-itens-*`, `loja-carrinho-390`
- `loja-validacao-*`, `loja-finalizar-*`, `loja-enviado-whatsapp-*`
- `loja-estado-{pausada,sem-produtos,sem-whatsapp,nao-encontrada}-390`
- `emulador-loja-real-390`, renderizada com o documento publicado pelo backend real no emulador

## 6. Fluxo público completo (com clique real e captura da aba aberta)

O fluxo testado (`scripts/audit-loja-online-v3.cjs`, em 390 e 1366 px):
1. Bolo de pote (variação "Ninho com morango", 2 un.), mais 1 Brigadeiro e 2 Cookies.
2. Carrinho com observação.
3. Tentativa de enviar sem nome: bloqueada e campo destacado.
4. Entrega, nome, endereço e Pix.
5. "Enviar pedido pelo WhatsApp" abriu `https://wa.me/5511900000000?text=…`, que é o número publicado da loja. O texto decodificado é:

```
Olá! Gostaria de fazer um pedido pela loja Doceria Aurora.

🛒 *Meu pedido*
2x Bolo de pote (Ninho com morango) — R$ 32,00
1x Brigadeiro gourmet — R$ 3,50
2x Cookie com gotas — R$ 14,00

Subtotal: R$ 49,50
Entrega: Entregar no endereço
Endereço: Rua Fictícia, 200 — Jardim QA
Taxa de entrega: a combinar
Pagamento: Pix
Observações: Sem granulado colorido, por favor.
Nome: Maria Teste

*Total dos produtos: R$ 49,50*
A taxa de entrega ainda não está incluída.

Aguardo a confirmação da disponibilidade e do pedido. Obrigado!
```

Verificado depois do clique:
- Nenhuma chamada a `submitCatalogOrder` nem outra função.
- A tela informa que o pedido ainda não foi confirmado.
- O carrinho é preservado até "Já enviei".

Com o documento gerado pelo backend real (emulador), a mensagem saiu para `wa.me/5511912345678` com "pela loja Doceria V3 QA".

## 7. Testes

**Unitários (`npm test`)**
- 1.304 testes: 1.199 passam e 105 falham.
- **Nenhuma falha nova** em relação à main `2817d50`, que tinha 1.264 testes, 1.151 passando e 113 falhando. As falhas restantes são pré-existentes; algumas variam por horário.

**`tests/loja-online-v3.test.js`: 22 testes**
- Mensagem de retirada e de entrega, sem frete inventado.
- Limpeza de texto e URL `wa.me` com emoji, acento e quebra de linha.
- Validação do WhatsApp.
- Endereço sugerido e reservados.
- Contraste dos 9 estilos.
- Rascunho convertido no contrato do servidor.
- Situação, preparação e diferenças.
- Painel com DOM real (jsdom):
  - salvo só depois da confirmação;
  - falha de rede vira "Não salvo" e o rascunho é mantido;
  - resposta sem a alteração vira erro;
  - conflito reaplica uma vez sem sobrescrever o outro aparelho;
  - somente o proprietário altera;
  - limite de 400;
  - publicar espera o rascunho;
  - 2.000 produtos (36 cartões e busca fora do lote);
  - prévia sem custo.
- Loja: nenhum número fixo; o WhatsApp não registra pedido; a prévia só aceita mensagens da mesma origem; a loja pausada é tratada.

**Testes estruturais da V2 atualizados com os mesmos invariantes**
- Busca e filtros locais, sem leitura.
- O cartão não compra sozinho.
- Diálogos centrais no desktop.
- A modalidade é validada pelo servidor.
- Enquadramento de foto e SEO.
- Atualização registrada depois da navegação.
- Nenhuma leitura Firebase nos módulos de UI.

**Emulador**: `npm run test:loja-v3:emulator`, 6/6 contra `onlineStoreService` e `firestore.rules` reais, usando os payloads do painel.

**Navegador**: `node scripts/audit-loja-online-v3.cjs`, com 62 capturas e **90/90 checagens**. O Chrome roda isolado da rede: o resolvedor só aceita 127.0.0.1.
- 0 rolagens horizontais.
- 0 controles sem nome.
- 0 imagens sem `alt`.
- Sem erros de página.
- Teclado:
  - Espaço alterna o produto;
  - Alt+↓ reordena categorias;
  - Enter abre o produto com foco no diálogo;
  - Esc fecha e devolve o foco.
- Alvos de toque de 36 px ou mais (o alternador da prévia subiu de 38×34 para 44×40).

## 8. Isolamento entre espaços e empresas

O emulador confirmou:

**Seleção**
- O produto exclusivo do espaço B não aparece no espaço A.
- Produto de outro espaço ou de outra empresa na seleção é recusado (`failed-precondition`).

**Permissões**
- Um gerente com `products.edit` não altera a loja (`permission-denied`).
- O dono de outra empresa não carrega a loja nem usa um endereço já tomado (`already-exists`).

**Rascunho e documento público**
- O rascunho não cria nem altera o documento público.
- O documento público não contém `custo`, `cost`, `fornecedor`, `margemLucro`, IDs de usuários nem telefone de cliente.

**Rules**
- Um visitante lê só `publicCatalogs/{token}` e o endereço da loja.
- Não lista catálogos e não lê o rascunho (`onlineStores`).
- Visitante, outra empresa e gerente não escrevem em `publicCatalogs`, `publicCatalogSlugs` nem `onlineStores`.

O painel fica preso ao espaço selecionado:
- Toda resposta antiga é descartada pela sequência (o teste de invariante "old response cannot activate UI of another space" segue passando).
- A troca de espaço exige salvar ou descartar antes.

## 9. Desempenho

**Painel com 2.000 produtos** (fixture com o servidor simulado sem limite; veja a pendência P1)
- Abre Produtos em cerca de 48 ms com **36 cartões montados** (cerca de 130 nós no painel).
- Busca em todo o catálogo em cerca de 48 ms.
- Alternar um cartão leva menos de 1 ms: só o cartão é redesenhado.
- O salvamento junta toques em 900 ms.

**Loja com 400 produtos** (máximo do servidor)
- `DOMContentLoaded` em cerca de 40 ms no loopback e busca em cerca de 75 ms.
- As seções usam `content-visibility: auto` e as imagens são `lazy`.

**Leituras extras**: o painel faz uma leitura do documento público ao abrir e depois de publicar. Busca, filtros, carrinho e mensagem são 100% locais.

## 10. Pendências, riscos e GO/NO-GO

### Mudanças de backend propostas (pedem aprovação; nada foi implementado)

**P1. `getOnlineStore` acima de 1.000 produtos**
- Hoje o servidor recusa (`resource-exhausted`) e o painel mostra uma mensagem clara.
- Para 2.000 produtos ou mais é preciso paginar a listagem (ex.: cursor por nome) ou devolver só campos de vitrine.
- **Risco:** baixo. É leitura, e o painel já renderiza em lotes.

**P2. Mais de 400 itens na loja**
- O documento público é único e tem limite de cerca de 1 MB.
- Passar disso exige itens paginados em subcoleção.
- **Risco:** médio. Muda o contrato da loja pública e as Rules.

**P3. Custo do salvamento do rascunho**
- Cada `save` relê todos os produtos selecionados (até 400) e até 1.000 variações.
- Proposta: validar a seleção só no `publish`, ou ter uma ação `save_draft` leve.
- **Risco:** baixo, mas é preciso cuidar para o rascunho não aceitar ID de outro espaço. Hoje o painel junta os toques para reduzir o custo.

**P4. Personalização extra**
- Campos novos em `catalogSettings`: layout dos cartões, exibição de preço, seções da página inicial, outras redes sociais e taxa de entrega fixa opcional.
- **Risco:** um servidor antigo descarta campos sem avisar. O painel V3 já detecta isso e mostra "O servidor não confirmou todas as alterações".

**P5. Enquadramento das fotos**
- A projeção `OnlineStoreModel.product` não publica `imagePresentation`.
- A loja já aplica o enquadramento quando ele existe; hoje as fotos usam o recorte padrão ("cover").

### Riscos e observações

- **Service Worker:** a versão do `CACHE` precisa ser trocada na publicação (decisão do Codex/usuário).
- **Remoções na página pública:** saíram o portal legado (identificação, benefícios, conta) e o modo `?demo=1`. Os dois eram inalcançáveis para lojas V2: a página já recusava `schemaVersion` menor que 6.
  - O script antigo `audit-public-catalog-desktop-v2.cjs` foi substituído pelo novo (`npm run test:public-catalog-browser`).
  - A Function `identifyCatalogCustomer` continua existindo.
- **Dados do cliente no aparelho:** nome e endereço ficam salvos neste aparelho, por loja (como já acontecia), para o próximo pedido. Não há um botão "esquecer meus dados"; é uma possível melhoria.
- **Nomes do módulo:** o menu continua chamando a rota de "Catálogo online" (o `index.html` é compartilhado), e a tela se chama "Loja online". Vale alinhar numa próxima versão.
- **Teste real do WhatsApp:** ainda é preciso testar em aparelho real que `wa.me` abre o app nos navegadores embutidos (Instagram e Facebook). A loja usa um link `<a target="_blank">` gerado no clique, que é o caminho mais compatível, mas ninguém tocou em um aparelho físico.

### GO/NO-GO

- **GO para revisão do Codex e homologação.**
  - Frontend sem mudança de backend e contrato preservado.
  - 0 falhas novas nos unitários, 6/6 no emulador e 90/90 na auditoria do navegador.
- **NO-GO para produção até:**
  1. a revisão do Codex;
  2. a decisão sobre a versão do cache do Service Worker;
  3. o teste em celular real, abrindo o WhatsApp a partir da loja publicada num espaço de teste;
  4. a autorização do usuário para publicar.
- As pendências P1 a P5 não bloqueiam esta versão. Elas dependem de aprovação para mexer no backend.
