# V163 — Contas e cartões: loop e aparência

## Escopo

Somente a seção Contas e cartões e seus metadados visuais. Resumo, cálculos,
lançamentos, saldos, faturas, limites, espaços e IDs mantêm o contrato anterior.
Base/rollback do frontend: V162, `d335a9a4afca64464764f8e080b34abed000d664`.

## Carrossel

`js/financial-accounts-carousel.js`, sem biblioteca adicional. Rolagem nativa,
snap central, mouse, toque, trackpad, teclado e setas. Sem autoplay.
Uma faixa circular inclui cópias **somente de apresentação** antes/depois dos
itens reais. Ao cruzar a faixa central, o scroll é compensado pela distância
exata de um ciclo, com escala/opacidade transferidas no mesmo paint, sem
transição entre cópias equivalentes. Paginação usa o índice lógico. Não existem
IDs DOM duplicados nem documentos financeiros clonados. Um item não tem loop;
dois itens usam a mesma faixa circular. Descarte de listeners por AbortController.

## Aparência e referência

Seção branca com subtítulo e Personalizar cartões. Cards coloridos, destaque
central, laterais em escala 0,90, decoração CSS local, iniciais como fallback,
lápis separado do menu operacional. Nenhuma imagem externa ou bandeira inventada.
Foram usados os elementos da referência enviada em 05/10/2026; números/datas
da imagem NÃO são copiados para os dados do aplicativo.

Defaults por chave exata conhecida (`banco_inter`, `c6_bank`, `nubank`, etc.),
sem correspondência parcial de nomes. Cor neutra para identificação desconhecida.
O laranja é ajustado para contraste AA com texto branco; cores personalizadas
escolhem texto claro/escuro automaticamente, verificando ambos os extremos do
gradiente. Em combinação sem contraste suficiente, usa-se cor sólida legível.
Investimento continua patrimônio; cartão sem conta não ganha saldo fictício;
limite desconhecido não gera barra; ausência de fatura aparece uma única vez.

## Persistência e segurança

Não há documento canônico de instituição: o agrupamento existente reúne recursos
de `financialSpaces/{home}/financialAccounts/{id}` e `creditCards/{id}`.
Cada recurso do agrupamento recebe exclusivamente:

```text
presentation: { displayName, color, gradientVariant, cardNickname? }
presentationUpdatedAt
```

`displayName` não altera `institution`, `institutionKey` ou `name` técnicos.
`cardNickname` é individual por cartão. A gravação usa o writer existente,
preservando a barreira de geração/reset, em batch atômico. Não são gravados
saldos, limites, transações ou identidades. Restaurar padrão grava `{}` somente
na apresentação após Salvar. Cancelar e live preview nunca gravam.

Não foi criada coleção, banco, listener ou cache novo. A metadata acompanha as
leituras atuais; outro dispositivo a recebe ao carregar os mesmos recursos.
Não há reads/writes na navegação. Salvar: **N writes**, um por recurso exibido no
agrupamento (conta + cartão = 2), em um único batch; não uma gravação por slide
ou clone. As leituras de contexto/generation do writer e o refresh posterior
continuam os da arquitetura existente. Isso evita uma coleção paralela e
mantém o reset operacional já implementado.

Owner/manager autorizado: permitido. Seller: não personaliza, mesmo tendo
visualização financeira. Espaços pessoais continuam privados. Rules restringem
campos, tamanho, cor, estilo e alterações simultâneas de valores financeiros.
O caminho de metadados é separado das validações financeiras para não exceder
o limite de expressões das Rules; as permissões e o fence continuam obrigatórios.

## Validação

Resultados locais/emulador, incluindo nova rodada após versionamento:

- Unit: 601/601; Firestore/Auth/Storage Rules: 122/122; lint e build: aprovados
  (290 arquivos JavaScript verificados); `git diff --check`: aprovado.
- Carrossel: 320, 360, 375, 390, 412, 430, 1024, 1280, 1366, 1440, 1600,
  1920 px; sem overflow da página; snap com erro inferior a 2 px; mouse, touch,
  wheel, teclado, movimento reduzido, 0/1/2/3/4/8/12 instituições.
- Loop: 20 movimentos à direita, 20 à esquerda e 20 rápidos; paginação lógica,
  vizinhos presentes e nenhuma query ao navegar. Resumo financeiro inalterado.
- Atalhos: Ver todos e detalhes abrem os destinos existentes; Ajustar saldo,
  Ajustar fatura e Pagar fatura abrem seus formulários e cancelam sem gravação.
- Preview/cancelamento: zero writes. Salvar Inter Principal/Inter Pessoal e
  C6 Black: serviço e Rules reais no emulador, reload e segundo contexto de
  navegador com a mesma apresentação; campos financeiros comparados antes/depois.
- Permissões: owner/manager autorizado, seller negado, isolamento entre empresas,
  espaço pessoal, geração/reset, schema e batch atômico verificados.
- Smoke integrado: login owner, Home, Vender, fiado, recebimento, Payment Engine
  aprovado/recusado/recovery/duplicidade/estoque, Clientes, WhatsApp individual
  simulado e sequência de três, Financeiro, Histórico, Equipe, sync IndexedDB,
  reload autenticado; convergência entre dois contextos locais.
- PWA: service worker, assets em cache, reload/offline; owner/seller/manager e
  navegação validados pelo audit de desempenho existente. O audit de pagamentos
  mantém no relatório o rótulo histórico 159, mas executou o código desta entrega.

Evidências (dados sintéticos restritos ao emulador/fixture):

- [Desktop Inter, primeiro índice com cards dos dois lados](screenshots/accounts-carousel-v163/1440-inter-real-app.png)
- [Desktop C6](screenshots/accounts-carousel-v163/1440-c6-real-app.png)
- [Mobile 390](screenshots/accounts-carousel-v163/390-carousel-real-app.png)
- [Modal mobile](screenshots/accounts-carousel-v163/390-modal-real-app.png)
- [Preview desktop](screenshots/accounts-carousel-v163/1440-personalizar-preview.png)

Não houve teste físico em Android nesta execução; emulação não equivale ao
aparelho real. Nenhuma escrita de QA utiliza o projeto de produção.

## Arquivos

Produção: `js/financial-accounts-carousel.js`, `css/financial-accounts-carousel.css`,
`js/financial-ui.js`, `js/firebase/financial-space-service.js`, `firestore.rules`.
Versionamento: `js/build-info.js`, `js/app.js`, `index.html`, `service-worker.js`.
QA: `tests/financial-accounts-carousel.test.js`, `tests/financial-presentation-service.test.js`,
`tests/emulator/financial-presentation.rules.test.js`, `tests/financial-module.fixture.html`,
`scripts/audit-accounts-carousel-v163.cjs`, `scripts/audit-financial-presentation-v163.cjs`;
expectativas de versão dos testes existentes atualizadas mecanicamente.
Documentação: este relatório e screenshots acima. Sem dependências novas.

## Publicação e rollback

APP_VERSION: **163**. Cache/SW: **veconi-v163-card-presentation**.
Testes locais aprovados. Entrega em um commit coeso (o que adiciona este relatório),
com Rules antes do frontend e uma publicação Pages final. Nenhuma migration
financeira é necessária. O resultado efetivo do deploy e SHA são informados
na resposta após verificar a publicação.
URL: https://murillocharles97-netizen.github.io/adi-festa-controle/
Rollback de interface: voltar ao commit V162 acima preservando a proteção das
Rules de apresentação. Não rebaixar Rules/reset-generation para versões antigas.
