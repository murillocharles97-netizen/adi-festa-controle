# VECONI — instruções para agentes (Claude e Codex)

Regras comuns a todas as sessões de IA neste repositório. O Codex lê este arquivo direto; o Claude Code o importa pelo `CLAUDE.md`. Documentação de produto e de cada release fica em `README.md`, `SAAS_MULTIEMPRESA.md` e `docs/`.

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
- Versão da release: `node --test tests/sync-version-identity.test.js` e `scripts/release-version-check.cjs`.

## Repositório público

Este repositório é público. Nunca entram em commits, testes, capturas ou documentos:

- dados reais de clientes, lojistas ou empresas (nomes, telefones, valores, saldos, IDs de documentos);
- credenciais, tokens, chaves, conteúdo de `.env` ou caminhos pessoais da máquina;
- exportações, backups ou diagnósticos de produção.

Use dados fictícios. Material com dados reais fica fora do repositório, com acesso restrito.

## Produção e dados reais

- Não altere dados reais sem autorização explícita do responsável, dada na conversa para aquela operação.
- Leitura de produção só quando pedida, e somente leitura.
- Operações financeiras (saldos, recebimentos, caixa, estoque, Fiado) exigem prévia, backup, gravação condicionada à versão do documento e execução única.
- Não confunda abrir o WhatsApp, gerar uma mensagem ou salvar um rascunho com operação confirmada no servidor.

## Publicação

- A `main` é protegida e só a Deploy Key publica. Não desproteja a `main`, não procure credenciais e não publique sem GO explícito.
- Os comandos de publicação são executados pelo responsável. Prepare o comando ou script, sem expor credenciais.
- Ordem quando há backend: Functions, depois Rules, depois frontend. Toda candidata traz plano de rollback.

## Trabalho paralelo

- Cada tarefa usa sua própria branch e worktree, partindo da `main` atual (confira o HEAD antes de começar). Sem merge na `main` sem autorização.
- Áreas: o Codex é dono de assinaturas, cobrança e integração com Mercado Pago. As outras sessões não alteram esses fluxos.
- Um escritor por arquivo. Antes de alterar arquivo que outra sessão ou o Codex também está alterando, avise o responsável.
- Arquivos compartilhados de release: `index.html` (parâmetros `?v=` e tags de script), `service-worker.js` (nome do cache e lista `ARQUIVOS`), `js/build-info.js` (versão do app) e `public-site.manifest.json`.
  - Uma sessão pode acrescentar ao `service-worker.js` e ao manifesto os arquivos novos que criou, e apontar no `index.html` os scripts novos.
  - **A versão do app e do cache só muda na integração da release**, por quem integra (hoje o Codex). As candidatas deixam a versão como está e dizem no relatório quais arquivos precisam de novo `?v=`.

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

Para trabalho que outra sessão ou o Codex vai continuar ou revisar, entregue:

- **Objetivo e critério de conclusão.**
- **Estado conferido:** branch, commit base, commits, se há mudança não commitada.
- **Evidências:** comandos executados, resultados e falhas comparadas com a base.
- **Pendências e bloqueios:** o que falta, do que depende e o que não foi verificado.
- **Recursos em uso:** worktrees, portas, emuladores, pastas fora do repositório.
- **Publicação:** arquivos de versão a atualizar, ordem de deploy, rollback e recomendação GO ou NO-GO.

Quem retoma confere arquivos, Git e testes de verdade: o relatório é contexto, não prova.
