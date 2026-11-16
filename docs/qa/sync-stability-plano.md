# Estabilização do Sync: auditoria de produção, fases 1–2 e plano das fases 3–5

- **Base:** V231.1 (`557e365`).
- **Branch:** `claude/sync-stability`.
- **Candidato de homologação:** `claude/sync-candidate`. Contém a estabilidade + a correção do estoque legado + o D2 + a ferramenta Android.
- **Nada publicado.** Nenhum dado real foi alterado, nenhuma fila de produção foi reenviada e nenhuma Function foi publicada.

## 1. Auditoria de produção (somente leitura)

### 1.1 O que foi possível ler
| Fonte | Resultado |
|---|---|
| `firebase functions:list` | 101 Functions publicadas. Todas as do repositório existem; 4 existem só em produção (`completeGoogleAccountAccess`, `prepareGoogleAccountAccess`, `getDailySalesPerformance`, `reviewFiadoOriginEvidence`). |
| `firebase functions:log` | Devolve no máximo ~15 linhas por consulta, sem filtro de data. Só aparecem inícios de instância e "auth VALID / app MISSING" (App Check não usado). **Nenhuma recusa aparece.** |
| Cloud Logging (30 dias) | **Não lido.** O `gcloud` não está instalado e o Console pediu login no navegador da sessão. Precisa da sua entrada; veja 1.4. |
| Pacote publicado da `commitOperationalSync` (`VECONI-commitOperationalSync-pkg`) | Comparado arquivo a arquivo com o repositório (`scripts/functions-source-diff.cjs`). **Correção (rodada 6):** a revisão ativa é a **`00019-xol`**, não a 00017; veja 1.5. |

### 1.2 Incidente de produção confirmado: código publicado ≠ repositório
A `commitOperationalSync` ao vivo **não contém o servidor da V231/V231.1**:
- 9 arquivos diferem e 8 serviços existem só no repositório, entre eles `payment-recovery-policy`, `preserved-payment-recognition` e `operational-read-service`;
- os commits `3940f91` (recuperação por recibos verificados), `d891dd1` (valor canônico no replay) e `557e365` (reconciliação de estoque) mexeram em `operational-commit-service.js` depois do pacote 00017;
- o servidor publicado não conhece 11 recusas do repositório, quase todas da revisão/recuperação de recebimentos;
- o repositório não conhece 1 recusa do publicado: "Movimento de outra venda.".

**Consequência:** o app V231.1 publicado conversa com um servidor anterior. Os fluxos de recuperação de recebimento da V231 dependem desse servidor e não estão ativos em produção. Isto é um **fato de publicação**, verificável sem logs. Não é uma suposição.

### 1.5 Correção: revisão ativa e origem do pacote (rodada 6)
- **Revisão ativa:** `commitoperationalsync-00019-xol`.
  - Fonte enviada em 15/11 às 19:23:30 UTC (`storageSource.generation` de `functions:list --json`).
  - `DEPLOYMENT_ROLLOUT` às 19:24.
  - Depois disso, **todas** as requisições nos logs são da 00019, e nenhuma da 00018. Isso é compatível com os 100% de tráfego que o Codex confirmou.
  - A configuração de tráfego do Cloud Run não foi lida: exige a API do Cloud Run e login.
- **Linha do tempo das revisões, pelos logs de auditoria `UpdateFunction`:**
  - 00010–00013: 10–11/11;
  - 00014–00016: 12/11;
  - **00017:** 15/11 às 06:48 UTC;
  - **00018:** 15/11 às 10:15 UTC;
  - **00019:** 15/11 às 19:23 UTC.
- **Origem do código:** o hash que o Firebase CLI grava na Function (`firebase-functions-hash = 1ec0e910…`) é **reproduzido exatamente** pelo conteúdo atual de `VECONI-commitOperationalSync-pkg/functions` (`scripts/functions-deploy-hash.cjs`).
  - Os arquivos desse pacote não mudam desde 15/11 às 06:24 UTC (última alteração: `operational-engagement-validation.js`).
  - Portanto 00017, 00018 e 00019 publicaram o **mesmo código**. O pacote de rollback (00016) e o repositório (`557e365`) **não** reproduzem esse hash.
