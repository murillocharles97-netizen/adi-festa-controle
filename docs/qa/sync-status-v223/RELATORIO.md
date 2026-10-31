# V223 — estado de Sync após recuperação

Base sanitizada V222 `f5e3f1e00f0e602b8478a68e304ad6af1bcdad38`. Trabalho local, sem push/deploy. Nenhum dado comercial, fila ou armazenamento real alterado.

## Recuperações reais: leitura canônica

As duas vendas indicadas foram conferidas individualmente nos originais, recibos de coleta, índice de operações, decisões de recuperação, vendas canônicas, `processedOperations`, movimentos de estoque, entradas financeiras e eventos de Histórico.

| Venda original de 26/10/2026 | Situação | Estoque | Financeiro |
|---|---|---|---|
| 16:57:05 — R$107,16 — dinheiro | Recuperada com decisão e atestado do proprietário | 2 movimentos originais, uma vez | 1 entrada paga de 10716 centavos |
| 19:37:24 — R$69,16 — Pix | Recuperada com decisão e atestado do proprietário | 2 movimentos originais, uma vez | 1 entrada paga de 6916 centavos |

IDs e horários originais foram preservados, assim como os valores e hashes dos envelopes. Decisões `recovered`, atestados individuais de entrega/pagamento/ausência de recriação, autor correspondente ao proprietário canônico, recibos `processed` e hashes vinculados. Os eventos canônicos de Histórico estão confirmados. As recuperações ocorreram em 29/10/2026 às 22:38:17 e 22:38:26, horário de São Paulo.

A comparação de possíveis duplicatas percorreu as vendas do espaço com o mesmo critério de itens/quantidades e dia ou valor, abaixo do limite seguro de 500. Nenhuma venda equivalente adicional foi encontrada. Conjuntos de movimentos por operationId e venda coincidem exatamente com os IDs originais; não se comparou o estoque atual a snapshots antigos. Não existem novos pagamentos, alocações, intenções de cobrança ou eventos de saldo desses operationIds. As duas entradas representam as vendas à vista já recebidas, sem nova cobrança.

Evidências privadas e identificadores completos estão fora do repositório em `C:/Users/Murillo/.codex/visualizations/2026/10/31/v223-sync-resolution/`. Não são recursos públicos. Não houve sessão no computador do gestor; a correspondência entre os dois envelopes inventariados e as duas resoluções canônicas foi verificada, mas não se afirma ter inspecionado os sidecars atuais daquele perfil Chrome.

## Causa reproduzida no código publicado

A hipótese inicial era incompleta: a V222 **já exclui** resoluções válidas de `errors` indiretamente, pois `queueManualReviewReason → queueQuarantineReason → readRecoveryResolution` retorna `recovery_resolved`. A regressão fixada no commit V222 confirma `queueCounts().errors=0` e `archived=2` com provas válidas.

O defeito reproduzido é o desacoplamento da apresentação:

1. `refreshRecoveryResolutions` grava metadados separados, sem emitir imediatamente uma nova projeção.
2. O painel/detalhes mistura `lastState.errors` antigo com `getQueueDiagnostics()` atual. O DOM da V222 reproduz exatamente **2 erros ativos e 2 resolvidos** no mesmo painel.
3. `updateQueueState` pode não emitir nenhuma atualização quando os pré-requisitos de estado saudável não estão prontos ou quando permanece um `syncFailure`. Assim, a mensagem e a cor de um erro anterior sobrevivem à resolução.
4. O ícone do painel aberto era desenhado na abertura, mas não tinha sua classe atualizada em `renderState`.
5. O detalhe resolvido usava apenas `linkedSaleId`, ignorando `saleId`; uma recuperação monetária podia aparecer incorretamente como encerramento sem efeitos.

Sem a versão/estado em memória atuais do dispositivo não se atribui um ramo exclusivo ao print. Os defeitos acima são comprovados por execução dos scripts V222 intactos e pela reprodução do DOM; não é necessário repetir uma venda para demonstrá-los.

## Os 54 registros

O diagnóstico preservado de **28/10/2026, V208**, contém a lista exata de 54 vendas em `saleIntegrity.verificationPending`; não havia comparação remota concluída (`comparedAt` vazio e `lastCloudComparison` ausente). Esse estado significa que o conteúdo local atual não tinha prova de comparação válida. Não significa ausência no servidor.

Comparação realizada em 31/10, somente leitura:

- **54/54 documentos presentes** no caminho canônico da empresa.
- **54/54 operationIds correspondentes**.
- **0 ausentes** entre esses IDs.
- 54 checksums atuais diferentes dos registrados no diagnóstico antigo, usando o algoritmo da V208. O diagnóstico contém metadados e checksum, não os 54 payloads completos: não é possível separar com segurança diferenças de representação/metadados de alterações comerciais campo a campo.
- Nenhum marcador explícito de QA foi encontrado nesses documentos. Nenhum registro foi excluído da verificação por nome, idade ou ID.

Essa análise não substitui uma comparação do conteúdo atual daquele aparelho. A lista de 54 do print atual pode ou não ser idêntica à lista preservada. A ação mínima, pelo próprio app, é **Nuvem → Ver detalhes → Comparar com a nuvem**, uma comparação de leitura, sem Reprocessar, recuperação ou limpeza. A V223 mantém diferenças reais visíveis; não marca automaticamente esses registros como iguais nem grava marcadores otimistas de confirmação.

