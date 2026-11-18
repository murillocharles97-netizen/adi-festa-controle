# V238 — homologação local e preparação da integração

## Resultado

**GO para o fluxo local de serviços. NO-GO para publicar a integração exata com `a34c4bf` até corrigir a sinalização de recebido parcial.** Nenhum push, merge na main, deploy ou escrita de produção foi executado.

- Base: main V237 `c94f60ac341745f952630948efd97342a5ed6072`.
- MVP original preservado: `6f066d1cfb02fb8f198b64af14b570435b3f6a1f`, branch `codex/v238-flexible-services`.
- Trabalho do Claude solicitado: `a34c4bfd0ee489e5d3873ec2bec74dc8795b83b4`.
- Candidata local: `codex/v238-local-integration`, worktree `C:/Users/Murillo/Documents/VECONI-V238-Integration`.
- Preparação por cherry-picks locais sobre V237: `b492d2d` (cópia do MVP) e `d24199a` (cópia de `a34c4bf`). Conflitos apenas em `js/performance-model.js` e `js/performance-dashboard.js`: preservados Ontem, recebido separado e contribuição por espaço do Claude, mais contadores de execução/km/minutos da V238.
- A branch do Claude já avançou para `5303cd2`. Esse commit foi apenas consultado, não aplicado, pois a solicitação nomeou `a34c4bf`. Nenhum arquivo do worktree do Claude foi modificado.

## Homologação ponta a ponta

Chrome com toque emulado, 360 e 390 px, componentes reais de cadastro/PDV/recibo/Histórico/Desempenho. HTTP local ligado aos serviços transacionais reais no **Firestore Emulator**, projeto `demo-veconi-v238-homologation`. Autenticação de transporte, persistência e worker são adaptadores exclusivos de QA; a autorização da empresa e as transações passam pelos serviços reais. Não substitui teste de teclado/navegador no Android físico.

Criado pela interface um serviço de preço livre, custo R$ 1,20/km e taxa estimada de 10%. Cada execução tem quantidade 1 e IDs próprios:

| Execução | Pagamento | Distância | Cobrado | Extra estimado | Custo estimado | Margem estimada | Toques |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Pix | 10 km | R$ 30,00 | R$ 0,00 | R$ 15,00 | R$ 15,00 | 6 |
| 2 | Dinheiro | 17,5 km | R$ 47,50 | R$ 0,00 | R$ 25,75 | R$ 21,75 | 7 |
| 3 | Cartão manual, offline | 6 km | R$ 22,00 | R$ 2,00 | R$ 11,40 | R$ 10,60 | 8 |
| **Total por ambiente** | | **33,5 km** | **R$ 99,50** | | **R$ 52,15** | **R$ 47,35** | |

Custo = km × R$ 1,20 + 10% do valor final + extra. Margem estimada = valor cobrado − custo estimado. O custo não gera despesa de caixa; as entradas financeiras somaram os R$ 99,50 efetivamente registrados como pagos no cenário fictício.

Os toques incluem card, campos obrigatórios, adicionar, sacola e concluir. Trocar pagamento acrescenta um toque; preencher extra acrescenta outro. Não incluem teclas digitadas, rolagem, cadastro inicial nem fechar recibo. Não foi acrescentada outra etapa à venda de produtos físicos.

Comprovações em **cada largura**:

