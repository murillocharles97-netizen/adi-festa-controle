# V242.12 — saldo contínuo e fluidez (preparada, não publicada)

Ponto de partida: V242.11 publicada (`b21164d`). Comparação: V242.9 (`2c93126`), V242.10
(`9767085`), V242.11 (`b21164d`) e a correção (`8f8efe8`). Somente frontend: nenhuma
alteração em Functions, Rules ou dados. Todos os números abaixo vêm de dados e servidor
fictícios.

## Sintoma

No Android, um cliente com dívida histórica regularizada por Espaço mostrava o saldo,
depois deixava de mostrar e voltava sozinho algum tempo depois. Junto com isso, o app
tinha lentidão e pequenas travadas.

## Causas confirmadas

1. **O saldo sumia quando a confirmação de 60 s vencia** (`js/installment-credit.js`).
   A mesma prova do servidor autorizava operações e alimentava os cards. Ao vencer
   (`DISPLAY_TTL`), o card voltava para "a conferir" até chegar uma nova resposta. Isso
   acontecia em vários momentos:
   - no ciclo de 30 s (`expireDisplayedProofs`);
   - a cada status de sincronização;
   - a cada atualização de clientes;
   - a cada evento financeiro (`recheck` apagava todas as provas);
   - ao ficar offline ou voltar a ficar online.

   A regra existe desde a V228. Ela só ficou visível na V242.11, quando o servidor passou
   a comprovar a conta regularizada. Antes, a conta falhava sempre e o card ficava
   permanentemente em "A conferir".
2. **Uma resposta superada esperava 15 s.** Uma consulta em andamento durante um evento
   financeiro era descartada, como deve ser, mas era registrada como falha. A nova
   tentativa só acontecia depois de `RETRY_DELAY`, e o saldo ficava fora da tela nesse
   intervalo.
3. **Renderização completa a cada confirmação.** Cada resposta, mesmo com o mesmo valor:
   - disparava `fiado-account-updated`;
   - recalculava a projeção de todos os clientes (`prepareList`);
   - renderizava a página inteira fora da tela para copiar os totais
     (`updateVisibleTotals`).

   Além disso, o `MutationObserver` da lista chamava a hidratação a cada mutação do DOM.
   A hidratação repintava todos os cards em fila (`paintAll`) antes de consultar.
4. **Leituras repetidas no servidor a cada passagem da fila** (V242.10,
   `js/firebase/sync.js`). `refreshMaintenanceResolutions` lia 4 documentos no servidor
   para cada original bloqueado sem decisão registrada, até 20, em toda passagem. Isso
   antecedia o envio de vendas novas. As passagens acontecem depois de cada venda ou
   recebimento, ao voltar para o app e ao reconectar.

## Correções

- **Exibição e autorização separadas** (`f5465ff`).
  - Cards, totais da lista e resumo do perfil usam `displayAccount`: o último valor
    confirmado do mesmo escopo, só enquanto bate exatamente com o cadastro do cliente
    (mesma versão financeira e saldo, mesmo dia).
  - Um cliente cujo saldo mudou não mostra o valor antigo.
  - A nota "atualizando…" ou "desatualizado / sem conexão · confirmado às HH:MM" só
    aparece quando a revalidação demora, falha ou não há conexão.
  - `confirmedAccount`, `financialStatus` e `listFinancialStatus` no modo normal não
    mudaram. Recebimentos, cobranças, mensagens e vendas continuam exigindo a prova de
    até 60 s ou uma consulta nova ao servidor.
  - Uma resposta superada é refeita na hora, sem a espera de 15 s.
  - Uma resposta nunca sobrescreve outra pedida depois dela (número de sequência por
    cliente).
  - Uma resposta com o mesmo valor só atualiza a nota: não renderiza a página nem
    recalcula a lista.
  - O observador da lista passou a ser agrupado (no máximo uma verificação a cada 150 ms)
    e a hidratação não repinta antes de consultar.
  - Nada é guardado entre reinícios. Uma troca de sessão, empresa ou Espaço descarta o
    valor guardado.
- **Consulta de decisões no servidor uma vez, não a cada passagem** (`813a962`). Sem
  decisão encontrada, o mesmo original só é procurado de novo depois de 10 minutos ou na
  sincronização manual. Uma leitura incompleta por falha de rede é tentada de novo na
  passagem seguinte.
