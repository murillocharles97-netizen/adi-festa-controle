# Sincronização: comparação legível, saldos retidos e recuperação explicada

Branch `claude/sync-diagnostico-saldos`, a partir da `main` `e45a934` (V242.8). Somente frontend. Sem mudança em Functions, Rules, protocolo ou formato da fila. Este documento usa apenas dados fictícios; a análise com dados reais fica fora do repositório.

## Causas encontradas

1. **As contagens "Aparelho" e "Nuvem" medem universos diferentes.**
   - O aparelho conta tudo o que guarda localmente. Isso inclui registros do Fiado antigo que o encerramento autorizado removeu do servidor e operações retidas na fila.
   - A nuvem conta só os documentos ativos.
   - O download nunca apaga um registro local que sumiu da nuvem ("ausência não é tombstone"). Por isso o histórico local permanece, e a diferença aparecia como se fosse perda.
2. **A comparação por registro nunca rodava quando havia operações bloqueadas.**
   - A sincronização manual só fazia a auditoria somente leitura com a fila sem erros.
   - Erros históricos que não podem mais ser reenviados deixavam `integrityStatus` em `not_checked` e o último resultado de comparação em `null` para sempre.
3. **Uma operação bloqueada congela o saldo do cliente no aparelho.**
   - `pendingIds('clients')` inclui operações com erro ativo, e o download ignora o documento do servidor desses clientes.
   - Uma regularização confirmada pelo servidor não aparece no aparelho.
   - O diálogo de regularização dizia apenas que a lista "será atualizada", o que não acontecia, e isso poderia levar a um segundo ajuste.
4. **A exportação de recuperação está correta, mas explicava mal.**
   - Ela só aceita vendas originais recusadas por falta de permissão (`permission-denied` ou `sale-recovery-review-required`).
   - Vendas recusadas por outro motivo, como configuração de custo de serviço ausente, não entram, e o botão continua desabilitado.
   - A tela não dizia isso.
5. **"Sincronizado" aparecia sem comparação.** O rótulo do celular e a mensagem da sincronização automática diziam que tudo estava sincronizado sem nenhuma conferência com a nuvem.

## Correções

- **`compareLocalAndCloud()`**
  - calcula, para vendas e pagamentos, quantos registros são do Fiado antigo encerrado, quantos estão retidos na fila e quantos são comparáveis;
  - aplica a mesma regra de arquivamento aos documentos lidos da nuvem no download completo;
  - compara comparável com comparável, mantendo os totais brutos;
  - se essa explicação falhar, volta às contagens brutas e registra o erro, sem derrubar a sincronização.
- **`retainedClientBalances()`, somente leitura:** para cada cliente retido pela fila, mostra lado a lado o saldo do aparelho, o último saldo lido do servidor nesta sessão e as operações que o retêm.
- **Sincronização manual:** faz a comparação somente leitura quando não há nada enviável, nada em andamento e nenhuma falha ativa.
  - A comparação reutiliza os documentos do download.
  - Erros bloqueados mantêm o estado de erro.
  - Quando a comparação é adiada, o motivo fica em `integrityDeferredReason`.
- **Diagnóstico exportado ganha:**
  - `countComparison`, com a base comparável;
  - `retainedClientBalances`, sem nomes;
  - `integrityDeferredReason`;
  - em vendas, pagamentos e ajustes, os campos `clientId`, `spaceId`, `archivedLegacyFiado`, `heldByQueue` e `serverRegularization`.
- **Tela "Sincronização dos dados":**
  - abre com um único estado em linguagem simples: Tudo confirmado, Atualizando dados, Diferenças encontradas, Operações antigas precisando de revisão ou Dados do aparelho ainda não confirmados na nuvem;
  - abaixo do estado, quatro conferências: envio, operações antigas, comparação e saldos de clientes;
  - as ações aparecem só quando podem ser executadas, cada uma com a sua finalidade;
  - a grade técnica vai para "Detalhes técnicos da fila".
- **Exportação de recuperação:**
  - a tela de sincronização consulta quantas vendas são elegíveis e só oferece o botão quando há pelo menos uma; sem nenhuma, explica o motivo;
  - o diálogo mantém "Preparar arquivo" desabilitado e diz para que serve o arquivo.
- **Regularização:** se o servidor confirmou, mas o aparelho retém o cliente, a mensagem diz que o saldo já está confirmado e que não se deve registrar outro ajuste.
- **"Sincronizado":** o rótulo do celular só aparece depois de uma comparação desta sessão sem diferenças. A sincronização automática passa a dizer "Alterações deste aparelho confirmadas na nuvem".

## Não alterado

- Nenhum dado local, fila, recibo ou IndexedDB é apagado, reenviado, arquivado ou recalculado.
- A regra de elegibilidade da recuperação e a validação de identidade ficam como estão.
- Saldos retidos não são corrigidos automaticamente. A liberação depende da revisão das operações bloqueadas.

## Verificações

| Verificação | Resultado |
|---|---|
| `tests/sync-comparison-clarity.test.cjs` | 22/22. Inclui a reprodução na base publicada: contagens brutas divergentes e nenhuma comparação com 3 vendas bloqueadas. |
| Suíte completa (`node --test --test-concurrency=4 tests/*.test.js tests/*.test.cjs`) | Nenhuma falha nova por nome em relação à base `e45a934`. A única falha nova encontrada no caminho (CSS citando "balance" dentro do bloco do login) foi corrigida. |
| Emulator: 4 suítes de Rules que carregam `sync.js` | Idêntico à base: 16 aprovados e 28 falhas preexistentes, com os mesmos nomes. |
| `npm run lint`, `npm run build`, `build:public`, `test:public-containment`, `sync-version-identity` | Aprovados. O pacote público tem 284 arquivos; o isolamento, 56/56. |
| Tela com dados fictícios em 360, 390, 412, 768 e 1366 px, temas claro e escuro | Sem rolagem horizontal. Estado, conferências e ações legíveis. |

## Não verificado

- Aparelho Android físico.
- Dados reais. A comparação real só roda no aparelho, com a sessão do responsável.
- Leitura direta de produção.

## Publicação

- Pode ir como release de correção separada, sem o trabalho de cobrança em lote. Versão e cache ficam para a release.
- Rollback: reverter os commits desta branch e publicar uma versão nova. Nada no formato local muda, então filas e recibos continuam compatíveis.
