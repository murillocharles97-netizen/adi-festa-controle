# V159 — Payment Engine V1 / terminal simulado

## Escopo e segurança operacional

Somente MockPaymentProvider; nenhuma integração, credencial ou SDK novo de Cielo,
Mercado Pago ou PagBank. O stub Cielo preexistente permanece desativado.

**Simular aprovação não cobra cartão, mas conclui uma venda real no negócio
selecionado e movimenta estoque/Histórico.** Usar produto/carrinho de teste
controlado. Não há estorno nesta V1; o cancelamento comum de venda integrada é
bloqueado. Nenhuma venda ou alteração financeira de produção foi usada no QA.

Rollback identificado antes da publicação: V158,
`c6d0016265f66f598d50f0daf8ea6ab0d047ddc6`. Um rollback completo também precisa
considerar Functions e Rules, não apenas os arquivos do GitHub Pages. Não apagar
intents, recebíveis ou vendas já criados. URL:
https://murillocharles97-netizen.github.io/adi-festa-controle/

## Arquitetura e modelo

- UI → serviço central de pagamentos → registry/contrato → MockPaymentProvider.
- `businesses/{businessId}/paymentTerminals/{id}`: provider, nickname, status,
  active, capabilities, `spaceAccess=all_spaces|selected_spaces`, allowedSpaceIds.
- `businesses/{businessId}/paymentIntents/{id}`: business/space/actor, checkoutId,
  saleId, snapshot normalizado do carrinho, cartFingerprint, amountCents/BRL,
  método crédito/débito, terminal/provider, IDs do provider, tentativa/key,
  timestamps, estado e finalização. Valores monetários da cobrança em centavos.
- `paymentCheckoutLocks/{actorUid}`: bloqueio transacional entre abas/dispositivos
  para impedir duas intenções ativas do mesmo operador.
- `paymentIntents/{id}/events`: eventos com IDs determinísticos; transições
  críticas persistidas junto ao estado na mesma transação.
- `paymentReceivables/{intentId}`: um recebível por aprovação finalizada, ligado
  à venda; grossAmountCents, fee/net null, pending_settlement e isTest.
- Contrato existente: createPayment, getPaymentStatus, cancelPayment,
  refundPayment e extensões de pairing/webhook/health. UI usa estados normalizados;
  não usa status de adquirentes. Mock também usa esse contrato.

Estados wire compatíveis com a base existente:
`created → awaiting_terminal → processing → approved|declined|cancelled|expired`.
`pending_confirmation` representa UNKNOWN. Erro de rede/timeout não autoriza uma
segunda cobrança. Consultar novamente ou obter cancelamento confirmado. Estados
finais não podem ser ressuscitados por um callback comum.

Cada tentativa recusada fica preservada. Nova tentativa recebe nova chave;
duplo toque/reload reutiliza a tentativa persistida. Apenas aprovação do backend
permite concluir a venda.

## Pipeline canônico, Financeiro e recuperação

Reutiliza `Checkout → Repositories.saleRepository().create → Vendas.registrar`:
estoque, campanhas, cliente, sync transacional/idempotente e projeção de Histórico
existentes. Não foi criado outro checkout por provider. Sale mantém
paymentIntentId, provider, terminalId, actorUid, spaceId e operationId estáveis.

`payments/pagamentos` é recebimento de dívida/fiado, não pagamento de cartão.
Não inserir um cartão nessa coleção evita liquidar dívida indevidamente. O
pagamento integrado é a intenção aprovada + recebível único relacionado à venda.
Cartão não vira saldo bancário disponível; taxa e líquido desconhecidos são null.

Antes do provider, a tentativa é persistida no IndexedDB existente
`veconi-local-records / records`, chave `payment-attempt:<business>:<uid>`.
Somente o carrinho da tentativa atual, sem coleções empresariais em localStorage.
Recuperação consulta intents ativos do operador, inclusive APPROVED sem venda;
restaura o carrinho e consulta status. Offline não inicia cobrança integrada;
as formas normais continuam com as regras anteriores.

Finalização usa claim de 60 segundos, ID de venda/operationId determinísticos,
consulta da venda canônica antes de reaplicar e confirmação da gravação remota.
O backend só reconhece conclusão após verificar a venda remota: ID, intenção,
valor, espaço, operação e actor. Carrinho só é limpo após essa confirmação.
Falha após aprovação deixa finalização pendente: recuperar, nunca cobrar de novo.
Após queda durante claim, outra sessão pode precisar aguardar até um minuto.
A recuperação que conclui a venda preserva e exige o operador original.

Auditoria manual na configuração sinaliza pagamento aprovado sem venda e venda
integrada sem aprovação correspondente. Cobertura limitada e declarada: até 10
aprovações pendentes e 25 vendas recentes; não é uma varredura histórica completa.

## Permissões e validação

Backend verifica Auth/membership ativa, permissão sales.create, business,
espaço do funcionário, terminal autorizado/ativo, capacidades, soma do carrinho,
produtos existentes/ativos e vínculo empresarial. Preços seguem o snapshot de
checkout autorizado, incluindo preço manual/campanha existente; não foi criado
um segundo motor de precificação server-side nesta fase.

