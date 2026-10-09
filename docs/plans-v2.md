# Planos VECONI — catálogo v2 / release V165

## Arquitetura e auditoria

O app continua em JavaScript/CSS, sem framework adicional. O catálogo compartilhado
`functions/src/shared/plan-catalog.js` alimenta BusinessContext/PlanLimitService e o
plan-service do backend. As Rules possuem uma projeção estática, conferida por teste.
SubscriptionService, os índices de cobrança e o processamento Mercado Pago existentes
foram reutilizados. Não foram alterados documentos, assinaturas ou cobranças reais.

IDs persistidos continuam `essential`, `professional` e `premium`. Os nomes comerciais
são Essencial, Gestão e Pro. O alias legado `pro` continua significando `professional`;
alterá-lo converteria eventos antigos para o plano errado.

## Matriz cumulativa

| Plano | Recursos adicionais |
|---|---|
| Essencial | Vendas, clientes/histórico individual, fiado/recebimentos, mensagens/cobranças, produtos/estoque básico, metas, campanhas simples por quantidade, sincronização. **Sem módulo Financeiro.** |
| Gestão | CRM/segmentação, campanhas avançadas, relatórios/Histórico/Desempenho, financeiro completo, planilhas de produtos, estoque avançado, catálogo/pedidos online, assinaturas de clientes |
| Pro | Equipe/permissões, controle por operador, terminais, integração de pagamentos, fiscal, automações e suporte prioritário |

Os recursos futuros não são implementados por esta tarefa: Cielo e fiscal/SEFAZ são
apresentados como futuros. Variantes existentes continuam no estoque básico. As chaves
de capacidades futuras não criam interfaces ou integrações inexistentes.

Bloqueios de rotas usam a matriz; ações protegidas usam PlanLimitService e o modal
consistente de upgrade. Cadastro de terminal/nova cobrança integrada e operações de
equipe também verificam o plano no servidor. Consulta/recuperação de pagamentos antigos
e bootstrap de membership não foram bloqueados: downgrade não pode abandonar pagamento
em andamento nem impedir login.

Não existe Financeiro básico no catálogo novo. `basicFinance` é somente um alias de
compatibilidade de `financeAdvanced`, liberado a partir de Gestão. Não há UI simplificada.
Eventos históricos de campanhas e alocações de
recebimentos permanecem graváveis no Essencial, para não bloquear venda/recebimento.
Importação XLSX exige Gestão na interface/serviço; as Rules protegem a atualização marcada
como importação. Isso não pretende impedir edições individuais legítimas de produtos.

## Preços

| Plano | Mensal | Equivalente anual/mês | Cobrança anual |
|---|---:|---:|---:|
| Essencial | R$ 29,90 | R$ 23,92 | R$ 287,04 |
| Gestão | R$ 59,90 | R$ 47,92 | R$ 575,04 |
| Pro | R$ 119,90 | R$ 95,92 | R$ 1.151,04 |

Cálculo em centavos: mensal × 12 × 80%, arredondado para centavo; equivalente = anual/12.
A alternância anima os números por requestAnimationFrame e cancela animações anteriores.
Com prefers-reduced-motion, atualiza imediatamente. O checkout usa o total do ciclo,
nunca o valor mensal equivalente do anual.

## Compatibilidade e condição antes do deploy

- Não há migração destrutiva ou reajuste automático de assinatura Mercado Pago.
- Webhooks continuam validando o preço armazenado no índice da assinatura contratada.
- Novos checkouts exigem catálogo v2 no frontend e backend; cotações antigas não iniciam
  um novo checkout com preço desatualizado.
- Frontend isolado não é suficiente: publicar Functions e Rules compatíveis em implantação
  coordenada. Clientes antigos serão orientados a atualizar antes de novo checkout.
- Política vigente: troca voluntária antecipada; preservar contrato antigo até nova
  ativação paga com webhook processado. Não cancelar por classificação como legado.
  Consulte `docs/legacy-plan-transition.md`, que substitui a proposta anterior.
- O trial utiliza Gestão, não concede automaticamente Pro.
- Revisar seed somente como catálogo: não sobrescrever assinaturas existentes com ele.
- Release V165 e cache `veconi-v165-plans-approval-first`; atualização PWA existente preservada.

## Ajuste de Financeiro — 09/10/2026, sem deploy

- Catálogo compartilhado: `financeAdvanced`, `financialModule`, `basicFinance`, `finance.view` e `finance.manage` negados ao novo Essencial; Gestão/Pro liberados. Herança preservada; equipe/permissões/maquininhas/fiscal continuam Pro.
- Card do Essencial informa ausência do Financeiro; comparação é gerada do mesmo catálogo sem linha fictícia de Financeiro básico. Preços e assinatura Mercado Pago não mudaram.
- Navegação oculta Financeiro para quem não tem entitlement; `#/financeiro` (inclusive query antiga ou hash restaurado) passa pela matriz e abre upgrade para Gestão antes do lazy-load. UI revalida ao retomar/trocar contexto, serviço protege leituras/mutações.
- Rules protegem registros financeiros, consultas globais de contas/cartões e anexos no Storage. Metadados globais dos espaços continuam acessíveis para Vendas/Produtos, sem liberar o conteúdo financeiro.
- Callables de reconciliação e exclusão de conta/cartão verificam o mesmo entitlement calculado no servidor. Vendas, fiado, recebimentos e suas projeções canônicas não foram reimplementados.
- A exceção de direitos legados contratados continua até o período pago; não é concessão de Financeiro ao novo Essencial.
- Sem deploy, alteração de assinatura real, execução de seed/migração ou atualização de preço contratado.

