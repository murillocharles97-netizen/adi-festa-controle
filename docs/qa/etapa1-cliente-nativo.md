# Etapa 1 — cliente novo nativo na conta por Espaço

Local, sem push nem deploy. Plano geral em `arquitetura-unica-etapas.md`.

## O que muda

### 1a. O recebimento por Espaço aloca às vendas

Até aqui, nos regimes por Espaço (abertura e regularização), o recebimento consumia a
dívida do Espaço sem registrar em qual venda. A venda paga continuava em aberto no
histórico, e a campanha não confirmava os pontos.

Agora a reconstrução por Espaço informa a venda de cada item em aberto. O aparelho aloca o
recebimento às vendas do Espaço, da mais antiga para a mais nova, como no regime simples:

- a venda quitada é marcada como paga;
- o recebimento parcial fica registrado na venda;
- a campanha confirma os pontos da venda quitada.

O saldo antigo, sem venda, é consumido primeiro, porque é o mais antigo.

O servidor já aceitava essa alocação e já conferia que a venda é do mesmo Espaço. A ordem
dos itens não mudou. Vale também para os clientes já abertos ou regularizados, a partir do
próximo recebimento.

A conciliação de divergências anteriores ficou fora desta etapa. Cada caso exige validação individual e autorização própria.

### 1b. A conta guarda os itens em aberto

A verificação da conta (carga, gatilho e comando de ajuste) guarda os itens em aberto de
cada Espaço, na ordem da reconstrução. O recebimento pela conta (Fase 4c) devolve esses
itens, e não mais uma linha única. Assim, conta e reconstrução alocam às mesmas vendas.

### 1c. A primeira venda Fiado abre a conta do cliente novo

Na transação da primeira venda Fiado, o servidor coloca o cliente no regime por Espaço. É
o mesmo regime de uma regularização, sem mudar valor.

Só acontece quando todas as condições abaixo valem:

| Condição | O que se exige |
|---|---|
| Cliente | Ativo, sem regime por Espaço, sem abertura, sem parcelamento, com saldo 0 e versão financeira 0. |
| Histórico | Sem recebimento, ajuste, evento, alocação ou venda Fiado anterior. |
| Venda | Tem Espaço e não é parcelada. Parcelas entram na Etapa 3. |

A leitura do histórico usa um contexto interno do servidor, então um vendedor sem acesso
aos clientes não trava a venda. O marcador da operação registra a ativação. A segunda
venda não reativa.

Interruptor: `NATIVE_SPACE_ACCOUNT_ENABLED` em `operational-commit-service.js`. Com `false`,
o cliente novo volta ao regime simples. Quem já foi aberto continua como está.

### 1d. Aparelho

Com o saldo do servidor ativo no aparelho, cliente sem dívida e sem documento publicado
aparece com zero, sem consultar a conta. Sem essa regra, cada cliente por Espaço sem
dívida geraria uma consulta na lista.

O aparelho já enviava o indicador de histórico em vendas, cancelamentos, recebimentos e
ajustes. O recebimento no card já exigia conexão para todos os clientes. Nada muda nisso.

### Correção encontrada pela verificação

O gatilho da conta sombra (Fase 1) podia contar duas vezes um evento que já estava na
base. Isso acontecia quando a base era montada com outros eventos já gravados, por
exemplo se o gatilho de um evento anterior rodasse atrasado.

A causa era o formato do horário. O servidor grava o horário do evento como Timestamp; a
reconstrução o lê como texto ISO. Comparados como texto, o Timestamp sempre parecia mais
novo. Agora os dois viram o mesmo texto antes de comparar. O teste de unidade e o teste no
Emulator cobrem esse caso.

## O que continua igual

- **Cancelamento.** Venda que já recebeu pagamento não é desfeita, como no regime simples.
  O aparelho recusa, e o servidor também, quando um aparelho desatualizado tenta.
- **Clientes já movimentados no regime simples.** Continuam nele até a migração (Etapa 2).

## Testes

| Teste | Resultado |
|---|---|
| `tests/emulator/native-space-account.test.cjs` | 6 de 6 |
| `tests/fiado-native-receipt.dom.test.cjs` (campanha e recebimento parcial no aparelho) | 2 de 2 |
| `tests/fiado-shared-balance-v24213.test.cjs` (com o caso de cliente sem dívida) | 6 de 6 |
| `tests/customer-account-v1.test.cjs` (com o caso do horário) | 8 de 8 |

O teste no Emulator cobre:

- ativação na primeira venda, e cliente já movimentado sem mudança;
- recebimento parcial e total, com paridade entre a conta e a reconstrução depois de cada
  operação;
- cliente regularizado antes;
- fila offline e reenvio;
- dois recebimentos concorrentes;
- cancelamento de venda sem pagamento e recusa de venda paga.

## Suítes completas

| Suíte | Resultado | Em relação à base |
|---|---|---|
| Unidade | 2610 testes, 115 falhas antigas | Nenhuma falha nova. Numa primeira rodada, 10 testes de `sale-cancellation-dom` falharam juntos sob carga; sozinho e na segunda rodada, passaram 10 de 10. |
| Emulator das Fases 0 a 4c e Etapa 1 | 68 testes, nenhuma falha, 1 ignorado | Mais 6 desta etapa. |
| Rota de recebimento anterior | 20 aprovados, 1 ignorado | Igual à base. |
| Rules | 517 testes | Uma falha a mais por tempo esgotado do Emulator. Sozinho, o teste passou; as outras 3 falhas do arquivo já existem na base. |
| Lint e contenção do pacote público | 577 arquivos; 56 de 56 | Sem erro. |
