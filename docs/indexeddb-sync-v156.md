# V156 — persistência empresarial estruturada

## Causa e escopo

O diagnóstico Android/PWA V155 fornecido identificou `persisting_cloud_snapshot`,
`localStorage`, `QuotaExceededError`, `local-storage-quota`. A chave
`adiFestaDB_v1:<business>:<uid>:<permissionSignature>` recebia um snapshot completo
serializado a cada alteração. Os 652 documentos ocupavam 2.451.351 bytes UTF-8 /
4.891.376 bytes UTF-16, além das demais chaves do origin. Os downloads haviam
terminado e a fila estava vazia: a falha não era de internet, Auth ou Rules.

Não houve edição de dados financeiros de produção, limpeza de filas, mudança de
Rules/Functions ou alteração visual da Equipe. Os dados das verificações abaixo
são sintéticos, em origens locais e emuladores isolados.

## Arquitetura nova

- Banco existente `veconi-local-records`, versão 1; store existente `records`,
  índice `scope`. Nenhum segundo banco foi criado.
- Escopo empresarial separado por business/usuário/assinatura de permissões.
- Coleções divididas em documentos estruturados, preservando ordem, IDs,
  duplicatas legadas e campos desconhecidos. Filas divididas por operação.
  Configurações pequenas permanecem objetos estruturados.
- A projeção síncrona em memória mantém os contratos dos módulos de negócio.
  `DB.flush()` aguarda a confirmação da transação IndexedDB. Não há uma string
  JSON empresarial monolítica armazenada no novo backend.
- O diff por documento escreve apenas registros alterados e metadados; ainda
  percorre a projeção em memória para detectar mudanças. Não é um novo motor
  de consultas lazy, nem elimina o custo O(n) desse diff.
- Alterações de dados e fila produzidas na mesma ação são transacionais.
  Venda/recebimento aguardam durabilidade antes da confirmação de sucesso;
  upload aguarda a fila durável antes da chamada remota.
- Consultas incrementais existentes foram preservadas. Cursor só avança depois
  de persistir o lote. Revisão transacional impede uma aba desatualizada de
  sobrescrever gravações de outra aba.
- Firestore continua canônico; regras existentes de revisão, operação pendente
  e projeção financeira são mantidas. O cache offline do SDK Firestore foi
  preservado: não representa toda a projeção operacional local nem substitui
  nossa fila, mutações offline ou registros ainda não enviados.

## Migração, retenção e falhas

1. Ler somente a chave do escopo atual (ou fallback legado autorizado do owner).
2. Preservar o conteúdo original; gravar documentos + metadados/SHA-256 numa
   transação IndexedDB.
3. Reler a cópia e comparar integralmente com o original.
4. Gravar a confirmação de verificação.
5. Conferir que a chave original não mudou; remover somente essa chave exata.

Reabertura após interrupção retoma a verificação. Se o original mudou em outra
versão/aba, a migração bloqueia com causa específica e preserva os dados para
revisão. JSON inválido não vira uma base vazia ou demo. Nunca se usa
`localStorage.clear()` nem limpeza global de IndexedDB/Service Worker.

Chaves efetivamente removidas em um aparelho dependem da migração que ocorrer
nele: somente a fonte `adiFestaDB_v1...` verificada. Backups antigos de schema e
cópias legadas de fila não são apagados automaticamente. Operações novas e
metadados de sincronização usam o backend IndexedDB; a preferência de empresa
ativa pode continuar no localStorage, com falha não bloqueante por quota.

O catálogo público não autenticado possui um cache separado `adiCatalogCache:`,
que não participa do full-business-cache e não foi migrado neste hotfix. Sua
existência é exibida na auditoria de metadados; não se afirma que todo o
localStorage do origin passou a conter apenas flags.

Não são criadas versões completas sucessivas do snapshot. A transação mantém a
revisão atual; limpeza já existente de sequências concluídas após 30 dias é
preservada e não remove eventos ainda não enviados. Não há expurgo automático
de vendas/pagamentos ou filas. Em quota do IndexedDB, a transação aborta,
mantém os registros já duráveis e oferece erro explícito; alterações não
confirmadas permanecem em memória para retry enquanto a página estiver aberta.
Não se promete sobreviver ao fechamento de uma alteração cuja gravação falhou.

Quatro scripts legados de carga/correção financeira automática foram retirados
do bootstrap HTML (`cleanupDemo`, `kyteBootstrap`, `saldoCorrecoes`,
`financeMigration`). Eles executavam antes da inicialização autenticada do
banco. Seus arquivos permanecem no repositório; não foram reexecutados depois
da migração para evitar reaplicar correções/importações antigas.

## Sincronização e diagnóstico

