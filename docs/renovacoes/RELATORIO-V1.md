# Renovações V1 — relatório

Branch local `claude/renovacoes-v1` (base `origin/main` a44a49a). Nada foi enviado nem publicado.
Nenhuma alteração em `functions/`, `firestore.rules`, índices, Mercado Pago ou planos da VECONI (`js/plans.js`, `plan-catalog`).

## Pronto

**Tela `#/renovacoes`** (`js/renovacoes.js`, `css/renovacoes.css`)
- Está no menu do desktop (Gestão, abaixo de Clientes) e no menu lateral do mobile. Exige `customers.view`, igual a Clientes, e o recurso `customerSubscriptions` do plano. Sem o plano, abre o modal de upgrade que já existe.
- Tem busca única por cliente, telefone (3 dígitos ou mais) e plano, sem diferenciar acentos.
- Os indicadores clicáveis também são os filtros: Vencem hoje · Próximos 7 dias · Vencidas · Renovadas (30 dias) · Ativas · Pausadas. A tela abre no grupo mais urgente que não estiver vazio.
- **Sobreposição explícita:** cada indicador diz como se relaciona com os outros ("Inclusas em Ativas", "Fora de Ativas", "Podem estar em Ativas ou Vencidas"). Uma nota fixa avisa que os números não se somam.
- Cada assinatura tem Renovar, Lembrar e Perfil, todos pelos fluxos existentes: `[data-renew-subscription]` → `Checkout.prepareRenewal`, `[data-renewal-whatsapp]` (link individual) e `[data-profile-client]` (perfil CRM). Sem permissão de venda, o botão Renovar não aparece. Sem WhatsApp válido, o botão Lembrar fica desativado.
- A lista mostra 40 itens por vez, com "Mostrar mais".
- Estados tratados: carregando, vazio por filtro, busca sem resultado, conta sem assinaturas (leva a Produtos), sem conexão e acesso restrito.

**Lembrete em lote**
- Cada linha tem uma caixa de seleção, e o cabeçalho tem "Selecionar N para lembrar". A seleção é por cliente: duas vigências do mesmo cliente compartilham a mesma caixa.
- "Abrir na Central" chama `MobileMessages.openCenter({ type: 'notice', clientIds })`. O tipo **Aviso** não tem variáveis de saldo nem de dívida. A Central já impede o tipo Cobrança quando o público não é de devedores.
- Não há disparo automático. O envio continua um a um no `MessageSequenceUI`.

**Números completos ou parciais**
- **Com espaço ativo:** `queryRenewalsForSpace` lê o espaço inteiro, página a página. Os números só são tratados como totais se essa leitura terminar.
- **Sem espaço:** são feitas quatro leituras paginadas por cursor, 50 por página e até 500 por janela:
  - ativas por vencimento, das mais próximas para as mais distantes;
  - ativas já vencidas, das mais recentes para as mais antigas;
  - vencidas;
  - pausadas.
- Cada indicador sabe se está exato. Se o corte acontece depois do 7º dia, "Vencem hoje" e "Próximos 7 dias" continuam exatos. Os demais aparecem com "+" e um aviso explica o limite.
- Sem conexão, ou se a leitura falhar, a tela usa os dados do aparelho, avisa e mostra todos os números com "+".
- Vigências que existem só no aparelho, ainda não confirmadas na nuvem, são contadas e informadas, mas não entram nos números.

**Fuso horário (America/Sao_Paulo)**
- Passaram a usar o dia civil de São Paulo, com o novo `CustomerSubscriptions.daysUntil` e `civilDayEnd`:
  - `metrics`, `loadExpiring`, `loadDashboardMetrics`, `loadHomeMetrics` e `view.loadHomeMetrics`;
  - o selo de renovação na lista de Clientes;
  - o texto do lembrete por WhatsApp.
