# Renovações V1 — homologação no app real

Branch local `claude/renovacoes-v1`. Nada foi publicado.

**Ambiente.** O app real foi servido localmente e autenticado contra os emuladores do Firebase (Auth, Firestore e Functions) do projeto de teste `adi-festa-variations-test`. Os dados são fictícios, criados por `scripts/qa-renovacoes-emulator.cjs`, que se recusa a rodar fora dos emuladores. Nenhuma venda real foi criada: os modais de renovação foram cancelados e as sequências da Central terminaram com 0 envios. Functions, Rules, Mercado Pago e planos da VECONI não foram alterados.

**Massa de teste.**
- Empresa "Studio Fictício QA" (plano Pro), com dois espaços: Loja Centro e Loja Bairro.
- A mesma cliente, Joana, tem *Plano Mensal Pilates* no Centro e *Academia 3x semana* no Bairro.
- Assinaturas que vencem hoje (às 20:00, horário de São Paulo), daqui a 1, 3 e 12 dias, uma vencida, uma pausada e uma renovada recentemente.
- Usuários de teste: proprietário, gerente e vendedor (este só com acesso à Loja Centro).
- Empresa "Loja Essencial QA", no plano Essencial.
- Empresa "Academia Volume QA", com 230 assinaturas: 160 ativas e 70 vencidas.

## Resultado por item

| # | Item | Resultado |
|---|---|---|
| 1 | Tela no app autenticado | **OK**: login real, rota `#/renovacoes`, menus do desktop e do mobile |
| 2 | Seletor de espaços | **Corrigido e OK.** A V1 não tinha seletor e só mostrava o espaço ativo (captura 01). Agora há "Todos os espaços (N)" e cada espaço autorizado, usando o SpaceContext. Escolher um espaço chama `SpaceContext.selectActive`; "Todos" é uma visão só da tela |
| 3 | Dois espaços, mesma cliente com planos diferentes | **OK.** Em "Todos" aparecem 6 assinaturas com chip do espaço de origem. A busca por "joana" mostra as duas, cada uma com seu plano e espaço (capturas 02, 03, 18) |
| 4 | Troca de espaço: indicadores, filtros, busca, previsão e lista | **Corrigido e OK.** A tela não acompanhava a troca de espaço, porque o app só remonta Início, Clientes, Produtos e Vender; agora ela recarrega sozinha. Bairro: 2 ativas, previsão de R$ 199,80. Centro: 1 ativa, 1 vencida, 1 pausada. Todos: 1 vence hoje, 2 em 7 dias, 1 vencida, 1 renovada, 4 ativas, 1 pausada |
| 5 | Renovar sempre no espaço de origem | **Corrigido e OK.** Sem a correção, Renovar a partir de "Todos" falhava ("A vigência selecionada não está mais disponível…"). Agora Renovar, a partir da lista ou do Perfil, ativa antes o espaço de origem e o modal mostra "Espaço: Loja Centro" (capturas 04, 06, 21). Se a troca for bloqueada (por exemplo, sacola aberta), nada é renovado |
| 6 | Permissões | **Proprietário OK.** **Vendedor (só Centro) OK**: sem seletor, só as 3 assinaturas do Centro; busca, leitura forçada e Renovar de outro espaço são recusados (captura 11). **Gerente com dois espaços selecionados OK.** **Gerente com acesso a todos os espaços: falha pré-existente nas Rules**, ver o problema P1 |
| 7 | Renovações → Perfil → Renovar; Renovações → Central → Voltar | **Corrigido e OK em 390 e 1366.** (a) Bug no checkout: o Perfil → Renovar falhava em silêncio após qualquer troca de espaço (problema P3). (b) A Central voltava para Clientes; agora mostra "Voltar para Renovações" e retorna à tela (capturas 07, 09, 20) |
| 8 | Aviso de upgrade | **OK.** No plano Essencial, o menu mostra "◇ Gestão" e a rota abre o modal "Assinaturas de clientes está no plano Gestão", sem expor dados (captura 12) |
| 9 | Muitas assinaturas | **OK.** 230 assinaturas lidas em 8 páginas de 50 (~0,4 s no emulador). Todos os indicadores exatos: hoje 4, 7 dias 28, vencidas 70, ativas 160. A lista renderiza 40 por vez. Os testes cobrem o corte em 500 por situação e o "+" por indicador (captura 13) |
| 10 | Falhas da suíte relevantes | Ver a seção de testes. Nenhuma falha testa código de Renovações |

Também foram conferidas as larguras 320, 360 e 390 px no app real, com emulação Android: sem rolagem horizontal, fonte mínima de 12 px e nenhum botão abaixo de 40 px. Em 320 px o seletor cortava o texto e foi corrigido (capturas 14, 15, 16). No desktop, a linha sem WhatsApp desalinhava as colunas e também foi corrigida (capturas 18, 19).

## Problemas encontrados

