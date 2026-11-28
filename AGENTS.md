# VECONI — instruções para agentes (Claude e Codex)

Regras comuns a todas as sessões de IA neste repositório. O Codex lê este arquivo direto; o Claude Code o importa pelo `CLAUDE.md`. **Claude e Codex têm as mesmas responsabilidades e permissões.** Documentação de produto e de cada release fica em `README.md`, `SAAS_MULTIEMPRESA.md` e `docs/`.

## Produto e stack

- PWA de gestão multiempresa e multissegmento (vendas, estoque, clientes, Fiado, financeiro, loja online), offline-first.
- Frontend em JavaScript puro, HTML e CSS (`index.html`, `catalogo.html`, `js/`, `css/`), com IndexedDB local e Service Worker.
- Firebase: Firestore (`firestore.rules`, `firestore.indexes.json`), Storage (`storage.rules`), Auth e Cloud Functions Gen2 em Node 22 (`functions/`).
- Site público no GitHub Pages por `.github/workflows/deploy-pages.yml`, com pacote em lista permitida (`public-site.manifest.json`).

## Comandos canônicos

- Verificação do projeto: `npm run lint` (`scripts/check-project.js`); build: `npm run build`.
- Testes unitários: `npm test` (`node --test tests/*.test.js`). Também existem `tests/*.test.cjs`, rodados por arquivo.
- Pacote público: `npm run build:public` e `npm run test:public-containment`.
- Rules no Emulator: `npm run test:emulator`. Functions no Emulator: `npm run test:functions-emulator`.
- Auditorias de navegador (Puppeteer): scripts `test:*-browser` do `package.json` e `scripts/audit-*.cjs`.
- Versão da release: `node --test tests/sync-version-identity.test.js` e `node scripts/release-version-check.cjs` (compara com a versão publicada, somente leitura).

## Repositório público

Este repositório é público. Nunca entram em commits, testes, capturas ou documentos:

- dados reais de clientes, lojistas ou empresas (nomes, telefones, valores, saldos, IDs de documentos);
- credenciais, tokens, chaves, conteúdo de `.env` ou caminhos pessoais da máquina;
- exportações, backups ou diagnósticos de produção.

Use dados fictícios. Material com dados reais fica fora do repositório, com acesso restrito.

## Produção e dados reais

- **Deploy em produção, publicação de Functions, de Rules e qualquer alteração em dados reais exigem autorização explícita do responsável pela VECONI para aquela operação.** Autorização anterior não vale para a próxima operação, e atualizar estas instruções não autoriza deploy.
- Leitura de produção só quando pedida, e somente leitura.
- Operações financeiras (saldos, recebimentos, caixa, estoque, Fiado) exigem prévia, backup, gravação condicionada à versão do documento e execução única.
- Não confunda abrir o WhatsApp, gerar uma mensagem ou salvar um rascunho com operação confirmada no servidor.

## Desenvolvimento em paralelo

- Todo desenvolvimento usa branch e worktree isolados, partindo da `main` remota atual (`git fetch origin` e conferir `origin/main` antes de começar). Sem merge na `main` fora de uma release autorizada.
- Não sobrescreva trabalho de outro agente nem altere worktrees ou branches de outra sessão sem coordenação com o responsável.
- Um escritor por arquivo. Antes de alterar arquivo que outra sessão está alterando, avise o responsável.
- Quando o responsável atribui uma área a um agente (por exemplo, assinaturas, cobrança e Mercado Pago), o outro não altera essa área sem combinar antes.
- Branches de desenvolvimento podem acrescentar ao `service-worker.js` (lista `ARQUIVOS`) e ao `public-site.manifest.json` os arquivos novos que criaram, e apontar no `index.html` os scripts novos. A versão do app e do cache fica para a release.

## Especialistas por tarefa

- Os perfis de projeto estão em `.codex/agents/` e `.claude/agents/`. Acione somente os perfis que respondem a uma questão concreta, em ondas curtas. O agente principal integra as evidências e coordena qualquer edição.
- Interface usa `ui-ux`, desempenho usa `performance` e toque/offline usa `mobile-pwa`. Para contratos, dados e validação, acione `architecture`, `financial-safety`, `firebase`, `qa` ou `code-review` conforme a mudança.
- Reaproveite Skills instaladas no host. Perfis e Skills não ampliam permissões. Registre quais agentes de fato rodaram e compare medidas com a base nas mesmas condições.

## Releases

Claude e Codex podem preparar, integrar e publicar releases, com as mesmas permissões. Preparar inclui `APP_VERSION` em `js/build-info.js`, o nome `CACHE` e o `GET_VERSION` do `service-worker.js`, o precache (`ARQUIVOS`), os `?v=` e as tags de script do `index.html` e o `public-site.manifest.json`.