- **Auditoria reproduzível** (`82e0164`): `scripts/audit-saldo-fluidez.cjs`.
- **Versão** (`d80ac98`): 242.12, cache `veconi-v24212-saldo-continuo-v1`.
- **"Consultar saldo"** (`8f8efe8`): durante uma consulta manual, o card não é redesenhado; a
  resposta, de sucesso ou de erro, continua visível.

## Medição

Laboratório do repositório (`scripts/audit-saldo-fluidez.cjs`): app real, Chrome em perfil
Android (390 px, CPU 4× mais lenta), dados e servidor fictícios.

- **Cenário:**
  - proprietário com Espaço ativo e 3 clientes com dívida regularizada;
  - navegação contínua Clientes → Cobranças → Dashboard → Vendas;
  - sincronização em segundo plano a cada 5 s;
  - minutos alternados com internet instável (0,2–2,5 s e 15% de falhas);
  - 6 s offline nos minutos 3 e 7 e troca de Espaço no minuto 5;
  - uma venda registrada durante a sincronização em cada ciclo.
- **Versões:** as quatro rodaram ao mesmo tempo. Os tempos absolutos servem só para
  comparar.
- **Rotas:** no celular, "Fiados" abre Clientes, por isso a Central de Fiado medida é
  Cobranças.
- **Cópia medida da correção:** `82e0164`. O `8f8efe8` muda só o botão "Consultar saldo",
  que o roteiro não usa.

### Uso contínuo por 10 minutos, 2.000 clientes

| | V242.9 | V242.10 | V242.11 | V242.12 |
|---|---|---|---|---|
| Sumiços do saldo confirmado | 35 | 34 | 34 | 3 |
| Tempo com o saldo oculto | 130,9 s | 130,5 s | 123,9 s | 3,4 s |
| Maior sumiço | 19,8 s | 19,8 s | 19,6 s | 1,1 s |
| Saldo ao voltar para Clientes (mediana / p95) | 0,8 / 18,1 s | 0,8 / 15,4 s | 0,9 / 18,8 s | imediato / 2,0 s |
| Renderizações completas da página | 226 | 224 | 222 | 36 |
| Renderizações de card | 520 | 512 | 509 | 209 |
| Trocas do bloco de saldo | 91 | 89 | 89 | 25 |
| Tarefas longas (> 50 ms) | 307 · 73,3 s | 310 · 73,4 s | 305 · 73,3 s | 176 · 54,4 s |
| Abrir Clientes (mediana) | 616 ms | 649 ms | 681 ms | 521 ms |
| Abrir Cobranças / Dashboard / Vendas | 1,82 / 0,35 / 0,57 s | 1,86 / 0,31 / 0,60 s | 1,85 / 0,34 / 0,62 s | 1,84 / 0,32 / 0,56 s |
| Registrar venda durante a sincronização (mediana) | 571 ms | 544 ms | 552 ms | 508 ms |
| Consultas da conta de Fiado por minuto | 7,4 | 7,2 | 7,4 | 8,1 |
| Memória JS no fim (faixa no período) | 60,5 MB (45–63) | 62,2 MB | 62,2 MB | 56,1 MB (45–63) |
| Intervalos ativos / erros de página | 2 / 0 | 2 / 0 | 2 / 0 | 2 / 0 |

- **Os 3 sumiços da V242.12** acontecem todos na troca de Espaço, por desenho: o valor
  guardado não passa de um escopo para outro.
- **Consultas:** subiram cerca de 10%. A consulta refeita depois de uma mudança financeira
  agora sai na hora. Antes, ela esperava 15 s com o saldo fora da tela.
- **Memória:** oscila na mesma faixa nas quatro versões, sem tendência de crescimento.

### 3 minutos por volume

| Clientes | Sumiços (V242.9 / V242.10 / V242.11 / V242.12) | Oculto | Renderizações completas | Tarefas longas | Abrir Clientes |
|---|---|---|---|---|---|
| 200 | 6 / 12 / 12 / 0 | 68,5 / 59,3 / 58,4 / 0 s | 66 / 76 / 75 / 13 | 6,7 / 7,8 / 8,2 / 6,4 s | 454 / 908 / 1.017 / 495 ms |
| 500 | 12 / 12 / 12 / 0 | 64,0 / 64,2 / 62,3 / 0 s | 75 / 75 / 76 / 13 | 12,1 / 12,2 / 12,3 / 9,6 s | 699 / 664 / 620 / 643 ms |
| 2.000 | 11 / 11 / 11 / 0 | 68,5 / 71,6 / 72,9 / 0 s | 72 / 72 / 71 / 14 | 24,6 / 25,7 / 25,9 / 20,6 s | 810 / 686 / 723 / 566 ms |

