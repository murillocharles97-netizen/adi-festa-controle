# Etapa 7 — preparação da Fase 5

Local, sem push nem deploy. Plano geral em `arquitetura-unica-etapas.md`.

A Fase 5 tira do aparelho a dependência da prova (a consulta de cada conta ao servidor) e da
projeção financeira antiga. Esta etapa prepara isso:

- a consulta passa a ler a conta;
- há uma medida objetiva de prontidão;
- está registrado o que sai, quando sai e qual teste protege cada saída.

## O que muda nesta etapa

### Consulta da conta lê a conta por Espaço

A consulta `fiado_account` é a usada pelo aparelho para mostrar saldos comprovados e
iniciar crediário. Ela responde da conta quando o cliente está no regime por Espaço e a
conta está em dia com ele:

- a mesma forma da reconstrução (versão 2), com os mesmos itens e parcelas;
- o mesmo controle de Espaço: quem não é proprietário precisa acessar cada Espaço com item
  em aberto;
- leituras constantes.

Senão, reconstrói como antes. Interruptor: `LEDGER_READ_ENABLED` em
`fiado-account-service.js`.

### Cancelamento pela Function em qualquer Espaço do cliente

Antes, a Function exigia que o Espaço principal do cliente fosse o Espaço da venda.
Agora basta o cliente estar ligado a esse Espaço. A venda e o débito continuam precisando
ser do próprio Espaço, e o acesso do perfil ao Espaço continua sendo conferido.

### Prontidão para a Fase 5

Novo comando do proprietário, `customer_account_readiness`, em `manageCustomerAccounts`,
somente leitura. Classifica cada cliente:

| Situação | Significado |
|---|---|
| `ledger_current` | Na conta por Espaço, em dia com todas as operações. |
| `verified_only` | Comprovado só pela última verificação. |
| `stale` / `no_account` | Precisa de auditoria ou reconciliação. |
| `finding` | Auditoria com divergência aberta. |
| `needs_migration` | Cliente simples que pode migrar. |
| `needs_opening` | Precisa de abertura por Espaço. |
| `no_history` | Sem movimento. |
| `archived` | Arquivado. |

`readyForPhase5` só fica verdadeiro quando todo cliente ativo com histórico está em
`ledger_current`, sem divergência aberta.

## O que sai na Fase 5

| Hoje | Arquivo | Substituto | Condição para sair | Teste que protege |
|---|---|---|---|---|
| Consulta de conta por cliente para exibir (`hydrateVisible`, `refresh`, `displayAccount`, saldo retido da V242.12) | `js/installment-credit.js` | Saldo por Espaço publicado (Fase 4) e regra do saldo zero (Etapa 1) | `readyForPhase5` em produção por 14 dias e saldo publicado ativo nos aparelhos | `fiado-shared-balance-v24213.test.cjs`: nenhum regime consulta a conta com o saldo ativo |
| Projeção local do legado: `closedOpeningStatus` vinculada ao Espaço do corte, recontagem do legado, regularizados sem calendário | `js/clientes.js` | Saldo publicado | Igual à linha anterior | Mesmo teste, e as suítes de Clientes e Cobranças |
| Consulta da conta original e prova para recebimento sem rota (`openOriginalDirectory`, `originalProof`) | `js/fiados.js` | Rota de recebimento pela conta (4c) | Nenhum recebimento sem rota nos registros de 30 dias | Testes de recebimento da 4c e da Etapa 1 |
| Campos do legado na primeira venda (`legacyBalance`, `legacyBalanceRemaining`) | `js/vendas.js` | Cliente nativo na conta por Espaço (Etapa 1) | Nenhum cliente simples com histórico | `native-space-account.test.cjs` |
| Rota completa quando a conta não está em dia | `fiado-receipt-route.js` | Conta mantida na transação (Etapa 5) | Auditorias sem divergência por 30 dias | `transactional-account.test.cjs` e `account-audit.test.cjs` |
| Conferência da prova antiga no ajuste (`PROOF_COMPATIBILITY`) | `customer-balance-adjustment-service.js` | Conta mantida na transação | Igual à linha anterior | `customer-balance-adjustment.test.cjs` e `transactional-account.test.cjs` |
| Função da regularização de 12/11 (`reviewFiadoOriginEvidence`) | `fiado-origin-evidence-handler.js` | Abertura geral (Etapa 4) | Central de regularização sem pendências | `customer-account-opening.test.cjs` |

A reconstrução completa continua como ferramenta, por amostra e sob demanda (Etapa 6), na
carga, na migração, na abertura e na reconciliação.

## Ordem sugerida para publicar as etapas

Cada passo tem GO próprio:

1. **Rules.** Fase 4 e Etapas 2, 4 e 6.
2. **Functions.** Todas as alteradas nas Fases 1 a 4c e Etapas 1 a 7.
3. **Carga auditada por empresa.**
4. **Migração de clientes elegíveis.**
5. **Abertura individual das contas que precisarem dela.**
6. **Prontidão.** Conferir `readyForPhase5`.
7. **Frontend** com a nova versão.
8. **Fase 5.** Depois do prazo de observação.

## Testes

`tests/emulator/phase5-readiness.test.cjs`, com 3 testes:

| Teste | O que confere |
|---|---|
| Consulta da conta | Responde da conta, igual à reconstrução (itens, parcelas e totais), com o mesmo número de leituras enquanto o histórico cresce. Com a conta atrasada, reconstrói como antes. |
| Cancelamento | Cancelamento pela Function no Espaço secundário do cliente, com a conta acompanhando. |
| Prontidão | Mostra cliente sem movimento, arquivado, com divergência e a migrar. Só libera depois da reconciliação e da migração. |

`tests/fiado-shared-balance-v24213.test.cjs`: com o saldo do servidor ativo, nenhum dos cinco
regimes consulta a conta para exibir: abertura, regularizado, nativo, migrado e simples.

## Suítes completas

| Suíte | Resultado | Em relação à base |
|---|---|---|
| Unidade | 2615 testes, 115 falhas antigas | Nenhuma falha nova. |
| Emulator das Fases 0 a 4c e Etapas 1 a 7 | 92 testes, nenhuma falha, 1 ignorado | Mais 3 desta etapa. |
| Rota de recebimento e crediário anteriores | 20 e 16 aprovados, 1 ignorado cada | Igual à base. |
| Rules | 519 testes, 85 falhas antigas | Igual à base. |
