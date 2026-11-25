# Força-tarefa de estabilização da sincronização

**Branch:** `claude/estabilizacao-sync`, criada a partir de `main` em `2c93126` (V242.9).
**Estado:** implementação e testes locais. Sem merge, push, deploy ou alteração de dados reais.
**Dados:** este documento usa só dados fictícios. Identificadores reais e valores ficam fora do repositório.

## Escopo e autorização

| Autorizado (GO) | Não autorizado (NO-GO) |
|---|---|
| auditoria somente leitura | alterar dados reais |
| implementação local | excluir ou restaurar |
| testes | merge |
| simulações de reparo | deploy |

**Preservado:**
- a branch de cobrança em lote do Codex;
- Functions e Rules de produção;
- o formato da fila;
- a compatibilidade com a V242.9 e com sessões existentes.

## Fontes de diagnóstico

| Fonte | Situação |
|---|---|
| Firestore de produção | Lido em modo somente leitura, com a credencial do Firebase CLI. Um cliente com trava recusa, antes de enviar, qualquer método de escrita (`PATCH`, `DELETE`, `commit`, `beginTransaction`). Cópias guardadas fora do repositório. |
| Logs das Cloud Functions | Lidos. Mostram só o status HTTP das chamadas; o motivo da recusa não é registrado pelas Functions. |
| Recibos (`processedOperations`) | Lidos. |
| Android via ADB / DevTools | **Indisponível.** Nenhum aparelho conectado. Falta ativar "Depuração USB" no aparelho e autorizar este computador. |
| IndexedDB, fila e bloqueios do Android | Avaliados pelo último diagnóstico exportado (V242.8), registro a registro, contra a cópia atual do servidor. |

## Causas encontradas

1. **"Diversas divergências" na V242.9.**
   - A contagem de diferenças somava todo registro que só existe na nuvem.
   - Isso inclui o que o aparelho não guarda por design: cadastros inativos, vendas antigas de antes dos Espaços (sem Espaço) e registros de testes antigos.
   - Na conta auditada, a tela anterior teria mostrado cerca de 66 diferenças. A classificação nova deixa 2 que exigem atenção, 4 que dependem de decisão e 63 explicadas.
2. **Exportação no Android.**
   - Os downloads clicavam num link fora da página e revogavam o arquivo após 1 s. O gerenciador de downloads do Android pode ler o arquivo depois disso.
   - A mensagem de sucesso aparecia sem depender do resultado.
   - Afetava o diagnóstico, o backup de Configurações, o arquivo de recuperação, a imagem do recibo e a planilha do crediário.
3. **Decisão de manutenção guardada só no aparelho.**
   - A conciliação ou a recuperação de uma operação antiga ficava registrada apenas no armazenamento local do aparelho que a executou.
   - Se esse registro se perdesse, a operação voltava a parecer bloqueada e o cliente voltava a ficar retido, mesmo com a decisão registrada no servidor.
4. **Proteções que não rodavam.**
   - 164 testes falhavam na V242.9.
   - Dezenas deles cobrem sincronização e dinheiro (vendas offline, falha ao gravar a fila, troca de sessão, recuperação no checkout, saldos de Fiado). Falhavam por desatualização do harness, não do código.

## Correções (commits)

| Commit | O que muda |
|---|---|
| `56ead0f` | **Classificação, tela e exportações.** `js/sync-findings.js` classifica cada diferença (exige atenção, precisa de decisão, recuperável, aguardando envio, explicada), com motivo em linguagem simples. A tela de Sincronização foi reorganizada, a recuperação individual e em lote (`runSafeRecoveryBatch`) foi criada e `js/export-center.js` entrega os arquivos de forma confiável. |
| `7781af0` | **Decisão do servidor reconhecida de novo.** A fila volta a reconhecer conciliação ou recuperação registradas no servidor. Exige mesma venda, operação, empresa, geração e Espaço, mais o marcador processado com hash de auditoria. |
| `f91f237` | **Testes de proteção restaurados.** 48 testes de sincronização e finanças voltaram a rodar. |
| `3218eb2` | **Cenários novos.** Atualização de versão durante o envio, troca de Espaço, mesma operação em dois aparelhos e modo offline. |
| `5a1e729` | **Login preservado.** O fluxo de login congelado continua intacto. O backup da tela de login fica para uma decisão separada. |

### Tela de Sincronização

