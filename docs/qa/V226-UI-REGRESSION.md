# V226 — incidente de interface / correção local

Base publicada: `5957fb9b1e78481f940f58766e17257cc1b0336f`.
Base de cobrança preservada: `e83635c0fee645ffeaf1a4dea9c6480cc153a2f9`.
Branch isolada: `codex/v226-ui-regression-hotfix`.
**Sem autorização de publicação. NO-GO para declarar o incidente integralmente resolvido.**

## Evidência e diagnóstico

| Relato | Resultado comprovado | Tratamento local |
| --- | --- | --- |
| Venda anterior ausente no Android | O botão foi inserido em `.pos-head`; `checkout-mobile.css` oculta esse cabeçalho em até 767 px. O enhancer real adiciona `.mobile-sale-page`. Reprodução positiva no código publicado, mesmo com owner válido. | Entrada independente, fora do cabeçalho oculto, abaixo do espaço e antes da busca. Área de toque mínima de 44 px e largura total no mobile. |
| Entrada ausente após carregar a sessão | `actionMarkup()` devolve vazio enquanto a identidade owner está sendo validada. O `mount()` original só vincula botões já existentes. O botão não reaparece ao concluir a autenticação. | Slot reconciliado após eventos de sessão/contexto, conservando a mesma validação de owner e sem executar venda. |
| Espaço permanece como texto de espaço único | Reprodução QA: a lista inicial tem um espaço; outros chegam com modal aberto. `app.js` adia o remount nesse estado, mas não atualiza o seletor nem agenda esse remount para depois. Esse defeito também existe na base anterior; a condição do aparelho real ainda não foi confirmada. | Atualização apenas das barras de espaço ao receber a lista ou mudar o contexto. Mantém carrinho, observações e modal; usa os mesmos filtros de autorização. |
| Lucro do dia desaparecido | Não reproduzido com owner canônico pronto. Home, Dashboard, cálculos de lucro, permissões e CSS de Home são idênticos em V225 e V226. A mesma fixture calcula R$48,00 no consolidado e R$18,00 no segundo espaço nas três versões. Carregamento temporário pode ocultar os indicadores; o teste de retorno ao owner restaura o lucro. Isso não comprova a causa no Android. | Nenhum cálculo ou permissão alterado. O follow-up corrigiu o feedback enganoso durante loading/error em performance-access.js; o desaparecimento persistente no aparelho continua sem causa comprovada. Consulte V226-PROFIT-INVESTIGATION.md. |
| Mudança geral da Home | Nenhuma remoção identificada no diff V225→V226. Meta, vendido hoje, lucro autorizado, resumo do dia, prioridades e resumo de sete dias permanecem no renderer. A função de gráfico já era aberta pelo resumo de sete dias, não exibida diretamente na Home. | Sem redesenho da Home nem inclusão de números artificiais. |

Leituras de produção, sem gravação:

- Domínio/build-info/Service Worker e 17 recursos críticos correspondem à V226 publicada; não houve diferença entre os arquivos servidos e o commit esperado.
- Adi Festa: empresa e proprietário ativos, perfil e membership owner coerentes, `spaceAccess: all`, autorização de lucro preservada. Há dez espaços ativos de titularidade canônica, seis habilitados para vendas.
- Essa leitura não inspeciona a sessão nem os dados locais do Android. Não prova qual contexto estava renderizado no incidente.
- As 99 Functions e as Rules correspondem ao snapshot pós-publicação V226. Nenhuma foi alterada nesta tarefa.
- Nenhuma leitura ou alteração de registros de vendas, estoque, pagamentos, clientes ou assinatura foi necessária para estas correções.

## Diff V225 → V226

No frontend, a V226 acrescentou `prior-sales.js`, `prior-sales.css`, a policy compartilhada de datas, as entradas no checkout mobile/desktop, a integração dos callables, os recibos com datas comerciais e os metadados/PWA. Não editou `home-mobile.js`, `desktop-dashboard.js`, `spaces.js`, `team-access.js`, `performance-access.js`, `app.js`, `business-context.js`, `space-service.js` ou o CSS de Home/espaços.

O hotfix atual modifica oito arquivos públicos: `checkout.js`, `desktop-sales.js`, `prior-sales.js`, `spaces.js`, `performance-access.js`, `prior-sales.css`, `build-info.js` e `service-worker.js`. O manifesto exato está em `releases/v226/ui-hotfix-manifest.json`.

Não altera o contrato de vendas, Functions, Rules, índices, Auth/Google, assinatura, cobrança V225, leitores, protocolo de Sync, filas ou mapas de permissão. A mudança do Service Worker é só o nome do cache estático; mantém a ativação e o fallback anteriores, sem apagar caches, IndexedDB, localStorage ou filas.

## Testes e limites da evidência

- **209 testes focados aprovados, zero falhas**, em 21 arquivos de teste após o follow-up de lucro e sessão.
- **41 novos cenários** (21 do hotfix inicial e 20 do follow-up de lucro/sessão): regressão do botão oculto; sessão tardia; larguras parametrizadas 320/360/390/430; entrada desktop; datas/motivo/pagamento externo; hidratação tardia dos espaços; preservação do carrinho e motivo; revogação; troca de empresa; lucro por espaço; restauração após loading; restrição de funcionários; escopo exato do hotfix; preservação de backend/Rules/Sync e cache sem limpeza.
- Os testes existentes de prévia, confirmação individual, resposta perdida e consulta idempotente continuam aprovados. Nenhuma operação comercial foi enviada a produção.
- Lint e build validados. Pacote público gerado por allowlist, sem fixtures, diagnósticos, documentos internos ou implementação privada do backend.
- Dois testes antigos falhavam também no commit publicado (evidência preservada em diretório de suporte): um inferia vínculo de cliente pela compra, incompatível com o diretório compartilhado vigente; outro exigia versões estáticas V171/V173. Foram atualizados para o contrato vigente, incluindo negativas para empresa estrangeira e cliente explicitamente vinculado a outro espaço. Nenhuma política comercial foi alterada para fazer o teste passar.
- O teste de escopo da integração V225→V226 continua preso ao commit integrado original; um gate separado limita este hotfix aos arquivos autorizados no seu manifesto.

