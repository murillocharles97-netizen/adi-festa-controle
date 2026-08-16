# Paridade funcional mobile e desktop

Funcionalidades do Adi Festa devem possuir a mesma regra de negócio, dados, permissões e ações no mobile e no desktop. O layout pode divergir para respeitar densidade, navegação e tamanho de tela, mas não deve existir um segundo motor de negócio por plataforma.

## CRM e segmentos

- `EngagementSegments` centraliza os segmentos sugeridos, a regra de proximidade de recompensa (80% ou mais da meta) e o construtor de filtros salvo.
- Filtros personalizados aceitam apenas campos e operadores da lista permitida e suportam `all` (E) e `any` (OU).
- Segmentos salvos ficam em `segmentosClientes`, isolados pelo `businessId`, e são sincronizados pela infraestrutura existente.
- O resultado corrente é reutilizado nas ações de WhatsApp, criação de campanha e exportação CSV. A lista completa só é consultada quando a ação exigir o conjunto completo.

## Campanhas operacionais

- O Campaign Engine V2 continua sendo a fonte da verdade.
- A interface apenas projeta participantes, progresso próximo da recompensa, recompensas disponíveis, resgates, progresso pendente de fiado e participantes parados.
- CRM e Campanhas usam a mesma regra de proximidade de recompensa.

## Apresentação do catálogo

- Produtos operacionais não são duplicados.
- Overrides públicos são salvos em `config.catalogSettings.presentation`:
  - `banners[]`;
  - `categories[internalName]`;
  - `products[productId]`.
- Cada produto público pode escolher `imageMode: product | catalog`, sem alterar a imagem do estoque.
- Imagens públicas usam paths multiempresa sob `businesses/{businessId}/catalog/...`.
- A publicação gera um único documento público autocontido; o catálogo anônimo não consulta coleções administrativas.

## Pedidos online

- Estados persistidos continuam `recebido`, `confirmado`, `separando`, `entregue` e `cancelado`.
- A interface traduz esses estados em Recebido, Em preparo, Pronto e Entregue e apresenta somente a próxima ação válida.
- Transições inválidas são bloqueadas e a operação possui identificador idempotente.
- A criação de venda, campanha, estoque e renovação ocorre apenas no fluxo já consolidado de conversão do pedido.

## Custo e carregamento

- Trocar tabs, chips, busca já hidratada e abrir editores visuais não cria leituras.
- O editor de catálogo reutiliza o snapshot local e publica uma atualização consolidada.
- Não existe listener individual por produto, categoria, banner ou pedido.
- Listas continuam limitadas/paginadas; ações sobre o resultado completo carregam esse conjunto somente quando solicitadas.