## Implementação

`classifyQueueOperation` passa a ser a origem comum dos contadores, diagnósticos, estado, exportação e elegibilidade de reenvio. Categorias disjuntas:

| Categoria | Enviável | Erro ativo | Revisão | Arquivado/resolvido |
|---|---|---|---|---|
| Pendente autorizado | Sim | Não | Não | Não |
| Processando / preparando local | Não | Não | Não | Não |
| Erro não resolvido | Não automaticamente | Sim | Conforme motivo | Não |
| Revisão manual / quarentena | Não | Não | Separada | Não |
| Prova de resolução/arquivamento inválida ou conflitante | Não | Sim | Explicação de bloqueio | Não |
| Arquivada sem efeitos, com recibo válido | Não | Não | Não | Sim |
| Resolvida com prova canônica vinculada | Não | Não | Não | Sim |

Os erros originais continuam nos envelopes e aparecem nos detalhes de auditoria: código, mensagem, tentativas, checksum e estado original. Nada é normalizado ou removido da fila.

- Após atualização das confirmações, a projeção do estado é refeita mesmo sem outro upload/download.
- Abrir Nuvem/Detalhes consulta a projeção atual, sem usar contadores antigos.
- Apenas o ponteiro ativo de uma falha de commit exatamente vinculada à operação, empresa, ator e código já resolvidos pode ser retirado. `syncFailureHistory` e o envelope ficam intactos. Falhas de listener, identidade, rede ou outra operação não são escondidas.
- Uma resolução válida não autoriza replay em modo automático, manual, forçado ou Reprocessar todos. Uma divergência monetária ainda não resolvida também fica fora do retry genérico, exigindo o fluxo controlado já existente.
- Provas inválidas/conflitantes continuam como erro ativo e não são reenviáveis.
- Controles de retry usam a mesma elegibilidade; resolvidos/arquivados não oferecem reprocessamento.
- O ícone do painel acompanha o estado atualizado. `saleId` é exibido corretamente em resoluções monetárias.
- Com 0 erros/0 enviáveis/2 resolvidos e 54 não comparados: indicador de espera/comparação, sem vermelho por erros históricos. Não se declara integridade completa.
- Falhas reais de integridade, comparação incompleta, registro comprovadamente ausente, listener ou sessão continuam separados e visíveis.

## Escopo

Runtime: `js/firebase/sync.js`, `js/firebase/firebase-ui.js`, `js/build-info.js`, `index.html`, `service-worker.js`.

`js/firebase/auth.js` muda **somente** o parâmetro de versão do import de Sync, de 205 para 223. O mesmo import na UI e os dois pontos de entrada do index são atualizados juntos para preservar uma única instância do módulo. Não há mudança em autenticação, Google, credenciais, memberships ou permissões.

QA: helper e regressões V223, adequação de três harnesses que recortam funções do Sync, auditoria Chromium e documentação/capturas. O teste antigo que pressupõe URLs de Sync alinhadas passa com o versionamento desta release, sem enfraquecer sua asserção.

Intactos: Functions, Rules, protocolo autorizado, payloads/checksums/IDs/tentativas, criação de pagamentos/vendas, motor de estoque/Financeiro, Trocas, Fiado, Google e permissões reais. O caminho comercial de commit não muda; o ajuste no loop é exclusivamente o bloqueio de operações classificadas como não reenviáveis, antes de preflight/mutação.

## Testes e publicação

- **302 app/DOM/contenção aprovados**, incluindo baseline V222 reproduzido, mistura de erro real/resolução, dois resolvidos, arquivo sem efeitos, prova inválida, mudança de sessão, reabertura, 54 não comparados, avisos de integridade, auto/manual/forçado sem replay e preservação dos envelopes. Inclui regressões de recibos V220–V222.
- **15 Emulator aprovados**, projeto demo isolado: originais, decisão autenticada individual, recibos, estoque/Financeiro únicos, resposta perdida, retry, duplicidade e negação a seller sem autorização. Nenhum dado real usado nos testes.
- **10 Chromium aprovados**, mobile e desktop: resolvidos, misto, 54 não comparados, prova inválida e arquivo sem efeitos. Zero chamadas externas e zero mutações comerciais.
- Lint/build global e sintaxe dos deltas finais; allowlist e diff-check no fechamento do pacote. Sem arquivos sensíveis ou fixtures na publicação.

Publicação proposta: **somente frontend/PWA**, após autorização específica do candidato. Conferir base V222, dois rulesets ativos, ascendência sanitizada, Actions, 247 recursos e Service Worker V223. Nenhuma Function, Rule ou migração será publicada. Nenhuma comparação ou tentativa comercial será executada no aparelho durante o deploy.

Rollback compatível mantém classificador, contadores, provas, bloqueios de replay e todos os dados. A flag `syncResolvedStatusPaused=true` pausa somente a promoção visual para conclusão verde de ocorrências resolvidas, usando estado de espera explícito; não restaura contadores falsos nem retry inseguro. Consultas, diagnósticos e operações legítimas continuam disponíveis. Cache estático próprio. Os rollbacks anteriores permanecem preservados.

**GO técnico** para publicação isolada do hotfix, condicionada à autorização. Limitações: ausência de inspeção do estado local atual do computador e impossibilidade de determinar divergência comercial dos 54 apenas pelos checksums do diagnóstico antigo. Essas limitações não são convertidas em confirmação falsa nem em replay automático.
