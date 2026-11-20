# V240 — revisão e preparação de integração (20/11/2026)

**Parecer: GO para integração do candidato local; NO-GO para publicação neste momento.** A publicação depende de autorização, verificação da main remota no momento da integração e aceite explícito das falhas preexistentes. Não há comprovação nesta revisão de que as corridas reais de 18/19 chegaram ao servidor.

## Código e escopo

Checkout: `C:/Users/Murillo/Documents/VECONI-TaxiFin`, branch `claude/v240-taxi-financeiro`. Base examinada: `0860a53` (V239.1, também origin/main local). A referência main local está em outro commit; não foi usada como substituta silenciosa da base solicitada. Nenhum fetch, push, merge em main ou deploy foi feito.

Preservados: `887673e` (backend/Rules), `25943d9` (interface/dashboard) e `706b4a6` (homologação do Claude, que apareceu durante a revisão). O relatório do Claude em `docs/qa/v240-homologacao-taxi.md` é evidência dele, separada dos testes executados nesta revisão.

A pasta original Adi Festa Controle contém alterações de outra versão e não foi modificada. Nenhuma base real, fila, corrida histórica ou identidade de registro foi alterada.

## Achados e correções

- A confirmação de uma conta não invalidava o cache de Clientes fora da tela Clientes. A reprodução retirou o `prepareList()` artificial do teste e falhou. A invalidação agora também acompanha `fiado-account-updated`; o commit concorrente do Claude contém proteção adicional no redesenho do dashboard.
- O indicador e o painel financeiro exibiam R$ 0 mesmo com conta pendente. Agora mostram **A conferir**, inclusive no saldo previsto. O teste verifica a ausência do zero indevido; valores confirmados e parcelas futuras continuam separados.
- Desfazer a automação removia o marcador no servidor, mas o cliente guardava o ID do próprio desfazer e oferecia outra reversão inválida. O cache local agora acompanha o estado do servidor. Teste DOM cobre ativação, retry com mesmo ID, desfazer e reabertura.
- Versão e cache atualizados para 240; URLs dos arquivos alterados atualizadas. Os dois consumidores do serviço financeiro usam a mesma URL v240. Contratos de sync, dados persistidos e filas não mudaram. Um teste que fixava o import em v163 foi atualizado para a versão efetivamente entregue.

## Validação executada

| Verificação | V239.1 | Candidato V240 |
|---|---:|---:|
| Suíte geral `npm test` | 1185 passam / 97 falham | 1185 passam / mesmas 97 falhas |
| Suíte backend `npm --prefix functions test` | 247 passam / 3 falham | 247 passam / mesmas 3 falhas |
| Rules de espaços no emulador | 24/24 | 25/25 |
| V240 DOM/dominio + combustível + identidade de versão | — | 23/23 |
| Proteção do pacote público | — | 56/56 |
| Build JS | — | 550 arquivos validados |
| Build público | — | 277 arquivos permitidos |

As suítes gerais **não estão verdes**. A comparação por nome não encontrou novas falhas; não foram corrigidas falhas históricas fora do escopo. `npm test` só inclui `*.test.js`, por isso os novos `*.test.cjs` são executados separadamente por `npm run test:v240`.

Emulador Firestore próprio, porta 8240, projeto demo; os testes Rules usam seu projeto fictício habitual no mesmo emulador. A porta padrão estava ocupada e seu processo foi preservado. Foram testados: autorização, conta incompatível, revisão concorrente, retry idempotente, ativação no mesmo espaço, preservação de históricos, venda anterior sem backfill, venda paga uma única vez, Fiado sem entrada, recebimento parcial de R$ 50, isolamento loja/Táxi, recusa de mover receita já projetada, reversão e reativação. A extensão verifica estimativa de combustível de R$ 9,25 sem despesa automática e despesas manuais de manutenção/pedágio coexistindo.

A interface foi exercitada com JSDOM e resposta callable simulada; o serviço backend real foi exercitado separadamente no emulador. Não se afirma uma nova homologação visual completa em navegador ou celular nesta revisão.

O teste do dashboard usa `SpaceContext` real e data fixa de 20/11/2026: duas corridas de R$ 180 + R$ 140 em 18/19 resultam em **R$ 320** nos sete dias; loja, datas antigas e registros sem espaço ficam de fora. Não atribui vendas antigas ao Táxi. Agregação sintética de 10 mil vendas ficou em aproximadamente 40–50 ms, sem leituras remotas; isso não mede latência de rede ou desempenho em celular. A hidratação existente limita cada rodada a 25 contas e aplica intervalo por cliente.

## Limites para o caso real

Esta versão não recupera operações ausentes no servidor e não recria as corridas de R$ 300+. Confirmar a causa real exige uma auditoria somente leitura dos IDs, comprovantes e fila do aparelho original. A revisão verificou o filtro com dados fictícios confirmados, não a existência das corridas reais. O dashboard mantém o modelo anterior de dados locais/sincronizados; não foi introduzida nova certificação remota de cada venda.

O saldo previsto continua sendo receita do período menos dívida exigível, fórmula preexistente que pode misturar dívida histórica com receita recente. Perfis sem acesso à prova canônica conservam o fallback anterior. Esses comportamentos não foram ampliados nesta entrega.

## Publicação seletiva — executar somente após autorização

1. Verificar a main remota e confirmar se ainda corresponde a `0860a53`. Se avançou, integrar e repetir os testes afetados. Preservar todos os commits; não usar reset, rebase destrutivo ou force push. Não enviar main antecipadamente: `.github/workflows/deploy-pages.yml` publica Pages automaticamente no push.
2. Publicar apenas as duas novas Functions, a partir deste candidato revisado:
   `firebase deploy --project adi-festa-controle --only functions:configureFinancialSpaceAutomation,functions:readFinancialSpaceAutomation`
3. Publicar apenas Firestore Rules:
   `firebase deploy --project adi-festa-controle --only firestore:rules`
   Não publicar indexes, Storage Rules, funções de cobrança ou demais funções. Os projetores financeiros existentes não foram alterados.
4. Integrar os commits em main e então permitir o workflow Pages publicar o pacote allowlist. Verificar versão 240 no build e no Service Worker e carregamento do financeiro. Não limpar IndexedDB, localStorage ou filas para atualizar.
5. A ativação no Táxi real é uma ação financeira separada: revisar espaço e conta escolhidos antes de salvar. Sem ativação automática por deploy, sem backfill e sem recadastrar corridas. A confirmação de funcionamento real deve usar registros reais já existentes por leitura ou operação expressamente autorizada, nunca cadastrar vendas de teste em produção.

Rollback: reverter o frontend por novo commit/cache, preservando os históricos e os dois endpoints. Reverter o frontend não desativa uma automação já ativada; eventual desativação deve ser autorizada e feita pelo fluxo auditável. Não reabrir Rules antigas nem apagar lançamentos, trilhas ou filas.

## Reproduzir

- `npm run test:v240`
- `npm run test:v240:emulator`
- `node --test tests/service-fuel.test.cjs tests/sync-version-identity.test.js`
- `npm run test:public-containment`
- `npm run build` e `npm run build:public`

Logs locais: `qa-artifacts/v240-review/`. Resumo comparativo versionado: `docs/qa/v240-review-results.json`.
