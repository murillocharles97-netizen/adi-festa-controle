# V226 — Registrar venda anterior

Estado: **integrado localmente sobre a V225 publicada, sem autorização de deploy**. Base fixada `e83635c0fee645ffeaf1a4dea9c6480cc153a2f9`, branch `codex/v226-on-v225`. O commit original `bcdc215e1f9f33aab459f5c5c62d6dbf6ee56bdb` continua intacto em `codex/previous-sales-v1`. Nenhum deploy é autorizado por estes arquivos.

A integração preserva integralmente os sete handlers e os módulos de cobrança V225. Os conflitos de build-info e Service Worker foram resolvidos mantendo a flag de cobrança e acrescentando somente a contenção específica da V226. O índice canônico recebeu os trechos de vendas anteriores; nenhum arquivo antigo de cobrança foi copiado. O gate agora comprova essa preservação contra o commit publicado.

O manifesto canônico é `deploy-manifest.json`. Ele substitui os manifests privados anteriores que usavam o nome incorreto `reconcileActivityEvents`: o nome real é **`reconcileBusinessActivityEvents`**. O verificador recusa nomes ausentes e qualquer inclusão das sete Functions de cobrança.

## Fluxo e limites

- O proprietário usa Vender → Registrar venda anterior e o carrinho já existente.
- Data comercial em `data`/`occurredAt`, fuso America/Sao_Paulo, até sete datas anteriores, nunca um instante futuro. `createdAt`/`registeredAt` são timestamps do servidor. Uma venda de 01/11 pode ser lançada em 04/11 dentro dessa janela; o acesso operacional e a assinatura ainda precisam estar válidos.
- Pix, dinheiro e cartão representam recebimento externo já ocorrido, com `paidAt` explícito. Nenhuma cobrança ou webhook artificial é criado. A projeção financeira respeita a configuração de automação do espaço e a data efetiva do recebimento.
- Estoque é baixado uma vez pelo delta atual, inclusive variações e reservas. O proprietário confirma que não houve baixa anterior por outro lançamento/ajuste.
- Fiado registra somente dívida integral ainda em aberto, sobre saldo e versão financeira canônicos atuais. Pagamento posterior ou pagamento aplicado com data desconhecida exige conciliação e bloqueia esse lançamento. Não reabre ou realoca recebimentos antigos.
- Campanhas atuais e renovações não são aplicadas. Condições históricas são informadas e confirmadas pelo proprietário; não se deduz desconto histórico comparando apenas o catálogo atual.
- Prévia não altera venda, estoque ou saldo. Confirmação revalida owner, geração, espaço, produtos/clientes ativos, duplicidades e recebimentos dentro da transação.
- Clique repetido/retry preserva IDs. Após resposta perdida, Consultar confirmação apenas lê venda/recibo; não há replay automático. Erros, arquivos e filas antigos não são apagados.
- O Histórico usa a data comercial e mantém o registro técnico separado. A última compra do cliente e as métricas não retrocedem quando há compra posterior.
- Modalidade individual, online, até60 linhas. Sem lote, cobrança integrada, crédito de troca como pagamento ou reconstrução de condições históricas ausentes.

## Preparação reproduzível

```text
node scripts/verify-prior-sales-release.cjs
node --test tests/prior-sales.test.cjs
```

Os testes integrados exigem Firestore Emulator local na porta8188. Recusam produção e usam somente a empresa QA autorizada com dados sintéticos, em projeto demo único por execução. Não há limpeza/replay. O teste de navegador usa Auth/Firestore Emulator e um perfil Chromium temporário próprio, sem acessar perfil comercial.

Para gerar um pacote local novo, sem executar deploy:

```text
node scripts/package-prior-sales-release.cjs NOVO_DIRETORIO_PRIVADO NOVO_DIRETORIO_PUBLICO_DENTRO_DO_WORKTREE
```

O packager copia somente código/package files do backend, nunca `.env`, credenciais, node_modules ou dados QA. Gera Rules separadas, frontend por allowlist e rollback de contenção. O manifesto e os SHA256 do pacote novo são evidência válida; builds privados mais antigos são preservados, mas não devem ser publicados.

