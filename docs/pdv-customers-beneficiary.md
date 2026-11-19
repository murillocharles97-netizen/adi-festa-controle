# PDV: cliente por espaço e atendido separado do pagador

Base publicada: 828b02d (V238.2). Branch isolada codex/pdv-payer-beneficiary. Sem acesso ao armazenamento do Android, alteração de dados reais ou deploy. A corrida real em andamento não foi acessada nem alterada.

## Etapa A — hotfix independente

Causa reproduzida no Chrome com o código publicado: carrinho mobile z-index 72, modal genérico 60; o seletor utilizava o repositório geral de clientes em vez de SpaceContext.customersForView.

Correção: camada 80 somente nos formulários de cliente do checkout, mesmo filtro de vínculos de Clientes, exclusão de empresa diferente/inativos, pesquisa/recentes restritos e fechamento seguro ao trocar sessão/contexto. Selecionar ou cancelar mantém itens, valores e tentativa. Revalidação da seleção antes de concluir. Desktop usa o mesmo filtro. Não mostrar o saldo global como saldo de um espaço no seletor ou na prévia.

Não foi criado outro fluxo de vínculo: Novo cliente reutiliza o cadastro único e a confirmação explícita existente por WhatsApp. O servidor continua validando permissões e vínculo; não há criação automática nem transferência de dívida.

Testes: regressão visual reproduzida na base e corrigida em 360/390/1366 px, pesquisa, seleção/cancelamento, vazio, espaços, empresa, saldo agregado oculto e proteção do carrinho durante mudança de espaço. 16 testes de cadastro/vínculo/preferências locais aprovados. Somente frontend; sem Rules, Functions ou migração.

## Etapa B — evolução opcional, preservando o contrato financeiro

No carrinho que contém execução flexível de serviço, um detalhe recolhível “Atendido diferente do pagador” permite nome livre de até 160 caracteres. Não acrescenta etapa obrigatória; fica oculto para produtos comuns e venda anterior. O nome normalizado é gravado em serviceBeneficiaryName, sem ID ou vínculo de cliente. clienteId/clientId/customerId continuam apontando exclusivamente para o pagador, incluindo Fiado, métricas, parcelas e renovação. Não se cria outro cliente nem outra venda.

O campo entra no rascunho existente, na identidade de conteúdo da tentativa, no envelope original e na validação transacional do servidor. Alteração durante a conferência é detectada. Permanece no Histórico, recibo na tela, imagem e texto de compartilhamento; nada é enviado automaticamente. Vendas confirmadas não podem reescrever o nome. Serviços/vendas anteriores sem esse campo mantêm o contrato.

Os recibos de atendido distinto ou cliente explicitamente vinculado a vários espaços apresentam o valor desta venda e o recebido nela, sem apresentar o saldo agregado como dívida do espaço. Os valores históricos armazenados não são recalculados.

### Saldo compartilhado: diagnóstico e prova

O cadastro clients.saldo continua sendo uma projeção agregada por cliente/empresa, com financialVersion global. **Não deve ser interpretado como conta de um espaço.** As origens financeiras são as vendas/eventos e as entradas comprovadas por espaço. O roteamento já publicado filtra as obrigações elegíveis antes de alocar recebimentos, revalida a cotação/versão e rejeita cruzamento entre espaços. Não foi criado outro mecanismo de conta.

Teste no Emulator: uma única venda Táxi de R$180, pagador Pai QA e atendido Maremont QA => faturamento 180, recebido imediato zero, dívida 180 somente do pagador no Táxi, atendido sem dívida, zero estoque. Outra venda de 70 do mesmo pagador em outro espaço permanece separada. Receber 70 no Táxi deixa 110 no Táxi e 70 no outro espaço; somente uma entrada de caixa de 70 no Táxi, mesmo repetindo a operação. Alocação forjada para a outra venda é rejeitada atomicamente. Conta com diferença de saldo sem prova continua bloqueada. Cancelamento de serviço novo reverte somente seu pagador e mantém o snapshot do atendido, sem estoque ou pagamento fictício.

