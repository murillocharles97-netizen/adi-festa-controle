# V222 — confirmação de recebimentos e recibos do Histórico

Base sanitizada: V221 `f9770a669d55132e1514cf47a1269c7fead5a4ff`. Implementação exclusivamente frontend/PWA, local, sem deploy. A interface aprovada da V221 e seu CSS foram preservados.

## Causas e evidências

**Espera depois do commit:** `Fiados.receiptAttempt.confirm()` aguarda `DB.flush()`, que confirma persistência local. O modal pode abrir antes do commit remoto. O Sync agenda o trabalho com debounce de 500 ms; também verifica sessão/protocolo antes do envio. Esses caminhos comerciais não foram modificados. A V221 consulta imediatamente e depois espera 800/1600/3200 ms, mesmo se o pagamento original já tiver sido confirmado no meio do intervalo.

O pipeline existente chama `markLocalPaymentConfirmed`, remove a operação concluída e emite `firebase-sync-status` por `saveQueue/updateQueueState`. Posteriormente a hidratação também emite `cloud-data-updated`. A V221 não usa esses sinais para acordar a leitura do recibo. A espera extra foi reproduzida executando os scripts da V221 publicada e os scripts novos no mesmo Chromium, com a mesma latência e o mesmo horário de commit fictício.

**Recibo antigo:** no Histórico geral da V221, o detalhe de pagamento usa `genericDetail`, que oferece abrir Clientes, não o recibo diretamente. O botão existente na linha do tempo depende de `DB.pagamentos` e do cliente completo em cache; `openExisting` recusa a abertura antes da consulta se faltar essa hidratação. A regressão demonstra essa recusa mesmo quando o leitor canônico confirma o recibo. A V222 acrescenta a ação específica no Histórico e não exige a cópia local para consultar os identificadores originais.

**Caso real consultado somente para leitura:** um pagamento de R$49 Pix, um `processedOperation`, um evento de saldo e uma entrada financeira de 4900 centavos; saldo atual zero, versão financeira 3. Pagamento, cliente, evento e recibo conservam as versões documentais originais. O evento canônico de Histórico existe e contém paymentId, operationId, cliente, empresa, espaço e geração corretos. O leitor backend atual, executado sobre esses snapshots, confirma o recibo. Nenhuma alteração de schema ou autorização do servidor se mostrou necessária.

Não existe captura da memória/erro ou resposta autenticada original do Android nessa reabertura. Portanto, os defeitos de navegação/hidratação são comprovados no código e em QA, mas não se atribui silenciosamente um desses ramos à sessão física do aparelho. A validação física da abertura específica poderá ocorrer depois da publicação, sem outro lançamento.

Os timestamps preservados do caso real mostram cerca de 4,192 s entre a data registrada pelo dispositivo e a criação atômica dos documentos. Isso não separa persistência local, agendamento, autenticação e execução; também envolve relógios distintos. Logs anteriores mostram uma leitura antes do commit e latência HTTP de aproximadamente 64 ms, sem tipo/parâmetros/corpo da callable. Não se inventam durações ausentes ou um resultado a partir de HTTP 200.

## Tempos medidos em QA

Chromium real, scripts V221 fixados pelo commit, resposta canônica simulada de 80 ms. O mesmo sinal do pipeline é emitido nas duas versões. Tempos da abertura à mensagem pronta no DOM; nenhum pagamento criado e nenhuma chamada externa. A coluna após commit isola a espera que esta correção consegue eliminar.

| Commit fictício após abertura | V221: mensagem pronta | V222: mensagem pronta | Espera após commit V221 → V222 | Consultas V221 / V222 |
|---|---:|---:|---:|---:|
| 250 ms | 1033 ms | 335 ms | 771 → 85 ms | 2 / 2 |
| 1500 ms | 2657 ms | 1585 ms | 1156 → 85 ms | 3 / 3 |
| 3600 ms | 5945 ms | 3684 ms | 2344 → 83 ms | 4 / 4 |

Essas medições estão em `screenshots/RESULT.json`. São cenários controlados, não um SLA de produção. O momento do commit comercial não é antecipado: elimina-se a espera artificial posterior. Um recibo já aplicado é consultado imediatamente, sem backoff inicial.

## Correção