- Cadastro salvo, preço livre sem tarifa fictícia obrigatória, custos e snapshots corretos nas três execuções.
- Recibos reais da interface conferidos; Histórico carregou **três eventos projetados pelo serviço existente**, com valores corretos. Aberto detalhe da corrida de 6 km e reaberto seu recibo pelo Histórico.
- Desempenho consultado pelo endpoint real: receita R$ 99,50, custo R$ 52,15, margem R$ 47,35, três serviços, 33,5 km. Valores locais e confirmados no servidor coincidiram.
- **Zero** movimentos de estoque; produto físico de controle permaneceu com os três aliases em 5 unidades.
- Primeira venda aplicada no servidor com resposta deliberadamente perdida: `processSyncQueue` original consultou `getOperationalSyncReceipt`, reconheceu o comprovante e não criou outra venda.
- Terceira venda feita offline; reabertura ainda offline pelo worker de QA, IndexedDB e envelopes originais preservados. Reconexão acionou a fila automaticamente, sem botão de sincronizar.
- Por ambiente: exatamente três vendas, três snapshots privados, três entradas financeiras e três operationIds de venda distintos. Envelope/hash mantido durante as tentativas.
- Recibo do gateway e projeção de custos carregados também do código V237 `c94f60a`: o recibo anterior reconheceu a confirmação nova; o projetor anterior não recalculou o snapshot já criado atomicamente.

Evidências locais, somente fictícias: `qa-artifacts/v238-homologation/results.json`, `http.log`, capturas `historico-360/390.png`, `recibo-*`, `execucao-*`, `desempenho-360/390.png`.

## Correção necessária encontrada na homologação

O MVP guardava a execução na venda, mas `performance-read-service.js` retirava `serviceExecution` da resposta de `getPerformancePage`. Após consultar a nuvem, receita/custo/margem permaneciam, porém os indicadores de serviços/km desapareciam.

A candidata local acrescenta somente a projeção pública sanitizada dessa execução, reutilizando `FlexibleService.execution`. Custos detalhados e campos arbitrários continuam excluídos; custo e margem totais respeitam as permissões existentes. Snapshot opcional malformado não impede ler o valor da venda histórica. Quatro testes novos cobrem projeção, privacidade, compatibilidade e separação entre recebido e margem.

## Bloqueio da integração solicitada

No `a34c4bf`, a seção de recebido exibe **Total recebido** mesmo sem confirmação da nuvem e com 200 pagamentos locais, que podem ser apenas o lote recente do sync. A ressalva genérica sobre base local não identifica esse total como incompleto. O caso foi reproduzido isoladamente; evidência: `consolidated-risk.json`.

Isso não alterou saldos nem impediu os testes de serviços, mas impede recomendar essa integração para publicação comercial. O commit posterior `5303cd2` trata a sinalização parcial e o contrato V238; sua inclusão precisa ser aprovada ou substituída por correção equivalente, seguida do teste direcionado. Não foi incluído silenciosamente.

## Backend seletivo para futura publicação

| Function | Necessidade |
|---|---|
| `commitOperationalSync` | **Alterar.** Validação da execução, configuração histórica imutável, autorização e snapshot privado na mesma transação da venda. |
| `readOperationalWorkspace` | **Alterar.** Nova allowlist pública preserva a execução no leitor operacional autorizado, sem liberar custos. |
| `getPerformancePage` | **Alterar.** Preserva medidas da execução; continua juntando snapshots privados apenas para os perfis autorizados. |
| `getOperationalSyncReceipt` | **Manter**, se a comparação com a fonte ativa confirmar o contrato testado. Comprovantes e idempotência são os existentes; compatibilidade com o código V237 demonstrada no HTTP. |
| `projectSaleFinancialIncome` | **Manter**, se a fonte ativa mantiver a verificação de snapshot existente. O gateway cria o custo antes do trigger; código V237 testado retornou `financial-snapshot-exists`. Receita continua sendo projetada uma vez, sem despesa estimada. |
| `projectSaleActivity` e demais Functions | **Manter.** O projetor existente gerou os eventos corretos do Histórico. Não há motivo para publicar billing, renovação, estoque ou outras Functions. |

Pacotes seletivos ainda devem ser reconstruídos das fontes **efetivamente ativas** quando houver GO. Comparar hashes e dependências comuns, incluindo `engagement-domain.js`, antes de qualquer deploy. Não inferir equivalência da revisão ativa apenas pelo frontend V237.

