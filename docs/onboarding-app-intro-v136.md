# VECONI — Introdução geral v1 (release 136)

## Escopo e arquitetura

Somente o tutorial geral foi implementado. O gerenciador em `js/tutorial-engine.js` registra tutoriais declarativos com ID, versão, passos, alvo, posição e callbacks; resolve elementos por `data-tour`, posiciona popovers dentro da viewport, cria spotlight, oferece fallback central para alvo ausente e controla foco, Escape e Voltar do navegador/PWA. Nenhum tutorial específico de módulo foi criado.

O controlador `js/app-intro-tutorial.js` registra quatro passos de introdução e um feedback final. O menu usa `data-tour="main-menu"` no mobile e `data-tour="sidebar-navigation"` no desktop. A barra rápida usa `data-tour="bottom-navigation"`; ela é ausente no desktop, então o passo usa o card central seguro. Foram reservados `finance-summary`, `financial-spaces`, `financial-accounts` e `financial-add` no markup financeiro, sem fluxo de tutorial nem alteração funcional. O texto do passo 3 usa “Novo cliente”, que é o item real da barra atual, em vez de “Escanear”.

## Elegibilidade e persistência

`APP_INTRO_TUTORIAL_VERSION = 1`. A versão fica em `users/{uid}.tutorialVersions.appIntro`, no documento do usuário já lido uma vez pelo bootstrap; o cache local usa `veconi:tutorialVersions:{uid}`. A versão efetiva é o máximo entre local e perfil remoto. Pular ou finalizar marca a versão local imediatamente e faz até uma gravação assíncrona no perfil, sem bloquear a interface. Offline, a preferência fica local; o evento `online` ou o próximo login tenta sincronizá-la. Não há coleção, `getDoc`, `getDocs` ou `onSnapshot` adicional, nem listener Firebase para o tutorial: **0 leituras e 0 listeners adicionais**, com **1 gravação de preferência** ao pular/finalizar quando a versão remota está atrasada.

A apresentação automática exige que `users/{uid}.createdAt` **e** `Firebase Auth metadata.creationTime` existam e sejam posteriores a `2026-09-14T20:04:00Z`. Data ausente, inválida ou anterior implica somente abertura manual. Assim, migração ou data de perfil alterada não converte uma conta antiga em nova. A introdução aguarda autenticação, montagem do app e conclusão do onboarding operacional já existente, evitando modais sobrepostos. A preferência é por `uid`, inclusive quando a conta troca de negócio. O usuário interno pode reabrir pelo mesmo caminho de Configurações.

## Passos e acesso manual

1. “Bem-vindo à VECONI 👋” — card central, Começar/Pular.
2. “Tudo começa por aqui” — spotlight do menu, Voltar/Próximo.
3. “Seu dia a dia fica aqui” — spotlight da barra mobile ou card central no desktop, Voltar/Próximo.
4. “Aprenda conforme usa” — card sem alvo, Voltar/Finalizar.
5. “Tudo pronto ✨” — feedback curto com “Começar a usar”.

Configurações ganhou uma entrada pequena de “Ajuda e tutoriais” com “Primeiros passos com a VECONI” e “Rever tutorial” no mobile e desktop. Fechar, Pular, Escape ou Voltar dispensam a versão atual. Finalizar persiste antes do feedback. Nenhum passo troca de rota ou clica no app. Foco é contido no diálogo e volta ao controle anterior; `prefers-reduced-motion` desliga a animação. O Service Worker precacheia apenas os três assets novos e limpa somente caches antigos de assets; IndexedDB e persistência Firestore não são tocados.

## Tamanho e validação

Arquivos novos de interface: engine **8.963 B** (gzip **2.911 B**), controlador **5.390 B** (gzip **2.036 B**), CSS **3.113 B** (gzip **1.104 B**). Total **17.466 B** bruto, **6.051 B** gzip. Nenhuma dependência adicionada.

- 420 testes unitários aprovados, incluindo elegibilidade, versionamento, skip/finalização, offline e ausência de leituras recorrentes.
- 77 testes Firestore Rules Emulator aprovados, incluindo gravação própria e rejeição para outro `uid`, versão inválida e alteração de papel.
- Lint e build aprovados (205 arquivos JS); `git diff --check` limpo.
- Browser QA autenticado com Firebase Emulator: 320, 360, 375, 390, 412 e 430 px, mais desktop 1280 px; **42 screenshots** de boas-vindas, menu, barra, explicação, final e Ajuda. Todos os cards dentro da viewport, sem sobreposição do alvo nem overflow horizontal. Foram exercitados reabertura mobile/desktop, Voltar do tutorial, Escape, Voltar do navegador, reload sem reapresentação, target removido e abertura/fechamento offline. Preferência `appIntro:1` confirmada no perfil do Emulator; nenhum erro de página no QA do tour.
- Smoke autenticado de Vender, concluir venda, Financeiro, offline e logout aprovado; browser tests mobile e financeiros aprovados. O smoke registrou erro de console no logout dentro de `mobile-navigation.js?v=133`, arquivo não alterado aqui; o fluxo de logout completou e ficou com 0 listeners ativos.

Screenshots locais: `artifacts/app-intro-v1/` (42 PNGs). O script reproduzível é `scripts/audit-app-intro-browser.cjs`.

## Release

Branch: `codex/onboarding-app-intro-v1`. APP_VERSION **136**. SW_VERSION **136** porque novos assets precisam de precache offline. Regras Firestore são publicadas junto à release, antes de disponibilizar o frontend. O site usa GitHub Pages. Commit, execução do deploy e URL são registrados no fechamento da tarefa.
