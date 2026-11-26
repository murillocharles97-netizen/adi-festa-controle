# Etapa 6 — o motor antigo como auditoria e reconciliação

Local, sem push nem deploy. Plano geral em `arquitetura-unica-etapas.md`.

A reconstrução completa do histórico (`fiado-history-account.project`) deixa de ser o
caminho de cada operação e passa a auditar e reconciliar a conta por Espaço.

## O que muda

- **Auditoria por amostra no gatilho.** Os eventos já aplicados na transação (Etapa 5) são
  auditados:
  - um em cada `AUDIT_EVERY` (20);
  - quando a última auditoria da conta tem mais de `AUDIT_MAX_AGE_MS` (7 dias);
  - na primeira vez em que a conta é vista.

  Os eventos que o próprio gatilho aplica continuam sendo verificados sempre, porque a
  verificação refaz os itens.
- **Comparação item a item.** A auditoria compara o total, cada Espaço e cada item em aberto
  mantido pelas transações com o que a reconstrução comprova: venda, parcela e restante.
- **Divergência registrada.** Cada auditoria grava o resultado em
  `customerAccountAudits/{cliente}`, que só o servidor lê. Uma divergência guarda os dois
  lados e a ação tomada:

  | Divergência | Ação |
  |---|---|
  | Itens divergentes com total certo | Os itens comprovados substituem os mantidos (`items_replaced_by_proof`). |
  | Total divergente | A conta sai do recebimento, e a rota completa decide até a reconciliação (`ledger_withdrawn`). |

- **Comandos do proprietário** em `manageCustomerAccounts`:

  | Chamada | O que faz |
  |---|---|
  | `customer_account_audit` | Audita um cliente agora, ou as contas da empresa por página, com um resumo por situação. |
  | `customer_account_reconcile` | Refaz a conta de um cliente a partir do histórico comprovado, com identificador e proteção contra repetição. Sem prova, indica a abertura por Espaço (Etapa 4). Para cliente fora da conta por Espaço, indica a migração. |

## Onde o motor antigo ainda roda

| Uso | Situação |
|---|---|
| Auditoria por amostra e sob demanda | Ferramenta. |
| Reconciliação, carga, migração e abertura | Ferramenta: montam a base comprovada uma vez. |
| Gatilho, para eventos que a transação não acompanhou | Recuo, por exemplo nas correções de manutenção. |
| Recebimento quando a conta não está em dia | Recuo temporário. Sai na Fase 5. |
| Comando de ajuste (`PROOF_COMPATIBILITY`) e regularização | Conferência enquanto a prova antiga ainda é aceita. Sai na Fase 5. |

## Testes

`tests/emulator/account-audit.test.cjs`:

| Teste | O que confere |
|---|---|
| Sequência limpa | A auditoria da empresa não gera nenhum alerta. |
| Itens trocados | 10 reais passam de uma venda para outra, com o mesmo total. A auditoria acusa, guarda os dois lados e substitui pelos comprovados; a rota volta a bater com a reconstrução. |
| Total errado | A conta sai do recebimento, e a rota completa decide com o valor certo. A reconciliação do proprietário refaz a conta; a repetição é idempotente, e a auditoria seguinte confere. |
| Amostra do gatilho | Sem amostra, só a primeira auditoria. Com auditoria recente, nada é reconstruído. Com amostra total ou auditoria vencida, todos os eventos são auditados. |
| Permissões | Só o proprietário audita e reconcilia. Cliente fora da conta por Espaço vai para a migração. |

`tests/emulator/customer-account.rules.test.js`: ninguém lê nem grava o resultado das
auditorias.

## Suítes completas

| Suíte | Resultado | Em relação à base |
|---|---|---|
| Unidade | 2614 testes, 115 falhas antigas | Nenhuma falha nova. |
| Emulator das Fases 0 a 4c e Etapas 1 a 6 | 89 testes, nenhuma falha, 1 ignorado | Mais 5 desta etapa. |
| Rota de recebimento e crediário anteriores | 20 e 16 aprovados, 1 ignorado cada | Igual à base. |
| Rules | 519 testes | O teste novo passa. A falha a mais é o teste de criações simultâneas do diretório de clientes, já conhecido por instabilidade. |
