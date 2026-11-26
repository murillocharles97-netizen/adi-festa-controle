# Arquitetura financeira única — etapas

A conta por Espaço vira o motor financeiro de todos os clientes, antigos e novos. O motor
antigo, que reconstrói o histórico a cada operação, vira ferramenta de auditoria. Durante
a transição, quando a conta não estiver comprovada, a rota antiga decide. Esse recuo é
temporário e some na Fase 5.

Cada etapa:

- é local até ter GO específico;
- fica numa branch própria, construída sobre a anterior;
- tem interruptor e rollback;
- passa por testes de paridade financeira e de regressão.

## Ponto de partida

A análise mostrou a necessidade de cobrir clientes existentes, inclusive quando há parcelamento ou falta prova da origem. A preparação de cada empresa deve confirmar essa cobertura antes da ativação.

## Etapas

| Etapa | O que entrega | Paridade exigida |
|---|---|---|
| 1. Cliente novo nativo | A primeira venda Fiado abre a conta por Espaço. O recebimento por Espaço aloca às vendas na ordem do histórico, marca a venda paga e confirma os pontos. A conta guarda os itens em aberto. | Rota pela conta e reconstrução: mesmos itens, na mesma ordem, depois de cada operação. |
| 2. Migração dos clientes simples | Comando do proprietário que converte o cliente sem mudar saldo, vendas ou recebimentos. Só aceita o histórico que comprova a mesma divisão por venda e por Espaço. | Saldo, valor pago e restante de cada venda iguais antes e depois; conta igual à reconstrução. |
| 3. Parcelamentos | A conta guarda o calendário por Espaço: vencidas, futuras e alocação por parcela. | Mesmas parcelas, vencimentos, valores e alocação da rota atual. |
| 4. Abertura e migração gerais | Abertura por Espaço e migração para qualquer empresa e Espaço, sem política fixa. | Mesma conferência da abertura atual, em Espaços e empresas fictícios. |
| 5. Conta na mesma transação | Venda, recebimento, cancelamento e ajuste atualizam a conta na própria transação. O gatilho vira só conferência. | Conta transacional igual à reconstrução em sequências aleatórias e concorrentes. |
| 6. Motor antigo como auditoria | A reconstrução completa sai do caminho de cada evento e passa a rodar por amostragem e sob demanda, com relatório de divergências e reconciliação assistida. | O auditor acusa toda divergência plantada e nenhuma falsa. |
| 7. Preparar a Fase 5 | Telas, Cobranças e recebimentos sem a prova de 60 s e sem a projeção local de regras antigas. Lista do que sai, com seus testes. | Telas iguais às de antes em todos os regimes, com a conta como única fonte. |

## Pontos acompanhados em todas as etapas

| Ponto | Como é conferido |
|---|---|
| Campanhas que contam vendas pagas | Venda quitada pelo recebimento por Espaço confirma os pontos. Recebimento parcial não confirma. |
| Indicadores e relatórios | Suítes de Dashboard, Clientes, Cobranças e relatórios, sem falha nova. |
| Histórico individual de vendas | Valor pago, restante e quitação de cada venda iguais aos da rota antiga. |
| Recebimentos parciais | Alocação à venda mais antiga do Espaço, como no regime simples. |
| Offline e sincronização | Fila de vendas montadas no mesmo estado local; reenvio idempotente. |
| Concorrência, idempotência e cancelamentos | Dois recebimentos sobre a mesma consulta: um confirma e o outro é recusado. Venda paga não é desfeita, nem por um aparelho desatualizado. |
| Isolamento entre empresas e Espaços | Rules por Espaço; recebimento só aloca vendas do próprio Espaço; testes com empresas fictícias separadas. |

## Situação (local, sem push nem deploy)

Cada branch parte da anterior, sobre a Fase 4c (`claude/fase4c-recebimento`).

| Etapa | Branch | Documento |
|---|---|---|
| 1 | `claude/etapa1-cliente-nativo` | `etapa1-cliente-nativo.md` |
| 2 | `claude/etapa2-migracao-simples` | `etapa2-migracao-simples.md` |
| 3 | `claude/etapa3-parcelamentos` | `etapa3-parcelamentos.md` |
| 4 | `claude/etapa4-abertura-geral` | `etapa4-abertura-geral.md` |
| 5 | `claude/etapa5-conta-transacional` | `etapa5-conta-transacional.md` |
| 6 | `claude/etapa6-auditoria` | `etapa6-auditoria.md` |
| 7 | `claude/etapa7-preparacao-fase5` | `etapa7-preparacao-fase5.md` |
