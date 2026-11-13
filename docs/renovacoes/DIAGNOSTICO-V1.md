# Renovações — diagnóstico e proposta (frente V1)

Base: `origin/main` em `a44a49a` (já inclui a Central de Mensagens v2, `961db01`).
Branch: `claude/renovacoes-v1`, sem push.

## 1. O que já funciona

| Área | Onde | Estado |
|---|---|---|
| Produto recorrente (vigência, rótulo, lembretes 7/1/0, mensagem) | `js/product-images.js` (form), `js/integrity.js` | ok |
| Ativação e renovação na venda, idempotentes, com política versionada (v1), âncora de calendário SP, troca de plano/preço | `CustomerSubscriptions.applySaleInData` + espelho `functions/src/shared/engagement-domain.js` | ok, bem testado |
| Desfazer venda restaura a vigência anterior | `reverseSaleInData` | ok |
| Pausar / reativar / cancelar com eventos | `changeStatus` → `customerSubscriptionEvents` | ok |
| Ação "Renovar" a partir do perfil (fixa a vigência, confere espaço/snapshot) | `crm-ui.js` → `Checkout.prepareRenewal(id)` | ok |
| Lembrete individual por WhatsApp (texto automático) | `crm-ui.js renewalMessage` | ok |
| Consultas limitadas (≤50) por cliente/status/vencimento/renovadas | `SyncFirebase.queryCustomerSubscriptions`, `queryRenewalsForSpace` | ok |
| Isolamento por espaço na leitura | `SpaceContext.showsRenewal / showsUnassignedRenewal`, `CustomerSubscriptions.view.*` | ok |
| Escrita só pelo servidor | `firestore.rules`: `customerSubscriptions` e `...Events` com `create/update: false` | ok |
| Alerta na Home (hoje / 7 dias) e filtro "renovação" em Clientes | `home-mobile.js`, `clientes-mobile.js` | ok |
| Segmentos CRM (renovação em 7 dias, perdida, renovou recentemente) | `crm-segment-engine-v2.js`, `engagement-segments.js` | ok |

## 2. O que falta

1. **Não existe tela de Renovações.** As vigências só aparecem por cliente (perfil) ou como contagem na Home. Não há lista operacional "quem vence hoje / na semana / venceu / renovou".
2. **"Hoje" depende do fuso do aparelho.** `metrics()`, `homeMetrics()` e `loadDashboardMetrics()` usam `setHours(23,59,59)` local, enquanto o cálculo de vigência usa o dia civil de São Paulo. Um vencimento às 23:30 SP aparece como "amanhã" num aparelho em UTC. (Não alterado nesta entrega; a nova função `board()` já usa o dia civil SP.)
3. **Renovadas recentemente não tem indicador** (só a consulta `loadRecentlyRenewed`).
4. **Lembretes configurados (`reminders: [7,1,0]`) não são usados por nada.** São gravados no produto/vigência, mas nenhum fluxo os lê.
5. **Sem lembrete em lote.** A Central v2 já aceita público pré-selecionado, mas não há tipo/modelo "renovação" (`SEQUENCE_TYPES = charge|campaign|notice|custom`).
6. **Busca por cliente/plano só existe na lista de clientes**, não sobre as vigências.
7. Contas sem espaço (`scopesCustomers() === false`) leem no máximo 50 por consulta; uma tela completa vai precisar paginar por `expiresAt`.

## 3. Proposta de tela (protótipo: `docs/renovacoes/prototipo-renovacoes.html`)

- Rota nova `#/renovacoes` (ou aba dentro de Clientes no mobile), protegida por `TeamAccess.canRoute('clientes')` e pelo recurso de plano `customerSubscriptions`.
- Busca única: cliente, telefone (≥3 dígitos) ou plano, sem diferenciar acentos.
- Indicadores clicáveis que também são filtros: **Vencem hoje · Próximos 7 dias · Vencidas · Renovadas (30 dias) · Ativas**. No mobile viram um carrossel horizontal com snap; em 320 px a linha vira cartão de 3 faixas.
- Cada linha: cliente, plano + valor contratado + data, selo de prazo ("Vence hoje", "Em 3 dias", "Venceu há 9 d"), e ações **Renovar** (`Checkout.prepareRenewal(id)`, o fluxo atual), **Lembrar** (WhatsApp individual atual) e **Perfil** (`CRMCliente` atual).
- Barra de ação em lote: "N clientes em Vencem hoje → Lembrar todos" abre a Central.
- Painel lateral: previsão de receita dos próximos 7 dias (já calculada como `forecastValue`).

## 4. Integração com a Central de Mensagens (planejamento — sem novo motor)

1. A tela chama `CustomerSubscriptions.view.board()` e usa `clientIds[bucket]` (já deduplicados).
2. "Lembrar todos" → `MobileMessages.openCenter({ type: 'campaign', clientIds })`. Funciona hoje, sem mudar a Central.
3. Passo seguinte (pequeno): incluir `'renewal'` em `SEQUENCE_TYPES` e um modelo padrão com variáveis `{plano}`, `{vencimento}`, `{valor}`, reaproveitando `renewalMessage()` de `crm-ui.js` como texto-base. `MessageSequenceUI` continua sendo o executor (envio um a um, retomável).
4. Usar `reminders` (7/1/0) só como **sugestão** de público do dia ("3 clientes com lembrete D-1 hoje"), nunca como envio automático.
5. Registrar o contato no histórico já existente da sequência; nenhuma coleção nova.

## 5. Isolamento

- Toda leitura da tela passa por `CustomerSubscriptions.view.*` (filtra `SpaceContext.showsRenewal`). `board()` puro não lê o banco; `view.board()` aplica o filtro do espaço.
- A renovação continua pelo checkout, que já valida espaço de origem, cliente, produto e snapshot (`requireRenewable`).
- Nada muda em `firestore.rules`, Functions, planos/billing da VECONI ou Mercado Pago.

## 6. Primeira melhoria entregue

`CustomerSubscriptions.board(rows, { reference, recentDays, query, describe })` e `CustomerSubscriptions.view.board(options)`:

- grupos `active`, `dueToday`, `next7`, `expired`, `renewedRecently` (+ contagem de `paused`), ordenados para a operação;
- dia civil de São Paulo (`daysUntil` exportado);
- busca sem acento por plano/cliente e por dígitos do telefone (via `describe`);
- `clientIds` por grupo para `MobileMessages.openCenter`;
- `forecastValue` (hoje + 7 dias) e `expiredValue`;
- não altera as vigências de origem, ignora removidas/inativas.

Testes: 2 novos em `tests/customer-subscriptions.test.js` (dia civil SP às 23:30, grupos, deduplicação, valores, imutabilidade, busca sem acento/telefone, filtro do espaço em `view.board`).

## 7. Próximos passos sugeridos

1. Tela `#/renovacoes` sobre `view.board()` (o protótipo é a referência), com testes de layout 320/360/390/1366.
2. Tipo `'renewal'` na Central + modelo padrão.
3. Corrigir o "hoje" de `metrics/homeMetrics/loadDashboardMetrics` para o dia civil SP (com teste).
4. Paginação por `expiresAt` para contas sem espaço com mais de 50 vigências.
