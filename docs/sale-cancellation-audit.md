# Cancelamento canônico de vendas — auditoria e hotfix local

Base: V199 sanitizada `3265f375a6bcd6276e202646725ce63e06a8d20c`. Branch local `codex/safe-sale-cancellation`. Pacote do hotfix V200 em preparação local; identificadores finais no relatório de entrega. Sem push ou deploy.

## Causa da limitação

O Histórico tinha uma única ação, ligada a `requestSafeSaleUndo` (`js/app.js`) e `Vendas.desfazerUltima` (`js/vendas.js`).

- `Vendas.ultima()` retorna a última posição da lista **local**, não uma comprovação da última venda global da empresa.
- `podeDesfazer()` e `desfazerUltima()` impõem cinco minutos. O Histórico também exige que o ID seja o da última venda.
- O fluxo remove a última posição local por `pop`, recalcula campos do cliente, reverte campanha/renovação e captura diferenças no Sync. É um atalho, não um cancelamento administrativo arbitrário.
- No Fiado, o atalho exige saldo/financialVersion exatamente correspondentes à venda. A V197 acrescentou o estorno canônico e sua confirmação; não tornou seguro cancelar qualquer posição da lista.
- A janela não é uma exigência do Pix, banco ou Firestore Rules. É uma restrição explícita do fluxo local simplificado. Apenas retirar o timer/`pop` poderia afetar vendas posteriores, benefícios e saldos.

Não foi possível concluir, por uma observação textual, que a venda relatada participa de Trocas V1. A nota não é usada como prova de dependência. O novo serviço consulta os registros formais.

## Mecanismos atuais auditados

| Tema | Situação e consequência |
| --- | --- |
| Estoque | O atalho cria devoluções e deltas no Sync; não deve ser convertido em restauração de snapshots antigos. O novo fluxo prova as baixas originais e soma somente suas quantidades ao estoque atual. |
| Saldo Fiado | `balanceEvents/credit_sale:<saleId>` comprova o débito; `credit_sale_reversal:<saleId>` é o estorno único. `financialVersion` protege a concorrência. Recebimentos/alocações posteriores não podem ser apagados. |
| Financeiro | O projetor existente `financial-income-service.projectSale` reverte apenas a receita automática original existente, uma única vez, na rota original. Não cria uma receita ou pagamento de cliente para cancelar. |
| Pix/dinheiro/cartão manual | São vendas manuais pagas. O cancelamento interno não chama banco, adquirente ou API de reembolso. Exige declaração explícita de devolução externa já realizada ou de que não existe reembolso devido, com motivo. |
| Cartão/Pix integrados | `paymentIntentId`, cartão presencial integrado e canal integrado continuam bloqueados; exigem fluxo do provedor. |
| Pedido online | Mantido bloqueado neste fluxo; demanda tratamento do pedido/reserva específico. |
| Permissões | Autenticação, perfil ativo, membership ativo, plano, empresa, geração, capacidade Vendas e espaço autorizado são verificados no servidor. Owner ou concessão existente `sales.cancel`. Nenhuma nova permissão. |
| Financeiro do vendedor | O servidor verifica dependências sem devolver saldo, custos ou lucro ao vendedor. Não se concede `financial.view`, `settings.manage` ou leitura das coleções privadas. |
| Trocas V1 | Resumo ou evento formal de troca bloqueia o cancelamento da venda original. Não são alterados troca, crédito emitido ou estoque desses eventos. |
| Crédito consumido | Continua no cancelamento dedicado `cancelExchangeCreditSale`, que restaura o crédito. O novo cancelamento genérico bloqueia essa origem e explica o motivo, sem duplicar a restituição. |
| Campanhas/renovações | Dependências formais são bloqueadas no novo fluxo e encaminhadas à resolução específica. O atalho anterior continua existente, sem alteração de seu cálculo. |
| Histórico/metas/Dashboard | A venda continua no Firestore com itens, valores, autoria e operação original. Recebe status/flags canônicos de cancelamento; os modelos atuais a excluem dos totais válidos. O projetor de histórico e métricas existente recebe a atualização normal. |

## Solução mínima implementada

### Dois caminhos separados

1. **Desfazer (atalho de 5 minutos):** preserva as restrições anteriores e a rotina já existente. Não removemos o timer nem generalizamos `pop`.
2. **Cancelar venda:** não depende de idade ou posição. Online, com consulta canônica, motivo de 8–400 caracteres, revisão e confirmação.

Novas Functions preparadas localmente:

- `previewSaleCancellation`: somente leitura transacional, valida dependências e retorna resumo mínimo/fingerprint.
- `confirmSaleCancellation`: repete as validações dentro da transação e aplica os efeitos de uma venda específica.