1. **Um responsável por release.** Cada release tem um único agente responsável pela integração e publicação, Claude ou Codex.
2. **Conferir antes de começar:**
   - a `main` remota (`git fetch origin`, `git log -1 origin/main`);
   - a versão publicada (`node scripts/release-version-check.cjs`);
   - se outro agente já prepara a mesma publicação: branches `*/release-v*` locais e remotas (`git branch -a --list "*release-v*"`), worktrees (`git worktree list`) e as notas de coordenação. Na dúvida, pergunte ao responsável antes de seguir.
3. **Versão e cache únicos.** A branch da release se chama `<agente>/release-v<versão sem ponto>-<assunto>` (por exemplo `claude/release-v2428-loja-online`) e marca a versão como em uso. Antes de escolher a nova versão, confirme que nenhuma outra branch já a usa: `git grep -l -F "appVersion: '<nova versão>'" $(git for-each-ref --format='%(refname)' refs/heads refs/remotes/origin) -- service-worker.js` não pode listar nenhuma branch além da sua. O nome do cache (`veconi-v<versão sem ponto>-<assunto>`) também não pode se repetir. Duas branches nunca publicam a mesma versão.
4. **Integração** a partir da `origin/main` atual, juntando as branches aprovadas sem reescrever o histórico delas.
5. **Verificações obrigatórias:** `npm run lint`, `npm run build`, `npm test` sem falha nova em relação à base, `npm run build:public`, `npm run test:public-containment`, `tests/sync-version-identity.test.js`, `scripts/release-version-check.cjs` e, quando a release toca backend, os testes de Emulator aplicáveis. Mudança no protocolo de sincronização só com `--protocol-change` e justificativa.
6. **Plano de rollback** em toda release. Ele preserva IndexedDB, filas de sincronização, recibos e dados dos clientes: voltar o frontend nunca apaga dados locais nem invalida operações pendentes.
7. **Publicação só com autorização explícita** daquela release. Ordem quando há backend: Functions, depois Rules, depois frontend. Use o mecanismo de publicação já autorizado, sem desproteger a `main` e sem exibir ou copiar credenciais.
8. **Proibido:** force push, `git reset --hard` ou outro reset destrutivo, e alterar uma `main` local divergente para facilitar a publicação. Se a `main` remota andou, refaça a integração sobre ela.
9. **Assumir uma release.** Se o agente responsável estiver ocupado, o outro pode assumir a preparação ou a publicação depois de confirmar o estado atual (branch, commits, testes, versão publicada) e que não há publicação concorrente em andamento.
10. **Depois de publicar:** confirmar que o site entrega a nova versão (`GET_VERSION` e `js/build-info.js` publicados) e registrar commit, versão, cache e rollback no relatório.

## Testes

- A suíte tem falhas antigas conhecidas. Compare sempre com a base, nome a nome: uma candidata só passa sem nenhuma falha nova.
- Rode cada uso do Emulator com `firebase emulators:exec` novo (estado limpo). Para trabalhos paralelos, use um `firebase.*.json` com portas próprias.
- Mudança de interface: confira em 360, 390 e 412 px, tablet e desktop, nos temas claro e escuro, com dados fictícios.
- Nunca relate como aprovado um teste que não foi executado. Diga o que não foi verificado (por exemplo, celular real).

## Armadilhas conhecidas

- Os arquivos usam CRLF. Em edições por script, normalize para `\n` e devolva CRLF ao gravar.
- Em `String.prototype.replace`, `$$` no texto de substituição vira `$` (isso já quebrou seletores `$$(`). Use função de substituição.
- O Firestore Rules tem limite de 1000 expressões por avaliação: meça antes de acrescentar `get()`/`exists()`.
- Em `node -e` pela linha de comando, escapes de regex se perdem: prefira um arquivo `.cjs`.
- `git stash` é compartilhado entre worktrees: não use, ou restaure imediatamente.

## Passagem de tarefa

Para trabalho que outro agente vai continuar, revisar ou publicar, entregue:

- **Objetivo e critério de conclusão.**
- **Estado conferido:** branch, commit base, commits, se há mudança não commitada.
- **Evidências:** comandos executados, resultados e falhas comparadas com a base.
- **Pendências e bloqueios:** o que falta, do que depende e o que não foi verificado.
- **Recursos em uso:** worktrees, portas, emuladores, pastas fora do repositório.
- **Publicação:** versão e cache pretendidos, arquivos de versão afetados, ordem de deploy, rollback e recomendação GO ou NO-GO.

Quem retoma confere arquivos, Git e testes de verdade: o relatório é contexto, não prova.
