# V203 — UX operacional e login unificados

Base e rollback frontend compatível: V202 sanitizada `c80da0fffb0106aea4d23cf097ee33896522f07c`, tag `rollback/v203-compatible-ux`. O rollback de autorização anterior `ff4c9f72720a0029e4e4ccd4142730c4cf2ab004` permanece preservado. Reverter apenas frontend/PWA para esse ponto não altera servidor, recibos, protocolo autorizado, filas ou estruturas de Trocas/crédito.

## Pacote

Login definitivo com componente oficial da marca e SDK Auth existente; layout desktop/mobile, recuperação usando o endpoint existente, loading e erros acessíveis. Modais de recibo, confirmação de recebimento, Trocas e cancelamento recebem shell limitado ao viewport, rolagem interna e ações acessíveis. Dashboard usa aviso compacto e desconta apenas ocorrências com confirmação histórica validada; falhas e revisões reais continuam visíveis, com acesso permanente no Histórico.

As etapas anteriores e suas capturas permanecem em `docs/qa/ux-v203` e `docs/qa/login-v203`. Seus relatórios descrevem o momento anterior à autorização do release; este documento fecha os dois blocos na mesma V203. O patch antigo de rollback somente do login é evidência da etapa anterior, não é o rollback do release unificado.

Somente 13 arquivos de produção, mais testes, scripts de QA e documentação. `js/firebase/firebase-ui.js` muda exclusivamente a query de versão do módulo visual de recuperação. Service Worker muda exclusivamente cache/release; nenhuma limpeza é adicionada. Functions, Rules, permissões, protocolo Sync, caminhos comerciais e allowlist pública permanecem idênticos à V202. Trocas/cancelamento só recebem uma chamada de layout, sem alteração de guards ou efeitos.

## Validação

Validação final: 174 testes críticos Node/DOM aprovados, 62 cenários Chromium de UX operacional e 29 cenários Auth aprovados. O Auth Emulator valida o controlador real e SDK 10.13.2, com identidades owner/seller fictícias, cadastro, recuperação, sessão, erros e responsividade; serviços empresariais são simulados. Lint, build, diff-check e build público aprovados. Novo teste `release-v203.test.cjs` comprova isolamento dos fontes protegidos e alterações exclusivamente de metadados no worker. Testes de contenção mantêm todas as proibições e atualizam somente a versão esperada.

O conjunto ampliado anterior teve 199 aprovações e duas falhas de harness legadas, ambas reproduzidas na V202 intacta: sandbox sem `window` em cache-session-hotfix e expectativa obsoleta do nome do cache em veconi-pwa-branding-v133. Não foram enfraquecidas as proteções para ajustar esses testes. Ver resultados finais de publicação na evidência privada; nenhuma afirmação de smoke autenticado em aparelho real deve ser inferida dos Emulators.

Limite: teclado e barras reais de Android/iOS não são automatizados; QA usa reflow/viewport equivalente e isolamento de rede. Nenhuma conta comercial é criada/modificada para validar login ou recuperação.

## Publicação autorizada

1. Conferir ancestry sanitizada, árvore limpa, testes críticos, pacote de 224 arquivos incluindo CNAME, zero fixtures/documentos/arquivos sensíveis no pacote.
2. Conferir `main` ainda V202 e rulesets `25744131` / `25744311` ativos, cobrindo branches/tags; usar somente chave temporária com SSH fixado. Não mudar pushurl ou guards.
3. Publicar atomicamente apenas `main` e nova tag de rollback, com leases individuais. Workflow Pages atual faz build público por allowlist. Nenhum comando Firebase deploy.
4. Verificar commit/release203 no domínio e `GET_VERSION` do PWA, fontes publicados e contenção V199; capturar login publicado em navegador QA novo, sem usar sessões/armazenamento dos usuários.
5. Comparar metadados e hashes publicados de Firestore/Storage Rules e Functions antes/depois. Rules restritivas V202 permanecem pendentes, sem ativação nesta entrega.

Smoke operacional usa dados fictícios em perfis isolados; não confirma ou executa vendas, trocas, recebimentos, uploads de recuperação ou retries reais. Se surgir divergência crítica, interromper em vez de alterar segurança ou dados.
