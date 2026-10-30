# V221 — confirmação de recebimentos e WhatsApp mobile

Base sanitizada V220: `d556e782c413c29641bb914caac05619b7f00ae1`. Implementação local; nenhum deploy ou efeito comercial real nesta tarefa.

## Pagamento real — somente leitura

Foi localizado um único pagamento correspondente ao incidente na empresa `adi-festa`, espaço `business_adi-festa`, workspace generation `0`. O cliente foi identificado pelo ID vinculado ao pagamento e conferido com o nome informado, sem selecionar por homônimo ou misturar empresas.

- PaymentId e operationId: `192daa3d-971a-4f6d-b281-756a97a7c24f`.
- Valor: **R$49,00**, Pix, pagamento total.
- Data original: **30/10/2026 às 19:23:31.738**, horário de São Paulo.
- Aplicação canônica: **19:23:35.896**; documentos atômicos criados às **19:23:35.929807**.
- Pagamento: `status=applied`, `applicationStatus=applied`, `financialAppliedAt` presente e `financialOperationId` correspondente.
- Recibo: `processedOperations` processado, autorização 1, requestHash válido e ator correspondente ao pagamento. O hash completo fica somente na evidência privada.
- Evento: um `payment_received`, valor e delta **+49**, mesma empresa, geração, cliente e operação.
- Cliente: saldo canônico **R$0,00**, financialVersion **3**; esperado anterior **R$-49,00 / versão 2**.
- Financeiro: uma rota e uma entrada `credit_payment_{paymentId}`, **4900 centavos**, Pix, direção de entrada e status pago.
- Duplicidade: um pagamento para o operationId, um pagamento para o cliente consultado, um evento de saldo e uma entrada financeira pelo sourceId. Nenhum movimento de estoque e nenhuma alocação em venda foram criados por esse pagamento; o débito era tratado pelo saldo existente.

Nenhum pagamento, evento, saldo, recibo, cadastro, permissão, fila ou cache real foi alterado. Evidências contendo IDs e metadados pessoais mínimos estão fora do repositório e do pacote público em `C:/Users/Murillo/.codex/visualizations/2026/10/30/v221-receipt-confirmation/`.

## Causa comprovada e limite da evidência

A V220 abre o modal depois de confirmar a gravação **local**, consulta a Function uma vez e conserva o resultado negativo até outro clique. O commit comercial ocorre depois, de forma assíncrona. Uma primeira resposta negativa não acompanha o commit posterior nem a atualização do Histórico. A regressão executa o código da V220 intacta e comprova que a tela permanece pendente mesmo depois de o mesmo recibo passar a existir.

No horário do incidente há uma requisição à callable iniciada às **19:23:32.300** e concluída cerca de 64 ms depois, antes da criação dos documentos às **19:23:35.929**. Para uma consulta desse pagamento nesse intervalo, a condição concreta do leitor é **`!p`**, retornando `awaiting_confirmation`; não existe pagamento canônico para validar ainda. Isso é um intervalo anterior ao commit, não inconsistência eventual do Firestore após um commit confirmado.

Há também uma requisição às **19:23:54.901**, com HTTP 200. **Os logs não incluem o tipo de chamada, parâmetros nem corpo da resposta**: HTTP 200 sozinho não comprova `confirmed=true`, e não se atribui um resultado específico à consulta vista no Android. Não há acesso ao estado em memória do aparelho nessa ocorrência. Essa limitação permanece documentada; não se exige nova tentativa comercial para investigá-la.

Todos os dados atuais do incidente foram confrontados com as condições de `paymentConfirmationRead` da V220 em execução local de leitura de snapshot: **confirmed=true, saldo=0, financialVersion=3**. Empresa, geração, espaço, ator, recibo/hash, evento, valor, nome empresarial e cliente são compatíveis. Não foi comprovado defeito de schema ou negação de autorização no servidor. **O leitor e todos os seus guards permanecem intactos.**

A apresentação contraditória também tem uma causa independente comprovada: `ActivityCenter.movementEvent` atribuía `Concluído` e sucesso a todo pagamento, sem verificar `pending_sync` ou a aplicação financeira. A V221 usa os metadados do pagamento para distinguir registrado/pendente/aplicado e atualiza a apresentação quando a coleção de pagamentos muda. O compartilhamento continua exigindo a consulta canônica, independentemente do rótulo do Histórico.

O problema dos botões foi reproduzido na cascata real de CSS: `#modal .viewport-dialog footer button` permitia `overflow-wrap:anywhere` com especificidade maior que a regra mobile de recebimentos. Com quatro ações na mesma faixa, palavras podiam quebrar dentro dos botões. A V221 usa seletores específicos para esse diálogo e hierarquia de ações própria.

## Correção implementada

