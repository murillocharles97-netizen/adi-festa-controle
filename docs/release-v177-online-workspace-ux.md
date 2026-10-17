# V177 — UX de Catálogo/Pedidos e diagnóstico de Sync

Release exclusivamente de frontend. Base/rollback: V176, commit `e10d8226687e66001baa91c8211736d943bd41f3`; tag `rollback/v176-before-v177`.

Inclui o refinamento aprovado dos cards, ícones, abas, resumo de produtos, ações e prévia mobile do Catálogo, sem “Ações rápidas”; resumo/filtros/contador/status/cards de Pedidos. Operações continuam nos detalhes canônicos existentes. Métricas sem medição continuam sem números inventados.

Inclui também as correções aprovadas do diagnóstico V176: presença remota comprovada não é órfã; Fiado ativo separado de histórico excluído; mínimo de estoque ausente equivalente a zero somente na comparação. Diferenças reais permanecem visíveis. O pipeline operacional de Sync permanece igual; nenhuma limpeza de cache, migração, reparo financeiro ou reprocessamento de histórico.

Backend, Rules, estoque, lançamentos financeiros, Auth, assinaturas e domínio não mudam. Nenhuma loja será publicada/ativada automaticamente e o smoke não deve criar ou atender pedidos. A regressão do snapshot V176 usa somente arquivos previamente exportados, em memória, sem novas leituras/escritas de produção.

Versionamento: `AdiFestaBuild.release=177`, cache `veconi-v177-online-workspace-mobile-ux`, referências dos quatro assets de UI e build-info atualizadas. O fluxo existente de atualização do PWA permanece igual.

Validação antes do push, em uma extração limpa do conteúdo selecionado:

```powershell
node --test tests/online-workspace-mobile-ui.test.js tests/online-orders-v2.test.js tests/online-store-v2.test.js tests/online-store-reception.test.js tests/legacy-store-retirement.test.js tests/mobile-structural-foundation.test.js tests/engagement-operations.test.js
node --test tests/sync-diagnostic-scope.test.js tests/integrity-v157.test.js tests/sync-reconciliation.test.js tests/global-sync-v155.test.js tests/workspace-sync-queue.test.js tests/customer-balance-sync-v144.test.js
npm run lint
npm run build
git diff --cached --check
```

Publicação pelo workflow existente `Deploy GitHub Pages`, acionado uma vez pelo push do commit para `main`. Sem deploy Firebase. Após publicação: verificar commit/versão/assets/SW no domínio oficial e realizar smoke visual mobile e leitura do diagnóstico disponível, sem acionar salvar/publicar/ativar/cancelar/concluir, checkout, recuperação ou reparo. Android físico será validado pelo proprietário.

Rollback: publicar novamente a árvore exata da V176 pelo mesmo workflow, em um commit de restauração revisado e restrito a estes arquivos de frontend. Não restaurar dados, reprocessar operações ou alterar Firebase. A tag é referência permanente da base anterior.
