# V225 — hotfix de cobrança

Candidato local sobre a V224 sanitizada `730abca9b1c4128042770074e4a07b2a2d132f21`, branch `codex/v225-billing-hotfix`. Sem push, deploy, cobrança, cancelamento ou reparação de produção nesta preparação.

**Revisão corretiva de03/11:** o candidato inicial `41d5095…` foi interrompido no preflight. A versão atual adiciona o guard de faturas/retentativas descrito em `CORRECTION.md`, com hashes separados em `corrective-hashes.json`. A comprovação de Orders no painel permanece independente e pendente. Nenhuma correção foi aplicada em produção.

## Escopo e integridade

Os dez originais do hotfix de02/11 estão preservados no pacote privado congelado. `original-hashes.json` mantém seus SHA256 brutos e normalizados. Na revisão corretiva, seis arquivos não index continuam iguais por LF; três módulos e o índice possuem o delta documentado separadamente, além de um guard interno novo. Os92 exports da V224 permanecem, seis handlers de cobrança continuam idênticos e somente createSubscription ganha a reconferência antes do POST. Nunca substituir o índice canônico inteiro pelo índice antigo do bundle.

O verificador confirma essa relação, a allowlist e ausência de outros arquivos de produção alterados. As diferenças entre as demais dependências do bundle antigo e a árvore V224 são de módulos não utilizados pelos sete handlers (reset, assets, equipe e projeção financeira); permission-service, subscription-service, catálogo e dependências de cobrança conferem. O backend integrado foi testado novamente.

Arquivos de produção do release completo: sete de backend e quatro de frontend, enumerados no manifesto. O commit corretivo altera somente quatro fontes existentes e acrescenta o guard interno; o frontend não muda nesta correção. Não há nova Function exportada, Rules, índices, Google, permissões V3, código de vendas retroativas ou protocolo Sync neste release.

A V226 permanece em `codex/previous-sales-v1`, commit `bcdc215e1f9f33aab459f5c5c62d6dbf6ee56bdb`; não foi reescrita ou integrada.

## Fluxo revisado

1. Owner autenticado escolhe plano, ciclo e forma. Cotação/cupom são validados no servidor. O valor antigo não quita o plano novo e desconto legado não é transferido implicitamente.
2. Em migração, GET do contrato e de todas as páginas de faturas antigas antecede a reserva. Estado scheduled/recycling, qualquer next_retry_date remanescente, pagamento pendente/aprovação recente, respostas incompletas ou estado desconhecido bloqueiam contratação e reparação para análise. Há nova conferência imediatamente antes do POST; a reserva exige prova interna vinculada ao contexto e recente.
3. Reserva e tentativa preservam operationId/hash, tenant e autor. Retry usa os mesmos identificadores e a idempotência do provedor.
4. Pix/cartão mensal usam Orders sem `notification_url`. Cartão preserva exatamente o Device ID do SDK no header oficial, tokenização e 3DS. Não inventa identificadores nem dados de cartão.
5. A reserva `creating` só pode ser encerrada pela ação separada `recover_failed_migration`, consentida pelo owner. Exige prova confiável de rejeição antes da criação, ausência de concorrência na assinatura antiga, GET Orders vazio, ausência de efeitos/vínculos e transação com lease. Reconferir a assinatura antes do lease e antes de encerrá-la. Preserva histórico e auditoria; a ação não cria pagamento. A consulta de uma reparação já concluída não a executa outra vez.
6. Somente aprovação oficial e validação de identidade, referência, valor, moeda e pagamento ativam o novo período. Webhook assinado ou consulta oficial autenticada do owner gera a prova correspondente. Duplicatas e resposta perdida não criam outro período.
7. O encerramento do contrato antigo pertence ao fluxo já existente de migração, depois da ativação nova e de prova válida. A confirmação do cancelamento é verificada no provedor. Esta preparação não executa esse fluxo nem autoriza cancelamento antecipado/manual.
8. Aprovação tardia de tentativa encerrada/superada fica em conferência. Falha de cancelamento mantém o plano pago novo ativo e permite retomada idempotente. A tolerância administrativa não vira pagamento.

Há uma corrida externa residual: o provedor não oferece transação única entre o débito antigo e o pagamento novo. O guard bloqueia riscos conhecidos e incertezas nas leituras, mas não garante que o provedor jamais agende uma cobrança após a última consulta. Eventual alteração posterior exige conciliação individual, sem crédito de período, estorno ou segundo pagamento automáticos. A retentativa já conhecida da3 Lindas continua bloqueando sua regularização até nova prova remota segura; esta correção não cancela essa retentativa.

## Publicação progressiva — somente após autorização específica

### Preflight

- Reconfirmar main/domínio/SW na base esperada, sete revisões de billing, dois rulesets GitHub ativos, hashes e credencial temporária autorizada. Interromper se houver alteração inesperada.
- Reconsultar a assinatura, a tolerância e as faturas completas da empresa, incluindo status do wrapper e next_retry_date. Não reutilizar um diagnóstico antigo como prova atual de inexistência de pagamento. A fatura scheduled identificada no preflight impede nova contratação/reparação enquanto permanecer arriscada ou inconclusiva.
- Conferir destino HTTPS, segredo e tópico Orders em Integrações do Mercado Pago. Não remover tópicos antigos necessários a transações pendentes. Nenhuma configuração do provedor foi alterada nesta etapa.
- Fixar hashes do pacote e rollback integrado. Não usar pacote privado antigo ou deploy genérico.