- Consulta imediata e até **três novas leituras**, com intervalos de **800/1600/3200 ms**. Máximo de quatro consultas por confirmação, orçamento de dez segundos e timeout por leitura. Nenhum retry comercial ou alteração da fila.
- Interrompe em confirmação, revisão permanente, perda de permissão, fechamento ou troca de conta/empresa/espaço. Respostas tardias não publicam dados na nova sessão.
- Rede lenta/resposta perdida restaura os controles ao encerrar o limite. O usuário pode consultar novamente depois; o sistema não cria pagamento substituto.
- Após recibo confirmado, a tela mostra **Pagamento recebido**, valor destacado, cliente, forma, saldo e mensagem padrão pronta. Não exige uma tela técnica adicional para chegar ao WhatsApp.
- Ação principal **Enviar pelo WhatsApp** em largura total; editar/baixar em faixa secundária e concluir em ação discreta. Sem quebra interna de palavras. Conteúdo com rolagem, footer acessível e safe-area.
- Edição individual de texto/modelo preservada, sem modificar o padrão. Copiar mensagem sempre disponível. O contato confirmado é priorizado; sem telefone válido, compartilhamento nativo ou cópia/Web permanecem alternativas.
- Antes de abrir/copiar, revalida recibo e saldo. Se os dados mudarem, reapresenta a mensagem e exige novo toque explícito. Abrir WhatsApp não marca envio como concluído.
- Download mantém distinção de provisório/confirmado. Histórico permite reabrir o mesmo recebimento sem registrar outro.

## Testes

- **162 testes app/DOM/contenção aprovados**: baseline V220 que reproduz a espera persistente, caso de 49 Pix total, parcial, recibo antigo, resposta perdida, limites/timeout, rede, permissão negada sem loop, alteração de saldo, reabertura, troca de sessão/empresa/espaço, status do Histórico, modelos V220 e regressões V219.
- **33 Auth/Firestore Emulator aprovados**, incluindo a forma real de pagamento integral de R$49, versão financeira 2→3, saldo -49→0, consulta antes/depois do commit, recibo/evento únicos, retry comercial idempotente somente em QA, histórico antigo, rejeição de ID/ator adulterado e os 30 cenários V219/V220 anteriores.
- **19 cenários Chromium aprovados** com todos os estilos reais do index: 320, 360, 390, 430, 412, 768 e 1366 px; editor com viewport baixa de teclado; passagem automática de pendente a confirmado após dois segundos; alteração de saldo requer novo toque; rede indisponível libera os botões. Zero requisições externas e zero pagamentos criados.
- **11 cenários Chromium de compatibilidade V220 também aprovados**, incluindo administração dos modelos e leitura de recibos com a nova navegação.
- Capturas e demonstração navegam somente sobre dados fictícios. Não foi executado teste em Android físico ou PWA fisicamente instalado nesta etapa. A validação automatizada cobre viewport/touch, altura reduzida e o CSS com safe-area; não é declarada equivalente ao teste no aparelho.
- Lint/build, manifesto público e diff-check integram o preflight do candidato.

## Escopo e arquivos

Frontend: `js/receipt-messages.js`, `js/receipt-message-ui.js`, `css/receipt-messages.css`, `js/activity-center.js`, `js/crm.js`, `index.html`, `js/build-info.js` e `service-worker.js`.

QA: `tests/receipt-confirmation-v221.test.cjs`, `tests/emulator/receipt-confirmation-v221.cjs`, `tests/fixtures/receipt-confirmation-v221.html`, `scripts/audit-receipt-confirmation-v221.cjs`; helper, testes e auditoria de navegador V220 atualizados para a nova navegação; relatório/galeria/capturas.

**Somente frontend/PWA para publicação. Nenhuma Function precisa ser republicada.** Nenhuma alteração em Firestore/Storage Rules, OAuth/Google, permissões, motor financeiro, Fiado, Trocas, recuperação, protocolo de Sync, recibos ou payloads/erros originais.

## Publicação e rollback compatível

1. Conferir base V220 publicada, candidato, diff, allowlist e dois rulesets GitHub ativos.
2. Publicar somente frontend/PWA V221 após autorização específica. Não publicar Functions ou Rules.
3. Conferir Actions, domínio, assets e cache `veconi-v221-receipt-mobile`.
4. Smoke de leitura/renderização e QA fictício. Não registrar outro pagamento comercial para validar o caso real.
5. No aparelho, atualizar normalmente/reabrir sem limpar armazenamento e usar **Clientes → Histórico/Linha do tempo → Ver recebimento** no registro já existente. Conferir a mensagem e o destinatário; nenhuma nova cobrança ou confirmação de pagamento é necessária.

Rollback compatível mantém o leitor seguro, recibos, modelos, credenciais e filas; pausa somente o compartilhamento com `receiptSharingPaused=true` e cache próprio. Não desfaz pagamentos, não restaura snapshots e não retorna ao compartilhamento otimista. Patch em `rollback-compatible.patch`, com regressão de pausa já existente; commit/tag local do rollback acompanham o candidato quando preparados.

## Riscos e pendências

- Se o commit levar mais que a janela limitada, a tela continuará pendente com consulta manual posterior. Isso não significa perda de pagamento.
- Documentos antigos sem comprovantes suficientes continuam recusados. Não são migrados nem presumidos confirmados.
- Novas movimentações depois da abertura do WhatsApp não podem atualizar uma mensagem já aberta fora da VECONI. A consulta é feita antes de abrir e o saldo é identificado com horário no recibo.
- Teste físico no S24 Ultra, Chrome/PWA e WhatsApp externo permanece pendente. Deve usar o recebimento existente, sem novo lançamento.

**Candidato local. Nenhum push, deploy, replay ou correção de dados reais foi executado.**
