# UX V203 — preparação local sobre a V202 sanitizada

Base: `c80da0fffb0106aea4d23cf097ee33896522f07c`, checkout `C:/Users/Murillo/Documents/VECONI-Sanitized-20261024`.

Não houve commit, deploy, autenticação em produção, alteração comercial, alteração de permissões, limpeza de cache/fila/IndexedDB ou ativação de Rules. O navegador de QA usa perfil separado, dados fictícios e bloqueio de requisições externas. A prévia do login não foi integrada ao login real.

## Diagnóstico e correção

| Área | Causa confirmada | Correção local |
| --- | --- | --- |
| Venda concluída | No desktop, o modal inteiro tinha `max-height` com `overflow:auto`: as ações faziam parte da rolagem extensa. No mobile, havia uma segunda rolagem limitada dentro da lista de itens. A reprodução usa 45 itens fictícios; o rodapé inicial da V202 fica fora da área visível. Não foi recebido vídeo nesta etapa. | Shell limitado ao viewport visível, uma área principal de rolagem e rodapé separado. VisualViewport acompanha tamanho/deslocamento, com fallback `dvh`, padding de safe area e quebra dos botões. Foco contido, Escape e região rolável acessível por teclado. A impressão não limita as linhas à altura da tela. |
| Trocas e cancelamentos | Formulários e rodapés estavam dentro de estruturas longas; no caso de Trocas, um rodapé sticky ainda dependia da posição do formulário no scroll. | Mesmo shell opt-in, campos roláveis e rodapé no formulário original, fora da área de rolagem. Elementos são movidos sem clonar controles, trocar IDs ou alterar listeners/validação. Revisar/editar Troca também foi testado em DOM real. |
| Recebimentos | Confirmação e cadastro de telefone tinham limite de altura, mas não um contrato comum de rolagem do conteúdo. | Shell opt-in, corpo rolável e ações da confirmação acessíveis. Compartilhamento, telefone, recibo e efeitos financeiros permanecem nos handlers existentes. |
| Aviso do Dashboard | `ownerArea` tornava o aviso permanente no Início/Histórico, mesmo com zero operações locais. A contagem de originais preservados não descontava metadados de resolução já verificados. | Histórico confirmado não dispara aviso. Pendência real usa aviso compacto. Situação remota é consultada pelo canal autenticado existente, com paginação até confirmar ausência de pendências. Falha, paginação inconclusiva ou hash/contexto divergente não são tratados como resolução. |
| Login/carregamento | Etapa de proposta visual solicitada antes de qualquer integração. | Prévia independente escura/turquesa: desktop dividido, mobile centralizado; e-mail/autofill, senha visível, recuperação com resposta genérica, carregamento e falha recuperável. Sem Auth/backend/storage ou timers que inventem sucesso. |

## Comportamento do aviso

- Sem revisão local não confirmada e sem revisão remota pendente: nenhum banner no Dashboard.
- Revisão real: “Há vendas aguardando revisão”, com botão “Revisar vendas”.
- Original local não confirmado: “Há X vendas aguardando análise”, mantendo envio explícito.
- Consulta indisponível: “Revisões: confirmação pendente”. Nenhuma operação é reenviada.
- “Revisões de vendas · em revisão e resolvidas” continua acessível no Histórico, mesmo sem banner.
- Resolução local só é excluída da apresentação com metadados já verificados pelo Sync e correspondência de checksum, operação, empresa, ator, geração, venda e espaço. O pacote e os metadados não são escritos pela nova apresentação.
- Consulta remota somente para owner autorizado no Início/Histórico. Cache apenas em memória por sessão/papel/espaço, até 60 segundos; atualização quando visível, por foco, conexão e eventos existentes. Respostas antigas não são aplicadas a outro contexto. Nenhum contador ou alerta próprio do Sync foi alterado.

## Testes finais

| Bloco | Resultado |
| --- | --- |
| Testes direcionados Node/DOM existentes + novos | 148 aprovados, 0 falhas |
| Auditoria Chromium isolado | 62 cenários aprovados, 0 falhas — detalhes em `results.json` |
| Lint e build | Aprovados |
| `git diff --check` | Aprovado |
| Contenção pública V199 | Testes incluídos nos 148; lista explícita de publicação permanece intacta |
| Auth, Functions, Rules, Sync, checkout, Fiado, business-cache e permissões | Sem alteração no diff contra a base |

Comandos reproduzíveis:

