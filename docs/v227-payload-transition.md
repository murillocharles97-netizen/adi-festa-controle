# Extração da operação e transição V226/V227

## Situação da evidência

O conteúdo disponibilizado nesta conversa identifica operação, empresa, etapa, código e mensagem. O arquivo específico desta operação não foi localizado entre os diagnósticos locais pesquisados. A localização continua pendente. A análise do exportador publicado confirma que o diagnóstico padrão não inclui o envelope completo. Ele inclui caminhos, versão do payload, checksum, tentativas e erro. A presença de entidades no diagnóstico não garante que elas reproduzam o estado original do envelope.

Para d0611a1a-cd01-4a8a-821d-0bebc8a5207c, faltam os valores originais de payload.writes, incluindo payment.legacyAmount, valor/requestedAmount/effectiveAmount, saldoAnterior/saldoNovo, expectedFinancialVersion/expectedBalance, paymentMode, alocações e deltas before/data do cliente e das vendas. O cliente da operação também precisa ser identificado pelo envelope. Isso impede atribuir o campo responsável a um valor concreto neste momento.

As leituras remotas anteriores não encontraram recebimento, marker, ledger ou alocação associados ao Operation ID. Uma consulta futura deve pesquisar também o paymentId e referências de alocação extraídos do envelope, além de possíveis recebimentos equivalentes sob outro ID.

## Procedimento no aparelho afetado

Executar na mesma origem https://veconi.app.br, no mesmo perfil e aparelho onde a operação foi registrada. Usar a sessão já aberta. Não registrar outro recebimento para substituir o original. Não acionar sincronização, recuperação, arquivamento, limpeza ou reinstalação.

1. Com a autorização do operador, desconectar temporariamente a rede do aparelho para impedir novas tentativas automáticas durante a coleta. Manter a aba/PWA existente aberta. Em Android, usar inspeção remota do Chrome no computador autorizado, se o aparelho estiver disponível.
2. No DevTools dessa sessão, colar a função de scripts/read-preserved-operation.cjs. Não habilitar scripts de terceiros nem compartilhar o console inteiro.
3. Executar `const evidence = await readPreservedOperation()` e examinar `evidence.matches.length`. A função lê somente o banco existente veconi-local-records/store records, com transação readonly, e chaves syncQueue da empresa em localStorage. Não chama DB.carregar, businessCache, SyncFirebase, flush ou métodos de recuperação.
4. Para o relatório financeiro, executar `copy(JSON.stringify(evidence, null, 2))` no DevTools e salvar em arquivo local privado. Isso copia somente a projeção permitida dos registros encontrados. Não enviar tokens, sessões, nomes, telefone, e-mail ou banco completo.
5. Se for necessário preservar o envelope integral em arquivo de suporte privado, executar `const privateEvidence = await readPreservedOperation({includeOriginal:true})`. O campo privateOriginals contém o item exato preservado, potencialmente com dados pessoais. Guardá-lo apenas no computador autorizado. Para análise compartilhada, usar a projeção financeira do passo anterior. Não publicar o original.
6. Conferir operationId e businessId. Se houver conflictingCopies, hashes diferentes ou ausência de matches, interromper e registrar o resultado. Não escolher automaticamente a cópia mais recente. O SHA-256 exportado é do JSON armazenado, e não substitui o checksum do protocolo.
7. Não alterar a fila. Restaurar a conectividade somente após decidir como preservar as tentativas automáticas do aparelho. A coleta sozinha não autoriza reenvio. O script não suspende o sincronizador nem altera seu estado.

O procedimento pode ser testado localmente com `node --test tests/preserved-operation.test.cjs`. O teste utiliza origem loopback e dados fictícios. A coleta real depende do acesso ao aparelho afetado. Ela não foi executada nesta entrega.

## Comparação financeira e recuperação proposta

Com a projeção, ler novamente servidor e registrar readTime/updateTime do cliente, das vendas referenciadas e dos registros da operação. Comparar versões antes de qualquer proposta de recuperação.

O backend tradicional calcula `legacyAmount = min(valorRecebido, legacyBalanceRemaining)`. Quando legacyBalanceRemaining é ausente ou não numérico, deriva a dívida histórica de `max(0, abs(min(0, saldo)) - somaDasVendasFiadoAbertas)`, conforme os filtros e limites publicados. Comparar o número enviado em source.legacyAmount com esse resultado. Conferir também soma das alocações, valores pagos/remanescentes por venda, espaço e expectedFinancialVersion. O caminho explícito installmentSaleId exige parcela histórica zero. Contas parceladas agregadas exigem fiadoSchedule e prova de vencimentos.

