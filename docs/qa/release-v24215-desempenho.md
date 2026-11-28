# Preparação da V242.15

Base pública V242.14.1 (`67ea1a2`). A branch `codex/release-v24215-desempenho` contém `af46e91` e os incrementos anteriores de Vender e Clientes. A identidade da candidata usa `APP_VERSION` e `GET_VERSION` 242.15, cache `veconi-v24215-desempenho-v1` e compatibilidade 242. Os 12 arquivos alterados têm o mesmo pin `24215-perf` nas referências HTML e no precache. Auth, Sync e o cache IndexedDB mantêm os pins compatíveis da base.

## Revisão e testes

- QA verificou em Chromium mobile os dois temas, a troca rápida com sincronização simulada, scroll durante o skeleton, gesto de borda do menu e reabertura offline no novo cache. A configuração de diagnóstico foi validada com clipboard e prompt de cópia.
- Code Review reproduziu a volta a Vender com uma repetição abandonada e a interferência de **Copiar desempenho** na área de toque da sacola. A candidata cancela a repetição ao sair durante a montagem, mantém compatibilidade com o seletor anterior de cliente e posiciona o diagnóstico à esquerda, respeitando a safe area. O carrinho vazio e os dois alvos de toque foram confirmados em navegador.
- A atualização autenticada da V242.14.1 para a V242.15 usou o pacote público, Auth e Firestore no Emulator e dados fictícios. A requisição pendente a `app.js` usou seu pin exato. O PWA reabriu com a origem estática indisponível. Sessão, tema, venda fictícia e duas operações da fila foram preservados. A navegação quente para Vender também passou com a rede do navegador desligada. Foram conferidos 14 hashes do cache ativo.
- Lint, build, pacote público de 290 arquivos, 61 testes de contenção e verificação de versão passaram. A suíte geral manteve as mesmas 65 falhas preexistentes por nome. As evidências de laboratório ficam em `qa-artifacts/performance/`.
- `?perf-nav=1` e **Copiar desempenho** exportam somente nomes das rotas e tempos. O relatório não inclui identificadores, saldos, URLs ou mensagens de erro. [Roteiro e medições](veconi-performance-v24215-navegacao.md)

## Homologação e publicação

GO técnico para concluir a preparação local. Android físico permanece pendente. Em uma instalação atualizada para V242.15, alterne Início, Vender, Clientes e Produtos nos dois temas. Role antes e depois dos dados, alterne telas durante a sincronização, confira busca e abertura da sacola e preserve um rascunho ao reabrir offline. Use `?perf-nav=1` para coletar até 60 segundos e copie o resultado.

Após autorização, reconfirmar o SHA remoto e ausência de publicação concorrente. Integrar por fast-forward pelo fluxo oficial de GitHub Pages. Validar SHA servido, versão/cache com `GET_VERSION`, pins, área de toque da sacola e atualização normal do PWA. Em regressão crítica, preparar reversão seletiva em novo commit, com a próxima versão corretiva livre e cache novo. Se necessário, voltar aos recursos da V242.14.1 com identidade nova. Preservar IndexedDB, filas, sessões e o fallback exato do Service Worker.

O desconto por produto está no [backlog](../backlog.md) para trabalho separado após estabilização.