```text
node --test tests/sale-completion.test.js tests/sale-recovery.test.js tests/sale-recovery-access.test.js tests/payment-confirmation-sharing.test.js tests/sale-cancellation-ui.test.js tests/sale-cancellation-dom.test.cjs tests/sale-exchanges.test.js tests/sync-recovery-resolution.test.js tests/ux-v203.test.cjs tests/public-site-containment.test.cjs tests/static-containment-worker.test.cjs
node scripts/audit-ux-v203.cjs
npm run lint
npm run build
git diff --check
node scripts/preview-ux-v203.cjs
```

### Cobertura do navegador

- Recibo extenso em desktop 1920×1080, notebook 1366×768, compacto 1024×600 e tablet 768×1024; reflow equivalente a 100%, 125%, 150% e 200%.
- Mobile 320, 360, 390 e 430 px. Mudança de zoom mantendo o mesmo modal aberto.
- Rodapé visível antes/depois do scroll; nenhuma rolagem horizontal indevida; itens e valores originais intactos.
- Compartilhar/editar com redução do viewport para teclado; foco contido, Escape e retorno ao recibo.
- Impressão com todas as 45 linhas; canvas e mensagem de WhatsApp preservados, sem enviar mensagem real.
- Trocas: revisão/edição, formulário original e rodapé; cancelamento: seletores, motivo e confirmação. Nenhuma confirmação comercial real.
- Recebimento e formulário de telefone: teclado/viewport reduzido, sem gravar telefone nem duplicar pagamento.
- Dashboard: resolvido, pendente, falha, paginação vazia intermediária, original local, hash divergente, reload e resposta obsoleta após troca de usuário/espaço. Somente chamadas de leitura.
- Login: estados em todas as larguras, labels/autofill, mostrar/ocultar senha, erro humanizado, recuperação, redução de movimento e contraste AA das principais cores de texto/ação.

Limite honesto: zoom foi validado como reflow do viewport CSS com densidade correspondente no Chromium, não por automação dos menus do Chrome do usuário. Teclado foi simulado por redução do viewport. Android/iOS físicos, teclado real, barras dinâmicas e insets físicos não foram exercitados. A implementação usa VisualViewport e `env(safe-area-inset-*)`; recomenda-se uma conferência física curta antes da publicação. Não é uma certificação completa de acessibilidade.

## Arquivos alterados

### Interface operacional (7 arquivos)

- `css/style.css`: shell e rolagem opt-in, safe area, responsividade e impressão.
- `css/sale-recovery.css`: aviso compacto e acesso no Histórico.
- `js/recibos.js`: markup do recibo/compartilhamento, viewport e foco; helper de layout.
- `js/clientes-page.js`: classes/layout da confirmação de recebimento; handlers comerciais intactos.
- `js/sale-cancellation.js`: uma chamada ao helper de layout; guards e fluxo canônico intactos.
- `js/sale-exchanges.js`: uma chamada ao helper de layout; transação, crédito e efeitos intactos.
- `js/sale-recovery-ui.js`: apresentação de revisões, consulta autenticada de leitura e validação dos metadados confirmados, sem modificar a fila.

### Prévia, testes e evidências (não entram no deploy público)

- `tests/fixtures/login-v203.html`, `.css`, `.js`.
- `tests/fixtures/receipt-viewport-v203.html` e `recovery-notice-v203.html`.
- `tests/ux-v203.test.cjs`.
- `scripts/audit-ux-v203.cjs` e `scripts/preview-ux-v203.cjs`.
- Este relatório, `index.html`, `results.json` e `screenshots/` nesta pasta.

## Proposta de publicação — ainda NÃO autorizada/executada

V203 UX, somente frontend/PWA: correção dos modais e do aviso de revisões. O redesign do login fica exclusivamente em prévia até aprovação visual e autorização separada de integração. `build-info`, Service Worker e versão publicada continuam V202 neste checkout; o bump final e o pacote de release serão preparados somente após aprovação.

Nenhuma mudança de Functions, Rules, permissões, protocolo de Sync ou dados. A ativação das Rules restritivas V202 continua sendo uma demanda separada, dependente da confirmação dos aparelhos e de autorização explícita.

Rollback de interface proposto: frontend V202 `c80da0f`, preservando integralmente o piso de autorização, Functions, Rules, recibos e dados existentes. Nenhuma restauração de caches ou genealogia antiga é necessária. Não houve push nem alteração das proteções do GitHub.