A tela segue esta ordem:
1. **Estado**, um de cinco: atualizando, não confirmados, diferenças, revisão, confirmado.
2. **Última confirmação do servidor.**
3. **Exigem atenção.**
4. **Precisam da sua decisão**, com o motivo de cada bloqueio.
5. **Recuperáveis com segurança**: individual e "Recuperar todos".
6. **Aguardando envio.**
7. **Sincronizados.**
8. **Diferenças explicadas**, recolhida e com o motivo de cada uma.
9. **Exportar e compartilhar.**
10. **Detalhes técnicos**, recolhidos, com todo o conteúdo anterior.

Se o aparelho ainda tiver o `sync.js` anterior em cache, a tela anterior continua igual.

### Recuperação segura

- Compara de novo com a nuvem antes de enviar e depois de terminar.
- Ignora o que a nova comparação não comprova.
- Nunca envia a mesma operação duas vezes no lote.
- Faz um único backup antes do primeiro envio.
- Para se a sessão mudar.
- Deixa de fora operações bloqueadas; essas são decididas uma a uma.
- Informa o resultado de cada item.
- Não permite dois lotes ao mesmo tempo. O teste pegou uma corrida nisso, corrigida antes do commit.

### Exportações

| Ação | Conteúdo |
|---|---|
| Compartilhar diagnóstico / Baixar diagnóstico completo | Diagnóstico técnico redigido, mais o relatório de divergências |
| Copiar diagnóstico resumido | Texto curto. Se a cópia falhar, aparece o texto para cópia manual |
| Relatório das divergências | Um item por achado, só com identificadores |
| Baixar backup completo | Pede confirmação, por conter dados pessoais |

- O resultado mostrado é o real: entregue, cancelado, download iniciado ou falha.
- Se o compartilhamento falhar, a VECONI tenta o download.
- Os arquivos de suporte removem nomes, telefones, e-mails, endereços, documentos, observações, tokens e chaves.

## Cenários de prevenção e evidência

| Cenário | Teste |
|---|---|
| Internet instável | `sync-d3-recovery`: internet instável; Wi-Fi sem internet |
| Vendas offline | `sync-resilience-scenarios`: sem conexão; `financial-write-ahead-v146`: offline |
| Fechamento inesperado | `sync-d3-recovery`: fechar e reabrir |
| Atualização com operações pendentes | `sync-resilience-scenarios`: atualização no meio do envio |
| Perda de resposta do servidor | `sync-d3-recovery`: resposta não chega |
| Operações simultâneas em aparelhos | `sync-resilience-scenarios`: mesma operação em dois aparelhos |
| Duplicidade | `sync-recovery-batch`, `sync-d3-recovery`; Emulator `operational-compatibility` (recuperações simultâneas) |
| Conflito de versão financeira | Emulator `operational-compatibility` (versão antiga recusada); `financial-domain` |
| Troca de Espaço | `sync-resilience-scenarios`; `read-hydration-v204` |
| Recuperação após falha parcial | `sync-recovery-batch` (falha parcial e nova rodada); `sync-maintenance-resolution` |

Regra transversal: nenhuma operação é descartada nem considerada sincronizada sem recibo do servidor. Os testes acima verificam isso.

## Verificações

**Testes novos (fictícios), 44 no total:**
- `sync-findings`: 11;
- `export-center`: 7;
- `sync-recovery-batch`: 9;
- `sync-screen-v24210.dom`: 7;
- `sync-maintenance-resolution`: 6;
- `sync-resilience-scenarios`: 4;
- `sync-comparison-clarity` (V242.9): 22 de 22, mantidos.

**Suíte completa:** 2546 testes, 117 falhas, contra 164 na V242.9.
- 48 consertados.
- 0 falhas novas, comparando nome a nome.

**Emulator** (portas próprias, sem tocar no Emulator do Codex nem na produção):
- `operational-compatibility`: 41 passando, 2 pulados por condição do próprio teste, 0 falhas. Cobre conciliação única, versão antiga recusada e recuperações simultâneas sem duplicar.
- Os 4 arquivos que carregam o `sync.js`: as mesmas 28 falhas da V242.9, comparadas nome a nome. Nenhuma nova.

**Build:**
- lint;
- pacote público com os 2 arquivos novos na lista permitida;
- isolamento 56 de 56;
- precache do service worker com `?v=24210-estab`.

**Visual:**
- 360, 390, 412, 768 e 1366 px, temas claro e escuro;
- sem rolagem horizontal.

**Falhas restantes classificadas:**
- 4 de `only-local-recovery-v147`: recuperação feita no aparelho, que foi para o servidor na V202. Coberta pelo Emulator `operational-compatibility`.
- 4 de `customer-balance-consecutive-v145`: o harness ainda precisa de mais peças.
- As demais são testes de releases antigas fixados em versões passadas ou de telas fora deste escopo. Nenhuma é nova.

