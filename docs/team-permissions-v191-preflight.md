# V191 — Equipe / Permissões: candidata local, não publicada

## Base e rollback

- Base V190: `27469d3afceb6a7e2e44f817904f2b4586c04209`.
- Referência de rollback prevista: `rollback/v190-before-v191-team-permissions`.
- Publicação aguarda autorização separada. Não há push, workflow ou deploy nesta preparação.
- Não há migração de usuários, permissões, espaços ou dados comerciais.

## Escopo congelado

Somente as 20 permissões existentes. Controles sem autorização independente permanecem vinculados ou indisponíveis. Presets são escolhas explícitas do gestor, não migração de vínculos. O envio exige revisão e confirmação; cargo `stock`, grants explícitos e espaços indisponíveis são preservados. O backend verifica o snapshot original dentro da transação para rejeitar alterações concorrentes. As Rules não mudam.

Última revisão de linguagem: Visualizar versus Executar / Editar; efeitos de escolher um modelo, inclusive possíveis remoções e troca de cargo; Personalizado sem troca de cargo; espaços atuais e futuros; avisos acionáveis de dependências; lista de acessos liberados/removidos antes de salvar. Explicações financeiras deixam claro que acesso ao Financeiro inclui escrita e que custos/lucro não são isolados entre si no contrato atual.

## Arquivos previstos no commit (18)

Runtime frontend e metadados:

1. `css/team-permissions.css`
2. `js/team-permission-model.js`
3. `js/team-permission-editor.js`
4. `js/team-page.js`
5. `js/firebase/team-service.js`
6. `js/build-info.js`
7. `index.html`
8. `service-worker.js`

Backend:

9. `functions/src/services/team-access-service.js` — somente comparação opcional `expectedAccess` em `updateTeamMember`; sem novos grants, migrações ou triggers.

Testes, prévia local e documentação:

10. `functions/test/team-access-concurrency.test.js`
11. `functions/test/team-permission-editor-emulator.js`
12. `tests/team-permission-model.test.js`
13. `tests/team-permission-integration.test.js`
14. `tests/team-permissions.fixture.html`
15. `tests/team-access-v150.fixture.html`
16. `scripts/serve-team-permissions-qa.cjs`
17. `docs/team-permissions-local.md`
18. `docs/team-permissions-v191-preflight.md`

## Exclusão comprovável de Sync e Rules

`js/firebase/sync.js` tem uma otimização independente ainda não aprovada para esta release (11 adições/4 remoções). Não deve ser adicionada ao índice, restaurada, descartada nem incluída em um deploy a partir do diretório sujo. Seu hash SHA-256 local antes da preparação é `3B1E22FD94CFCE73D21C6531910A998263A85ECF1AE19143B2FB7FB097055225`.

O pacote candidato é exportado da árvore do índice Git, com lista explícita dos 18 arquivos. O blob de `js/firebase/sync.js` deve ser exatamente igual ao da V190; mesma exigência para `firestore.rules`, `firestore.indexes.json`, `storage.rules`, configuração Firebase, Auth e workflows. Arquivos locais antigos não rastreados não entram no pacote.

Os testes finais devem usar essa exportação isolada e dependências locais existentes, não a versão alterada de Sync. Nenhuma credencial ou arquivo `.env` local será copiado.

## Validação final

Execução aprovada sobre exportação isolada do índice, em 19/10/2026:

- **86/86 testes Node** direcionados; zero falhas.
- **19/19 testes de Rules** no Firestore Emulator; zero falhas. Negações registradas nos cenários negativos são esperadas; as Rules não foram alteradas.
- **7/7 cenários de serviço** no Firestore Emulator: concorrência com uma confirmação/um abort, mapa esparso, isolamento, não-elevação, cargo preservado, comparação canônica e dados comerciais/updateTime intocados.
- **Lint e build aprovados** nos 385 arquivos JavaScript do pacote isolado, sem arquivos locais não rastreados de outros trabalhos.
- `git diff --check` e `git diff --cached --check` aprovados.
- Revisão visual local: aviso de troca de modelo, Personalizado, redução de dependentes e resumo antes de salvar; zero gravações no mock e nenhum acesso a Firebase real. Larguras 320/360/390/430 sem overflow horizontal.

Comandos reproduzíveis, executados na raiz da exportação limpa:

```text
node --test tests/team-permission-model.test.js tests/team-permission-integration.test.js tests/team-access-v150.test.js tests/operational-dashboard-access.test.js tests/sync-integrity-permissions.test.js functions/test/team-access-service.test.js functions/test/team-access-concurrency.test.js
firebase emulators:exec --only firestore --project adi-festa-variations-test "node --test --test-concurrency=1 tests/emulator/team-access.rules.test.js tests/emulator/operational-dashboard.rules.test.js tests/emulator/sync-integrity-permissions.rules.test.js && node functions/test/team-permission-editor-emulator.js"
npm run lint
npm run build
```

Exportação testada: árvore Git `dc9fcddf6694510151ef22fe8e41f7babf82df38`. Após os testes, somente esta nota de resultados foi atualizada; código e testes permanecem idênticos à exportação validada. O blob de Sync é `51127cb2ffe44a58aaffe01d0f0bb23f66161c7a`, igual ao da V190. O hash SHA-256 do Sync local pendente permaneceu inalterado.

Logs locais: `C:/Users/Murillo/AppData/Local/Temp/veconi-v191-preflight-c24c28e6d49e4bcc90e1bcacf8a27c9a/node-tests.log` e `emulator-tests.log`. Evidência visual: `C:/Users/Murillo/.codex/visualizations/2026/09/17/01a0accc-0d12-7c62-b253-4185d5a31790/team-permissions/v191-confirmation-320.jpg`.

## Plano de publicação após autorização

1. Usar somente o commit aprovado, em checkout/exportação limpa. Nunca publicar o diretório com alterações locais pendentes.
2. Publicar apenas a Function `updateTeamMember` da candidata, para ativar a comparação transacional opcional antes do frontend. Nenhuma outra Function ou trigger deve ser publicada.
3. Publicar frontend/PWA pelo workflow GitHub Pages do commit aprovado. Nenhum deploy de Rules/índices/Storage ou alteração de domínio.
4. Confirmar versão V191/commit no domínio oficial e smoke seguro de abertura da tela, revisão/cancelamento e restrições de perfil, sem alterar vínculos reais.

Rollback: restaurar o frontend da V190 e, se necessário, a Function `updateTeamMember` da mesma base. Nenhum rollback de dados é necessário; alterações de permissões posteriormente confirmadas pelo owner são decisões operacionais e não devem ser desfeitas automaticamente por rollback de código.