No laboratório, a conta regularizada é comprovada nas quatro versões. Em produção, até a
V242.10 ela falhava no servidor e o card ficava parado em "A conferir". Por isso o sumiço
só passou a aparecer no celular com a V242.11.

### Sincronização: leituras por passagem da fila

Medição com 5 originais bloqueados sem decisão, 300 ms por leitura e 12 passagens com
1 minuto entre elas. A última passagem foi manual. Script fora do repositório; o
comportamento é coberto por `tests/sync-maintenance-resolution.test.cjs`.

| | Leituras no servidor | Espera antes de enviar vendas |
|---|---|---|
| V242.9 | 0 | — |
| V242.10 e V242.11 | 20 em cada passagem (240 no total) | cerca de 1,55 s em cada passagem |
| V242.12 | 20 na 1ª passagem, nenhuma nas seguintes, 20 depois de 10 min e 20 na manual (60 no total) | 0 nas passagens sem leitura |

### Próximas prioridades de desempenho (não iniciadas)

O perfil de CPU com 2.000 clientes mostrou três custos que já existiam na V242.9 e não
mudaram entre as versões. Eles ficam fora desta release, na ordem aprovada. Nenhum deles
começa antes da homologação da V242.12 no Android.

1. **Eliminar a cópia completa dos dados a cada venda.** `business-cache.js` (`ordered` e
   `clone`) copia a base local inteira em cada gravação: cerca de 1,9 s de CPU em 90 s de
   uso, com cerca de 0,5 s por venda com 2.000 clientes.
2. **Otimizar a ordenação e os cálculos da Central de Cobranças.** A ordenação recalcula o
   saldo de cada cliente a cada comparação, e abrir Cobranças leva cerca de 1,8 s com
   2.000 clientes.
3. **Otimizar o Dashboard mobile.** O cálculo do Dashboard no celular (`home-mobile.js`)
   aparece entre os maiores custos do perfil.

## Verificações

- **Testes unitários completos:** 2.577 testes e 116 falhas, as mesmas 116 da V242.11 pelo
  nome. Nenhuma falha nova.
  - Inclui vendas, recebimentos e dívida histórica, ajustes, estoque, serviços,
    sincronização e offline, e Espaços.
  - Novos: `tests/fiado-held-balance-v24212.test.cjs` (5) e 3 testes em
    `tests/sync-maintenance-resolution.test.cjs`.
  - Ajustado: o teste offline de `tests/fiado-balance-display-v228.test.cjs`, que agora
    exige o valor marcado como desatualizado e o estado estrito "unverified".
- **`release-version-check`:** OK, 242.12.
- **`sync-session-alert`:** 8 de 8.
- **Pré-cache:** 312 entradas, sem duplicatas; todos os arquivos com `?v=24212` estão no
  pré-cache.
- **Dados reais:** cada commit do intervalo `b21164d..8f8efe8` foi varrido em busca de
  valores, nomes, IDs, telefones e e-mails reais. Nenhum foi encontrado; o telefone que
  aparece é fictício e já estava no repositório.

## Não verificado

- Android físico, rede móvel real e volume real de clientes do aparelho.
- Quantos originais bloqueados o aparelho tem. O ganho da correção 4 é proporcional a
  esse número.
- Latência real da Function, incluindo o tempo de partida a frio. Isso afeta quando a
  nota "atualizando…" aparece, não a permanência do valor.
- A tela de Fiados do computador (`app.js fiadoCard`) não foi alterada.

## Rollback seletivo

Esta release é só de frontend. Cada parte é um commit independente:

- Só a exibição: `git revert 8f8efe8 f5465ff`, que volta o comportamento da V242.11 nos
  cards.
- Só a sincronização: `git revert 813a962`.
- Ambas: reverter os commits do app desde `b21164d` e publicar como 242.13, com um cache
  novo.

As correções de integridade financeira da V242.11 (Functions `getOperationalSyncReceipt`
e `commitOperationalSync` e a prova da conciliação neutra) não fazem parte desta release
e continuam publicadas em qualquer caminho.
