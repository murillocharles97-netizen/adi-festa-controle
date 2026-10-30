# V220 — Recebimentos e Central de Mensagens

Implementação local sobre a V219 sanitizada `82aab3f6caf8f019ad4888df726af465e4cc474c`. Nenhum deploy, pagamento real, alteração de permissões, consulta à fila de aparelhos, replay ou limpeza de armazenamento nesta etapa.

## Causa e comportamento final

A V219 distinguia o pagamento pendente na tela, mas `ClientesPage.paymentSuccess` ainda construía uma mensagem para o cliente com esse estado técnico. Mesmo no caminho aparentemente confirmado, a mensagem e o PNG usavam `saldoNovo` do objeto local. Esse saldo pode estar desatualizado após movimentos de outro aparelho.

A V220 substitui o compartilhamento direto por uma confirmação autenticada de leitura. Enquanto a confirmação não existe ou não pode ser consultada, a tela mostra **Aguardando confirmação**, mantém WhatsApp bloqueado e permite consultar novamente. Essa consulta não envia nem reprocessa pagamentos. O download disponível nessa situação é **REGISTRO PROVISÓRIO — NÃO COMPROVA PAGAMENTO OU QUITAÇÃO**, com valor identificado como informado.

Após confirmação remota, WhatsApp abre uma prévia editável. O operador escolhe outro modelo da mesma situação ou modifica somente aquela mensagem. Antes de compartilhar ou baixar um recibo confirmado, o sistema consulta novamente. Se o saldo, versão financeira ou identificação mudar, atualiza a prévia e exige novo clique explícito. Sem confirmação do saldo, não publica um valor estimado. Telefone local divergente do confirmado bloqueia a abertura até o cadastro atualizar. Em Clientes → Histórico/Linha do tempo, o botão Ver recebimento reabre o mesmo registro após reload, sem passar pelo formulário de um novo pagamento.

Abertura de WhatsApp, compartilhamento nativo ou cópia não cria pagamento e não marca mensagem como efetivamente enviada. Cancelamento, rede indisponível e resposta perdida preservam o registro original e restauram os controles.

## Backend: somente consulta autorizada

Atualizar **somente `getOperationalSyncReceipt`**, adicionando `kind: payment_confirmation`. Não criar Function, não republicar `commitOperationalSync` e não alterar o protocolo 1, payloads, IDs ou checksums das operações.

O novo ramo usa uma transação somente leitura para validar:

- Sessão, vínculo ativo, empresa e workspace generation pelo contexto autorizado existente.
- `customers.receiveDebt` e `customers.view`, sem conceder `financial.view`.
- Empresa, espaço autorizado, cliente, paymentId e operationId correspondentes.
- Recibo `processedOperations` processado, versão de autorização, hash e ator coerentes.
- Pagamento aplicado e evento canônico `payment_received` correspondente, com valores compatíveis.
- Saldo e versão financeira atuais do cliente no mesmo snapshot transacional.

A resposta contém apenas os dados desse recebimento/cliente, identidade comercial necessária e modelos da categoria. Não retorna listas financeiras ou dados de outro espaço. Falta de prova, documento ausente ou divergência mantém o compartilhamento bloqueado, sem reparação automática.

## Modelos corporativos

**Central de mensagens → Recebimentos** contém os originais Pagamento parcial e Pagamento total, conforme os textos aprovados. Há edição, novo modelo, escolha de padrão por situação, sete variáveis, prévia com dados fictícios e restauração explícita do original antes de salvar. O operador edita a mensagem individual sem modificar o padrão.

Variáveis permitidas: `nome`, `primeiro_nome`, `valor_pago`, `saldo_atual`, `nome_negocio`, `data_pagamento`, `forma_pagamento`. Variáveis desconhecidas/malformadas bloqueiam salvar ou compartilhar. Os modelos originais mantêm sua classificação parcial/total para não permitir quitação indevida por mudança de categoria.

Os modelos de recebimento ficam em `businesses/{businessId}/settings/default.receiptMessageTemplates`, usando **o pipeline existente de configurações**, protegido por `settings.manage` no frontend, gateway e Rules atuais. A coleção antiga `messageTemplates` utiliza `customers.edit`; reutilizá-la para administração corporativa permitiria que um editor de clientes alterasse esses modelos. Por isso a Central reutiliza a API de mensagens para listar/salvar, mas persiste esta categoria na configuração empresarial já protegida.

Os originais são defaults virtuais, sem escrita automática ao abrir a tela. Editar requer `settings.manage` e sessão válida; uso requer as permissões existentes de recebimento e consulta de clientes. Configuração carregada em outra sessão/empresa mantém o namespace do DB. O editor informa gravação local e aguarda o Sync de configurações existente, sem prometer persistência remota antecipada. A mensagem comercial usa os modelos consultados no servidor, não uma edição local ainda não sincronizada.

Recebimentos não integram os tipos de transporte em sequência. A categoria não oferece seleção de clientes/disparo; o início de sequência também rejeita explicitamente esse tipo.

## Testes finais