### Arquivos deste ajuste

- `functions/src/shared/plan-catalog.js`: matriz, aliases, rótulos e proteção central da rota.
- `plans.seed.json`: projeção local de features, sem executar o seed.
- `js/plans.js` e `css/plans.css`: exclusão explícita no card, comparação e navegação.
- `js/app.js`: proteção antes de carregar o módulo financeiro por hash/estado salvo.
- `js/financial-ui.js`: remoção do Financeiro básico e revalidação em retomada/contexto.
- `js/firebase/financial-space-service.js`: proteção na fronteira do serviço financeiro.
- `functions/src/index.js`: entitlements efetivos/legados nos callables financeiros.
- `firestore.rules` e `storage.rules`: registros, contas/cartões e comprovantes.
- `tests/plan-catalog-v2.test.js`, `functions/test/financial-plan-access.test.js`: matriz, herança, preços preservados, direitos legados e backend.
- `tests/emulator/plan-entitlements.rules.test.js`, `tests/emulator/financial-attachments.storage.rules.test.js`: negação/permissão real nos emuladores.
- `scripts/audit-plans-v2.cjs`: verificação visual e comportamental no Chromium.
- `docs/plans-v2.md`: relatório atualizado.

### Resultado dos testes deste ajuste

- Aplicação: 624/624.
- Backend: 131/131.
- Firestore/Storage: 43/43, incluindo regressões de recebimentos, contas/cartões, gerente autorizado, isolamento de empresas, Essencial/Gestão/Pro e anexos.
- Houve inicialmente uma falha por repetição de checagens/limite de expressões das Rules na criação de cartão pelo gerente. A checagem duplicada foi removida; a suíte completa selecionada passou na repetição.
- Navegador desktop com viewports 320, 360, 375, 390, 412, 430 e 1440: sucesso; menu/guard de Financeiro, comparação, preços anuais, animação/reduced-motion e aviso legado.
- Evidências visuais locais: `artifacts/plans-v2/390-plans.png`, `1440-plans.png` e `390-legacy-notice.png`.
- Lint/build: 306 arquivos JavaScript; `git diff --check` sem erros (avisos de conversão CRLF).
- Não houve teste físico Android nesta rodada nem smoke logado em produção. Nenhuma alteração publicada.
  O novo arquivo já consta no precache, mas a publicação futura deve versionar o cache.

## Evidências locais e roteiro

Executados: 614 testes unitários do app, 106 do backend, 127 testes de Rules/Storage
na suíte completa; depois, teste direcionado adicional de campanha simples/recebimento.
Logs estão em `artifacts/plans-v2-*.log`. Testes negativos das Rules ainda produzem
mensagens de limite de expressões em alguns caminhos; não confundir uma negação esperada
com prova de um diagnóstico específico. Caminhos permitidos são testados explicitamente.

O teste de navegador usa os módulos reais com contexto local simulado, sem cobrança real.
Validou larguras 320/360/375/390/412/430/1440, preços, ciclo do checkout, upgrade Gestão/Pro,
alternância rápida e movimento reduzido. Screenshots em `artifacts/plans-v2/`.
Não substitui teste físico Android nem smoke autenticado completo de produção.

Para validar manualmente em QA:
1. Essencial ativo: mensagens/fiado disponíveis; CRM e planilha mostram upgrade Gestão;
   Equipe e terminal mostram upgrade Pro.
2. Gestão ativo: CRM/financeiro/planilhas disponíveis; Equipe/terminal bloqueados com Pro.
3. Pro ativo com permissões de membro adequadas: Equipe e terminal liberados. O simulador
   continua sujeito à feature flag segura; plano não substitui autorização operacional.
4. Assinatura expirada: nenhuma nova operação financeira liberada.
5. Alternar Mensal/Anual rapidamente, verificar valores finais e total no checkout;
   repetir com movimento reduzido no sistema.
6. Validar login, venda, recebimento, campanhas, Financeiro Gestão/Pro e cobrança sandbox;
   validar assinatura antiga sem reajuste. Essencial não tem Financeiro básico.

## Arquivos de implementação

- Catálogo: functions/src/shared/plan-catalog.js, plans.seed.json.
- UI/runtime: js/plans.js, css/plans.css, js/firebase/business-context.js, index.html,
  service-worker.js.
- Gates: js/campanhas.js, js/financial-ui.js, js/firebase/financial-space-service.js,
  js/product-spreadsheet-ui.js, js/firebase/product-spreadsheet-service.js,
  js/terminal-payments.js.
- Servidor: functions/src/index.js, functions/src/services/{plan-service,
  subscription-service,team-access-service,coupon-firestore-service}.js,
  functions/src/terminal-payments/terminal-payment-service.js, firestore.rules.
- QA: scripts/audit-plans-v2.cjs, tests/plan-catalog-v2.test.js,
  tests/emulator/plan-entitlements.rules.test.js; testes existentes de assinatura,
  multitenant, visual, cupons e terminal ajustados ao catálogo.

Sem deploy e sem alteração de dados de produção nesta etapa.
