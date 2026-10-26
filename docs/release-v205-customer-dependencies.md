# V205 — clientes autorizados e recuperação controlada

Estado: preparação **somente local**, sobre a V204 sanitizada `576d761e0947eef8917dc1d85cd4bd85b3da89d3`. Nenhum deploy, replay ou decisão real autorizado nesta etapa.

## Causa e correção mínima de autorização

O cadastro local (`Clientes.salvar`, importação e cadastro rápido do checkout) não exigia `customers.edit`, enquanto o canal autorizado corretamente exigia essa permissão. Assim, a interface aceitava um cadastro que só existia no aparelho. A venda seguinte dependia de um documento inexistente e era rejeitada como “Cliente não confirmado”. Não é problema resolvido ampliando Financeiro ou permissões.

A V205 mantém **exatamente a chave existente `customers.edit`** para cadastrar/editar/importar/excluir. Não cria `customers.create` nem separa essas autorizações nesta versão. Seller sem essa chave seleciona clientes existentes; o responsável confirma novos cadastros. Domain guard e handlers diretos protegem também caminhos fora dos botões visíveis.

Antes de criar IDs da venda ou iniciar cobrança integrada, o checkout verifica o cliente por leitura autenticada. Evidência de presença é metadado separado, por UID + empresa + geração. Callback antigo não escreve no namespace novo. Um cliente remoto previamente confirmado continua utilizável offline. O fluxo offline legítimo de **cadastro novo autorizado** mantém sua ordem de fila; pacotes antigos negados/em revisão jamais se tornam esse tipo de cadastro novo, mesmo após mudança de permissão.

Vendas avulsas, aritmética comercial, captura de operações, uploader autorizado, geração de recibos normal, Rules, permissões e protocolo 1 não mudam. A finalização Online V2 reutiliza a mesma pré-validação quando há cliente, antes de registrar a venda.

## Inventário real e limite da evidência disponível

O diagnóstico recebido contém quatro criações de clientes negadas e três vendas dependentes retidas; além de quatro vendas históricas já resolvidas. Os identificadores, timestamps, tentativas, checksums e dependências estão no inventário **privado**, fora do repositório/publicação. As consultas remotas realizadas em 26/10/2026 às 16:03:55 UTC não encontraram, nos IDs originais, os quatro clientes, três vendas, sete recibos ou seis movimentos esperados, nem pagamentos/eventos/ajustes por operationId das três vendas.

Isso não prova inexistência de recriação com outros IDs. O JSON **não contém** valor, itens/quantidades completos, forma de pagamento ou identidade comercial dos clientes. Esses campos não foram inferidos. A comparação por nome/telefone/e-mail ainda depende dos payloads originais no aparelho.

Os quatro cadastros negados passam a `quarantined / customer_permission_required` **em metadados separados**. Payload, status/erro originais, IDs, tentativas e checksum continuam intactos; não podem ser descartados pelo botão de arquivamento de incidentes. As três vendas continuam em revisão manual. As quatro ocorrências históricas resolvidas não são reativadas. Esta situação não é apresentada como sete registros resolvidos: há quatro cadastros aguardando análise e três vendas em revisão.

## Canal de preservação e decisões

1. Depois de publicação autorizada, a funcionária usa o botão existente **Enviar dados para recuperação → confirmar**. Não há envio silencioso, execução ou limpeza.
2. O pacote privado de cada venda inclui o original completo e os quatro cadastros negados da mesma conta/empresa/geração, inclusive o cadastro sem venda relacionada. SHA-256 verifica o envelope; os checksums originais permanecem inalterados. Cópias locais divergentes e limite de 500 KiB interrompem o envio. Reenvio idêntico é idempotente; conteúdo conflitante fica preservado.
3. O owner vê as dependências na revisão existente e confirma **Aprovar cadastro original** individualmente. Transação valida vínculo/ator/espaço/geração, original imutável e ausência de colisões. Procura conservadoramente clientes ativos com nome normalizado, telefone ou e-mail semelhantes. Possível duplicata com outro ID **bloqueia**, sem mesclar, remapear ou decidir automaticamente. Mais de 1.000 clientes também exige análise específica.
4. Aprovar cria somente o cliente original, com saldo e contadores iniciais zero, recibo determinístico pelo operationId original e auditoria privada. Não executa a venda, estoque, recebimento ou evento de saldo. Não altera permissões da funcionária. Nome/contato ficam em coleções privadas já existentes; não são publicados ou registrados em logs.
5. **Recuperar venda original** é outra decisão explícita, individual e cronológica. Exige atestações do owner sobre entrega, pagamento já recebido fora do app e inexistência de venda recriada. Não cobra, não consulta adquirente e não inventa confirmação externa.
6. A transação revalida ausência de venda/recibo/movimentos/efeitos financeiros, ator ativo com `sales.create`, espaço, estoque e reservas atuais. Aplica os deltas aos valores atuais, nunca snapshots antigos. Preserva saleId, operationId e IDs dos movimentos. Atualiza somente contadores comerciais do cliente; saldo/financialVersion não são alterados. Cria uma venda e os movimentos previstos. Financeiro deriva da venda canônica via projetor existente e sua idempotência, conforme configuração do espaço.
7. Confirmações autenticadas de resolução são armazenadas separadamente no dispositivo, validadas por empresa/espaço/ator/IDs/hash/geração. A fila original continua preservada e não reenviável por auto/manual/reload/troca de conta. Falha ou divergência da confirmação mantém revisão pendente.
8. Validar uma venda e seus efeitos antes de seguir à próxima. Parar em qualquer divergência. Nunca usar “Reprocessar todos”.

