# V197 — cancelamento Fiado sobre V196

Base publicada: V196, `ea0d0d9457567442f298e02e84e74f782d9ef144`. Preparação de commit/pacote autorizada. Publicação e reconciliação comercial ainda NÃO autorizadas.

## Causa reproduzida

O Sync escrevia `status: applied` no documento da venda após aplicar o débito. Isso substituía o estado comercial `fiado`. Após hidratação, tanto `Vendas.desfazerUltima` quanto `financialEffectFromWrites` verificavam somente `status === fiado`. O cancelamento tombstonava a venda e devolvia estoque, mas não restaurava o cliente nem emitia `credit_sale_reversal`.

O defeito foi reproduzido executando os módulos reais da V196: saldo -12 → -26; hidratação com status `applied`; cancelamento mantendo -26. O teste inicialmente falhou e passa com a correção.

## Correção

- Reconhecer Fiado por forma de pagamento ou status legado; novas confirmações preservam o status comercial e usam `applicationStatus` separadamente.
- Aplicar o delta de estorno ao saldo atual; nunca substituir o saldo pelo snapshot histórico.
- Bloquear o atalho quando houver pagamento alocado, recebimento parcial ou outro evento financeiro posterior. Esta entrega não cancela recebimentos nem produz reembolso.
- Validar na mesma transação Firestore a venda canônica, cliente, versão financeira, débito original, origem, espaço e delta. Divergência aborta a transação inteira.
- Reutilizar o evento determinístico `credit_sale_reversal:{saleId}` e o recibo `processedOperations/{cancelOperationId}`. Retry e concorrência não reaplicam saldo/estoque.
- Preservar o operationId/autoria da venda e identificar separadamente seu cancelamento e evento financeiro reverso.
- Confirmar sucesso visual somente após recibo, venda cancelada e estorno na nuvem; hidratar cliente canônico sem gerar outra operação comercial. Callback de sessão substituída é rejeitado.
- Manter as restrições e o cancelamento dedicado de vendas com crédito de Trocas.

## Limites de segurança

Nenhuma Rule, Function, permissão, coleção financeira de Trocas ou índice foi alterado. A validação adicional utiliza o fluxo transacional existente e não concede acesso ao vendedor. Falta de autorização continua impedindo a operação.

Uma alteração financeira posterior, inclusive legítima, bloqueia este atalho e exige conciliação específica. Se uma corrida só for descoberta na nuvem, a operação local permanece preservada com erro, sem efeitos remotos parciais; a UI não informa sucesso. Não há reparo automático de cancelamentos antigos.

## Verificação

- 110 testes Node direcionados aprovados (Fiado, Trocas/crédito, sessão, quarentena, isolamento do pacote e imports da release).
- 50 cenários Emulator aprovados (10 novos do cancelamento Fiado; Trocas e consumo/cancelamento de crédito).
- Regressões novas: status legado `applied`, estorno único, cancelamento repetido por ID, pagamento parcial/alocação, saldo posterior, débito ausente, delta adulterado, espaço divergente, duas operações concorrentes, resposta perdida, leitura por outro dispositivo, confirmação de UI e troca de sessão.
- Lint, build e diff-check aprovados.
- Nenhuma operação comercial executada em produção. Teste físico/PWA da correção ainda não realizado, pois não há publicação autorizada.

## Publicação proposta (depende de autorização)

Hotfix frontend/PWA V197 isolado sobre a V196. Sem Functions/Rules/migrações. `index.html`, build-info e Service Worker recebem somente metadados/URLs da release. Auth e firebase-ui mudam apenas o import `sync.js?v=194` para `sync.js?v=197`, garantindo um singleton e atualização do módulo corrigido; nenhuma lógica de autenticação foi alterada. Checkout, `fiados.js`, compartilhamento V196, Trocas/créditos, permissões e armazenamento permanecem byte a byte iguais à V196.

Publicação futura: enviar exatamente este commit ao pipeline estático existente, somente após autorização. Não chamar `firebase deploy`, não publicar Functions/Rules, não aplicar reconciliação junto ao deploy. O pipeline existente injeta commit/timestamp no HTML. Verificar versão e commit no domínio/PWA; smoke financeiro exclusivamente QA. Não fazer venda, cancelamento ou ajuste real.

## Rollback compatível

- Referência primária proposta: `rollback/v197-compatible-fiado-cancellation`, derivada do candidato e preparada separadamente.
- Preserva a leitura dos eventos novos, o estorno idempotente, o ledger, as filas e todos os fluxos de Trocas/crédito da V196. Pausa somente a criação de NOVOS cancelamentos Fiado no frontend de contenção. Operações legítimas já existentes continuam com seus IDs e validação transacional, sem limpeza/reprocessamento coletivo.
- Não equivale a restaurar dados. Requer publicação explícita do frontend de contenção e atualização normal do PWA; não muda um bloqueio no servidor e não interrompe magicamente uma aba que ainda execute o candidato anterior.
- Referência de origem preservada: `rollback/v196-before-v197-fiado-cancellation`, somente para rastreabilidade. Retornar cegamente ao frontend V196 reintroduziria o defeito e NÃO é a opção recomendada.
- Rollback compatível de Trocas `df6ed696a8eeb4b455b135dd0661061e7002e793` e referências anteriores permanecem preservados. Não usar rollback integral incompatível com ledger/créditos.

Reconciliação de incidente real é uma autorização separada, com releitura canônica, recibo determinístico e pré-condições exatas. Não reenviar o cancelamento antigo: seu estoque já foi devolvido.

## Pacote

Entram somente: `js/app.js`, `js/vendas.js`, `js/firebase/sync.js`, as URLs de import em `js/firebase/auth.js` e `js/firebase/firebase-ui.js`, metadados PWA em `index.html`, `js/build-info.js`, `service-worker.js`, este documento e os testes correspondentes (`fiado-cancellation`, harness, Emulator e contrato de release). Scripts/snapshots/planos específicos do cliente real ficam FORA do repositório e do pacote público.