### Evidências

- HTTP + Chrome 360, 390 e 1366 px com cadastro/PDV, reinício offline preservando nome/pagador/itens, reconexão e resposta perdida conciliada pelo recibo original. Uma venda, nenhum recebimento antecipado, nenhuma baixa física. Histórico e imagem/texto do recibo conferidos. Screenshots sintéticos em qa-artifacts/pdv-beneficiary.
- 19 cenários legados/fuel/estoque/Rules no Emulator e 5 cenários de beneficiário, isolamento, inconsistência, cancelamento e contenção de rollback aprovados, nos pacotes seletivos.
- Regressão selecionada: 173/177 aprovados. Quatro falhas de asserções estáticas foram reproduzidas na base publicada 828b02d: três em sales-pdv-cart.test.js (mensagem/estrutura legada e regex de estado), uma em fiado-receipt-route-queue.test.cjs (comparação textual do guard arquivado). Não são falhas novas; os cenários comerciais, fila, recebimento e interface correspondentes passam nos testes funcionais. Não foram relaxadas proteções para fazê-las passar.
- 56 testes de contenção pública/cache aprovados. Roteiro e versão/cache conferidos; pacote público mantém 276 recursos. Build completo registrado em qa-artifacts/pdv-beneficiary/build.log.

## Arquivos e pacote seletivo

A: js/checkout.js, js/desktop-sales.js, css/checkout-mobile.css e metadados PWA, teste de preferências e navegador. B: js/checkout.js, js/vendas.js, js/recibos.js, js/activity-center.js, css/flexible-service.css, functions/src/shared/flexible-service.js, functions/src/shared/operational-privacy-policy.js, functions/src/services/flexible-service-validation.js, testes, script de empacotamento e metadados PWA.

O backend **B exige somente commitOperationalSync e readOperationalWorkspace**. getPerformancePage, recibos de sincronização, triggers, Rules, índices, assinaturas e demais Functions não precisam mudar. scripts/package-service-beneficiary.cjs parte de cada fonte ativa verificada; não publica functions inteiro:

- Gateway 00024-cud: três arquivos alterados, 99 preservados; aliases de estoque, combustível, corte do Fiado, idempotência e demais validações intactos.
- Leitor 00004-tiw: uma linha da lista pública de campos de venda, 81 arquivos preservados. Somente o nome do atendido é adicionado; nenhum custo ou nova permissão.
- O empacotador preserva inclusive diferenças preexistentes entre a política de privacidade do repositório e a fonte de cada Function, sem copiá-las indiscriminadamente.

## Publicação e rollback — não executados

1. Reconfirmar main e revisões ativas; interromper se houver alterações concorrentes. A pode ser publicada sozinha, somente frontend, candidata 22a3f12 (238.3).
2. Para B, publicar somente o gateway seletivo e validar fonte, auth, compatibilidade antiga e recibos; depois somente o leitor, validando escopo e projeção. Nenhum dado comercial precisa ser escrito para publicar.
3. Publicar frontend correspondente (candidata 238.4), conferir 276 hashes/SW e atualizar PWA online. O rascunho real de R$180 não é criado/reexecutado pelo deploy. Não limpar dados, filas nem cache. Vincular o pagador ao Táxi pelo cadastro existente exige confirmação explícita do operador.
4. Rollback frontend independente para A ou 828b02d, sem apagar campos/envelopes nem restaurar Rules. Após usar B, manter a leitura aditiva do nome; pacote de contenção do gateway pausa novas vendas com atendido distinto e preserva replay de confirmadas, serviços normais, combustível, estoque e filas originais. A interface anterior pode não mostrar o novo nome, mas os registros permanecem intactos. Nunca reatribuir dívida para reverter software.

GO técnico para preparar publicação seletiva, condicionado a autorização do proprietário e nova conferência da base/revisões no momento do deploy. Nenhum push, merge ou deploy autorizado nesta rodada.
