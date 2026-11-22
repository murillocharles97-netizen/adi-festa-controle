# Loja Online V3 — homologação do frontend

**GO técnico para revisão visual.** Antes de publicar, falta confirmar a abertura e a colagem no WhatsApp instalado e no WhatsApp Web autenticado, com número de teste. As verificações atuais cobrem a interface, o texto completo, o navegador simulado e a resposta HTTP do WhatsApp.

## Integração

- A candidata `codex/loja-online-v3-homolog` parte da main `89cc196`. Os cinco commits de `claude/loja-online-v3` e as correções `26c4960` e `e8d3ba8` foram reaplicados individualmente.
- O runtime novo se limita ao painel, à vitrine, ao leitor do catálogo público e ao carregamento dos recursos da Loja. A lista de precache inclui seis URLs versionadas e a allowlist pública valida 280 arquivos. A constante de cache continua `veconi-v2423-performance-selling-v1`.
- O backend, Firestore Rules, Storage Rules, checkout do PDV e sincronização são idênticos aos de `89cc196`. Conferidas por metadados as revisões ativas `saveonlinestore-00004-fol`, `submitcatalogorder-00022-qun` e `getonlinestore-00004-zud`.
- Pausar e retomar enviam somente escopo, revisão e estado. O painel diferencia reabertura da última vitrine de publicação do rascunho e confirma as diferenças pela leitura pública. Uma falha nessa leitura mantém a situação das alterações em aberto.

## WhatsApp

O limite de **4.000 bytes da URL codificada** é um orçamento de compatibilidade da VECONI. A RFC 9110 recomenda suporte HTTP a pelo menos 8.000 bytes. O WhatsApp documenta como preencher o texto, mas não publica um limite garantido para navegador, app ou webview. O orçamento deixa margem para reencaminhamentos e é independente do número de itens. [RFC 9110, seção 4.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.1) · [WhatsApp, Click to Chat](https://faq.whatsapp.com/5913398998672934/?locale=pt_BR)

A sondagem com número fictício reproduziu substituição de emojis no redirecionamento de `wa.me`. O destino web direto preservou o texto em 400, 4.000, 8.000 e 21.000 bytes nos agentes desktop e Android. No desktop, o link para WhatsApp Web preservou o texto. No agente Android, a resposta HTTP é compatível com a página web e não exercita o app instalado.

O carrinho fictício de 400 itens produziria um link de 21.309 bytes. O navegador confirmou o resumo integral, com valores, variante, observação e emojis, a seleção para cópia manual quando a área de transferência falha e que o único link disponível leva à conversa sem a mensagem na URL. O carrinho permaneceu disponível. Nenhum desses fluxos fez chamadas comerciais.

## Validação

| Ensaio | Resultado |
| --- | --- |
| Navegador, roteiro completo | 90/90 verificações, 62 capturas |
| Navegador, matriz independente | 25 resultados sem falhas, 360/390/412/768/1440 px |
| Node, regressão direcionada | 136/138, mesmas duas falhas de fixture de inicialização de Sync da base |
| Firestore e Storage Emulator | 60/65, mesmas cinco falhas da suíte antiga de finalização por `Vendas + Sync + Rules` |
| Firestore Emulator com os pacotes exatos das revisões ativas | 10/10 |
| PWA instalado V242.3 → candidata | Seis recursos com hashes corretos, dois documentos e quatro operações intactas, tema escuro preservado e reabertura offline |

O painel abriu 36 cartões com 1.000 produtos fictícios e encontrou itens fora do primeiro lote. Em duas matrizes no Chromium local, a abertura de Produtos levou de 49 a 61 ms e a busca de 155 a 239 ms, incluindo debounce. A vitrine com 400 itens manteve 4.092 nós antes da busca. Os arquivos JS/CSS da Loja acrescentam 26,8 kB gzip ao shell administrativo e 3,0 kB gzip à vitrine, em relação à main. Os tempos locais não estimam a abertura em um aparelho físico.

A vitrine aceita o alias, `catalogo.html?v=` e o caminho antigo `/catalogo/<token>` via `404.html` para publicação V2 válida. O portal anterior ao schema 6 já era rejeitado pela V242.3. A rota `?demo=1` deixou de apresentar o catálogo embutido com número fixo. A rota do pedido existente e a tentativa durável permanecem válidas.

Limites existentes confirmados. A empresa pode editar pelo painel até 1.000 produtos na origem, contados antes do filtro por espaço, e selecionar até 400 por vitrine. O backend limita 1.000 variações e 100 pedidos por espaço na carga administrativa. Checkout registrado aceita até 40 linhas diferentes. O resumo para WhatsApp preserva o carrinho completo mesmo quando a URL excede o orçamento.

## Repetição e publicação futura

- Execute `node scripts/audit-loja-online-v3-independent.cjs` e `node scripts/audit-loja-online-v3.cjs qa-artifacts/loja-v3/homolog/capturas`. Ambos usam Chrome em loopback e fixtures. Passe `LOJA_V3_DOC` com uma projeção exportada pelo emulador para incluir a vitrine publicada pelo backend.
- Execute `npm run test:loja-v3`, `npm run test:public-containment` e os testes de Loja no Firestore e Storage Emulator com `firebase.online-store-rules.json`. Os testes de V3, pausa/retomada e pedidos da publicação estão em `tests/emulator/`.
- Para repetir o PWA, gere a allowlist com `npm run build:public`, configure `VECONI_PWA_SITE` para o diretório gerado e rode `node scripts/audit-veconi-v2422-upgrade.cjs --loja`. O identificador de cache de teste é substituído apenas na resposta do servidor de loopback.
- Execute `node scripts/probe-loja-whatsapp-handoff.cjs` para repetir a leitura HTTP externa exclusivamente com número e texto fictícios.
- Antes de um deploy autorizado, conferir HEAD e Functions, validar o WhatsApp instalado, carimbar versão e cache novos e repetir o upgrade do PWA. Publicar somente o frontend pelo GitHub Pages. Se houver regressão crítica, reverter o frontend com um novo commit e outra identidade de cache, mantendo o hotfix de backend e os dados locais.

Uma edição de rascunho ainda não confirmada fica na aba durante perda da rede. Fechar à força a aba antes do salvamento pode descartar essa edição. Tráfego de favoritos externos de versões anteriores ao schema 6 ficou fora da homologação.