A validação que emite a mensagem já existia na V226. Os testes anteriores reproduziram a rejeição atômica da divergência e o replay idempotente de um envelope consistente. As hipóteses ainda abertas são dados locais incompletos/desatualizados, classificação histórica diferente ou concorrência. Não há justificativa para retirar a validação ou corrigir valores financeiros sem o original.

Após demonstrar a causa, preparar uma proposta identificada e condicionada à versão financeira atual. Preservar operationId e intenção original sempre que o protocolo permitir. Se a resolução exigir outro identificador, manter vínculo auditável e impossibilidade de ambas as operações serem aplicadas. Antes e depois de eventual execução autorizada, conferir pagamento, processedOperations, ledger, alocações, saldo e recibo. Qualquer execução financeira depende de autorização específica.

## Transição dos dispositivos

O frontend V226 conhece o saldo contábil integral, mas não fornece fiadoSchedule. Em contas que já têm parcelas V227, o servidor rejeita recebimentos sem apuração, com failed-precondition e orientação para atualizar o saldo e preservar o original. A rejeição ocorre antes da gravação. O teste Emulator de compatibilidade anterior comprovou ausência de pagamentos e markers. Fiado tradicional continua com o fluxo existente.

Nesta branch local, o aviso de atualização orienta concluir/salvar formulário, conferir V227 em todos os aparelhos e consultar recebimentos pendentes antes de registrar outro. A ativação aguarda DB.flush. Falha de persistência impede ativação/recarga. A troca de controlador passa a exigir recarga confirmada pelo operador. Nenhuma rotina de limpeza ou replay foi adicionada.

O código antigo já armazenado no dispositivo não recebe essas novas mensagens antes de uma publicação. A versão V226 possui o próprio aviso de nova versão e recarga automática após controllerchange. Por isso a transição inicial exige orientação do operador e validação de formulários/filas antes de aceitar a atualização. Uma publicação apenas estática não comprova atualização universal de aparelhos offline.

Procedimento de homologação por aparelho:

1. Identificar versão, papel, empresa, geração e alterações pendentes. Preservar evidência de cada Operation ID pendente e dos rascunhos abertos.
2. Concluir/salvar formulários antes da atualização. Não limpar armazenamento nem refazer vendas/recebimentos pendentes.
3. Com a publicação autorizada disponível e conexão estável, aceitar a atualização. Conferir build V227, controlador do Service Worker e persistência dos mesmos IDs e envelopes. Se o aparelho recusar atualização, manter bloqueado o uso de contas parceladas nesse aparelho.
4. Repetir em proprietário e funcionário, com dois dispositivos e duas abas. Conferir rejeições de contexto obsoleto sem perder fila. Não ampliar papéis.
5. Em ambiente sintético, receber Fiado tradicional e misto, exercitar recebimento parcial, antecipação, perda de resposta, offline/online e recarga. Comparar saldo exigível, futuro e total nos aparelhos.
6. Liberar parcelas comerciais somente após a homologação física e solução do incidente original. A ausência de operações pendentes não basta para concluir que todos os aparelhos estão atualizados.

Foi adicionado um bloqueio local quando o cliente traz hasInstallmentFiado mas o calendário ainda não chegou ao cache. Esse caso não pode cair no recebimento tradicional. Proprietário e funcionário receberam testes de ausência de mutação. Operações existentes continuam reconhecidas pelo ID antes dessa cerca.

## Validação e decisão

50 testes locais direcionados passaram na primeira rodada. Cobrem leitura do IndexedDB, projeção sem nomes/e-mails, cópias divergentes, proprietário/funcionário, Fiado tradicional, parcelas, persistência antes da atualização, cancelamento e falha de gravação. A comparação do registro armazenado antes/depois comprovou ausência de alteração no teste de extração.

Os testes com navegador utilizam dados sintéticos. Android/PWA físico e dois aparelhos reais não estavam conectados para esta homologação. As evidências de Emulator e QA responsivo do candidato original permanecem na pasta v227-frontend-incident. Os testes locais novos não substituem a validação física da transição.

GO para coleta somente leitura e homologação local. NO-GO para publicação do frontend enquanto o payload real não for recuperado/comparado e a atualização dos dispositivos não for homologada. A branch codex/v227-transition-payload deriva de b149dccf, com alterações locais que exigem revisão e aprovação de um novo candidato. A correção isolada do SpaceService não integra esta branch.