## Integração obrigatória com V225

1. Fixar o commit **realmente publicado e validado** da V225. Não usar o main local desatualizado, um bundle histórico de billing ou um commit presumido.
2. Criar integração sobre esse commit e aplicar o delta revisado da V226. Não copiar o `index.js` inteiro de um bundle antigo e não sobrescrever arquivos de cobrança.
3. Preservar os dez arquivos originais/hashes da V225 como artefato congelado. Na árvore integrada, `js/plans.js`, `js/firebase/business-context.js` e os módulos de billing permanecem iguais à V225. Os metadados de versão/cache terão hashes novos e manifesto próprio.
4. Resolver `build-info.js` com versão226, `billingCheckoutPaused` e `priorSalesPaused`. Resolver Service Worker com versão/cache226, assets novos e política da V225 preservada.
5. Integrar apenas os trechos autorizados de `functions/src/index.js`, preservando todos os exports existentes. O deploy futuro é seletivo: cinco atualizações e duas Functions novas listadas no manifesto.
6. Reconfirmar que o patch Firestore parte das Rules publicadas, muda apenas o match de sales para reservar a nova modalidade e não ativa V3/portal legado. Storage e índices permanecem intactos.
7. Reexecutar regressões afetadas no código integrado, build/contensão, QA autenticado e rollback combinado. Somente então gerar novo hash candidato e solicitar autorização específica de deploy.

A integração local e os testes afetados foram concluídos; `productionReady` e `deploymentAuthorized` permanecem `false` até o preflight final e a autorização de publicação. A conferência física Android/PWA e o QA autenticado do backend após futuro deploy não foram presumidos.

## Rollback compatível

Pausar intake/confirmacões novas com `PRIOR_SALES_ENABLED=false` e a interface com `priorSalesPaused=true`. A consulta `confirmPriorSale` com `action: status` permanece disponível. Preservar Rules, leitores, projetores, vendas, estoque, saldos, auditorias, recibos e filas. Não excluir Functions usadas por registros existentes.

Depois da integração, gerar o rollback sobre a V225 publicada: ele não pode restaurar o frontend V224, remover correções de cobrança ou desativar a consulta de pedidos já existentes.

## Homologação física Android/PWA pendente

- Chrome Android e PWA instalado, conta owner QA separada da comercial: entrar/sair do modo, trocar espaço, data/hora de São Paulo e teclado aberto.
- Conferir preço/quantidade/desconto, cliente e Pix/dinheiro/cartão externo; verificar que nenhuma cobrança é iniciada.
- Revisão com muitos itens, rolagem, safe-area, botões e retorno pelo Android. Conferir também320px e zoom aumentado.
- Confirmar uma venda sintética única; fechar/reabrir pelo Histórico, baixar recibo e conferir as três datas.
- Simular queda da resposta após confirmação; reabrir e consultar o mesmo registro, sem novo pagamento ou baixa de estoque. Não limpar armazenamento.
- Seller QA não recebe ação e tem tentativa direta negada. Vendas normais, Fiado e recebimentos seguem funcionando.
- Repetir o smoke mínimo de assinatura/cobrança na versão integrada, sem cobrança real de teste.

Não declarar a emulação de viewport como homologação física. Não testar essas operações na 3 Lindas ou Adi Festa.

## Roteiro da 3 Lindas, somente após deploy integrado autorizado

Owner seleciona a própria empresa/espaço → Vender → Registrar venda anterior →01/11 e horário real → produtos/valores/clientes/meio externo efetivos → motivo → revisar → confirmar entrega, preços, pagamento, ausência de outro registro e de baixa anterior de estoque. Se a confirmação não chegar, consultar o mesmo registro. “Registrar outra venda desta data” inicia uma operação individual nova, sem reutilizar a anterior.

Se estoque já foi ajustado, Fiado parcialmente pago, valor divergente, data desconhecida ou possível duplicata: manter o caso bloqueado para conferência individual; não mudar horário/valor para contornar a validação.