Rules: apenas duas condições adicionais em `products` proíbem gravar `serviceCostConfig` no documento público. Configuração privada permanece em `productFinancials`; não criar coleções/índices novos. Aplicar esse delta sobre as Rules ativas, sem substituir outras políticas pela cópia do repositório.

## PWAs antigos e dados existentes

- Produtos físicos, serviços antigos sem `serviceConfig`, variações, recebimentos, parcelas e renovações mantêm o contrato anterior. Nenhuma migração ou conversão automática.
- Um PWA antigo não deve interpretar uma tarifa por km/hora como preço fixo: o backend recusa **novas execuções de serviços configurados** sem os dados V238, com orientação de atualização. Não descarta a fila.
- Conferir pendências antes de converter um serviço antigo para o modelo flexível. Durante a atualização, preferir cadastrar o novo serviço após os aparelhos atualizarem, em vez de modificar um item ainda referenciado por fila antiga.
- A fila nova mantém operação, payload e configuração original. Configurações anteriores continuam disponíveis para sincronização posterior; não recalcular usando custo atual.
- “Todos os espaços” permanece dentro da empresa ativa e dos espaços autorizados. Não consolida empresas independentes.
- O teste usa o runner original de retries com relógio controlado e HTTP real para os serviços no Emulator; não comprova a entrega de atualização pelo PWA Windows/Android instalado nem autenticação real Firebase no aparelho.

## Plano de publicação — somente após novo GO

1. Resolver o bloqueio do recebido parcial; validar o commit final do Claude aprovado. Conferir novamente main e revisões ativas, sem incluir outras branches.
2. Salvar frontend estável, fontes/revisões individuais das três Functions, Rules ativas e hashes dos pacotes. Preparar contenção compatível antes de abrir a V238.
3. Publicar seletivamente `commitOperationalSync`; conferir protocolo/saúde e compatibilidade. Publicar os leitores `readOperationalWorkspace` e `getPerformancePage`, verificando cada etapa. Não publicar o frontend se houver divergência.
4. Publicar somente o delta de Rules conferido; testar leitura pública de produto, negação de custo e isolamento. Nenhuma alteração comercial de teste em produção.
5. Publicar o frontend integrado: 276 recursos, versões de assets e SW preparados como `veconi-v238-services-consolidated-qa-v1` (definir identificador final ao publicar). Conferir SHA-256 dos bytes Git/Linux e build do workflow.
6. Smoke autenticado somente leitura em produção; gravações fictícias ficam no Emulator. Homologação no Android físico para teclado, abertura/fechamento, atualização de PWA e reconexão.

## Rollback e riscos

- Frontend: retornar ao pacote estável ou conter apenas entrada de novas configurações/execuções V238. Preservar documentos, IDs, snapshots, evidências e filas; nenhum ajuste de saldo/estoque para reverter software.
- Backend: depois de existir venda/fila V238, **não restaurar cegamente o gateway antigo**. Manter validação de serviço, recibos e snapshots ou preparar pacote de contenção da fonte ativa que recuse apenas novos envelopes flexíveis, mantendo consultas e operações já processadas. Operações normais não devem ser pausadas junto.
- Rules: conservar a proibição de custo no documento público; não restaurar permissões mais amplas.
- Pacotes de rollback/revisões reais só podem ser fixados após a comparação das fontes ativas no preflight autorizado; o plano não deve ser confundido com rollback já executável em produção.
- Custos continuam **estimados**, separados de combustível/despesas reais em Finanças. Campo adicional não cria pagamento, despesa ou cobrança externa.
- Risco pendente conhecido: total recebido parcial em `a34c4bf`. Demais pendências para produção: fonte ativa, pacotes/rollback, autorização e Android físico. Nenhuma escrita real ocorreu.

## Verificações finais

32 testes unitários/de integração de modelo aprovados; duas homologações HTTP completas (360/390 px); 56 testes de contenção/worker aprovados; build e verificação do engine gerado aprovados. O engine permaneceu semanticamente idêntico ao commit preservado (normalização local de CRLF, sem diff funcional).
