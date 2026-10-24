# V200 — pacote local de cancelamento canônico de vendas antigas

Base exclusiva: V199 sanitizada `3265f375a6bcd6276e202646725ce63e06a8d20c`. Nenhum merge, cherry-pick ou importação de objetos da genealogia anterior. Esta preparação não autoriza publicação nem cancelamento real.

## Pacote isolado

- Duas Functions novas: `previewSaleCancellation` e `confirmSaleCancellation`, região `southamerica-east1`, mesmas opções restritas dos callables operacionais existentes.
- Serviço novo `sale-cancellation-service.js`: autenticação, vínculo ativo, plano, geração, espaço com Vendas e autorização existente `sales.cancel`; transação e recibos determinísticos. Não concede permissão nova.
- Única mudança de Rules: negar atualizações feitas diretamente pelo cliente em venda já cancelada por `canonical_transaction`. Necessária contra replay do desfazer legado em outra aba/versão. Todas as outras Rules são idênticas à base.
- Frontend: novo módulo de confirmação, dois caminhos no Histórico, referências e metadados PWA V200. Lista pública explícita adiciona apenas o novo módulo de interface.
- Testes específicos, atualização das expectativas de versão dos testes de contenção e documentação.
- Sem índices novos, migração, alteração de permissões, reprocessamento, limpeza ou API de reembolso. Não publicar `functions` indiscriminadamente.

## Invariantes

Sync, filas, Auth, namespaces, rotina existente de Fiado, Trocas, créditos e projetor Financeiro permanecem idênticos à V199. O serviço novo chama o projetor existente sem alterá-lo. Fixtures sanitizadas, workflow de publicação e construtor de pacote público permanecem iguais.

Cancelamento de venda intermediária soma apenas o delta comprovado ao estoque atual; não restaura saldo/estoque antigo nem remove venda posterior. Fiado só permite débito comprovado e não recebido; recebimentos ou ajustes posteriores exigem conciliação. Trocas formais e crédito consumido bloqueiam o cancelamento genérico.

Pix/cartão manual não acionam reembolso externo. A confirmação exige declaração de devolução já realizada fora da VECONI ou ausência de reembolso devido. Pagamentos integrados continuam bloqueados neste fluxo.

## Validação e evidências

Executar antes dos commits: testes de cancelamento, Fiado, Histórico, Trocas/crédito, financeiro e contenção; Emulator com identidade owner/seller, concorrência, venda posterior, retorno de estoque e rollback; lint, build e diff-check.

Os logs e hashes finais dos dois commits ficam fora da publicação, em `C:/Users/Murillo/.codex/visualizations/2026/10/24/sale-cancellation-qa/`. Somente dados fictícios locais/Emulator. Nenhuma venda real é cancelada ou consultada para homologar o pacote.

Candidato versionado: **153 testes Node e 75 Emulator aprovados**, sem falhas ou testes ignorados. Lint, build, `git diff --check` e pacote público de 224 arquivos aprovados. O cenário de estoque original 10→8, estoque atual 4, devolução para 6 e venda posterior intacta foi revalidado. Os testes também preservam bloqueios de Trocas/crédito, recebimentos de Fiado e leituras financeiras do seller.

## GitHub: consulta de prontidão, sem mutação

Em 24/10/2026, `main` ainda era `3265f37`. Rulesets `25744131` (branches) e `25744311` (tags) ativos para `~ALL`, sem exclusões, bloqueando criação, atualização e exclusão. Único tipo de bypass configurado: DeployKey da manutenção; conta comum não tem bypass. Origem de push deste clone continua `disabled://veconi-clean-maintenance/`.

Esta preparação não altera ruleset, credencial, pushurl ou proteção local e não testa escrita remota. Publicação exige autorização posterior para o procedimento com credencial temporária restrita, lease para a referência sanitizada esperada e nenhuma substituição indiscriminada. A manutenção de segurança continua ativa.

## Ordem de publicação proposta — aguardar autorização

1. Revalidar SHA remoto, pacote e rulesets; autorizar separadamente a origem sanitizada e a credencial de manutenção, sem desligar proteções.
2. Publicar somente `firestore:rules` com a trava restritiva.
3. Publicar somente `functions:previewSaleCancellation,functions:confirmSaleCancellation`; aguardar ambas prontas.
4. Publicar o commit candidato aprovado do frontend/PWA pela lista explícita; confirmar V200, commit e Service Worker no domínio.
5. Smoke curto somente QA: venda antiga Pix, Fiado não recebido, bloqueio de recebimento e de troca, tentativa repetida e aba antiga. Nenhuma ação na venda real relatada.

## Rollback compatível

Preparar em branch/tag local separadas `rollback/v200-compatible-sale-cancellation`, derivadas diretamente do candidato, sem substituir o candidato.

- `allowNewCancellations:false` nos dois callables: novas confirmações e previews bloqueados; replay da MESMA solicitação já confirmada pode consultar o comprovante, sem novo efeito.
- Retirar apenas o novo botão/módulo carregado do frontend e da lista pública, retomando o comportamento visual anterior; identificar PWA com cache próprio `veconi-v200-safe-sale-cancellation-rollback` e release 200.
- Preservar serviço, Functions, Rule restritiva, recibos, ledger, vendas já canceladas, movimentos, Fiado, Trocas e créditos. Nunca voltar Rules/ledger à base anterior após o primeiro cancelamento.
- Atualizar testes de versão para o cache do rollback; testes do serviço e Emulator continuam validando invariantes.
- Para efetivar rollback após autorização: suspender primeiro as duas Functions e depois publicar frontend do commit de rollback. Sem restauração ou exclusão de dados.

Os SHAs exatos do candidato e do rollback serão fornecidos após os testes, no relatório externo e na entrega. Nenhum push ou deploy faz parte desta etapa.