**JSDOM não comprova layout, toque, visibilidade por pixels ou comportamento físico Android.** O defeito de CSS foi constatado pela combinação da árvore real, do enhancer e da regra de ocultação publicada. Capturas e cliques reais permanecem pendentes: o controle do navegador foi bloqueado pelo Work e o usuário escolheu continuar sem navegador. Não foi contornada essa restrição e não foram produzidas capturas simuladas.

## Prévia comparativa local

Servidor de suporte somente leitura, porta 8236, sem SDK Firebase, credenciais ou fallback de produção. O canal de rede da fixture é bloqueado; qualquer mutação comercial sintética é recusada. O código V225/V226 é lido diretamente dos respectivos commits, não reconstruído por aproximação.

- V225: `http://127.0.0.1:8236/v225/tests/v226-ui-regression.fixture.html`
- V226 publicada: `http://127.0.0.1:8236/v226/tests/v226-ui-regression.fixture.html`
- Correção local: `http://127.0.0.1:8236/candidate/tests/v226-ui-regression.fixture.html`

O servidor foi preparado para uma futura sessão autorizada de navegador. HTTP 200 da prévia não representa homologação visual. A fixture é isolada, com duas lojas fictícias; não representa a sessão real da Adi Festa.

## Roteiro pendente (390 px e aparelho real)

1. Na fixture, abrir Início; conferir seletor, meta, vendido hoje e lucro. Trocar Matriz/Filial e conferir respectivamente R$30,00/R$18,00 de lucro; no consolidado R$48,00. Confirmar ausência de overflow e de controles sob overlays.
2. Em Vender, trocar espaço sem carrinho; depois adicionar produto e cancelar a troca, verificando que o carrinho permanece no espaço original.
3. Usar o cenário de carregamento tardio: a V226 original conserva o texto de espaço único; o candidato deve mostrar o seletor com duas opções ao fechar o modal, sem apagar o carrinho.
4. Em Vender → **Registrar venda anterior** (abaixo do espaço e antes da busca), verificar data/hora comercial, motivo, data/hora de pagamento externo e aviso de não cobrança. Sair do modo deve preservar o carrinho. Na V226 original o botão fica oculto no mobile; no candidato precisa estar visível e tocável.
5. Conferir carrinho → Revisar venda anterior → itens, valores, datas e declarações individuais. Usar somente ambiente QA com backend sintético/Emulator para confirmar; a fixture visual bloqueia transmissão comercial.
6. Em QA autenticado, confirmar retry/consulta com mesmos IDs após resposta perdida e bloqueio offline. Não fazer lançamentos reais para homologar.
7. No Android original, sem limpar nem trocar a sessão comercial, conferir versão, conta/empresa ativa, disponibilidade dos espaços e lucro. Se o lucro continuar ausente, capturar o estado pelas telas de conta e diagnóstico do próprio aplicativo; não usar DevTools nem modificar permissões para forçar o componente.

## Publicação e rollback propostos

1. **Não publicar agora.** Falta homologação visual real do candidato e esclarecer o lucro no contexto original.
2. Depois da validação e autorização específica, reconfirmar `main`/domínio na base V226, as revisões de backend/Rules, manifesto e integridade dos oito arquivos públicos.
3. Publicar somente frontend/PWA, pelo fluxo de Pages sanitizado, mantendo os dois rulesets GitHub ativos. Não há deploy de Firebase neste hotfix.
4. Conferir workflow, commit de build, namespace novo do Service Worker e hashes dos recursos; smoke de leitura, sem criar venda/recebimento.
5. Homologar Home/Vender no Android antes de iniciar vendas anteriores reais. Uma venda anterior permanece owner-only, online, sujeita às validações do backend já publicado e à confirmação individual.

Rollback de frontend: a base `5957fb9b1e78481f940f58766e17257cc1b0336f` é compatível com o backend atual, mas reintroduz os defeitos de interface documentados. A referência remota de contenção já existente é `1f7e1675fa2d0551e3dcbf3ee8183fdb7e4dd2f5`, tag `rollback/v226-compatible-v225-integrated`, preservando a cobrança V225 e as proteções do backend. Avaliar registros anteriores em andamento antes de escolher a referência. Não apagar identidades, recibos, drafts ou filas; não reenviar operações e não restaurar Rules antigas. Nenhum rollback foi executado ou publicado.

**GO:** correções locais reproduzidas e regressões técnicas.
**NO-GO:** declarar todo o incidente resolvido, homologação física concluída ou iniciar publicação/lançamentos reais nesta etapa.

Follow-up detalhado: [V226-PROFIT-INVESTIGATION.md](V226-PROFIT-INVESTIGATION.md). O único acréscimo de runtime nesta continuação está no feedback de loading/error de performance-access.js, sem mudança da política de autorização ou dos leitores.