- **Efeito nas conclusões:**
  - O número da revisão citado antes estava errado (00017 → 00019).
  - O código comparado era o publicado: as conclusões de 1.2 e 1.3 se mantêm.
- **Para publicações futuras:**
  - Nenhum pacote local é base de publicação por si só.
  - A base precisa reproduzir o hash da revisão ativa naquele momento, com a verificação pré-deploy da Fase 3. Só então recebe as mudanças revisadas.

### 1.6 Logs de produção lidos (rodada 6)
- `firebase functions:log --json` devolve até 999 entradas por consulta. Isso cobre de 09/11 a 15/11 para a `commitOperationalSync`; 30 dias completos exigem o Logs Explorer.
- **Correção da rodada anterior:** as recusas **aparecem** no log de requisição, como código HTTP:
  - 403 = `permission-denied`;
  - 400 = `failed-precondition`/`invalid-argument`;
  - 401 = `unauthenticated`.
- **Resultado em 7 dias, por origem:**

| Origem | 200 | 400 | 401 | 403 | 5xx |
|---|---|---|---|---|---|
| Aparelhos (Android e desktop) | 236 | 0 | 0 | **4** (12–13/11, revisão 00016) | 0 |
| Scripts `node` (testes de publicação) | 32 | 27 | 5 | 0 | 0 |

- Latência p50 0,24 s, p95 1,8 s, máxima 2,8 s, **sem timeouts**.
- **Leitura:**
  - A instabilidade relatada **não aparece como recusa no servidor**: há só 4 recusas de aparelho em 7 dias.
  - Falhas de comunicação (D3) não chegam ao servidor e, por isso, não aparecem nos logs. Isso reforça o D3 como causa principal.

### 1.3 Defeitos de código × incidentes registrados
| Item | Tipo | Evidência |
|---|---|---|
| C2: 105 de 158 recusas usam `permission-denied` por padrão | Defeito de código (diagnóstico) | Só **16** são falta de permissão real: 57 são conflito de dados, 15 de estoque, 13 de empresa/espaço/geração, 3 de revisão e 1 de recurso pausado. No publicado: 102, das quais 13 reais. |
| C3: classificação pelo texto | Defeito de código | 4 decisões no app e 1 no servidor (`sale-recovery-service`) dependiam do texto exato. |
| Versão do app parada em 229 | Defeito de código, em produção | O app V231.1 publicado se identifica como 229 para o servidor, para o usuário ("v229") e no diagnóstico. |
| D3: servidor inacessível vira erro | Defeito de código, **reproduzido** | Veja `d3-servidor-inacessivel-vira-erro.md`. |
| D1: `engagement-domain.js` defasado | Defeito de código (área do Codex) | Rodada anterior. |
| D2: origem do estoque | Corrigido em branch | Rodada anterior. |
| Divergência publicado × repositório | **Incidente de publicação confirmado** | Seção 1.2. |
| Recusas de vendas, retenções financeiras e funcionários em produção | Medidas em 7 dias (1.6) | 4 recusas 403 vindas de aparelhos. A causa de cada uma (motivo) só fica visível depois da Fase 1 publicada. |

### 1.4 Para completar a parte de logs
1. Entre na conta Google do projeto no navegador da sessão (Cloud Console). Eu leio o Logs Explorer **somente leitura**, com estes filtros:
   - `resource.labels.service_name="commitoperationalsync" severity>=WARNING`, 30 dias;
   - erros de todas as Functions.
2. Ou envie diagnósticos exportados dos aparelhos (Sincronização → Exportar diagnóstico). Com a Fase 1, eles passam a trazer `rejectionReason`/`rejectionCategory` e um resumo `byCategory`.

