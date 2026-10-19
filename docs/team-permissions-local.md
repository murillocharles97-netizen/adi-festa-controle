# Equipe / Permissões — auditoria e implementação local

Base auditada: V190 (`db080d6`). Escopo: editor local e integração com o contrato existente. Sem deploy, migração de membros ou alteração de dados reais.

## Contrato atual: 20 permissões

Frontend: `js/team-access.js`. Backend: `functions/src/services/team-access-service.js`. O vínculo efetivo permanece em `businesses/{businessId}/members/{uid}`, com `role`, `status`, `permissions`, `spaceAccess` e `allowedSpaceIds`.

| Permissão | Efeito atual e limites |
| --- | --- |
| `sales.create` | Cria vendas e lê o consolidado operacional do espaço; autoriza efeitos de estoque/saldo da venda. Não é uma autorização financeira geral. |
| `sales.cancel` | Cancela vendas/pedidos autorizados; mantém validações de autoria, espaço, idempotência e regras do fluxo. |
| `sales.viewAll` | Consulta administrativa de vendas e leitura de pedidos online; não é necessária para o consolidado operacional básico do vendedor. |
| `customers.view` | Consulta clientes e o saldo canônico necessário ao atendimento. |
| `customers.edit` | Cadastra e edita clientes; também participa de mensagens/CRM operacional. Não há separação persistida entre criar e editar. |
| `customers.receiveDebt` | Recebe fiado e permite consultar fontes financeiras relacionadas a esse atendimento. Não deve ser apresentado como uma simples opção sem impacto financeiro. |
| `customers.adjustBalance` | Ajusta saldo do cliente; independente do cadastro do cliente. |
| `products.view` | Consulta produtos/variações autorizados pelo vínculo e espaço. |
| `products.edit` | Cadastra e edita produtos; permite abrir o contexto administrativo do catálogo online, mas não publicar/configurar loja como não-owner. |
| `inventory.view` | Consulta estoque/movimentações autorizadas; registros privados de custo têm proteção adicional. |
| `inventory.adjust` | Ajusta estoque no espaço autorizado; não se confunde com a baixa legítima realizada ao vender. |
| `financial.view` | Acesso amplo ao módulo financeiro; o modelo atual também o utiliza para gerenciamento de lançamentos/recursos financeiros do espaço. Não é somente leitura. |
| `reports.view` | Relatórios, análises completas e áreas de CRM; não controla isoladamente o gráfico operacional básico do Início. |
| `profit.view` | Consulta lucro/margem e a projeção privada compartilhada `saleFinancials`, conforme Rules. |
| `cost.view` | Consulta/escrita de projeções de custo e acesso à projeção privada compartilhada `saleFinancials`, conforme Rules. |
| `team.view` | Consulta equipe e convites. |
| `team.manage` | Convita, edita vínculos/permissões e desativa funcionários, respeitando as proteções do backend. É uma permissão administrativa ampla. |
| `settings.manage` | Acesso às configurações existentes; não transfere operações exclusivas do proprietário. |
| `billing.manage` | Exibe acesso à área de planos; operações de assinatura continuam owner-only no backend. |
| `spaces.manage` | Gerencia espaços conforme contrato e restrições existentes. |

As roles persistíveis continuam `owner`, `manager`, `seller` e `stock`. **Personalizado é o estado visual do preset, não uma role nova.**

## Acoplamentos que a interface deve explicar

- **Ver vendas e criar venda:** `sales.create` ou `sales.viewAll` habilitam leitura operacional do espaço. Não é correto oferecer “Ver vendas: desligado” enquanto a criação continua ligada e prometer invisibilidade. Dashboard, metas e Histórico operacionais continuam empresariais, não limitados ao UID do vendedor.
- **Pedidos online:** atendimento exige `sales.create` + `sales.viewAll`; cancelar exige adicionalmente `sales.cancel`. O editor não deve prometer uma nova chave independente de atendimento.
- **Clientes/produtos:** cadastrar e editar compartilham `customers.edit` e `products.edit`. Qualquer divisão futura precisa de validação no runtime, no backend e nas Rules.
- **Financeiro:** `financial.view` já inclui possibilidades de escrita; separar “ver”, receita e despesa por toggles sem enforcement novo seria enganoso.
- **Custos/lucro:** são sanitizados separadamente no frontend, mas `saleFinancials` é uma projeção privada compartilhada cujo documento é legível com `cost.view` **ou** `profit.view`. A Firestore Rule autoriza documentos, não oculta campos. A tela deve informar essa limitação; não garantir segregação de campos que o contrato atual não oferece.
- **Loja e assinatura:** salvar/publicar configurações da loja é owner-only no callable atual. `products.edit` não remove essa proteção. Gerenciar assinatura também permanece owner-only, mesmo quando a rota de planos está visível.
- **Desconto/preço:** hoje pertencem ao fluxo de `sales.create`, sem grants independentes aplicados pelas Rules. Não apresentar uma restrição visual futura como garantia de backend.
- **Metas e desempenho individual:** não existem grants independentes para cada um; `reports.view` não deve ser rotulado como exclusão de todo o desempenho operacional.

