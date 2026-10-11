# Importação de produtos V2

## Preparação da publicação V168 — 11/10/2026

Base de produção preservada: V167, `441ebce87f07fec80f6de8ec0f517ac94b878051`.
Domínio oficial permanece `https://veconi.app.br/`. Nenhuma migração de dados.
Release visível 168; cache `veconi-v168-product-import`.

Validação repetida na base de release: 633 testes do app, 131 do backend e
130 testes Firestore em instância nova e isolada, todos aprovados. Lint/build:
313 arquivos JavaScript. `git diff --check` sem erros. A primeira execução em
emulador previamente utilizado apresentou colisões de fixtures; não foi aceita
como resultado e foi substituída pela execução isolada completa.

Publicar `createSpreadsheetProducts`, Rules e os quatro endpoints de restauração
que compartilham a classificação de coleções (capability, request, retry e worker).
Essa compatibilidade apenas reconhece recibos/reservas da importação como dados
operacionais; publicar o código não solicita nem executa restauração alguma.
Não publicar funções de cobrança, autenticação, domínio ou Storage Rules.

Smoke autorizado exclusivamente em um espaço VECONI QA/QA V168, com dois produtos
QA V168 Produto 1/2, estoque zero. Resultado de produção deve ser registrado após
o deploy, sem antecipar sucesso. Teste físico Android permanece a cargo do usuário.

Rollback: reverter coordenadamente frontend, callable e Rules para a base V167,
sem remover produtos ou dados criados. Restaurar também a classificação de reset
exige manter compatibilidade com os recibos existentes; não executar reset como
parte de rollback. Clientes antigos devem atualizar antes de novas alterações de
identidade após ativação do controle de concorrência; filas não são descartadas.

O relatório abaixo registra a implementação local original, anterior ao release.

## Escopo e auditoria

Implementação local, sem deploy, sem migração de dados e sem gravações em produção.
Versão pública/cache não incrementados nesta tarefa. As alterações pré-existentes
de domínio e demais trabalhos no diretório não fazem parte desta entrega.

O cadastro manual usa `Produtos.salvar` em `js/produtos.js`, o modelo de produto
schema 14, `DB.alterar` e a fila transacional existente em `js/firebase/sync.js`.
Custos são segregados em `productFinancials`; estoque usa os campos canônicos
`estoqueAtual`/`estoque` e `stockMovements`. A V1 de planilhas já atualizava produtos
em pequenas transações otimistas no Firestore, após prévia e confirmação.

O construtor original foi extraído para `functions/src/shared/product-model.js`
e é chamado tanto pelo cadastro manual quanto pela criação via planilha. Não há
um segundo schema nem uma nova base local. A criação online é comandada por uma
callable para validar concorrência, escopo, permissões e plano no servidor.

## Correspondência e prévia

- Modo padrão: **Atualizar produtos existentes**. Criação exige escolher
  **Criar novos + atualizar existentes**.
- ID VECONI tem prioridade. ID desconhecido ou fora do escopo não vira criação.
- Sem ID: SKU; sem SKU: EAN. Se ambos forem informados, devem ser coerentes.
  Correspondências múltiplas ou conflitantes bloqueiam a linha.
- Nome nunca identifica um produto para atualização. Pode criar um produto novo
  sem códigos, assim como o cadastro manual.
- Códigos de produtos inativos, variações e códigos alternativos ficam reservados;
  revisar pelo cadastro, sem criar duplicatas nem alterar variações pela planilha.
- Todas as ocorrências duplicadas de ID, SKU, EAN ou linha sem identificador são
  bloqueadas; não existe política silenciosa de “primeiro/último vence”.
- Nome é obrigatório para criação. Custo/preço/estoque vazios usam os defaults do
  cadastro manual (zero). Células vazias em atualização preservam valores.
- Números aceitam `10,50`, `10.50` e `1.234,56`; estoque não negativo, até duas casas
  decimais, conforme estoque fracionado já permitido. IDs/SKU/EAN devem ser texto
  para não perder zeros à esquerda. EAN segue o cadastro atual, que também admite
  códigos internos; não foi introduzida uma exigência nova de dígito verificador.
- Criação requer espaço específico autorizado. “Todos os espaços” continua útil
  para exportar/atualizar, mas não determina implicitamente o espaço de criação.
- Prévia separa atualizações, novos, erros e conflitos. Seleção do arquivo e troca
  de modo fazem somente leituras. Só **Confirmar importação** escreve.

## Persistência, idempotência e concorrência

`createSpreadsheetProducts` valida usuário, membro ativo, permissões de produto,
custos/estoque, entitlement de planilha, business, espaço e workspaceGeneration.
Cada lote de até 25 criações usa uma transação Admin SDK. Reconsulta códigos no
catálogo/variações e cria produto, custo permitido, movimento de estoque inicial
e comprovante de operação atomicamente. Falha da transação não deixa meio cadastro.

`productImportOperations` mantém recibos server-side. IDs determinísticos incluem
geração, espaço e dados normalizados da linha, não sua posição. Duplo clique,
duas abas, retry após erro de rede e reenvio da mesma criação não duplicam produto
ou estoque. Campo numérico vazio e seu default explícito têm a mesma identidade.

`productImportIdentifiers` mantém reservas e um documento `catalog-revision`.
Importações e escritas de identidade do catálogo pela fila atual participam da
mesma transação de controle. O token único de commit permite que o SDK reexecute
uma transação concorrente; comparar apenas o contador nas Rules provocava uma
negação prematura antes da reexecução. A reserva é reavaliada no retry.