## Não verificado

- Android físico: sem ADB.
- Dados reais aplicados: NO-GO.
- Publicação: NO-GO.

## Release V242.10

Prioridade: registrar vendas novas com confiança. O passado que exige recuperação complexa fica de fora.

### Incluído nesta release

- Tudo o que está acima.
- **"Encerrar sem efeitos"** para as vendas de serviço recusadas antes da V241:
  - usa a conciliação auditada com o saldo atual da nuvem como alvo, então o ajuste registrado é zero;
  - pede confirmação e faz backup antes;
  - mantém o original e o erro no aparelho;
  - é idempotente e nunca entra no lote.
- **Releitura completa dos clientes** quando um aviso de sincronização inclui ajustes de saldo:
  - a regularização feita no servidor não atualiza `updatedAt`, por isso a leitura incremental não a via em outros aparelhos;
  - também vale para o aparelho que estava offline: o mapa de versões em produção é acumulado, e o aviso pendente fica salvo.
- **Versão:** 242.10, cache `veconi-v24210-estabilizacao-v1`.
- **Arquivos com `?v=24210-estab`, todos no precache:** `sync.js`, `firebase-ui.js`, `auth.js` (só a importação), `app.js`, `recibos.js`, `installment-credit.js`, `sale-recovery-ui.js`, `css/firebase.css`, `sync-findings.js`, `export-center.js`.

### Verificações da release

| Verificação | Resultado |
|---|---|
| Suíte unitária | 2552 testes, 116 falhas; nenhuma nova em relação à V242.9, comparando nome a nome |
| Emulator completo | 511 testes; 85 falhas contra 86 na V242.9, nenhuma nova. As antigas são de gravação direta pelo navegador, bloqueada pelas regras desde a V202, ou de harness. |
| Vendas Pix, dinheiro, cartão e fiado | 36 de 36 |
| Ajuste e regularização de saldo | 14 de 14 |
| Estoque | 31 de 31 |
| Serviços e corridas | 33 de 33 |
| Sincronização, offline e duplicidade | 80 de 80 |
| Tela e exportação | 15 de 15 |
| Recebimento de fiado | 29 de 31 (as 2 falhas antigas só procuram texto de código) |
| Isolamento de Espaços | 41 de 42 (a falha antiga só procura texto de código) |
| Versão e identidade dos módulos | `release-version-check` OK; `sync-session-alert` 8 de 8 |
| Precache | 311 entradas, sem duplicatas; os 11 endereços versionados presentes |
| Pacote público | 286 arquivos; isolamento 56 de 56 |
| Teste local do pacote (390 e 1366 px) | 235 requisições com 200; service worker ativo com o cache novo; build 242.10; único erro de console = servidor externo bloqueado pelo teste |

### Rollback

1. Reverter os commits da força-tarefa sem forçar a `main`, num único commit:
   ```
   git revert --no-commit 2c93126..HEAD && git commit -m "Revert V242.10"
   ```
2. Publicar como 242.11, com cache `veconi-v24211-rollback-v1`.

Nenhum formato de fila, recibo ou dado salvo mudou. Voltar não invalida operações pendentes, e as decisões já registradas no servidor continuam válidas.

### Pendências para a próxima versão

- **Functions:** a regularização de saldo deve gravar `updatedAt`. Perfis sem permissão de ver ajustes só veem a regularização depois de "Sincronizar agora".
- **Motor comercial gerado:** está desatualizado em relação ao `sync.js` (`--check`). Já estava assim na V242.9; exige revisão e deploy de Functions.
- **Download do backup na tela de login:** o arquivo está congelado pelo teste da V203.
- **Limpeza de dados de QA e estoque negativo antigo:** exigem GO específico.
- **Harnesses antigos:** 4 da arquitetura de recuperação anterior à V202 e 4 de saldo consecutivo.

## Homologação da V242.10 no Android — correções locais (V242.11, não publicada)

### Cliente com dívida histórica regularizada mostrando "A conferir"

**Causa (reproduzida com a apuração real do servidor, somente leitura):**
1. A conta de Fiado desses clientes é apurada no servidor (`fiado-history-proof`), que exige um evento financeiro confirmado para todo ajuste.
2. A conciliação auditada que encerra uma venda antiga sem efeitos (`legacy_reconciliation:<venda>`, valor 0) não gera evento por definição.
3. A apuração falhava com `source-without-confirmed-effect`. O app nunca recebia a conta confirmada e o card ficava "A conferir"; o recebimento de Fiado desse cliente também ficava bloqueado.