| ID | Problema | Origem | Situação |
|---|---|---|---|
| P1 | Um gerente com `spaceAccess: "all"` **não consegue listar `financialSpaces`** (permission-denied na regra de leitura de `financialSpaces`). Fica sem nenhum espaço em todas as telas por espaço, não só em Renovações. Ler cada espaço individualmente funciona, assim como um gerente com os espaços **selecionados** | Pré-existente, nas **Rules** | Não corrigido (Rules fora do escopo). Renovações agora mostra "Nenhum espaço autorizado foi carregado…" em vez de um falso "0 assinaturas" (captura 10). Reproduzido de forma isolada com as regras reais |
| P2 | As Rules **não isolam `customerSubscriptions` por espaço**: um vendedor com `sales.create` lê, por acesso direto, uma assinatura de outro espaço da mesma empresa | Pré-existente, nas **Rules** | Não corrigido. O app isola corretamente: tela, busca, leitura por espaço e Renovar. Recomendo revisar as Rules separadamente |
| P3 | `retireSpaceDraft()` descartava o pedido de renovação ou de cliente feito pelo Perfil quando o espaço tinha mudado desde a última visita a Vender. O Perfil → Renovar falhava sem mensagem, também no fluxo antigo Clientes → Perfil | Pré-existente, em `js/checkout.js` | **Corrigido:** o pedido é preservado só para o mesmo usuário e com o escopo já revalidado. A sacola anterior continua guardada na chave original |
| P4 | Renovações não tinha seletor nem "Todos", e não reagia à troca de espaço | V1 | **Corrigido** |
| P5 | Renovar a partir de "Todos" falhava em outro espaço | V1 | **Corrigido** (adota o espaço de origem) |
| P6 | Central → Voltar ia para Clientes | V1 | **Corrigido:** `openCenter({ returnRoute: 'renovacoes' })`. Sem esse parâmetro, nada muda na Central |
| P7 | A Central trabalha por espaço; em "Todos", clientes de outro espaço seriam descartados sem aviso | V1 | **Corrigido:** o lembrete em lote só é oferecido com um espaço escolhido, com uma dica na tela |
| P8 | Em "Todos", aviso e chip do espaço; em 320 px, o seletor cortava o texto | V1 | **Corrigido** |

Observação sobre a Central, sem mudança: o tipo **Aviso** está pré-selecionado e tocar em "Cobrança" não troca o tipo, porque o público não é de devedores (guarda já existente). O editor de Aviso ainda oferece o chip `{{saldo}}`, como em qualquer Aviso da Central; se for usado, mostra o saldo canônico do cliente. Não é uma cobrança automática.

## Testes
- `tests/renovacoes-page.test.js`: 14 testes, 6 deles novos nesta etapa. Cobrem:
  - seletor e "Todos os espaços", só com espaços autorizados;
  - troca de espaço;
  - Renovar e Perfil adotando o espaço de origem, e Lembrar sem trocar de espaço;
  - troca bloqueada e espaços divergentes;
  - vendedor de um espaço;
  - falha parcial com "+";
  - estado sem espaço carregado;
  - Central com retorno e preservação da intenção no checkout.
- `tests/customer-subscriptions.test.js`: 22 de 22, incluindo os dois testes antigos de checkout "atalho do perfil…".
- Suíte completa: **1178 testes, 1094 passam, 84 falham**. Nenhuma falha nova em relação à linha de base. Seis falhas antigas passaram a passar porque as dependências de `functions/` foram instaladas com `npm ci` (lockfile).
- Falhas pré-existentes mais próximas de Renovações; nenhuma testa o código desta tela:
  - `mobile-home-clients-polish` "Clientes preserva … contexto de renovação": compara o texto-fonte com um padrão antigo de busca.
  - `customer-balance-consecutive-v145` (2 testes de checkout): o harness não define `readOperationalDocument`.
  - `sales-pdv-cart` (2 testes): esperam trechos antigos de `spaces.js` e `app.js`.
  - `veconi-visual-system` e `global-spaces-v1`: esperam o nome antigo do cache do service worker.
  - `team-sync-release-v179`: hook de trocas.
  - `legacy-stock-space`: modal de estoque.
  - `exchange-scope-dashboard`: seleção de espaço no harness de trocas.
- Lint (`scripts/check-project.js`): OK.

## Evidências (`docs/renovacoes/homologacao/`)

| Arquivo | Conteúdo |
|---|---|
| 01 | V1 sem seletor (antes da correção) |
| 02, 03 | Todos os espaços; busca mostrando a mesma cliente nos dois espaços |
| 04, 06 | Renovar no espaço de origem: pela lista e pelo Perfil após troca de espaço |
| 05 | Perfil aberto no espaço de origem |
| 07, 08, 09 | Central com a seleção; Aviso com Cobrança bloqueada; Voltar para Renovações |
| 10, 11, 12, 13 | Gerente sem espaço (P1); vendedor; upgrade; volume |
| 14, 15, 16 | 320 e 360 px |
| 17 a 21 | Desktop 1366 px: Todos, lote por espaço, Central, Renovar no espaço de origem |

Capturas 01 a 16: navegador do app em modo mobile. Capturas 17 a 21: Chrome headless (CDP) com login no app.

## GO/NO-GO

**GO condicionado** para Renovações V1. Não há bloqueio no código de Renovações, mas antes de publicar:
1. **Decidir sobre P1:** gerentes com acesso a todos os espaços ficam sem espaços no app inteiro (pré-existente, nas Rules). Se houver gerentes assim em produção, eles verão Renovações sem dados, com um aviso honesto. A alternativa imediata, sem mudar Rules, é configurá-los com os espaços selecionados.
2. **Registrar P2** (isolamento de `customerSubscriptions` por espaço nas Rules) como pendência de segurança separada. O app não expõe esses dados na interface.
3. **Na preparação da release:** subir a versão do cache do `service-worker.js` e do build-info (os arquivos novos já estão na lista de cache) e fazer um teste rápido num Android físico. A validação mobile foi feita por emulação (viewport e user agent Android).
