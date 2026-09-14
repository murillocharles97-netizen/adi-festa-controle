# VECONI — Configurações essenciais e tutorial geral (release 137)

## Resultado

A tela Configurações foi reduzida a três grupos com nove ações essenciais e passou a usar a mesma implementação no mobile e no desktop. O cabeçalho da rota foi alinhado à referência aprovada, o status de sincronização usa o estado real já mantido por `SyncFirebase`, e a navegação inferior existente foi preservada.

Antes, Configurações repetia atalhos para Clientes e fiado, Produtos e estoque, Histórico, Campanhas, Renovações, CRM, Catálogo online, Pedidos online e Cupons. Esses atalhos foram retirados somente dessa página. As rotas, serviços, dados, regras e módulos continuam no aplicativo e nenhum arquivo funcional desses recursos foi removido.

A nova estrutura é:

- **Conta e operação:** Dados da empresa, Plano e assinatura, WhatsApp padrão, Modelo de operação e Conta.
- **Sistema:** Sincronização, Backup de dados e Ajuda e tutoriais.
- **Ações:** Sair da conta, com a confirmação já existente.

Notificações ficou oculto porque a auditoria encontrou apenas um placeholder no painel antigo, sem configuração real. Nenhum botão sem ação foi criado.

## Sincronização, desempenho e offline

A página lê `SyncFirebaseState`, já disponível na sessão, e reage ao evento existente `firebase-sync-status`. Não foram adicionados `getDoc`, `getDocs`, `onSnapshot`, consultas ou listeners Firebase. Os estados pronto, sincronizando, pendente, offline e erro são derivados dos sinais reais de conexão, hidratação, listener, fila e erros. O card e a linha Sincronização abrem o painel existente; esse painel mantém sincronização manual, fila, erros, recuperação e diagnóstico técnico.

O render principal de Configurações deixou de chamar `DB.carregar()` e de montar resumos dos módulos removidos. Os dados da empresa e da conta são acessados somente quando a respectiva ação é aberta. O novo CSS está no precache e a recarga autenticada offline foi validada sem apagar IndexedDB, persistência Firestore ou dados do usuário.

## Tutorial geral

A elegibilidade automática agora é exclusivamente:

`storedAppIntroVersion < APP_INTRO_TUTORIAL_VERSION`

`APP_INTRO_TUTORIAL_VERSION` permanece em **1**. Data de criação da conta e distinção entre usuário novo ou antigo deixaram de participar da regra. Concluir ou pular grava a versão 1; uma recarga não reapresenta essa versão; a abertura manual continua permitida e não muda a preferência apenas por abrir/rever. Uma futura versão 2 torna elegível quem tiver a versão 1.

O fluxo continua aguardando Auth, app montado, configuração operacional e ausência de modal concorrente antes de abrir.

## QA e testes

- Unitários e integrações: **422 aprovados, 0 falhas**.
- Firestore/Auth/Storage Emulator e Rules: **77 aprovados, 0 falhas**.
- Browser QA com Auth e Firestore Emulator: conta criada em 2024 recebeu o tutorial; valor local foi de 0 para 1 ao pular; valor remoto terminou em 1; nenhuma reabertura automática após reload.
- Ações A–K: Dados da empresa, Plano, WhatsApp, Modelo de operação, Conta, os dois acessos à Sincronização, Backup, Ajuda, Rever tutorial e confirmação de logout foram exercitados.
- Mobile: 320, 360, 375, 390, 412 e 430 px, todos com 3 grupos, 9 linhas e **0 px de overflow horizontal**.
- Desktop: 1280 px, 9 linhas e **0 px de overflow horizontal**.
- Offline/reconexão: estado offline real, recarga autenticada pelo Service Worker e retorno online aprovados; o CSS novo foi encontrado no cache.
- PWA: 6 assets de manifesto/ícones com HTTP 200, manifesto VECONI e Service Worker controlador.
- Lint: 206 arquivos JavaScript validados.
- Build e `git diff --check`: aprovados.

## Evidências visuais

- [Referência e implementação lado a lado](screenshots/settings-v137/reference-vs-implementation.png)
- [Mobile 360 px](screenshots/settings-v137/360-settings.png)
- [Mobile 390 px](screenshots/settings-v137/390-settings.png)
- [Mobile 430 px](screenshots/settings-v137/430-settings.png)
- [Mobile offline](screenshots/settings-v137/390-settings-offline.png)
- [Desktop 1280 px](screenshots/settings-v137/1280-settings.png)
- [Tutorial automático em conta antiga](screenshots/settings-v137/old-account-auto-tutorial.png)

## Versionamento e publicação

- Branch: `codex/settings-redesign-tutorial-fix`
- Commits funcionais: `dbd439a` (regra do tutorial) e `b656e92` (Configurações essenciais).
- APP_VERSION: **137**.
- SW_VERSION/cache: **137** (`veconi-v137-settings`), incrementado porque houve novo CSS e alterações em JS usados offline.
- Firestore Rules: sem alterações e sem deploy de regras nesta release.
- Deploy do site: GitHub Pages, um único deploy final após todas as validações.
- URL pública: <https://murillocharles97-netizen.github.io/adi-festa-controle/>
