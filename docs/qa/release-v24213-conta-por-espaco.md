# VECONI V242.13 — Plano de publicação da Conta por Espaço

## Estado da candidata

A base é a `origin/main` V242.12 (`f84d34f`). A branch local `codex/release-v24213-conta-por-espaco` preserva o resultado dos 28 commits do Claude, com documentação sanitizada e correções pontuais de leitura e recebimento. Os 28 commits originais continuam disponíveis nas worktrees do Claude. Alguns deles continham dados financeiros reais em relatórios. O intervalo a revisar e publicar é somente `f84d34f..codex/release-v24213-conta-por-espaco`. Integrar a linhagem original publicaria esses dados mesmo depois de removê-los dos arquivos finais.

| Trabalho | Branch original | Ponta |
| --- | --- | --- |
| Fase 0, contrato e testes de ajuste | `claude/fase0-ajuste-contrato` | `b2b4509` |
| Fase 1, conta sombra | `claude/fase1-conta-sombra` | `d60369b` |
| Fase 2, carga auditada | `claude/fase2-carga-contas` | `87f8af9` |
| Fase 3, ajuste e estorno | `claude/fase3-comando-ajuste` | `de4f7db` |
| Fase 4, leitura nas telas | `claude/fase4-leitura-conta` | `ee6a7d0` |
| Fase 4c, roteamento de recebimentos | `claude/fase4c-recebimento` | `c56d481` |
| Etapa 1, conta nativa | `claude/etapa1-cliente-nativo` | `b1437ca` |
| Etapa 2, migração simples | `claude/etapa2-migracao-simples` | `61f6629` |
| Etapa 3, parcelamentos | `claude/etapa3-parcelamentos` | `066d9e3` |
| Etapa 4, abertura auditada | `claude/etapa4-abertura-geral` | `d2d8ff3` |
| Etapa 5, projeção transacional | `claude/etapa5-conta-transacional` | `bdb9e4b` |
| Etapa 6, auditoria e reconciliação | `claude/etapa6-auditoria` | `ecc2136` |
| Etapa 7, prontidão e contingência | `claude/etapa7-preparacao-fase5` | `5522577` |

O contrato está nas notas da [Fase 0](fase0-ajuste-saldo.md), [Fase 3](fase3-comando-ajuste.md), [Fase 4](fase4-leitura-conta.md) e [Fase 4c](fase4c-recebimento-conta.md). A Etapa 7 mantém `PROOF_COMPATIBILITY`, leitura por histórico e contingência de recebimento. A retirada do legado da Fase 5 será objeto de outra decisão.

A cobrança em lote permanece em sua própria branch. A integração posterior tem sobreposição em `clientes-page.js`, `cobrancas.js`, `index.html`, Service Worker, manifesto, rota de recebimento, prova histórica e commit operacional. Testar esses pontos na integração futura com a base então publicada.

## Evidência local da transferência

- Suíte JS/CJS com Node 22, mesmo comando nas duas bases. V242.12 teve 2.460 aprovados, 116 falhas e um ignorado. A candidata teve 2.501 aprovados, 115 falhas e um ignorado. A comparação por nome não encontrou falha nova.
- Firestore/Auth Emulator com Rules da candidata e empresas fictícias. Foram 39 testes de integração aprovados. A suíte de recebimento passou em sete testes após a correção, incluindo a contingência quando a consulta indexada devolve pré-condição.
- O leitor da conta separa a cópia local por sessão, empresa, geração e escopo. Testes cobrem redução de acesso, duas consultas por grupos de Espaços, instantâneo de cache e rejeição da leitura.
- Lint, build, pacote público, 56 verificações de contenção e 13 testes dirigidos de versionamento e sessão passaram.
- Atualização em Chrome headless e servidor local, com perfil isolado. O Service Worker trocou V242.12 por V242.13, serviu 13 recursos versionados com SHA-256 correspondente ao pacote e preservou dois registros fictícios no IndexedDB, quatro operações da fila e o tema escuro. A reabertura offline conferiu os mesmos dados. A homologação no PWA oficial em Android permanece pendente.


## 1. Preparação e backup