- **125 app/DOM/contenção aprovados**, incluindo parcial/total, pendência, consulta de leitura após resposta perdida, rede, saldo alterado em outro aparelho, saldo zero, revisão da prévia, variáveis, duplo clique, troca de usuário/empresa/espaço, telefone pendente, edição/restauração/persistência de modelos e navegação real da Central por owner/seller.
- **30 Auth/Firestore Emulator aprovados**: 19 cenários da consulta/modelos e 11 regressões comerciais V219. Cobrem owner, seller sem Financeiro, permissões negadas, escopo, IDs/hash/evento adulterados, saldo atual, persistência via settings, ausência de novas escritas comerciais e idempotência V219.
- **11 cenários Chromium aprovados**, com scripts e CSS reais: desktop 1366 px, tablet 768 px, mobile 320/390 px e viewport de 390×360; ações acessíveis, editor, prévias, estado pendente, pagamento total e nenhuma requisição externa.
- Build/lint aprovados; `node --check` dos novos arquivos; diff-check aprovado. Manifesto público com **247 recursos**, incluindo CNAME; nenhum teste, fixture, captura ou relatório é incluído.
- Rollback: patch compatível validado por `git apply --check`, com regressão de pausa do compartilhamento.

A primeira execução Emulator identificou uma chave literal de permissão montada incorretamente na fixture fictícia; foi corrigida apenas a preparação QA. O navegador real de QA identificou um seletor de binding da Central incorreto; foi corrigido e recebeu regressão DOM para owner/seller. Não foram mascaradas falhas. A bateria final está aprovada.

As capturas ficam em [galeria local](index.html). Nenhum teste utilizou registros comerciais reais. Android físico/WhatsApp externo não foi executado pelo agente; foi usado Chromium com viewports/touch e destino externo simulado.

## Arquivos

Runtime:

- `functions/src/services/payment-confirmation-read.js` (novo leitor sem escritas).
- `functions/src/services/operational-commit-service.js` (somente import e despacho do novo tipo de consulta).
- `js/receipt-messages.js`, `js/receipt-message-ui.js`, `css/receipt-messages.css`.
- `js/clientes-page.js`, `js/app.js`, `js/crm-ui.js` (recebimento em Clientes/Fiado usa a mesma confirmação e pode ser reaberto pela linha do tempo).
- `js/mensagens.js`, `js/mensagens-mobile.js`, `js/message-sequence.js` (categoria e bloqueio de sequência).
- `index.html`, `public-site.manifest.json`, `js/build-info.js`, `service-worker.js`.

QA: testes `receipt-messages-v220*`, helper, fixture, atualização do contrato de `payment-confirmation-sharing.test.js`, redirecionamento da fixture antiga, script `audit-receipt-messages-v220.cjs`, galeria/capturas e este relatório.

Sem alteração de `js/firebase/sync.js`, motor comercial, Rules, Google/OAuth, concessões reais ou Functions de recuperação.

## Plano de publicação e rollback

1. Conferir candidato isolado e base sanitizada, regras de proteção GitHub e rollback remoto antes de publicar.
2. Publicar **somente `getOperationalSyncReceipt`** e validar o novo tipo de consulta com QA autenticado. O handshake e as consultas antigas de venda/cancelamento continuam iguais para V219.
3. Publicar frontend/PWA V220; conferir Actions, domínio, 247 recursos e Service Worker. Confirmar V220 carregada nos aparelhos: uma sessão ainda na V219 conserva sua interface antiga até atualizar normalmente, sem limpeza de armazenamento.
4. Smoke QA: parcial/total, resposta perdida, consulta offline, modelo do owner em outra sessão, seller sem edição corporativa, mudança de saldo e ausência de novo pagamento.
5. Não reenviar pagamentos/filas antigas. Não executar novo recebimento do caso real para homologar mensagens.

O rollback compatível mantém a V220 e o leitor canônico, habilitando `receiptSharingPaused=true` e um novo cache estático. Suspende o compartilhamento, preserva consulta/download dos recibos, pagamentos, modelos e filas. **Não voltar ao compartilhamento inseguro da V219.** Não reverter dados ou restaurar permissões antigas. Patch em `rollback-compatible.patch`; a referência de rollback de release deve ser preservada junto ao candidato.

## Limites e riscos restantes

- Rede e prova canônica são necessárias para comunicação definitiva. Registros antigos sem recibo autorizado completo permanecem bloqueados para esse compartilhamento; não serão migrados ou presumidos confirmados.
- O saldo é o snapshot canônico da última consulta, com horário no recibo. Se mudar antes da consulta de envio, o operador deve revisar novamente. Como em qualquer comunicação externa, novas movimentações depois da abertura não podem alterar uma mensagem já aberta no WhatsApp.
- Navegadores podem bloquear pop-ups/compartilhamento nativo após a leitura assíncrona. Há fallback explícito para conversa/Web e cópia, sem registrar envio presumido; o link expira e exige nova consulta.
- A edição livre é responsabilidade do operador; o sistema valida variáveis e fornece os valores canônicos. Não tenta interpretar promessas escritas manualmente em linguagem natural.

**Preparação local aprovada. Publicação controlada autorizada separadamente pelo proprietário; resultado do deploy deve ser conferido no relatório final da publicação.**