Persistência cloud e cursor são aguardados antes do sucesso/timestamp. Sync
automático mantém o agendamento/listeners existentes. Sync manual executa a
auditoria de integridade depois dos dados; reaproveita documentos do pull
completo, consultando separadamente fontes de auditoria não baixadas. Uma falha
opcional de integridade fica separada de uma sincronização de dados concluída.
Não foi introduzido listener global novo. Contagens de reads reais em produção
dependem do negócio; não foram medidas neste aparelho.

Diagnóstico versão 4: backend, DB/store, layout, número de registros, última
transação, pendência/erro local, migração verificada/removida, inventário de
prefixos/tamanhos/tipos antes/depois, `navigator.storage.estimate()` quando
disponível, Auth/member/business, etapas/erro/timestamp/fila e integridade.
Inventário de storage não inclui conteúdos de clientes ou credenciais. A
estimativa de storage é do origin e pode incluir outros aplicativos.
`navigator.storage.persist()` não é requerido nem solicitado automaticamente.

## Evidências de teste

| Verificação | Resultado |
|---|---|
| Unit/integration de domínio (`node --test tests/*.test.js`) | 534 passaram |
| Firestore/Auth/Storage Rules, emuladores | 104 passaram; nenhuma Rules relaxada |
| IndexedDB real em Chromium (`npm run test:business-cache`) | 9 cenários |
| Fixture equivalente ao diagnóstico | 126 clientes, 338 vendas, 108 pagamentos, 33 ajustes + 47 produtos = 652 documentos; tamanho exato do diagnóstico |
| Migração | leitura de volta, verificação, remoção somente da chave fonte; dados sintéticos PrimeDocs/TaxPress preservados |
| Quota localStorage | origin isolado preenchido até QuotaExceededError; gravações empresariais continuam no IndexedDB |
| Escala | 1.000 clientes + 5.000 vendas; 8.064.374 bytes de projeção; uma alteração escreve 1 registro + metadados |
| Interrupção | transação abortada não grava venda/saldo/fila parcialmente; retry sem duplicar; migração interrompida retoma |
| Concorrência | aba obsoleta rejeitada sem sobrescrever a revisão durável |
| Offline/reload | cache e fila persistidos; cursor não avança quando persistência falha |
| Sync real integrado com emuladores | aplicativo completo, Auth + Firestore + Functions; owner ativo/all |
| Dois dispositivos simulados | contextos de navegador com storage separado; convergência nas duas direções |
| Smoke integrado | Home, Vender/fiado, Clientes/Receber, WhatsApp individual, sequência 3 clientes, Financeiro, Histórico, Equipe/modal cancelar-reabrir, reload autenticado |
| WhatsApp individual | saldo canônico, cancelamento, permissões e idempotência; abertura externa simulada |
| Sequência | 15 cenários, incluindo 80 contatos/localStorage cheio, 1/3/10/125, lifecycle, reload, offline e multiaba |
| Financeiro browser | 4 auditorias passaram |
| Equipe responsiva | 20 layouts passaram; visual V155 preservado |
| Home/Clientes e venda desktop | auditorias passaram |
| PWA | manifesto, assets e controle do service worker passaram |

Logs e artefatos locais: `artifacts/v156-*.log`. Scripts novos reproduzíveis:
`scripts/audit-business-cache-v156.cjs` e `scripts/audit-v156-integrated.cjs`.
O segundo recusa execução sem emuladores e bloqueia endpoints de produção.

## Publicação e aceite físico

APP_VERSION/release 156; cache SW `veconi-v156-indexeddb-cache`. Publicação somente
do frontend via um push/uma execução GitHub Pages. URL:
https://murillocharles97-netizen.github.io/adi-festa-controle/

Base anterior V155: `00965cf818e811814716f59cb3908e88a92cd32a`.
**Atenção a rollback:** V155 não entende a nova persistência. Depois da migração,
retornar apenas o código pode ocultar registros locais ainda não enviados.
Preservar IndexedDB, exportar diagnóstico/backup e planejar recuperação; preferir
correção progressiva. Não limpar o banco para viabilizar downgrade.

Pendente: no mesmo Android/PWA, confirmar V156, abrir Sincronização, sincronizar,
verificar timestamp e integridade e exportar diagnóstico. Esse teste físico e
WhatsApp real não podem ser substituídos pelos testes automatizados. O hotfix
não é declarado validado naquele aparelho antes dessa confirmação.

Arquivos funcionais: `js/business-cache.js`, `js/storage.js`,
`js/firebase/sync.js`, `js/firebase/auth.js`, `js/firebase/firebase-ui.js`,
`js/checkout.js`, `js/terminal-payments.js`, `js/app.js`, `js/clientes-page.js`,
`js/message-sequence.js`, `js/build-info.js`, `index.html`, `service-worker.js`.
Testes existentes adaptados para bootstrap assíncrono e release 156; novo helper
de memória apenas para testes unitários legados. Os testes de IndexedDB usam o
backend real, não esse helper.