### Transação e idempotência

- ID determinístico `cancel_sale_<hash da empresa/geração/saleId>`.
- Comprovante em `processedOperations/{operationId}`, com hash da solicitação, motivo, responsável, cargo, data, tratamento do pagamento e IDs dos movimentos.
- Venda original não é removida. `id`, `operationId` original, itens, preço, data e autoria permanecem; novos campos registram o cancelamento.
- Movimentos originais precisam corresponder à venda, operação, empresa, espaço, itens e quantidades. Falta de prova não é compensada por presunção.
- Estoque atualizado por delta sobre a leitura atual. Reservas preservadas. Variações e total do pai conferidos dentro da transação. Estoque inconsistente ou produto de outro espaço bloqueia a ação.
- Fiado: somente débito original comprovado e integralmente não recebido; estorno em evento determinístico e saldo atual incrementado pelo valor do débito. Não restaura `saldoAnterior` antigo. Outros débitos posteriores permanecem. Recebimentos/ajustes/estornos posteriores ou sem data comprovada exigem conciliação e bloqueiam a ação.
- Mesma solicitação/retry após resposta perdida retorna o comprovante existente, sem segunda devolução. Solicitação diferente para o mesmo cancelamento é recusada.
- Resposta de sessão/empresa/espaço anterior não hidrata o contexto atual.
- A tentativa é preservada em chave local própria por UID/empresa/geração/venda. Não entra na fila comercial. Reload não faz replay automático.
- Alteração de estoque entre revisão e confirmação recusa a transação; a solicitação recusada é preservada separadamente e a interface oferece nova revisão explícita. Resposta incerta de rede não é tratada como rejeição definitiva.
- Filas reais existentes impedem iniciar esta ação até sua resolução normal; o novo fluxo não força Sync/retry.

### Trava contra abas/versões antigas

A única mudança em Rules **restringe** atualizações do cliente a uma venda já marcada pelo servidor com `cancellationMode: canonical_transaction`. Isso impede que uma aba antiga execute o desfazer legado sobre uma venda já cancelada pelo novo fluxo. Como o legado escreve a venda e estoque na mesma transação, a recusa impede a segunda baixa/devolução integralmente.

Não foram alteradas concessões, leitura financeira, isolamento, Rules de Trocas ou Functions existentes. O novo servidor não depende de esconder botão como proteção.

### Tratamento financeiro honesto

Para vendas pagas, a confirmação exige uma das opções:

- “Já devolvi o valor fora da VECONI”; ou
- “Não há reembolso devido”, explicado no motivo.

“Ainda preciso devolver” não confirma o cancelamento nesta primeira entrega. Permitir pendência de reembolso exigiria representar corretamente uma obrigação futura no Financeiro, em vez de marcar como saída financeira paga. Essa lógica não foi improvisada.

O Financeiro usa exclusivamente o projetor canônico já existente, inclusive sua idempotência. Se a projeção ficar pendente ou exigir revisão, a interface informa que a venda foi cancelada, mas que a conferência contábil está pendente; não manda repetir o cancelamento. Nenhuma API bancária é chamada.

## Testes essenciais

Somente dados fictícios, no processo Node e no Firestore Emulator local (`demo-veconi-cancel`, além das bases fictícias dos testes preexistentes). Nenhuma conta ou espaço real foi utilizado.

| Cenário | Resultado |
| --- | --- |
| Venda antiga Pix, dinheiro e cartão manual | Aprovado |
| Venda mais recente | Aprovado |
| Venda intermediária; venda posterior intacta | Aprovado |
| Estoque original 10→8, estoque atual 4; devolução correta para 6 | Aprovado |
| Variação e agregado do pai | Aprovado |
| Reservas mantidas | Aprovado |
| Fiado não recebido, com outro débito posterior | Aprovado: reverte só o débito original |
| Fiado recebido/ajustado posteriormente | Aprovado: bloqueado, sem tocar recebimentos |
| Troca registrada, crédito consumido, integrado, pedido, campanha, renovação | Aprovado: bloqueios específicos, sem efeitos |
| Observação textual sobre troca, sem registro formal | Aprovado: não cria falsa dependência |
| Duplo clique, duas tentativas simultâneas, resposta perdida e retry | Aprovado: um cancelamento, um movimento |
| Outra aba preservou a solicitação | Aprovado: adota a mesma solicitação, não sobrescreve o motivo |
| Estoque alterado após revisão | Aprovado: recusa atômica e revisão explícita |
| Seller autorizado; seller sem permissão | Aprovado: permite/nega conforme grant |
| Seller sem Financeiro/custos/lucro | Aprovado: continua sem essas leituras |
| Outro espaço/geração | Aprovado: recusado |
| Reload, consulta em outro dispositivo e Histórico canônico | Aprovado |
| Atualização de cache sem captura de nova operação | Aprovado |
| Aba legada tentando cancelar depois do novo fluxo | Aprovado: Rule impede sobrescrita/replay |
| Financeiro habilitado | Aprovado: uma receita original e um estorno correspondente, sem duplicar |
| Rollback compatível | Aprovado: suspende novos cancelamentos e conserva recibos anteriores |