## 2. Fase 1: identificação correta dos erros (implementada)
- **`functions/src/shared/sync-rejection.js`:** tabela única com motivo estável e categoria para as 158 recusas literais do repositório, mais as dinâmicas e a única que só existe no publicado.
  - **Categorias:** autenticação, permissão, conflito de estoque, inconsistência de dados, pacote inválido, versão, revisão obrigatória, empresa/espaço/geração, operação repetida, recurso pausado, conexão, dependência pendente, verificação local e não classificado.
- **Servidor:** `fail()` continua com **o mesmo código e a mesma mensagem** e só acrescenta `details: {reason, category, rejectionSchema: 1}`. O mesmo vale para a borda `operationalCallable`. Os PWAs antigos ficam idênticos.
- **App:**
  - grava `lastErrorReason`, `lastErrorCategory` e `lastErrorReasonSource` em cada falha;
  - decide por motivo e cai no texto exato **só** quando o pacote é anterior aos motivos ou o módulo não foi carregado;
  - o diagnóstico ganha `rejectionReason`, `rejectionCategory`, `rejectionSource` e `byCategory`.
- **Sem presunções:**
  - `permission-denied` sem motivo **não** vira "permissão";
  - `internal` **não** vira "conexão".
- **Testes:**
  - `tests/sync-rejection-reasons.test.js`: cobertura de todas as recusas, unicidade, compatibilidade e decisões do app com e sem o módulo;
  - `tests/emulator/sync-rejection-reasons.cjs`: serviço real no Emulator, e também contra o pacote publicado via `VECONI_LIVE_FUNCTIONS_DIR`;
  - `scripts/sync-stability-mutations.cjs`: 14 de 14 mutações detectadas.
- **Ainda dependente de texto, para a próxima etapa:** o servidor `sale-recovery-service` valida `lastErrorMessage` do pacote. Ele passa a aceitar `lastErrorReason` quando o servidor com motivos estiver publicado.

## 3. Fase 2: identificação das versões (implementada)
| Conceito | Onde | Valor |
|---|---|---|
| Versão do app | `AdiFestaBuild.appVersion` | `231.1` (mostrada ao usuário e no diagnóstico) |
| Número de compatibilidade | `AdiFestaBuild.release` → `clientRelease` | `231` (estava `229`). O servidor publicado aceita inteiro ≥ 202 e usa ≥ 227. |
| Protocolo | `syncProtocolVersion` | `1` (inalterado) |
| Formato da operação | `payloadVersion` / `schemaVersion` / `clientRelease` do pacote | `4` / `3` / `202` (inalterados, nunca regravados) |
| Versão que criou o pacote | `createdByAppVersion`, `createdByRelease` | Só em pacotes **novos** |

- O Service Worker informa as duas versões.
- Um teste falha se o app, o Service Worker e o nome do cache divergirem.
- `appVersion` é enviado só à `commitOperationalSync`: outras callables têm lista estrita de campos.

## 4. Fase 3: controle de publicação (plano)
1. **Manifesto versionado `functions-deploy-manifest.json`:**
   - para cada Function: a origem (repositório/commit ou pacote), o hash normalizado de cada arquivo, a revisão do Cloud Run e a data;
   - preenchido **depois** de cada publicação, a partir do que foi de fato enviado.
2. **Portão antes do deploy:** `scripts/functions-source-diff.cjs` (já criado) compara o que vai ser publicado com o manifesto da revisão ao vivo e com o repositório. Ele bloqueia quando:
   - um arquivo do repositório está mais antigo que o publicado (por exemplo, a recusa "Movimento de outra venda." sumiria);
   - um módulo gerado está defasado (D1: `generate-*.cjs --check`).
3. **Reconciliação única:** levar o servidor da V231/V231.1 para um pacote que **parta do 00017** e acrescente só o necessário, revisado arquivo a arquivo. Publicar só a `commitOperationalSync`, com rollback para 00017.
4. **Teste de contrato:** o teste do Emulator da Fase 1 roda contra o pacote candidato e contra o publicado; as diferenças precisam ser explicadas.

