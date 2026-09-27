# V154 — Central de mensagens: persistência e retorno do WhatsApp

Status: implementação local testada; publicação RETIDA. Branch `codex/message-sequence-v154`.
O usuário informou não ter Android disponível. Não foi dispensado o gate de teste físico.

## Causa e evidências

1. A chave que falhava é construída por `storageKey()` em `js/storage.js`:
   `adiFestaDB_v1:<businessId>:<uid>:<permissionSignature>`; no cache legado, `adiFestaDB_v1:<businessId>`.
   `salvar()` executava `localStorage.setItem(key, JSON.stringify(normalizado))` para TODO o banco.
2. `Mensagens.createSequence/updateSequence` chamavam `DB.alterar`, que regravava clientes, vendas,
   pagamentos, movimentos, histórico e sequências a cada mudança. A captura de sync também copiava
   a base e enfileirava alterações operacionais. Não eram 80 mensagens pré-renderizadas: eram IDs e
   rascunho dentro de um banco muito maior. A hipótese de persistência estava correta, com essa distinção.
3. O backup fornecido de 22/09 tinha 2.927.971 bytes no arquivo formatado; em JSON compacto,
   2.276.067 bytes UTF-8 e aproximadamente 4.541.302 bytes UTF-16. Vendas: 964.640 bytes;
   messageHistory: 149.108; charges/cobrancas: 76.615; 15 messageSequences: 64.952.
   Isso NÃO é uma medição do storage atual do Android. Outras chaves também dividem a quota da origem.
4. A antiga abertura seguia `openWhatsApp → registerOpened → updateSequence → setPending`.
   Se a gravação do banco falhasse depois da abertura, o estado de retorno não era salvo.
   `returnShown` e o estado transitório em sessionStorage também não reconstruíam a jornada após reload.
5. No teste Chromium, o localStorage da origem foi preenchido até lançar `QuotaExceededError` real.
   Mesmo assim, a nova sequência de 80 contatos iniciou e confirmou os três primeiros.
   O registro inicial dessa fixture tinha 1.745 bytes, com IDs sintéticos curtos; o tamanho real varia.

## Persistência e fluxo novos

- `DB.localRecords`: extensão estruturada do namespace DB, com IndexedDB `veconi-local-records`,
  store `records`, índice de escopo `businessId:actorUid`. Não existia uma camada de IndexedDB da
  aplicação; os outros bancos IndexedDB pertencem ao SDK Firebase e não foram reutilizados indevidamente.
- Sequência guarda IDs selecionados, tipo, template/rascunho, índice, cliente atual, contadores,
  timestamps e revisão. Só a mensagem do contato atual é renderizada e armazenada.
- Máquina: `PREPARED → AWAITING_CONFIRMATION → PREPARED/FINISHED`; `CONFIRMED` e `SKIPPED`
  são transições auditadas; `CANCELLED` encerra com resumo de enviados, pulados e restantes.
- O commit IndexedDB de `AWAITING_CONFIRMATION` termina ANTES de apresentar “Continuar para WhatsApp”.
  O clique nesse botão abre a URL sincronicamente, sem await de Firestore ou storage no gesto.
- A confirmação é montada imediatamente após abrir. Também é reconstruída em `visibilitychange`,
  `pageshow`, `focus`, lifecycle resume e ao reabrir a Central. Listeners são instalados uma vez.
- “Sim, enviado” grava evento e avanço juntos, numa única transação IndexedDB. “Pular” não grava envio.
  Cancelar a confirmação anterior à abertura volta ao editor sem registrar envio.
- Reload/reabertura oferecem a sequência existente; uma nova não substitui silenciosamente a anterior.
- `sequenceId + customerId` define operationId estável. Revisão/índice esperados impedem avanço duplo
  entre toques ou abas. O evento é publicado numa transação Firestore idempotente.
- O progresso não é escrito no Firestore. Só confirmações explícitas geram messageHistory e, quando
  cobrança, charges e metadados lastChargeAt/lastChargeMessageId. Não escreve saldo, venda ou pagamento.
- A confirmação offline fica em uma fila IndexedDB, com aviso de sincronização pendente; volta a tentar
  ao conectar/retomar. Falha de IDB não avança o índice e mostra mensagem compreensível.
- O leitor canônico é o mesmo `readCanonicalClient`, com opção de somente leitura, evitando gravar toda
  a base para preparar a sequência. O saldo é revalidado para o contato atual antes de preparar a abertura.
  Cobrança sem confirmação cloud fica bloqueada; campanhas/avisos/texto sem variável saldo podem funcionar offline.
- O fluxo individual mantém seu comportamento. O teste específico de regressão continua separado.

## Migração, retenção e segurança

- Importa apenas sequências do ator/empresa, ou legado sem ator quando owner, após commit bem-sucedido.
  Só então compacta as respectivas linhas `messageSequences` do cache antigo; não remove o banco completo.
- Remove apenas metadados obsoletos `adiFestaMessageCenterState_v2`, `adiFestaActiveMessageSequence_v2`
  e pending-return correspondente à sequência migrada. Não apaga carrinho, vendas, clientes, financeiro ou sync queue.
- Se houver evento legado de abertura para o contato atual, restaura a pergunta de confirmação e reutiliza
  seus IDs de evento/operação/cobrança. Não transforma abertura em envio automaticamente.
- Sem evento legado recuperável, oferece preparação do contato atual. Não inventa confirmação perdida.
- Resumos, drafts e sequências encerradas antigas são coletados após 30 dias. Eventos de negócio pendentes
  nunca são removidos pela coleta. O backup financeiro/global e o cache geral legado não foram migrados.