**Correção (`functions/src/shared/fiado-history-proof.js`):**
- só essa conciliação, comprovadamente neutra, dispensa evento: padrão do identificador, tipo, subtipo, resolução, valor zero e saldo inalterado;
- qualquer outro ajuste continua exigindo evento confirmado;
- a cadeia de eventos continua tendo de fechar com o saldo atual.

**Resultados:**
- Na apuração com os dados reais, só um cliente muda de resultado: passa de "sem prova" para o exigível correto.
- Clientes sem histórico apurado no servidor não são afetados pela conciliação neutra.

**Requer deploy de Functions** (`getOperationalSyncReceipt` e `commitOperationalSync`). Não publicado.

### "Consultar saldo" sem resposta

- Na lista filtrada por Espaço, o botão retornava em silêncio quando o cliente não estava na visão ou o perfil não tinha permissão, e só avisava a falha por toast.
- Na lista geral e na Central de Fiado, "Consultar saldo" era uma etiqueta sem ação.

**Agora:**
- todo toque responde com "Consultando…", o valor confirmado pelo servidor ou o motivo;
- a dívida regularizada visível é consultada sozinha também nas listas filtradas por Espaço;
- o saldo local nunca é usado.

### "45 diferenças sem explicação"

- **Causa principal:** documentos de custo (produtos, variações, vendas) que existem só na nuvem eram contados como diferença sem olhar o registro de origem. Na conta auditada, são custos de 23 produtos inativos, 6 produtos de QA, 2 variações de QA e vendas desfeitas ou de QA.
- **Clientes de QA da V200:** os 7 que aparecem como divergentes são registros de teste.

**Agora:**
- o custo herda o motivo do seu registro;
- um custo sem registro de origem continua exigindo atenção;
- registros de QA são reconhecidos também quando divergentes ou só no aparelho, e nunca são oferecidos para recuperação.

Simulação na forma da conta auditada: 35 sem explicação passam a 0, e as 43 linhas continuam listadas com o motivo.

### "3 recuperáveis" contra "0 pendências somente locais"

- O indicador da tela principal (pendências somente locais) conta só vendas e recebimentos.
- O da tela detalhada inclui cadastros (clientes, produtos, variações) que existem só no aparelho.
- As 3 corridas de 19/11 estão encerradas no servidor (conciliações de valor zero) e aparecem como "explicadas".
- Os 3 recuperáveis não são vendas. Se forem registros de teste, a nova versão os mostra como QA e não os recupera. Caso contrário, o relatório das divergências exportado do aparelho mostra quais são, só com identificadores.

### Plano de limpeza dos resíduos de QA (aguarda GO; nada executado)

**Inventário somente leitura** na empresa real:
- 15 vendas de QA (12 pagas, R$ 379,24 de faturamento fictício; 3 canceladas);
- 15 produtos de QA, 2 variações e 8 clientes de QA (2 com R$ 39,00 em aberto dentro do total do Fiado).

**Dependentes:**

| Coleção | Documentos |
|---|---|
| Movimentações de estoque | 32 |
| Eventos de atividade | 25 |
| Custos de vendas | 20 |
| Pedidos do catálogo | 14 |
| Reservas de pedido online | 14 |
| Aberturas do Fiado | 8 |
| Custos de produtos | 6 |
| Reservas de estoque online | 6 |
| Marcadores de operação | 4 |
| Custos de variações | 2 |
| Recuperações e revisões | 2 + 2 |
| Logs de auditoria | 2 |
| Membro | 1 |

**Passos propostos:**
1. Inventário final assinado (IDs e hash de cada documento) e backup somente desses documentos.
2. Para cada raiz, conferir que nenhuma venda, recebimento ou ajuste real referencia o registro.
3. Remover pelo servidor, numa operação auditada por lote pequeno: um documento de auditoria com o hash do backup, sem tocar em registros reais. Os saldos de QA saem do total do Fiado e as vendas de QA, do faturamento.
4. Reconferir o livro de saldos (abertura mais eventos igual ao saldo) e as contagens antes de liberar.
5. Rollback: restaurar os documentos do backup do passo 1.

Isso não interfere nas vendas novas. É uma correção de relatórios e totais.

### Interferência nas operações de amanhã

| Área | Situação |
|---|---|
| Vendas (Pix, dinheiro, cartão, fiado), estoque e ajustes | Não são afetados por essas divergências, que são só de comparação |
| Fiado dos clientes das 3 corridas | Liberado: as conciliações ficam registradas como revisadas |
| Recebimento de Fiado do cliente com dívida regularizada | **Bloqueado em produção** até o deploy da correção das Functions |
| Exibição do saldo desse cliente | Depende da PWA V242.11 mais o mesmo deploy |