## 5. Fase 4: operações explícitas (plano)
- **Ordem:** venda → recebimento → ajuste de estoque.
- Cada uma vira uma **intenção declarada**: `{kind, version, operationId, dados mínimos}`. O servidor calcula os efeitos (estoque, saldo, contadores), como já ocorre em parte com `createSaleOperation`.
- **Etapa A:** o app envia intenção + escritas atuais; o servidor confere as duas e registra divergências sem recusar a mais.
- **Etapa B:** o servidor passa a usar só a intenção; as escritas do app viram verificação.
- **Etapa C:** o diff genérico deixa de enviar campos de projeção (estoque, disponibilidade, saldo). Uma tela que tentar enviá-los falha **no aparelho, antes de enfileirar**, com motivo `projection_write_blocked`.
- **Preservado:**
  - offline: a intenção fica na mesma fila write-ahead;
  - atomicidade: uma transação por intenção;
  - idempotência: o mesmo `operationId` e recibos;
  - recuperação: recibos e revisão.
- **Pacotes antigos:** continuam aceitos pelo caminho atual até zerarem nos aparelhos. O painel `byCategory` mostra quando isso acontece.

## 6. Fase 5: central de sincronização (plano)
- **Agrupar pendências por categoria**, com texto próprio e o que fazer:
  - **conexão:** "aguardando internet", sem ação, envio automático (depende do D3);
  - **dependência:** "aguardando a venda X";
  - **permissão:** "peça ao gestor a permissão Y";
  - **estoque:** "o estoque mudou; confira o produto Z";
  - **dados:** "revisão necessária";
  - **versão:** "atualize o app".
- **Recuperação segura:**
  - "tentar novamente" só para conexão e versão;
  - revisão guiada para o resto;
  - exportar diagnóstico sempre disponível.
- **Nunca** descartar automaticamente. Arquivar continua exigindo confirmação e preserva o original.

## 7. Homologação (PC, Emulator isolado, dados fictícios)
| Perfil | Espaços | Online | Offline |
|---|---|---|---|
| Dono | 2 | Venda Pix com 2 controlados + 4 legados (acima do saldo antigo de 3): controlado 10→8, legado sem movimento. | Venda salva; **D3**: virou erro até "Sincronizar agora"; aplicada 1 vez (8→7). |
| Vendedora (só Loja Centro) | 2 | Venda na Loja Centro (7→6). | Venda do legado; **D3**; aplicada 1 vez, sem movimento de estoque. |
| Dono | 1 | Produto novo com estoque inicial 4: **sem pedir o espaço**, entrada na Loja Única (D2). | Venda; **D3**; aplicada 1 vez (10→9). |

Também confirmado:
- a versão aparece como 231.1;
- o módulo de motivos foi carregado;
- o produto legado aparece "Sem controle", sem botão de ajuste;
- nenhuma escrita indevida de `semControleEstoque` chegou ao servidor.

Observação, sem defeito: a auditoria de integridade mostra "Atenção — semControleEstoque" porque compara a cópia local normalizada com a nuvem. É só aviso; nenhum envio foi gerado.

**Não testado:**
- celular físico (nenhum conectado);
- o pedido de espaço do D2 com vários espaços na interface (coberto por testes unitários);
- recusas reais (estoque/permissão) na interface (cobertas pelo teste do Emulator).

## 8. Suítes
- **`claude/sync-stability`:** 2190 testes; as 141 falhas são as mesmas da base e nenhuma é nova.
- **`claude/sync-candidate`:** 2203 testes e 138 falhas: as 3 de origem de estoque, corrigidas pelo D2, saíram. Nenhuma falha nova.

## 9. Publicação futura e rollback (não executar sem aprovação)
1. **Functions:** um pacote a partir do 00017 publicado + `sync-rejection.js` + a linha do `fail` + `operational-callable.js`. **Não** publicar a partir de `functions/` do repositório (seção 1.2).
   - Rollback: a revisão 00017.
2. **Frontend depois:** a ordem é indiferente para compatibilidade. O app novo funciona com o servidor sem motivos (testado contra o pacote publicado), e o servidor novo funciona com os apps antigos.
   - Rollback: reverter os commits do frontend.