Rules negam escrita frontend em intents/terminais/recebíveis, aprovação forjada,
venda integrada sem intent aprovada e cancelamento comum de venda integrada.
Uma venda deve corresponder ao ID/amount/operação/actor/espaço aprovados. Não é
uma nova validação server-side de todas as linhas de estoque/preços da plataforma.
Antes de ativar adquirente real, exigir validação e reconciliação confiáveis do
adapter/webhook, inclusive o vínculo do carrinho final com o draft aprovado.

Mock permitido somente em emulador, Adi Festa com plano interno, ou flags de
negócio explicitamente administradas no backend. A configuração enviada pelo
cliente não habilita mock. Flags protegidas pelas Rules. Consulta somente-leitura
confirmou `adi-festa` no plano `internal`; nenhuma flag de produção foi alterada.

## Reads e retenção

Sem listener global de histórico de intents. Listener apenas da operação atual.
Setup de checkout cacheado por 30s; startup/recovery tem query limitada a 10
intents ativos do operador. Criação lê contexto, espaço, terminal e produtos do
carrinho; conclusão consulta a venda. Auditoria pesada apenas ao abrir a tela
de terminais com audit explícito. Não há estimativa fictícia de reads medidos em
produção. Intents/eventos/recebíveis permanecem auditáveis; tentativa IndexedDB
local é removida somente após desfecho seguro/conclusão.

## Validação local/emulador

- 551 testes unitários do app; 92 unitários backend; 106 testes de Rules: passaram.
- API Functions: duplo clique/chave, concorrência, recusa, aprovação duplicada,
  cancelamento, timeout/rede, terminal inativo, valor inválido, seller/espaços,
  isolamento empresarial, claim/ack e recebível idempotente: passaram.
- App real contra Auth/Firestore/Functions locais: login owner, cadastro do
  terminal, checkout R$25, recusa preservando carrinho/estoque, aprovação com uma
  venda e recebível, estoque 20→19; callback duplicado mantém 19; fechar página e
  reabrir/reload recupera a mesma intent; falha após aprovação e retry cria apenas
  outra venda, estoque 19→18. Timeout mantém cobrança desconhecida.
- Smoke: Home, venda normal, fiado, receber, Clientes, WhatsApp individual,
  sequência de três contatos, Financeiro, Histórico, Equipe/modal, sincronização,
  sessão após reload, IndexedDB e convergência de dois contextos isolados: passaram.
  Queue final pending=0/errors=0; integridade concluída.
- Layout 320/360/375/390/412/430 e desktop; suite desktop-selling, terminal browser,
  manifest/assets/service-worker PWA: passaram. Lint/build/diff-check passaram.
- WhatsApp externo foi simulado, sem envio real. Dois contextos são teste
  multidispositivo automatizado, não dois aparelhos físicos. Android/PWA físico
  com o usuário permanece pendente; não considerar validado por Chromium.

## Evidências

Capturas do app no emulador em `artifacts/payment-engine-v1/`:

- A-integracoes.png / B-terminal-cadastrado.png
- C-checkout.png / D-aguardando-320.png até D-aguardando-430.png
- E-aprovado.png / E2-venda-concluida.png / F-recusado.png
- G-recovery-reload.png / G2-recovery-reopened.png
- H-approved-without-sale.png / results.json

Capturas não contêm dados de clientes reais. Logs de teste estão em
`artifacts/payment-engine-*.log`; não incluem credenciais. APP_VERSION=159,
SW cache=`veconi-v159-payment-engine`. Commit e resultado efetivo do deploy são
informados no fechamento da entrega, após confirmação das plataformas.

## Arquivos centrais

Backend: terminal-payment-service, provider-registry, novo payment-state-machine
e providers/mock-provider. Segurança: firestore.rules. App: terminal-payments,
checkout, checkout-mobile, desktop-sales, vendas, activity-center, firebase/sync.
Recibo: identificação SIMULADOR e pendência consultada pela própria venda, não
por qualquer item da fila global. UI: css/terminal-payments.css. Release: index, build-info, service-worker e imports
versionados auth/firebase-ui. Testes: terminal engine/functions/Rules, script E2E,
fixture visual e asserts de cache/versionamento. Nenhuma mudança no visual de
Equipe, no comparador de integridade ou na arquitetura IndexedDB V156.

## Roteiro físico

Configurações → Integrações e maquininhas → Adicionar terminal. Criar Terminal de
teste VECONI e autorizar o espaço desejado. Montar carrinho controlado de R$25 →
Maquininha integrada → terminal → enviar. Primeiro testar recusa e conferir
carrinho preservado. Depois aprovação e conferir uma venda/estoque/Histórico.
Repetir com reload/fechar PWA durante processamento: deve recuperar sem nova
cobrança. Qualquer APPROVED pendente deve ser recuperado, nunca cobrado de novo.