- Escuta os eventos existentes sem alterar `js/firebase/sync.js`, filas, envelopes, protocolo ou `Fiados`.
- Só uma transição do pagamento exato, no mesmo usuário/empresa/geração e com IDs compatíveis, acorda a consulta. O sinal e o cache nunca são comprovação financeira: a liberação depende do mesmo `getOperationalSyncReceipt(kind=payment_confirmation)` autenticado e de todos os seus guards.
- Mantém os intervalos de fallback, limite de quatro leituras por rodada, timeout por leitura e orçamento de dez segundos. Um único sinal tardio correspondente pode abrir outra rodada limitada após a inicial; no máximo oito leituras automáticas por abertura. Sinais repetidos/genéricos não criam loop. Consultar novamente é sempre leitura explícita.
- Sinais durante uma consulta ainda em andamento não são perdidos. Fechamento, substituição do modal ou mudança de escopo interrompem/isolam respostas antigas.
- O estado pendente mantém aviso compacto, WhatsApp protegido e permite Concluir/Fechar imediatamente. Sair interrompe somente a leitura, nunca o pagamento original.
- Histórico → recebimento → Ver recebimento passa paymentId, operationId e clientId. A consulta não precisa hidratar ou gravar dados no cache. O servidor confere os identificadores; faltas ou divergências não viram confirmação inventada.
- Retorno preserva o contexto do Histórico. O caminho da linha do tempo continua funcionando. Registros legados sem prova permanecem pendentes/em revisão. Um provisório sem valor local não inventa zero.
- Layout, modelos parcial/total, editor, cópia, WhatsApp e download da V221 preservados. Antes de copiar/compartilhar/baixar, o saldo canônico é revalidado; uma alteração exige nova prévia. Nenhuma ação afirma envio concluído pelo WhatsApp.

## Validação

- 155 testes app/DOM/contenção: baseline V221, sinais rápidos e tardios, corrida entre resposta e sinal, sinal falso, orçamento sem loop, pagamento antigo sem cache, dados conflitantes, troca de conta/empresa/espaço/permissão, fechamento, parcial R$250/saldo R$247, mensagem/recibo provisório e regressões V219–V221.
- 33 testes Auth/Firestore Emulator reaproveitados e aprovados: contratos reais de owner/seller, pagamento total R$49 com versão 2→3, parcial, recibo antigo, resposta perdida, idempotência, saldo alterado em outro dispositivo, hash/evento/status/ator incorretos e isolamento. Nenhuma Function foi modificada.
- 13 cenários Chromium novos, incluindo três pares de desempenho, 320/360/390/430/412/768/1366 px, Histórico sem cópia local, download e retorno, parcial R$250, resposta perdida, confirmação tardia e saída em rede lenta.
- 19 cenários Chromium V221 de compatibilidade aprovados: editor/teclado, saldo atualizado exigindo novo toque, erro de rede e geometria mobile. Zero chamadas externas, zero pagamentos criados nos cenários DOM/browser.
- Lint de sintaxe integrado ao build aprovado; pacote público e diff-check verificados no fechamento do candidato. A homologação física da V221 informada pelo usuário foi preservada; V222 ainda não está instalada no aparelho.

## Arquivos

Runtime: `js/receipt-messages.js`, `js/receipt-message-ui.js`, `js/activity-center.js`, `js/build-info.js`, `index.html`, `service-worker.js`.

QA: `tests/helpers/receipt-messages-v220.cjs` (opção de timers reais), `tests/receipt-latency-v222.test.cjs`, `scripts/audit-receipt-latency-v222.cjs`, esta documentação e capturas fictícias.

Intactos: Functions, Firestore/Storage Rules, CSS aprovado, permissões, Google/OAuth, Sync comercial, Fiados, saldos, estoque, recuperação, payloads/checksums, cache e filas reais. Evidências reais ficam somente no diretório privado fora do repositório e da publicação. O allowlist público não inclui QA/documentação/fixtures.

## Publicação e rollback

Publicar somente frontend/PWA após autorização específica. Nenhuma Function ou Rule precisa ser publicada. Conferir candidato/ancestralidade sanitizada, allowlist, rulesets ativos, Actions, domínio e Service Worker `veconi-v222-receipt-read-latency`. Não reprocessar operações para fazer smoke.

Rollback compatível desativa somente os sinais de antecipação (`receiptSyncHintsPaused=true`), retorna à consulta limitada por intervalos e mantém a abertura canônica de recibos pelo Histórico, todos os guards, pagamentos, modelos, provas e filas. Tem cache próprio. Nenhum dado é restaurado, apagado ou migrado; os rollbacks anteriores permanecem disponíveis.

Smoke após publicação: abrir o recebimento já existente pelo Histórico e baixar o mesmo recibo; conferir saldo/data/cliente, edição/cópia e WhatsApp mediante toque. Não registrar outro pagamento. Teste físico Android/PWA com conectividade normal/lenta verifica somente navegação e consultas.

## Riscos restantes

- Rede/servidor lentos continuam limitando a confirmação real; um sinal local nunca libera a mensagem sozinho.
- Sem sinal correspondente, usa-se o fallback limitado ou a leitura posterior pelo Histórico.
- Evidência legada incompleta permanece protegida. Corrigir essa situação exigiria diagnóstico específico, não uma migração automática.
- Sem a resposta original do Android, não se declara reproduzida a condição exata de cache daquele aparelho. Os caminhos conhecidos falhos foram reproduzidos e corrigidos; nenhuma tentativa comercial é necessária para validar a abertura depois do deploy.

GO técnico para preparar a publicação; deploy depende de autorização do proprietário.
