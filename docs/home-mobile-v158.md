# V158 — Home mobile

## Escopo

Refinamento visual da Home, sem alteração dos cálculos existentes, atribuição
de espaços, operações financeiras, clientes, produtos ou infraestrutura de sync.
Sem imagens/valores fictícios da referência na interface real e sem novas queries.

## Visual e navegação

- Header existente preservado (menu, marca, título/data, nuvem e avatar), com
  ajustes CSS restritos à Home mobile.
- Seletor e filtro de espaço compactos, usando o picker real existente.
- Meta geral/do espaço com destaque teal, progresso, percentual e edição.
- Vendido/lucro e vendas/itens/clientes menores; lucro respeita permissão atual.
- Prioridades reais e condicionais, somente para destinos autorizados.
- Produtos em falta e estoque baixo separados: cada card abre seu filtro exato.
- Pedidos abre Pedidos online; clientes devendo abre Clientes filtrado por débito;
  renovações mantém o destino/filtro existente.
- Resumo rápido: ticket médio do dia e total dos últimos sete dias, calculados
  dos agregados já existentes. Não foi criada meta semanal fictícia.
- Indicadores menores e resumos abrem detalhes de leitura com contexto do espaço.
  Modais têm fechar, Escape e contenção de foco. Nenhum write financeiro.

## Alerta de vendas antigas sem espaço

Origem: `SpaceContext.contextualData()` em `js/spaces.js` conta vendas válidas
para as quais `resolveSaleSpaceId()` não resolve um espaço conhecido. É uma
informação de atribuição histórica, não prova de falha de sync ou perda financeira.
O card mobile usava `target:'goal'`, portanto apontava incorretamente ao editor
de meta, não a uma revisão de vendas.

Como não existe nessa Home um fluxo seguro e específico de revisão, o card foi
retirado das prioridades. Não foram atribuídos espaços, corrigidos registros ou
alterados totais. A contagem técnica no modelo e as regras de agregação continuam
inalteradas. Não foi afirmado que as 300 vendas reais foram reparadas; uma inspeção
individual de produção não faz parte desta tarefa visual.

## Testes

- 551 testes unitários, incluindo exclusão do alerta histórico, destinos
  suportados, permissões, resumo real e preservação dos agregados.
- `scripts/audit-home-v158.cjs`: Chromium isolado/loopback, 320/360/375/390/412/430,
  sem overflow; seletor/filtro reais; edição independente de meta geral/espaço;
  detalhes do dia e semana; cliques em estoque esgotado/baixo, pedidos e débito;
  estado vazio; renderer desktop preservado.
- `scripts/audit-mobile-home-clients.cjs`: Home/Clientes, metas zero e altas
  (até 125.000), paginação/busca e contexto de renovação, seis larguras.
- Smoke Auth/Firestore/Functions emulados: owner/login, Home, fiado/recebimento,
  WhatsApp individual, sequência de três com retorno simulado, dois contextos
  isolados convergindo, Financeiro, Histórico, Equipe, reload e integridade OK.
- PWA automatizado: manifest, assets HTTP 200 e service worker controlando a página.
- Lint, build e git diff --check. Nenhuma venda/WhatsApp real de teste em produção.
- Android físico permanece para validação do usuário; emulação não é teste físico.

Screenshots locais: `artifacts/home-v158/home-320.png` até `home-430.png`,
`day-summary.png`, `week-summary.png` e `desktop.png`.

## Arquivos e publicação

Implementação: `js/home-mobile.js`, `css/home-mobile.css`.
Release/cache: `index.html`, `js/build-info.js`, `service-worker.js`.
Testes novos: `tests/home-mobile-v158.test.js`, `scripts/audit-home-v158.cjs`.
As demais mudanças em testes somente acompanham APP_VERSION/SW cache.

APP_VERSION=158; SW/cache=`veconi-v158-home`. Publicação somente frontend.
Rollback: V157 `fa43f7d0cea1ce7d326addb9ba6e75bd9202b147`.
URL: https://murillocharles97-netizen.github.io/adi-festa-controle/
