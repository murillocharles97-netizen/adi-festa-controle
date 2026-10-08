# Produtos — Importar / Exportar V1

Implementação aprovada para publicação V164, sem alterações de dados de produção.

## Auditoria e integração

- Tela desktop: `js/app.js`; mobile: `js/produtos-mobile.js`. Somente um botão
  e seu listener foram adicionados em cada renderer. Busca, filtros, favoritos,
  lista/grade, código, cadastro e variações permanecem nos módulos existentes.
- Produtos são canônicos em `businesses/{businessId}/products/{id}`, com
  disponibilidade por `spaceAccessMode`/`allowedSpaceIds`. Não são cópias por espaço.
  A ação utiliza a seleção global `SpaceContext.homeId()` e os espaços autorizados
  do membro. Produtos compartilhados continuam compartilhados após a edição.
- Custos protegidos usam `productFinancials/{id}`, conforme o sync atual.
  Exportação sem `cost.view` deixa a coluna Custo vazia; importação de custo é negada.
- Ajuste de estoque mantém `estoqueAtual`/`estoque` e cria `stockMovements` com
  anterior, novo, diferença, operação e ator. O projetor existente cria o Histórico.
- Leitura paginada: `createFirestoreRepository`. Gravação: transações do
  `workspace-firestore.js`, mantendo isolamento e geração/reset. Não há novo banco,
  fila paralela, cache monolítico, listener permanente ou mudança de Rules.
- Após confirmação, os listeners e o pull existente atualizam o cache IndexedDB.

## Contrato da planilha

Aba Produtos, com os oito títulos solicitados. Identificadores são texto, valores
financeiros/estoque são números tipados. Uma aba Contexto identifica modelo,
empresa e espaço de origem; uma planilha exportada de outro contexto é recusada.
Essa metadata é apenas validação adicional, nunca uma autorização para gravar.

ID VECONI tem precedência absoluta. Um ID desconhecido não cai no fallback.
Sem ID, SKU/EAN precisam identificar um único produto do catálogo autorizado;
chaves conflitantes, nome isolado, produtos ausentes, duplicatas, fórmulas e
erros de célula não são importados. Todos os duplicados são bloqueados, não apenas
a segunda ocorrência. Linhas totalmente vazias são ignoradas.

Células vazias preservam dados; zero é uma alteração válida. São aceitos números
como `10,50`, `10.50` e `1.234,50`, até duas casas decimais, sem valores negativos.
IDs/SKU/EAN convertidos em números pelo editor são recusados para evitar perda de
zeros à esquerda. Cabeçalhos podem mudar de ordem, mas não há mapeamento universal.

Campos atualizáveis: nome, categoria, custo, preço e estoque. SKU/EAN são chaves de
identificação nesta V1; alterações desses códigos continuam pelo cadastro.
Produtos com variações exportam os dados agregados existentes, mas alterações de
custo/preço/estoque agregado são recusadas e orientadas ao editor de variações.
Não são criados produtos novos nem alterada disponibilidade/empresa/espaços.

## Fluxo seguro

Abrir → carregar catálogo atual na nuvem → exportar ou selecionar arquivo →
validar todas as linhas → mostrar contadores e alterações → confirmar → resumo.

Leitura/prévia não gravam produtos. Somente a confirmação inicia transações,
em grupos de cinco produtos. Cada grupo relê os documentos e compara os campos
com os valores apresentados na prévia. Mudanças concorrentes, exclusão ou saída
do escopo produzem falha explícita na linha, sem sobrescrever o novo valor.

Permissões, empresa, usuário, geração e seleção são conferidos antes de cada grupo.
Uma fila local pendente bloqueia a operação com orientação para sincronizar.
Duplo toque é bloqueado na UI. Uma reaplicação da prévia antiga encontra conflito
e não duplica o ajuste. Reimportar o arquivo gera uma nova prévia com o estado atual.

Grupos concluídos permanecem salvos se outro grupo falhar. O resumo distingue
sucessos, falhas e linhas ignoradas. Falha de atualização do cache é apresentada
separadamente de gravações já confirmadas. Offline não inicia a operação cloud.

