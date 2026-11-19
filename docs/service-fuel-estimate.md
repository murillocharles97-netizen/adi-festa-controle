# Combustível estimado nos Serviços — candidata V238.2

Branch `codex/service-fuel-estimate`, base publicada V238.1 `ec89bdaba24750034170735ca77e2edd0287c500`. Trabalho local/QA; sem push, merge, deploy ou alteração no cadastro real Corrida.

## Auditoria e implementação mínima

A V238.1 já possui cadastro de serviço, PDV, configuração privada versionada em productFinancials.serviceCostConfigs, snapshot atômico em saleFinancials.itemCosts, idempotência e projeção de receita. Foram reutilizados. Nenhuma página, módulo, cadastro de veículo, fila, coleção, despesa automática ou mecanismo financeiro novo.

- Cadastro: Combustível (km/L), consumo e preço do litro; custo/km calculado. Modelo de preço continua independente, incluindo preço definido na venda. Campos de combustível não são exigidos nos modelos fixo, km ou hora. Taxa percentual opcional preservada, padrão 0%, sem reserva implícita.
- Execução: mesmos campos e ação de adicionar ao PDV. Resumo compacto separa litros, combustível, faturamento/km, receita após combustível, taxa, extras, custo total e margem estimada. Quilômetros aproximados aceitos, sem GPS.
- Snapshot privado por execução: km, km/L, preço/L, litros estimados, custo de combustível, valor cobrado, faturamento/km e receita após combustível. Configuração versionada original preservada mesmo se outra tarifa for salva durante operação offline.
- Histórico autorizado mostra a estimativa registrada, não a configuração atual. Recibos e compartilhamento com cliente continuam sem custos privados.
- Desempenho distingue combustível estimado (já incluído no custo/margem estimada), faturamento e recebido. Despesas reais e resultado financeiro continuam no Financeiro. Estimativa não gera saída, abastecimento nem redução adicional do caixa.
- Integridade: projeção de conferência preserva o componente combustível, sem ignorar diferença real entre snapshots. sync.js, filas e políticas de retry não foram alterados.

## Cálculo e arredondamento

Exemplo fictício: 8 km/L, R$3,70/L, 20 km, R$50 cobrados, taxa e extras zero.

| Medida | Resultado |
|---|---:|
| Custo derivado por km | R$0,4625 |
| Litros estimados | 2,5 L |
| Combustível estimado | R$9,25 |
| Faturamento/km | R$2,50 |
| Receita após combustível | R$40,75 |

O custo monetário usa km ÷ km/L × preço/L sem arredondar o custo/km ou os litros intermediários. Arredonda somente o valor final em centavos; medidas e razões do snapshot usam até seis casas. Taxa e extras permanecem componentes separados. Receita após combustível desconta somente combustível; margem estimada desconta também taxa/extras. Não representa resultado financeiro líquido.

## Compatibilidade com V238 e proteção contra PWAs antigos

Para evitar que PWAs antigos falhem ao hidratar todo o catálogo, a configuração privada usa representação compatível `model:km`, `rate` legado e componente adicional `fuel` versionado. A UI exibe isso como Combustível (km/L). O campo rate pode ser arredondado para compatibilidade, mas **nunca** participa do cálculo novo de combustível.

Configurações e execuções novas com combustível declaram calculationVersion 2. O servidor consulta a configuração privada real e exige os dados atualizados antes de qualquer efeito. PWA antigo não pode vender combustível silenciosamente como custo/km arredondado, nem converter uma configuração combustível por seu editor antigo. Recebe orientação de atualização, mantendo a operação original. Esse marcador é compatibilidade, não autorização: permissões, espaço, configuração imutável e cálculo do servidor são validados independentemente.

Serviços antigos continuam inalterados. Operação offline anterior que referencia configuração km/fixo/hora continua usando essa configuração mesmo depois de o cadastro ser convertido para combustível. Não é feita conversão automática da Corrida; o proprietário poderá configurar manualmente depois de atualizar os aparelhos e autorizar a publicação.

## Testes e prévias