Evidências: `C:/Users/Murillo/.codex/visualizations/2026/10/24/sale-cancellation-qa/`.

Validação da implementação: **141 testes Node e 75 testes no Emulator aprovados**, sem falhas ou testes ignorados. Lint, build, pacote público por lista explícita e `git diff --check` aprovados. O registro verificável está em `LOCAL-VALIDATION.json`, junto dos logs e seus hashes. Essa rodada antecedeu a preparação dos commits. A revalidação do pacote versionado e do rollback consta dos logs V200 na mesma pasta. Nenhum push, deploy ou operação comercial real.

## Arquivos do hotfix

- `functions/src/services/sale-cancellation-service.js` — serviço novo, restrito ao cancelamento canônico.
- `functions/src/index.js` — exporta somente os dois novos endpoints e o controle de suspensão compatível.
- `firestore.rules` — trava restritiva pós-cancelamento canônico.
- `js/sale-cancellation.js` — confirmação, preservação da tentativa, retomada explícita e leitura do resultado.
- `js/activity-center.js` — separação dos dois botões e textos corretos.
- `index.html`, `service-worker.js`, `public-site.manifest.json` — inclusão explícita do módulo de interface/PWA.
- `tests/sale-cancellation-ui.test.js`, `tests/emulator/sale-cancellation.rules.test.js` — novas regressões.
- Este documento.

Permaneceram idênticos à base: `js/vendas.js`, `js/fiados.js`, `js/firebase/sync.js`, serviços de Trocas/crédito e projetor Financeiro. Não há instrumentação temporária nem mudanças de outras branches.

## Publicação e rollback propostos — NÃO executados

Preparar commit isolado da V200 e rollback compatível separado, conforme `docs/release-v200-sale-cancellation.md`. A versão atualmente publicada continua V199. A publicação exige nova autorização específica.

Ordem segura de futura publicação:

1. Publicar a trava restritiva de Rules.
2. Publicar somente `previewSaleCancellation` e `confirmSaleCancellation`.
3. Publicar frontend/PWA, com versionamento/cache do hotfix atualizados no pacote aprovado.
4. Smoke curto exclusivamente QA: antigo Pix, Fiado não recebido, negativo com recebimento, replay e aba antiga. Não cancelar a venda real por conta própria.

Rollback compatível:

- Base frontend V199 **sanitizada** `3265f375a6bcd6276e202646725ce63e06a8d20c`, nunca a genealogia contaminada anterior.
- Suspender novos cancelamentos no servidor por `allowNewCancellations:false`; só o servidor controla essa opção.
- Preservar os endpoints para reconhecer recibos anteriores, a Rule pós-cancelamento, o projetor Financeiro, vendas, movimentos e eventos de saldo existentes.
- Não restaurar snapshots de dados, apagar comprovantes ou repetir operações para voltar a interface.

O ensaio inicial usou `rollback-compatible-v2.patch`, com `git apply --check` aprovado e sem aplicação. Para o pacote versionado, preparar commit dedicado e tag local `rollback/v200-compatible-sale-cancellation`, mantendo o candidato em branch separada. Não usar o patch anterior em lugar do commit final validado.

O congelamento do GitHub e os bloqueios de push continuam intactos. Publicação futura precisa usar o procedimento de manutenção autorizado; nenhum bloqueio foi removido nesta demanda.

## Limites e riscos restantes

- É cancelamento integral; devolução parcial continua sendo uma operação distinta.
- Não implementa reembolso bancário/adquirente, devolução de pedido online, resolução de benefícios ou cancelamento genérico de crédito de troca.
- Dados antigos sem origem, espaço ou baixa comprovável são bloqueados, não “corrigidos” automaticamente.
- Fiado com recebimento/ajuste exige conciliação específica. Não subtrair valores manualmente.
- A projeção Financeiro é idempotente e pode ficar pendente de processamento; a interface não confunde isso com falha não confirmada da venda nem cria novo cancelamento.
- Não foi cancelada, alterada ou reprocessada a venda real relatada de R$91,70. Também não houve outras operações comerciais reais.