## Presets e preservação dos vínculos atuais

Presets são aplicados somente por ação explícita no formulário. Abrir, cancelar ou visualizar o editor não altera o vínculo. Uma mudança manual passa a seleção visual para **Personalizado**, preservando a role persistível.

Defaults seguros para novas escolhas:

- **Vendedor / Caixa:** venda e consultas operacionais de clientes, produtos e estoque. Sem Financeiro, recebimento/ajuste de saldo, custos/lucro, equipe, configurações ou gestão de planos/espaços por padrão.
- **Gerente:** operações ampliadas, explicitadas na prévia; não assumir acesso total, Financeiro, custos/lucro, edição de permissões ou assinatura. Grants financeiros adicionais exigem escolha explícita.
- **Personalizado:** mantém o mapa atual e permite editar somente capacidades realmente disponíveis neste contrato.

Não reescrever os presets canônicos ou membros existentes para obter esses defaults de UI. Não migrar automaticamente o gerente atual, que pode já possuir `customers.receiveDebt` e `customers.adjustBalance`.

Os normalizadores antigos completam chaves ausentes usando o preset. Por isso, **membros com mapa esparso ou `false` explícito exigem preservação de formato/valores ao editar**: não preencher grants faltantes silenciosamente ao abrir e salvar. Alterações deliberadas devem ser destacadas na revisão. Cargo `stock`, permissões administrativas existentes e campos não editados não podem sumir por causa da nova composição visual.

## Dependências do editor

Dependências reduzem combinações incoerentes no formulário, mas não substituem as Rules nem representam novas validações de servidor.

- Alterar manualmente um pai para desligado pode desligar seus dependentes editáveis, com indicação clara na revisão.
- Não ativar automaticamente o pai ou grants sensíveis quando um dependente for selecionado.
- `customers.edit` depende de consulta de clientes no editor; `products.edit` depende de consulta de produtos; ajuste de estoque depende das consultas relacionadas; gestão de equipe depende de consulta da equipe.
- Não “corrigir” vínculos antigos somente ao abrir o editor. Combinações antigas devem ser apresentadas para revisão explícita, sem concessão ou revogação silenciosa.
- O owner não perde acesso nem é desativado acidentalmente por um preset básico; o backend continua protegendo autoelevação e concessão de permissão que o gestor não possui.

## Espaços, sessão e segurança

- Preservar `all` versus `selected`, sem converter seleção vazia em acesso a todos.
- Exigir ao menos um espaço válido para uma nova seleção específica; não remover vínculos desconhecidos silenciosamente.
- Permissões continuam uniformes nos espaços liberados. A interface não deve anunciar perfis diferentes por espaço sem contrato novo.
- Preservar cache por UID + empresa + assinatura de permissões + espaços. Formulário/requisição obsoletos não podem publicar dados depois de troca de empresa/conta.
- Nenhuma alteração em `firestore.rules`, permissões de produção, estoque, vendas, filas ou diagnóstico de Sync faz parte da composição visual.

## Preparação visual e evolução futura

Opções ainda sem enforcement independente devem permanecer informativas/desabilitadas, identificadas como **vinculadas à permissão atual** ou **controle granular ainda não disponível**. Não enviar chaves inventadas no payload de membro.

Para granularidade real futura: versionar o mapa de permissões; definir defaults sem expansão para cada vínculo antigo; aplicar validação nas funções, Rules, consultas, Sync e serviços locais; testar negação direta fora da UI; oferecer ao owner revisão antes da migração. Isso inclui desconto/preço, criar versus editar cadastros, receitas/despesas, atendimento online e subdivisões de gestão da equipe.

## Validação necessária

- Membro esparso, `false` explícito, `stock`, owner e gerente existentes: abrir/salvar sem mudança não amplia acesso.
- Presets apenas explícitos, seleção Personalizado, dependências com redução transparente e nenhuma elevação implícita.
- Backend permanece aceitando apenas grants canônicos; controles preparatórios não produzem direitos fictícios.
- Seller sem Financeiro/custos/lucro/equipe/configurações; consolidado operacional e Histórico continuam alinhados ao owner no espaço autorizado.
- Mudança de conta/empresa, callback antigo, erro ao salvar e duplo clique não contaminam o formulário nem duplicam chamada.
- Espaços selecionados, espaço estrangeiro, membro inativo e tentativa de autoelevação negados.
- Larguras 320, 360, 390 e 430 px, tablet/desktop: sem overflow, alvo confortável, teclado e foco visível, seções colapsáveis e ação de salvar sem cobrir conteúdo.

Suites existentes relevantes: `tests/team-access-v150.test.js`, `tests/operational-dashboard-access.test.js`, `tests/sync-integrity-permissions.test.js`, `tests/emulator/team-access.rules.test.js`, `tests/emulator/team-manual-sale-sync.rules.test.js`, `tests/emulator/operational-dashboard.rules.test.js` e `functions/test/team-access-service.test.js`. Fixture visual atual: `tests/team-access-v150.fixture.html`.