Rules impedem que o cliente forje recibos/criações importadas e exigem participação
nesse controle para criar/mudar identidades quando o documento já existe. Escritas
somente de estoque não passam pelo novo controle. Filas conflitantes são preservadas
para revisão, nunca apagadas. Isto preserva o modelo existente de clientes autorizados
editarem produtos; não é uma migração de todo cadastro manual para o backend.

Atualizações V1 permanecem em grupos de cinco, comparando valores e identificadores
atuais com a prévia. Não sobrescrevem mudanças concorrentes cegamente. Após confirmação,
o pull existente recarrega produtos, custos e estoque no IndexedDB. Nenhum snapshot
monolítico novo é criado no localStorage.

## Limitações e preparação de uma futura publicação

- Mantidas as oito colunas VECONI; aliases `Nome` e `Estoque inicial` aceitos. Sem
  mapeamento universal, criação de variações, imagens ou produtos recorrentes.
- Máximo 5 MB / 10.000 linhas. Prévia mostra inicialmente 50 linhas, com “Mostrar mais”.
- Exige internet e fila sincronizada. Atomicidade é por lote, não por arquivo inteiro.
  O resumo informa sucessos e falhas; lotes já confirmados não são revertidos.
- Sem SKU/EAN, arquivos alterados não permitem deduzir identidade pelo nome. Para
  futuras atualizações, exportar e conservar o ID VECONI gerado. Um reenvio idêntico
  sem códigos é tratado como repetição, não como outro produto intencional.
- A checagem server-side lê uma projeção do catálogo e das variações por lote de
  criação, para proteger códigos legados ainda não indexados. Há custo proporcional
  ao catálogo; não existe listener global novo. Grandes catálogos podem exigir uma
  etapa futura de indexação incremental antes de otimizar essas leituras.
- Em futura publicação, coordenar callable + Rules + frontend/cache. Clientes antigos
  que não participam do controle de concorrência poderão ter novas escritas de
  identidade negadas após sua ativação; precisam atualizar, mantendo sua fila local.
  Não publicar só o frontend. Não houve alteração da versão visível nesta tarefa.
- Nenhum teste em Android físico foi realizado. Larguras mobile foram simuladas
  em Chrome, com o aplicativo e emuladores reais.

## Testes e evidências

- `npm test`: 641 aprovados, incluindo patches parciais de estoque/preço e tombstone de variação.
- `npm --prefix functions test`: 131 aprovados.
- Firestore Emulator: 61 aprovados em planilhas V1/V2, variações, equipe,
  entitlements e workspaceGeneration; inclui leituras/escritas multiempresa negadas,
  usuário restrito, reset, concorrência e tentativa de forjar recibos.
- Teste adicional de lote de 25 criações/reenvio: uma criação e um movimento por produto.
- Browser com Auth/Firestore/Functions Emulator: exportação do espaço correto,
  XLSX real, prévia sem escrita, atualização V1, duas criações + uma atualização V2,
  duplo clique, cadastro manual após importação e sessão/Produtos após reload.
- Larguras: 320, 360, 375, 390, 412, 430 e 1440 px, sem extrapolar o modal.
- `npm run lint`, `npm run build` e `git diff --check`.
- Evidências locais: `artifacts/product-spreadsheet/390-v2-preview.png`,
  `390-v2-success.png`, `390-actions.png` e `1440-products.png`.

Erros `PERMISSION_DENIED` em casos negativos do emulador são esperados; não indicam
que os testes de operações autorizadas falharam. Nenhuma credencial/conta real foi usada.

## Arquivos desta implementação

Produção:

- `functions/src/shared/product-model.js` (novo construtor compartilhado)
- `functions/src/shared/product-spreadsheet.js` (validação compartilhada V1/V2)
- `functions/src/services/product-spreadsheet-service.js` (nova callable transacional)
- `functions/src/index.js` (export da callable)
- `functions/src/services/workspace-reset-policy.js` (classificação dos dois stores)
- `js/produtos.js` (reuso do construtor)
- `js/product-spreadsheet.js` (compatibilidade de importação do modelo)
- `js/product-spreadsheet-ui.js` e `css/product-spreadsheet.css`
- `js/firebase/product-spreadsheet-service.js`
- `js/firebase/product-import-fence.js` e `js/firebase/sync.js`
- `firestore.rules`
- `index.html` (somente scripts compartilhados nesta tarefa)
- `service-worker.js` (novos assets, sem alteração de versão/cache)

Testes/documentação:

- `tests/product-spreadsheet-v2.test.js`
- `tests/product-import-fence.test.js`
- `tests/emulator/product-spreadsheet-v2.rules.test.js`
- `tests/emulator/product-spreadsheet.rules.test.js`
- `tests/barcode.test.js`, `tests/product-variations.test.js`,
  `tests/mobile-products-selling-fixes.test.js`, `tests/financial-domain.test.js`
- `scripts/audit-product-spreadsheet.cjs`
- Este relatório.

## Roteiro de aceite no celular (quando houver versão de teste)

1. Selecionar um espaço, exportar e guardar IDs/zeros iniciais.
2. Alterar preço de um produto, adicionar uma linha nova com nome/SKU e outra só
   com nome. Selecionar criação + atualização e conferir a prévia, antes de confirmar.
3. Confirmar com duplo toque: novos uma vez, atualização correta e estoque inicial correto.
4. Reimportar: não pode criar cópia dos produtos já confirmados.
5. Testar SKU/EAN repetidos, ID de outro espaço, nome vazio e estoque negativo:
   linhas bloqueadas, sem gravações indevidas.
6. Deixar custo/preço vazios em uma atualização: valores existentes preservados.
7. Recarregar e verificar Produtos, busca, favoritos, filtros, variações e cadastro manual.