- **152 testes de regressão aprovados**: cálculo, arredondamento, legado V238, privacidade, projeções, permissões, isolamento, integridade, Sync, versão/cache e contenção pública.
- Build e validação sintática aprovados; versão/cache consistentes em 238.2 (release compatível 238). Pacote público mantém 276 recursos.
- **19 testes do Emulator aprovados**, executados nos pacotes seletivos: cadastro/versões de combustível, cálculo atômico privado, repetição, dois dispositivos, perfil vendedor sem custos, recusa de outro espaço/custo forjado, fila antiga, mudança de preço com operação offline, aliases 00022 e contenção de rollback.
- Teste financeiro: corrida fictícia de R$50 cria uma única receita; abastecimento real fictício de R$150 fica uma única despesa. Resultado de caixa −R$100, sem descontar novamente R$9,25 estimados.
- HTTP + Chrome em **360 e 390 px**: cadastro real pela UI, preço livre, taxa zero, execução, recibo sem custo privado, Histórico e Desempenho. Duas corridas de 20 km/R$50 e 20 km/R$40: duas vendas, duas receitas totalizando R$90, combustível estimado R$18,50/5 L, margem estimada R$71,50, zero movimentos de estoque. Resposta perdida conciliada por recibo; reinício offline/reconexão mantêm envelopes/IDs. Mudar litro para R$4,20 não altera snapshots anteriores.
- Evidências locais somente fictícias em `qa-artifacts/service-fuel/`: cadastro-360/390.png, execucao-360/390-50.png, historico-360/390.png, desempenho-360/390.png, browser-results.json, regression.log e emulator.log.

## Arquivos principais

- functions/src/shared/flexible-service.js: configuração, precisão, cálculo e contrato compatível.
- functions/src/shared/product-model.js: marcador de cálculo e versionamento da configuração.
- functions/src/services/flexible-service-validation.js: validação do servidor/compatibilidade; mesma transação e snapshot privado.
- functions/src/services/performance-read-service.js: projeção mínima de litros/custo histórico somente com cost.view.
- js/flexible-service-ui.js, js/product-images.js, css/flexible-service.css: cadastro e resumo do PDV.
- js/activity-center.js, js/performance-model.js, js/performance-dashboard.js: Histórico e Desempenho autorizados.
- js/integrity.js: somente comparação de metadados privados de combustível.
- index.html, js/build-info.js, service-worker.js: candidata 238.2, release compatível 238, SW veconi-v2382-service-fuel-v1.
- scripts/package-service-fuel.cjs, scripts/homologate-service-fuel.cjs e testes direcionados: preparação/QA, fora do pacote público.

## Publicação seletiva necessária — NÃO executada

**Não é somente frontend. Exige exatamente duas Functions; nenhuma alteração de Rules ou índices.**

1. Reconfirmar main, Rules e revisões e gerações ativas. Pacotes foram derivados das fontes reais `commitoperationalsync-00023-mol` e `getperformancepage-00004-keh`, com seus ZIPs/hashes preservados privadamente.
2. Publicar somente commitOperationalSync do pacote isolado: 3 arquivos modificados, 99 preservados. O engine, aliases 00022, recuperação, Fiado, demais validações, entrypoint e dependências ficam idênticos à fonte ativa. Confirmar ACTIVE e compatibilidade antes de avançar.
3. Publicar somente getPerformancePage do seu pacote isolado: 2 arquivos modificados, 81 preservados. Mantém V224, permissões e escopo. readOperationalWorkspace e demais Functions permanecem intactos.
4. Publicar frontend pelo workflow oficial após integração autorizada; 276 recursos, hashes Git/Linux e atualização PWA V238.2. Nenhum dado real é alterado durante publicação.
5. Atualizar os aparelhos antes de configurar combustível. O proprietário escolhe quando editar a Corrida existente. Não criar corrida fictícia em produção para testar o deploy.

Os pacotes são preparados por `scripts/package-service-fuel.cjs` a partir dos ZIPs ativos; não publicar a árvore functions inteira do repositório. A proteção Rules já publicada impede custo no produto público; combustível permanece dentro das mesmas projeções privadas, sem nova permissão.

## Rollback e riscos

- Frontend anterior V238.1 ec89bda com os 276 recursos preservados. Não remover snapshots nem filas para reverter software.
- Após usar combustível, não restaurar cegamente o backend antigo: ele desconhece esse cálculo. Pacote de contenção preparado mantém leitura/snapshots/recibos e pausa somente novas configurações/execuções de combustível, sem duplicar ou reinterpretar operações. Serviços legados e vendas normais continuam; replay já confirmado retorna o mesmo comprovante. Testado no Emulator.
- Leitor de Desempenho pode permanecer na versão aditiva, preservando a consulta autorizada. Rules e demais Functions não mudam no rollback.
- Estimativas dependem do consumo e distância informados; não são comprovantes de despesa. Litros exibidos podem ser arredondados, sem influenciar o custo calculado.
- Um PWA antigo precisa atualizar para operar serviço convertido para combustível. Não descarta filas antigas nem exige atualização para os serviços legados não convertidos.

**GO técnico para publicação seletiva, aguardando autorização. Nenhum dado real, cadastro Corrida ou revisão de produção foi alterado.**