### Backend

Publicar individualmente nesta ordem, usando somente o diretório backend gerado pelo packager:

1. `retryLegacyPlanMigrations`
2. `receiveWebhook`
3. `getPixCheckoutStatus`
4. `getCardCheckoutStatus`
5. `syncSubscription`
6. `getBillingCheckoutConfig`
7. `createSubscription`

O filtro deve conter exclusivamente esses nomes (`functions:NOME`), nunca `--only functions` nem um deploy que inclua Rules. Conferir revisões ativas e configuração existente, sem alterar segredos, IAM, planos ou empresas.

### QA antes do frontend

Conferir handlers/versões e compatibilidade V224, autorização, dados retornados e flags. Usar somente QA isolada e credenciais de teste para qualquer chamada que crie pedido ou simule pagamento; não mudar a configuração global da produção para executar testes. Na ausência dessa infraestrutura, manter os testes de efeitos no Emulator e bloquear a etapa que dependa de comprovação ainda não obtida. Não fazer uma cobrança real como smoke.

### Frontend/PWA e validação real

- Publicar o commit sanitizado pelo procedimento protegido do GitHub, com workflow de allowlist. Verificar Actions, domínio, versão225, recursos e Service Worker.
- Smoke sem efeitos comerciais: login existente, plano/cotação, carregamento do checkout e feedback de erro. Não limpar armazenamento, deslogar usuários ou reprocessar filas.
- A reserva antiga da 3 Lindas pode continuar bloqueada até uma atestação administrativa específica e curta, após nova prova remota de rejeição e ausência de efeitos. A proposta anterior não foi aplicada por esta tarefa. Isso exige autorização específica de reparação; o deploy de código sozinho não regulariza a reserva.
- Depois, o owner usa **Gerenciar assinatura → Verificar tentativa interrompida**, confirma a conferência e escolhe plano/cotação/meio novamente. Pro mensal do catálogo V2 é R$119,90 sem cupom, sujeito à cotação atual e à escolha explícita. Nunca reutilizar R$50,34 como preço do plano novo.
- Somente uma contratação/pagamento explicitamente autorizado. Consultar a tentativa existente após demora ou resposta perdida; não solicitar segundo pagamento. Confirmar aprovação oficial, novo plano/período único e situação do contrato antigo.

## Rollback compatível

O packager prepara uma variante de contenção: apenas `createSubscription` bloqueia novos checkouts; `getPixCheckoutStatus`, `getCardCheckoutStatus`, `syncSubscription`, `receiveWebhook` e processamento de pagamentos já aprovados continuam disponíveis. A verificação GET-only de reserva também permanece. Frontend usa `billingCheckoutPaused:true` e novo nome de cache estático, sem apagar caches, armazenamento comercial, filas ou sessões.

Rollback modifica somente três arquivos: guard de criação em `functions/src/index.js`, flag em `js/build-info.js` e nome do cache em `service-worker.js`. Preserva integralmente o novo guard de retentativas, inclusive na reparação. Não reutilizar `331cb454…` como rollback da correção, pois ele antecede esse guard. Não restaura o código com payload defeituoso, não desativa confirmação de pagamentos e não desfaz assinaturas já pagas. Regras e todos os dados permanecem preservados. Nunca voltar simplesmente à árvore V224 para desfazer este release.

A referência local de rollback compatível é preparada como commit separado sobre o candidato. Seu hash e tag serão registrados no relatório de fechamento; nada é enviado ao remoto sem autorização.

## Preparação e validação reproduzíveis

```text
node scripts/verify-billing-release.cjs
node scripts/verify-billing-release.cjs --original-package DIRETORIO_PRIVADO_ORIGINAL
node scripts/package-billing-release.cjs NOVO_OUTPUT_PRIVADO NOVO_OUTPUT_PUBLICO_DENTRO_DO_WORKTREE
```

O packager contém somente código e package files do backend, frontend por allowlist e contenção. Não copia `.env`, credenciais, fixtures ou provas de produção. Builds antigos e os dez originais continuam preservados.

Ver `VALIDATION.md` para os comandos, resultados e pendências. Android/PWA físico, SDK antifraude/3DS completo com credenciais de teste e confirmação oficial de uma contratação real não são substituídos pelos adaptadores sintéticos.

## Integração posterior da V226

Depois da V225 publicada e validada, fixar seu commit efetivo e reaplicar somente o delta V226 em integração separada. Preservar módulos de cobrança, requestUpgrade, guard de checkout, flags de ambas as versões e Service Worker. `functions/src/index.js` é integrado por trechos, mantendo todos os exports; nunca copiar arquivos antigos de cobrança para resolver conflito. Reexecutar as regressões afetadas e gerar novo candidato/rollback combinado antes de considerar V226 pronta.

## Referências de contrato

- [Migração Payments → Orders: notificações configuradas na integração](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/migrate-payments-to-orders).
- [Device ID e header oficial](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/improve-payment-approval/recommendations).
- [Busca de Orders por referência e datas](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/search-order/get).