## Resultado e limites desta auditoria

Nenhum dado real foi consultado ou alterado. Nenhuma permissão foi adicionada. A nova UI organiza os 20 grants existentes, mas não promete distinções que o backend atual não aplica. A evolução granular completa depende da etapa contratual/segurança descrita acima, sem migração automática.

## Entrega local implementada

- `js/team-permission-model.js`: mapas explícitos, presets seguros somente por escolha, dependências sem promoção implícita, snapshot raw e payload restrito de acesso.
- `js/team-permission-editor.js` + `css/team-permissions.css`: identidade do funcionário, presets, sete categorias, espaços em chips, explicações recolhíveis, controles vinculados, revisão explícita, proteção de owner, sessão obsoleta e duplo envio.
- `js/team-page.js`: menu **Permissões e espaços**, preservação de mapas esparsos no formulário existente e presets seguros também para novos convites. Nenhum preset global/runtime foi alterado.
- `js/firebase/team-service.js`: identidade canônica pelo ID documental, inclusive vínculos antigos sem `uid` ou com alias inline inconsistente. O formulário antigo e o novo compartilham a preservação explícita de espaços indisponíveis; editar nome/status não remove vínculos não renderizados silenciosamente.
- `index.html` + `service-worker.js`: inclusão dos assets locais. Nenhuma versão de release foi publicada.
- `functions/src/services/team-access-service.js`: `expectedAccess` opcional, comparado transacionalmente antes das escritas. Divergência retorna `aborted`; chamadas antigas continuam compatíveis. Esta mudança de backend deverá acompanhar eventual publicação futura da tela para que a proteção de concorrência esteja ativa.
- Fixture `tests/team-permissions.fixture.html` e servidor `scripts/serve-team-permissions-qa.cjs`: somente loopback, dados fictícios, `connect-src 'none'`; nenhum SDK de produção inicializado.

Nenhuma alteração em Rules. Nenhuma chave efetiva adicionada. Visualizar/executar são classificações da UI das capacidades já aplicadas, não um novo contrato de autorização.

## Validação executada

- **86 testes Node**: modelo, backend/concorrência, IDs documentais, espaços indisponíveis/contraditórios, permissões atuais, Dashboard operacional e auditoria do Sync.
- **19 testes de Rules no Firestore Emulator**: acesso operacional, isolamento e negação financeira, com Rules inalteradas.
- **7 cenários de serviço no Firestore Emulator real**: concorrência, sparse/false, espaço estrangeiro, não-elevação do gerente, cargo stock, ordenação canônica e preservação de dados comerciais/updateTime.
- Navegador local: dependências com remoção transparente, perfil Personalizado, confirmação de preset seguro, duplo clique gerando uma chamada, vínculo esparso sem concessão, troca de sessão encerrando editor sem gravação e navegação Equipe → Permissões → Equipe sem gravação.
- Responsividade em **320, 360, 390, 430, 768 e 1440 px**: sem overflow horizontal; switches com área de toque de 44 px, sete seções; no mobile inicia com Vendas aberta e demais recolhidas.
- Lint, build e `git diff --check` executados. Os logs de negação nas suítes de Rules correspondem aos cenários de acesso negado esperados, não a liberação de permissões.

## Como testar localmente

Na base de release, executar `node scripts/serve-team-permissions-qa.cjs` e abrir a URL impressa. A fixture tem seleção de usuário fictício, simulação de troca de sessão e contador de chamadas mock. `?page=list` permite testar a entrada pela lista Equipe.

Screenshots em `C:/Users/Murillo/.codex/visualizations/2026/09/17/01a0accc-0d12-7c62-b253-4185d5a31790/team-permissions/permissions-{largura}.jpg`.

Na implementação local não houve deploy, alteração de usuário real, migração, fila, cache ou dados de produção. A edição preexistente independente em `js/firebase/sync.js` foi preservada e não faz parte desta entrega. A preparação da candidata V191 está documentada em `docs/team-permissions-v191-preflight.md`.

### Manifesto de arquivos desta entrega

1. `js/team-permission-model.js` (novo)
2. `js/team-permission-editor.js` (novo)
3. `css/team-permissions.css` (novo)
4. `js/team-page.js`
5. `index.html`
6. `service-worker.js`
7. `functions/src/services/team-access-service.js`
8. `functions/test/team-access-concurrency.test.js` (novo)
9. `functions/test/team-permission-editor-emulator.js` (novo)
10. `tests/team-permission-model.test.js` (novo)
11. `tests/team-permissions.fixture.html` (novo)
12. `tests/team-access-v150.fixture.html`
13. `scripts/serve-team-permissions-qa.cjs` (novo)
14. `docs/team-permissions-local.md` (novo)
15. `js/firebase/team-service.js`
16. `tests/team-permission-integration.test.js` (novo)