1. Após autorização, conferir `origin/main`, versão publicada, identidade única da release e o intervalo sanitizado. Inventariar Functions ativas, revisões e tráfego, Rules, índices, logs e estado do GitHub Pages. Guardar a referência exata de artefatos de retorno e testar cada retorno em ambiente isolado.
2. Antes de ligar qualquer gravação nova, obter ponto de recuperação do Firestore em destino privado. Usar exportação PITR em timestamp fixo se disponível. Se for preciso usar exportação comum, programar janela sem gravações e confirmar seu fim, pois a exportação comum pode incluir alterações concorrentes. Proteger bucket, retenção e registro da recuperação. Ensaiar restauração em banco isolado. Registrar geração da empresa e verificar filas em todos os dispositivos do piloto. [Documentação do Firestore](https://firebase.google.com/docs/firestore/manage-data/export-import)
3. Preparar e testar revisões de ativação e de retorno isoladas. A candidata local tem flags de escrita habilitadas. Antes de qualquer janela de observação sem gravações da nova arquitetura, preparar artefato com `SHADOW_ENABLED`, `TRANSACTIONAL_ENABLED` e `NATIVE_SPACE_ACCOUNT_ENABLED` desligados. Manter `ACCOUNT_RECEIPT_ENABLED` e `LEDGER_READ_ENABLED` desligados até a paridade do piloto. Isolar os modos de escrita de `manageCustomerAccounts`, inclusive auditoria e reconciliação, que gravam dados derivados. As flags são de código. Os comandos de carga e migração podem ser autorizados empresa por empresa. A ativação de uma revisão de escrita automática alcança todo o tráfego dessa Function.

## 2. Functions e Rules

| Ordem | Publicação seletiva | Condição verificável |
| --- | --- | --- |
| 1 | `manageCustomerAccounts` e `projectCustomerAccount` | Publicar primeiro os artefatos de observação. A primeira Function concentra prévias e comandos de carga, migração, abertura, ajuste, auditoria e reconciliação. O gatilho reage à criação em `balanceEvents`. |
| 2 | `getOperationalSyncReceipt` | Manter prova histórica disponível e testar clientes V242.12. Liberar leitura por conta e a 4c somente após comparação de paridade. |
| 3 | `commitOperationalSync` e `confirmPriorSale` | Ambos usam o mesmo motor de commit. Ter versões compatíveis em todo o tráfego e observar paridade entre o gatilho e a escrita transacional. A prévia da venda anterior continua no código vigente. |
| 4 | `previewSaleCancellation` e `confirmSaleCancellation` | Usam o serviço compartilhado de cancelamento. Publicar o par e validar prévias antigas e novas, cancelamento no Espaço secundário e repetição segura. |
| 5 | `firestore:rules` | Habilitar a leitura de `customerSpaceAccounts` por empresa, geração e Espaço concedido. As coleções de conta, eventos aplicados, carga, migração, auditoria e abertura ficam sob controle do servidor. |

As dependências comuns incluem os serviços `customer-account-*`, `customer-balance-adjustment-service`, `operational-commit-service`, `sale-cancellation-service`, `fiado-account-service`, `fiado-receipt-route`, `fiado-space-regularization` e os módulos de conta, abertura e histórico em `functions/src/shared`. Cada revisão deve ser empacotada a partir do mesmo conjunto testado de arquivos. O diff não muda dependências do Node, Rules de Storage nem índices. Conferir as consultas de parcelas pendentes e dos listeners por Espaço no projeto de destino antes de liberar a leitura. Em pré-condição do índice opcional da 4c, a prévia passa pela prova integral.

`commitFinancialMaintenance` continua gerando eventos já consumidos pelo gatilho. `getPreservedPaymentRecognition` e `reviewFiadoOriginEvidence` conservam os contratos atuais. Incluir os três nos testes de compatibilidade com o backend misto, mantendo as revisões publicadas enquanto esses contratos estiverem cobertos. Usar deploy seletivo por nome, sem redeploy amplo.

## 3. Conta sombra, carga e migração

1. Ligar o projetor sombra e conferir eventos novos, reentrega, equivalência em centavos, versão financeira e isolamento. Monitorar volume de leituras e duração de transações antes de ligar as escritas transacionais. Qualquer diferença inexplicada interrompe a ampliação.
2. No piloto autorizado, usar o proprietário ativo e a geração atual para paginar `customer_account_backfill_preview`. Usar `rules: []` inicialmente. Conferir de forma privada valores não atribuídos, excluídos, históricos inconclusivos e totais. Se o relatório conferir, autorizar `customer_account_backfill_apply` com `confirmed`, `backupConfirmed` e `runId`. Limite de 50 por página, preferir páginas pequenas e um operador por empresa. Cada cliente é avaliado em transação. Após perda de resposta, comparar os itens gravados e o cursor persistido antes de retomar. Repetir uma página pode regravar metadados e incrementar o contador. Registrar conclusão página a página.
3. Clientes existentes com obrigações integralmente comprovadas usam `customer_account_migration_preview` e `customer_account_migration`, com `quoteHash` atual e a mesma identidade para conferir uma tentativa após perda de resposta. Migrar casos simples e parcelados por esse caminho. Conferir que centavos, parcelas, valores já recebidos, IDs e histórico permanecem íntegros. Validar a lida com versões financeiras quando há movimento concorrente.
4. Casos `needs_opening` continuam em conferência até o proprietário comprovar a divisão por Espaço, conferir filas e aprovar abertura por cliente. A abertura cria um marco auditado e pode alterar saldo e versão financeira para o valor confirmado. Se houver diferença em centavos, apresentar a diferença e obter autorização específica antes de gravar. Preservar movimentos antigos e cronogramas. Casos sem prova continuam no caminho existente, inclusive após a publicação. A conta nativa cobre o primeiro lançamento elegível de cliente sem histórico.
5. Conferir todas as páginas de `customer_account_readiness`, incluindo `nextCursor`. Auditoria grava achados. Reconciliação atualiza a projeção mediante versão vigente e autorização. Fazer ambas somente quando previstas para o piloto. Conferir recebimento total, parcial, parcelas futuras, ajuste e estorno no mesmo Espaço, venda anterior, cancelamento, sincronização, ausência de duplicidade, e versões do backend convivendo com V242.12. Ativar os leitores somente quando a conta que será usada estiver comprovada.

## 4. Frontend e verificação

- Candidata local com `APP_VERSION` e `GET_VERSION` em `242.13`, cache `veconi-v24213-conta-por-espaco-v1` e `clientRelease` 242. Protocolo 1 e schema 4 permanecem. Os dois imports de Sync, HTML e precache apontam para o mesmo recurso versionado.
- Publicar por GitHub Pages depois da autorização e dos gates de backend. Conferir SHA servido, HTTP, manifesto, pacote permitido, precache e identidade do Service Worker. Testar atualização V242.12 para V242.13 com IndexedDB, filas, sessão e preferências existentes e reabertura offline. Homologar em Android físico antes da ampliação do piloto.
- Observar latência p95, custo de leitura e transação, falhas do gatilho, diferenças de saldo e motivos de contingência. Verificar recibo original depois de uma resposta perdida. Conferir leitura de membro com acesso parcial e ausência de valores fora dos Espaços autorizados. Testes financeiros com dados inventados ficam em ambiente isolado. Usar evidências reais somente em conferência autorizada e sob acesso restrito.

## 5. Retorno individual

| Sintoma | Contenção e retorno |
| --- | --- |
| Falha de frontend ou PWA | Publicar novo commit de retorno com cache novo e assets alinhados, mantendo IndexedDB, recibos e filas. Manter o backend capaz de atender as duas versões. |
| Falha de leitura da conta ou da 4c | Desligar `LEDGER_READ_ENABLED` ou `ACCOUNT_RECEIPT_ENABLED` na Function de leitura e usar a prova histórica. Preservar o comando canônico de recebimento e seus recibos. |
| Falha na conta nativa ou transacional | Suspender o fluxo afetado. Testar retorno de `commitOperationalSync` e `confirmPriorSale` em conjunto, com a conta sombra e a prova histórica ainda disponíveis. Em seguida conferir eventos e reconciliar ao retomar. Preservar os marcadores de clientes já migrados e a compatibilidade com aberturas. |
| Falha de carga, migração, abertura, ajuste ou reconciliação | Parar o comando afetado e manter prévias e evidências. Conferir caso a caso pela versão atual. Corrigir projeção comprovável pelo comando de reconciliação. Para ajuste financeiro confirmado, usar o estorno auditado, com prévia e identidade própria, se autorizado. Aberturas e migrações confirmadas ficam no histórico. |
| Falha de escopo de leitura | Fechar a leitura do novo namespace com revisão específica de Rules, preservando dados server-only. Retornar frontend ou leitura pertinente até revalidar permissões. |

Evitar troca cega por todo o backend anterior depois de uma migração, pois revisões anteriores podem ignorar marcadores e provas novas. A cópia de segurança serve para recuperação dirigida sob autorização específica. Uma importação ampla pode substituir documentos modificados desde a cópia e não aciona Functions para reconstruir projeções. [Comportamento da importação do Firestore](https://firebase.google.com/docs/firestore/manage-data/export-import)

O trabalho desta transferência é local. Backup, ensaio operacional no ambiente de destino, ativação, alterações de dados e publicação dependem dos respectivos gates e autorizações.