- `expiresAt` e `effectiveStatus` não mudaram: só o agrupamento por dia ficou civil.
- `loadHomeMetrics` e `loadDashboardMetrics` agora devolvem `limited`. A Home mostra "N+" e "Ao menos R$…" quando a leitura atingiu o limite de 50, e o alerta da Home abre a tela de Renovações.

**Suporte na sincronização:** `queryCustomerSubscriptions` aceita `{ page: true, cursor }` e devolve `{ items, cursor, hasMore }`. Sem `page`, o retorno continua igual ao de antes.

## Testes
- Dependências instaladas com `npm ci` a partir do `package-lock.json`, que inclui o jsdom 26.1.0. Os dois testes antigos de checkout ("atalho do perfil…") agora rodam e passam.
- Novo `tests/renovacoes-page.test.js`, com 8 testes. Ele roda com `TZ=UTC` para provar que o resultado não depende do fuso do aparelho. Cobre paginação, exatidão por indicador, espaço, modo offline, sobreposição, busca, ações, lote (Central como Aviso), modo restrito, lista longa e conta vazia.
- Os testes de checkout, renovação e mensagens (14 arquivos) dão 124 de 125. A única falha ("reset policy…") já existia antes desta frente.
- Suíte completa: 1156 testes, 1066 passam e 90 falham. **As 90 falhas são as mesmas da linha de base** (eram 90 em 1148 testes antes das mudanças), ou seja, nenhuma regressão.
- Dois testes antigos foram ajustados porque o contrato mudou de propósito: `limited` no retorno das métricas da Home, e o destino do alerta da Home, que agora é `renewals`.
- Lint: `node scripts/check-project.js` passou.

## Validação visual
Fixture: `tests/renovacoes.fixture.html`. Ele usa o CSS real do app e os módulos reais, com dados fictícios. As capturas, feitas no Chrome via CDP com emulação de viewport, estão em `docs/renovacoes/capturas/` e as medições em `medicoes.json`:

| Largura | Estados | Rolagem horizontal | Fonte mínima | Botões < 40 px |
|---|---|---|---|---|
| 320 | vencem hoje, vencidas | não | 12 px | 0 |
| 360 | próximos 7 dias, offline | não | 12 px | 0 |
| 390 | seleção em lote, limite 500, restrito, vazio, busca sem resultado | não | 12 px | 0 |
| 1366 | ativas com seleção, renovadas | não | 12 px | 0 |

Ajustes feitos durante a validação:
- A barra de lote só aparece quando há seleção, e o "Selecionar" foi para o cabeçalho da lista.
- Em 320 px, o selo de prazo desce para baixo do nome.
- Há espaço extra no fim da página quando a barra de lote está aberta.
- No modo restrito, os indicadores ficam ocultos.

## O que falta
1. **Validar no app real** com login: navegação, permissões de vendedor e gerente, modal de plano e retorno da Central. Até agora a validação usou o fixture e os testes.
2. **Preparar a publicação**, que fica com você:
   - subir a versão do cache do `service-worker.js` (a tela nova já está na lista de arquivos);
   - atualizar o build-info;
   - conferir se as 90 falhas pré-existentes da suíte são esperadas no main.
3. **Modelo "Lembrete de renovação"** na Central, do tipo Aviso, com `{{primeiro_nome}}`. Hoje a Central não conhece plano nem vencimento, então o texto é genérico. Passar plano e data exigiria uma variável nova no motor, o que ficou fora do escopo.
4. **Lembretes 7/1/0 dias** configurados no produto: ainda não são usados. Proposta: um filtro "lembrete de hoje", sem envio automático.
5. **Contas com mais de 500 vigências** numa mesma situação: os números aparecem com "+". Para totais exatos acima disso, dá para usar `getCountFromServer` por janela (o repositório já o usa).
6. O motor de segmentos do CRM (`crm-segment-engine-v2.js`) já usava o dia de São Paulo e não precisou mudar. Ele continua com cálculo próprio; dá para unificar com `CustomerSubscriptions.daysUntil` depois.