## XLSX e limites

SheetJS CE 0.20.3, distribuição oficial vendorizada e licença Apache-2.0 inclusa.
[Documentação oficial](https://docs.sheetjs.com/docs/getting-started/installation/standalone/).
Arquivo: `assets/xlsx-0.20.3.full.min.js`, SHA-256
`cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`.

O runtime de exportação pertence ao navegador da VECONI; não depende de ferramenta
de autoria externa nem de CDN durante o uso. A skill de planilhas orientou os
tipos de célula, formato numérico e preservação de identificadores. O arquivo de QA
foi produzido pelo próprio fluxo que será usado pelo usuário.

Parser em Web Worker, encerrado após 20 segundos. Até 5 MB e 10.000 linhas por
importação. Prévia paginada em 50 linhas para não inflar o DOM. Parser, modelo,
UI e serviço são separados para permitir um futuro adaptador de colunas sem
reescrever as regras de correspondência ou gravação.

## Testes

- Unitários: modelo, números, células vazias/zero, duplicidade, ambiguidade,
  isolamento, permissões, variações, limites, arquivo XLSX real e fórmulas.
- Emulator: serviço real com Rules atuais, sete produtos em dois grupos,
  custos protegidos, estoque/histórico, reexecução sem duplicidade, mudança de
  contexto e negação de usuário de outra empresa.
- Browser/Emulator: download real com sete produtos do espaço (oitavo excluído),
  IDs com zeros, upload, linha inválida e não encontrada, zero gravações antes da
  confirmação, um produto atualizado, uma movimentação mesmo com duplo toque,
  login preservado após reload. Larguras 320/360/375/390/412/430/1440.
- Suíte de Rules: 124 testes aprovados. Suíte unitária: 610 testes aprovados.
  Lint, build e diff-check conferidos na entrega. Android físico/Excel mobile
  ainda requer teste do usuário.

## Arquivos

Alterados: `index.html`, `js/app.js`, `js/produtos-mobile.js`, `service-worker.js`.
Novos: `js/product-spreadsheet.js`, `js/product-spreadsheet-worker.js`,
`js/product-spreadsheet-ui.js`, `js/firebase/product-spreadsheet-service.js`,
`css/product-spreadsheet.css`, os dois arquivos SheetJS em `assets/`,
`tests/product-spreadsheet.test.js`, `tests/emulator/product-spreadsheet.rules.test.js`,
`scripts/audit-product-spreadsheet.cjs` e este relatório.

Publicação V164 pelo workflow existente `Deploy GitHub Pages`, via push na `main`.
Release em `js/build-info.js`: 164. Cache: `veconi-v164-product-spreadsheet`.
O script `scripts/audit-pwa-update-v164.cjs` valida a atualização da V163, o aviso
existente, ativação, reload offline e preservação de IndexedDB/localStorage e cache
de outro projeto. Alterações preexistentes não relacionadas ficam fora do commit.
Rollback de referência: V163, `c91756b2ede54eb180b914a9e5e6ea25e36b279e`.
Nenhum deploy de Firebase Functions, Rules, índices ou Firebase Hosting é necessário.

## Roteiro no celular, após publicação

1. Escolher um espaço, abrir Produtos e verificar o novo botão abaixo das ações.
2. Exportar e conferir os oito cabeçalhos, produtos do espaço e códigos com zeros.
3. Editar custo para `8,50` e preço para `19.90`, deixando outro campo vazio.
4. Importar e conferir os valores anteriores/novos; cancelar e verificar que nada mudou.
5. Reabrir, importar novamente e confirmar. Conferir produto, custo, preço e histórico
   caso tenha alterado estoque. Reabrir o app e verificar persistência.
6. Repetir linha, usar SKU duplicado e valor inválido: linhas destacadas e não gravadas.
7. Tentar planilha de outro espaço/empresa e tentar offline: bloqueio claro.
8. Conferir busca, filtros, favoritos, lista/grade, entrada por código, cadastro e variações.
