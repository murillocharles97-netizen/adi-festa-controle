# Fase 1 — conta por Espaço em modo sombra

A Fase 1 cria uma conta por cliente que guarda quanto ele deve em cada Espaço. O servidor
a atualiza a cada evento do razão (`balanceEvents`), e ela é conferida com o saldo
cadastral e com a reconstrução completa do histórico.

Nada no app lê esta conta: nem a exibição, nem a autorização, nem o recebimento. Nenhum
caminho financeiro existente foi alterado. Nada foi publicado.

## Peças

- **`functions/src/shared/customer-account.js`**: regras puras da conta.
  - Cada evento confirmado soma ao Espaço de origem, ou à parte sem Espaço quando o
    evento não tem um.
  - O resultado não depende da ordem em que os eventos chegam.
  - Monta a base a partir da projeção comprovada ou, quando o histórico não se
    comprova, a partir da soma dos eventos.
  - Faz a comparação.
- **`functions/src/services/customer-account-service.js`**:
  - `applyEvent`: aplica um evento numa transação própria, sem repetir. Usa um marcador
    por evento em `customerAccounts/{cliente}/appliedEvents/{evento}`. Na primeira vez de
    cada cliente, monta a base e registra até qual evento ela já inclui.
  - `verifyClient`: reconstrói o histórico e grava o resultado em `verification`.
- **`functions/src/index.js`**: o gatilho `projectCustomerAccount`, disparado na criação
  de `businesses/{id}/balanceEvents/{evento}`, com nova tentativa automática em caso de
  falha.
- **`firestore.rules`**: `customerAccounts` e `appliedEvents` ficam sem leitura e sem
  escrita para qualquer aparelho. Só o servidor grava.
- **Interruptores**: `SHADOW_ENABLED` e `VERIFY_EVERY_EVENT` em
  `customer-account-service.js`. Desligar o primeiro interrompe a conta sombra sem efeito
  em nenhum outro fluxo.

## Formato da conta

```
schemaVersion, mode: 'shadow', businessId, workspaceGeneration, clientId
debtCents            positivo = deve, negativo = crédito
spaces               { espaço: centavos } (Espaços zerados saem)
unattributedCents    eventos sem Espaço (ajustes antigos)
eventCount, lastEvent {appliedAt, id}
baseline             { source: history_projection | event_sum, cut, eventCount,
                       unexplainedCents (saldo que os eventos não explicam), unprovableReason }
verification         { status: match | mismatch | balance_only, differences, scoped, financialVersion, at }
```

A verificação confere três coisas:

- **O saldo cadastral**, sempre.
- **O total da projeção**, quando o histórico se comprova.
- **Cada Espaço**, quando a projeção é por Espaço. Nas contas que ainda não são por
  Espaço, a projeção abate os recebimentos da dívida mais antiga, sem olhar o Espaço. Por
  isso, ali a diferença por Espaço aparece como "atribuição" e não conta como erro.

## Testes (dados fictícios)

| Teste | O que cobre |
|---|---|
| `tests/customer-account-v1.test.cjs` | Regras puras, 7 testes: soma por Espaço, ordem de chegada, crédito, eventos ignorados, base comprovada, base sem prova, tipos de divergência |
| `tests/emulator/customer-account-shadow.test.cjs` | Código real do servidor no Emulator, 8 testes, detalhados abaixo |
| `tests/emulator/customer-account.rules.test.js` | Proprietário, gerente, vendedor e visitante sem login não leem nem gravam a conta ou os marcadores (4 testes) |

Os 8 testes no Emulator usam operações reais do servidor:

1. Regularizações em dois Espaços conferem com o histórico depois de cada evento.
2. Eventos entregues de novo ou fora de ordem não mudam a conta.
3. Uma conta criada no meio do histórico usa a projeção como base, e os eventos antigos
   não contam duas vezes.
4. Um recebimento verificado reduz só o Espaço de origem.
5. O ajuste antigo sem Espaço vai para a parte sem Espaço; o crédito aparece como dívida
   negativa e confere com o saldo cadastral.
6. Um saldo antigo sem eventos aparece como "não explicado", sem inventar origem.
7. Eventos não confirmados, de outra empresa, de outra geração ou com a projeção desligada
   não gravam nada.
8. Leituras no servidor:

| Etapa | Documentos lidos |
|---|---|
| Base inicial com 2 eventos | 19 |
| Aplicar um evento, com 11 eventos no histórico | 3 |
| Aplicar um evento, com 41 eventos no histórico | 3 |
| Verificar, com 11 eventos no histórico | 69 |
| Verificar, com 41 eventos no histórico | 249 |

O teste de contrato da Fase 0 continua igual e passando: 17 de 17.

A suíte completa de Rules tem 515 testes: os 511 da `main` mais os 4 novos. As 85 falhas
são as mesmas da `main`, teste por teste, sem nenhuma nova. Os testes que leem as
exportações das Functions também mantêm as falhas que já existiam na `main`.

## Decisões para a Fase 2

- **Atribuição por Espaço nas contas que não são por Espaço.** Hoje, o recebimento sem
  Espaço abate a dívida mais antiga, de qualquer Espaço. A carga precisa de uma regra
  explícita para essas contas, aprovada pelo proprietário.
- **Saldo não explicado.** Alguns saldos antigos não têm eventos que os expliquem. Eles
  precisam de uma abertura por Espaço, não de uma suposição.
- **Corte da base.** A base usa a data de aplicação e o id do evento. Um evento gravado
  durante a montagem da base com uma data anterior ao corte seria ignorado. A verificação
  acusa esse caso, e a conta pode ser remontada.
- **Custo da verificação.** Verificar a cada evento reconstrói o histórico. Isso serve
  para a homologação. Depois, o certo é verificar por amostragem ou periodicamente
  (`VERIFY_EVERY_EVENT`).
- **Leitura pelos aparelhos (Fase 4).** Um único documento com vários Espaços não permite
  restringir a leitura de quem só acessa alguns Espaços. A leitura deve vir por Espaço,
  por exemplo um documento por cliente e Espaço, quando a conta passar a ser usada.

## Publicação e rollback

- **Publicação:** exige deploy da Function `projectCustomerAccount` e das Rules. As duas
  coisas ficam para um GO específico.
- **Rollback da Function:** `SHADOW_ENABLED = false`, ou remover a Function.
- **Rollback dos dados:** os documentos de `customerAccounts` podem ser descartados, porque
  nada depende deles.