- Rules: leitura de messageHistory também permitida ao membro ATIVO do MESMO business com
  customers.view + customers.edit, coerente com a autorização de registrar mensagens. Nenhum acesso
  genérico para todo usuário autenticado. Seller sem permissão, desativado e usuário de outro business negados.
- Instrumentação de storage em desenvolvimento informa chave, bytes e tipo, sem conteúdo integral.

## Testes executados

| Teste | Resultado |
| --- | --- |
| Unit/integration da aplicação | 525/525 |
| Suite Firestore/Auth/Storage Rules | 104/104 |
| Sequência completa com 3 clientes | passou; confirmação explícita antes de cada avanço |
| 80 clientes + localStorage realmente cheio | passou; primeiros três confirmados e progresso preservado |
| Seleções 1, 10 e 125 | passaram |
| Reload em PREPARED e AWAITING_CONFIRMATION | passou |
| Fechar/reabrir aba no mesmo perfil | passou; não equivale a fechar um PWA Android |
| visibilitychange/pageshow/focus | passou; listeners convergem em uma confirmação |
| Chromium congelado por 125 segundos | passou; confirmação continuou disponível |
| Background envelhecido em 10 minutos | passou como simulação de estado, não espera física |
| Quota/erro IndexedDB injetado | passou; sem avanço e mensagem amigável |
| Migração e coleta de 30 dias | passaram; evento antigo reutilizado, dados críticos e outbox preservados |
| Offline campanha/aviso/livre + retry | passou |
| Duplo clique e duas abas | passou; um registro e um avanço |
| Saldo atualizado antes de preparar envio | passou; valor alterado na fixture refletido na mensagem |
| Telefone inválido, pular, cancelar | passaram sem marcar enviado |
| WhatsApp individual mobile/desktop | passou; cancelamento e idempotência preservados |
| Mãe / João Adidas / Kami Adidas | fixtures sintéticas; card, confirmação e mensagem consistentes |
| Login owner + reload | passou com Firebase Auth Emulator |
| Home, Clientes, Vender, venda teste e carrinho | auditorias de navegador passaram |
| Financeiro e acesso de equipe | auditorias de navegador passaram |
| Histórico/isolamento de business | unit/integration/Rules passaram |
| PWA manifest, assets e service worker | passou no Chromium desktop |
| lint / build / git diff --check | passaram |
| Android físico/PWA + WhatsApp real | NÃO EXECUTADO: aparelho indisponível |

As aberturas de WhatsApp nos testes automatizados foram interceptadas; nenhuma mensagem real foi enviada.
O smoke foi coberto por auditorias de módulos/fixtures e emuladores, não por uma jornada única autenticada
em produção no Android. Esse smoke físico completo e o envio externo real continuam pendentes.
Uma fixture antiga de Home não configurava Equipe V1 e escondia a métrica de lucro; foi corrigida para
representar seu owner ativo, sem alterar a tela de produção.

## Arquivos e reprodução

Implementação: `js/local-records.js`, `js/message-sequence.js`, `js/message-sequence-ui.js`,
`js/mensagens-mobile.js`, `js/mensagens.js`, `js/storage.js`, `js/firebase/sync.js`,
`firestore.rules`, `css/mensagens-mobile.css`.

Versão/cache: `index.html`, `js/build-info.js`, `js/firebase/auth.js`, `js/firebase/firebase-ui.js`,
`service-worker.js`; release 154, cache `veconi-v154-message-sequence`.

Testes: `scripts/audit-message-sequence-v154.cjs`, `tests/message-sequence-v154.fixture.html`,
`tests/message-sequence-v154.test.js`, `scripts/audit-whatsapp-v152.cjs`,
`tests/whatsapp-v152.fixture.html`, `tests/whatsapp-hotfix-v152.test.js`,
`tests/emulator/team-access.rules.test.js`, `tests/desktop-shell-content.fixture.html`, `package.json`.
Asserções de versão também atualizadas nos testes de cache/build existentes, sem remover cenários funcionais.

Comandos principais: `npm test`, `npm run test:message-sequence`, `npm run test:whatsapp-browser`,
`npm run test:emulator`, `npm run test:login-recovery-browser`, `npm run test:desktop-selling`,
`npm run test:home-cart-v142-browser`, `npm run test:financial-browser`, `npm run test:team-access-browser`,
`npm run test:pwa-branding`, `npm run lint`, `npm run build`, `git diff --check`.
Para espera real de 125s no navegador, definir `SEQUENCE_LONG_BACKGROUND=1` antes do audit da sequência.

## Release e gate de publicação

- APP_VERSION/release: **154**. Service worker atualizado para incluir os novos módulos offline.
- Commit: registrado no histórico da branch `codex/message-sequence-v154` e informado na entrega.
- Deploy: **não realizado**. Nenhum push em main; esse push dispararia Pages automaticamente.
- URL existente: https://murillocharles97-netizen.github.io/adi-festa-controle/ — NÃO contém este hotfix local.
- Antes da publicação única: validar em Android/PWA real com três clientes de teste, retorno do WhatsApp,
  confirmação, background, fechar/reabrir PWA e smoke completo owner → Home → venda teste → Clientes →
  WhatsApp individual → Central → Financeiro → Histórico → reload. Publicar Rules junto à release validada.

Limites: IndexedDB também depende de espaço disponível e das políticas de armazenamento do navegador.
Não há promessa de persistência após limpeza dos dados do site/desinstalação ou falta total de espaço.
O hotfix remove o banco inteiro do caminho crítico da sequência, não reescreve a persistência de todos os módulos.