### Limites de recuperação deliberados

Somente a forma já suportada de venda manual paga, sem pagamento integrado, Fiado, campanha ou efeitos auxiliares não reconhecidos. Contadores/deltas devem conferir integralmente. Fiado, dados cadastrais auxiliares alterados dentro da venda, saldo inicial não zero, cliente semelhante em outro ID, falta de estoque/reserva incompatível, recibo parcial ou outro efeito remoto exigem plano específico. **Ainda não se pode afirmar que as três vendas reais são executáveis** sem seus payloads completos e confirmação operacional do owner. O cadastro órfão pode ser aprovado separadamente, sem gerar venda.

## Arquivos do pacote

- Autorização e UX: `js/clientes.js`, `js/clientes-page.js`, `js/clientes-mobile.js`, `js/app.js`, `js/checkout.js`, `js/vendas.js`.
- Presença/retensão/confirmação: `js/firebase/sync.js`; imports versionados em `auth.js` e `firebase-ui.js`.
- Preservação/revisão: `js/sale-recovery-client.js`, `js/sale-recovery-ui.js`.
- Compatibilidade Online V2: `js/online-order-finalization.js`, `js/online-orders-ui.js` (pré-validação somente).
- Backend: `sale-recovery-customer.js` (novo helper), `sale-recovery-service.js`, `sale-recovery-decision.js`.
- Versão/PWA: `index.html`, `js/build-info.js`, `service-worker.js`.
- Testes e gates: arquivos V205, fixtures sintéticas, pequenos ajustes de harness legado e expectativas de versão. Nenhum dado pessoal real nos testes.

## Validação local

- `node scripts/test-v205-critical.cjs`: **256 testes aprovados** (245 + 11).
- Emulator Firestore + Storage, projeto demo local, suites `customer-recovery-v205`, `sale-recovery-decision`, `authorization-hardening`, `operational-compatibility` e `v171-online-order-sync`: **93 aprovados**.
- Inclui sete operações fictícias (quatro clientes e três vendas), sequência causal, perda de resposta, concorrência, replay, isolamento, duplicata, estoque insuficiente, financeiro uma vez, Fiado bloqueado na recuperação, protocolos owner/seller, quarentena e quatro resoluções históricas.
- Regressões V204 de hidratação/leitura e callbacks antigos passam sem mudanças no controlador de leitura.
- Harness antigo de cache falhava também na V204 intacta por ausência de `window`/consulta de resoluções; atualizado apenas no teste. Teste antigo de Rules que aceitava escrita direta de venda foi corrigido para esperar bloqueio já existente desde a V202. Regex da mensagem de escopo Online foi alinhada ao texto já publicado.
- O gate histórico que compara o artefato **V201/V202 byte a byte** não se aplica a um novo release; permanece intacto e foi substituído, para esta execução, pelo gate específico V205. Os 11 testes substantivos do canal autorizado daquela suite são executados integralmente. Não houve enfraquecimento de Rules ou remoção de testes comerciais.
- `verify-v205-release.cjs`: allowlist de alterações e pacote público de **224 recursos**, sem diagnósticos/fixtures/documentação interna. Captura e processamento comercial de fila, engines e todas as fontes não aprovadas são idênticos à V204. Geradores de proveniência aprovados.

## Publicação futura — exige autorização

1. Manter congelamento GitHub/rulesets e genealogia sanitizada; somente credencial temporária autorizada para eventual push. Não ativar Rules restritivas.
2. Publicar exclusivamente as **três Functions existentes** `submitSaleRecovery`, `listSaleRecoveryReviews`, `decideSaleRecovery`. Não há Function nova, índice, migração, alteração de Rules ou de permissões. Não republicar `commitOperationalSync`, `getOperationalSyncReceipt`, projetores financeiros ou Functions de Trocas/Fiado/cancelamentos.
3. QA do intake antigo sem dependências e novo com dependências, autorização owner/seller, aprovação sem efeitos e recuperação única sintética. Frontend V204 continua compatível com as respostas aditivas.
4. Publicar frontend/PWA V205 pela lista explícita. Smoke QA: cliente existente, novo autorizado, negado, reload, troca de conta, fila antiga intacta e envio apenas de evidência.
5. Na conta real, autorizar primeiro **somente a captura** dos três payloads e quatro cadastros. Completar inventário e conferir duplicidade, entrega e pagamento. Recuperação real continua dependendo de autorização específica, venda a venda.

## Rollback compatível

Não voltar genericamente ao frontend V204, pois isso removeria os guards e reabriria o defeito. O rollback compatível V205 mantém UI, protocolo autorizado, proteção de fila, intake, consultas, auditoria, recibos e efeitos já aplicados. Altera somente `CUSTOMER_RECOVERY_ENABLED=false` no servidor para pausar novas aprovações/recuperações com dependências e a chave do Service Worker. Não apaga ou invalida documentos, não repete decisões e não restaura dados antigos. Consultas continuam confirmando decisões já concluídas.

Usar `verify-v205-rollback.cjs <commit-candidato>` e teste de bloqueio do servidor antes de marcar o rollback pronto. Aplicação futura: redeploy de `decideSaleRecovery` com o guard pausado e, se necessário, PWA compatível; as outras Functions/Rules atuais são mantidas. Os rollbacks anteriores permanecem preservados, mas não devem ser aplicados sem avaliar o piso de segurança e novos registros.
