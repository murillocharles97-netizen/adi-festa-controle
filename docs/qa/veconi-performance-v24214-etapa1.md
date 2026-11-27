# V242.14 — desempenho de Cobranças e gravação local

Candidata local sobre a V242.13 (`f24c386`). O laboratório, os testes e as correções estão na branch `codex/perf-v24213`.

## Implementação

- A rota Cobranças calcula o saldo usado na seleção e na ordenação uma vez por cliente. O histórico é agrupado por cliente e a última cobrança calculada uma vez por montagem. O cartão mantém a consulta estrita de saldo. Os filtros, indicadores e a ação de escolher o próximo cliente continuam considerando a lista completa.
- A grade usa páginas de 24 cartões. Isso limita o DOM mesmo depois de percorrer toda a lista. A paginação conserva o tratamento delegado das ações, guarda a página durante remontagens no mesmo contexto e rejeita a troca de página quando o contexto mudou. O botão leva o foco ao início da lista nova. Páginas fixas evitam medir a altura variável dos cartões e reciclar controles em uso.
- O IndexedDB mantém o mesmo formato de linhas, operações e revisões. O gravador guarda a referência privada de cada coleção persistida e reaproveita a assinatura estrutural de cada linha, composta por chave, posição ou tipo e valor. Coleções iguais dispensam a codificação de linhas. Valores iguais na fila dispensam novo agendamento. A confirmação de diferenças usa comparação estrutural em vez de recodificar JSON ordenado.
- A entrada da persistência continua copiando o que recebeu para manter o isolamento de um mutador externo. O caminho genérico `DB.alterar` continua normalizando a base antes de enviar o snapshot. Tanto a gravação de linhas como a revisão e a fila continuam na mesma transação, sob as verificações de versão e geração já existentes.

## Aferição

Chrome headless no Windows em 390 × 844, CPU 4×, latência de 80 ms e 200 kB/s. Três repetições por volume e tema. A base grande tem 2.001 clientes, 2.006 produtos, 5.001 vendas, 1.601 pagamentos e 1.600 históricos de cobrança. A base pequena tem 26 clientes, 31 produtos, 51 vendas e 21 pagamentos. Os dois lados executam o mesmo shell e as mesmas fixtures fictícias. Na referência, o servidor local entrega os três módulos afetados exatamente como estavam em `f24c386`.

A tabela usa medianas. A primeira pintura útil é aproximada por duas oportunidades de pintura após montar a rota com os cartões e indicadores prontos. A gravação termina quando `DB.flush()` resolve. Heap JavaScript é o valor do CDP ao fim do recorte. O perfil não inclui memória nativa nem prevê o tempo de um Android físico.

| Cenário | V242.13 | Candidata | Meta |
|---|---:|---:|---:|
| Cobranças, base grande, claro | 6.289 ms | **241 ms** | 700 ms, atingida |
| Cobranças, base grande, escuro | 6.312 ms | **245 ms** | 700 ms, atingida |
| Retorno a Cobranças, base grande, claro | 6.048 ms | **168 ms** | 300 ms, atingida |
| Cobranças, base pequena, claro | 204 ms | 213 ms | 700 ms, atingida |
| Alterar um produto, base grande | 1.412 ms | **525 ms** | 200 ms, pendente |
| Alterar um produto, base pequena | 60 ms | **46 ms** | 200 ms, atingida |
| Alteração vazia, base grande | 992 ms | **427 ms** | 50 ms, pendente |
| Alteração vazia, base pequena | 20 ms | **8 ms** | 50 ms, atingida |

Na base grande, tema claro, Cobranças passou de 6.283–6.323 ms para 235–312 ms. O DOM de `#app` passou de 44.848 para 724 elementos, com 24 dos 1.600 cartões montados. A preparação da lista passou de 429 para 41 ms e de 30.847 para 2.001 consultas de saldo. A soma do tempo acima de 50 ms por tarefa caiu de 6.158 para 132 ms. O heap ao abrir passou de 22,8 para 14,2 MB. Nos quatro ciclos de navegação após coleta forçada, o heap ficou entre 28,0–30,1 MB na base e 19,0–21,1 MB na candidata.

A gravação de um produto na base grande passou de 1.406–1.466 ms para 519–530 ms. Uma linha e a revisão foram gravadas. A própria transação ficou em 39 → 35 ms. A alteração vazia abriu zero transações em ambos os lados e baixou de 987–1.010 ms para 422–428 ms. O trecho síncrono da edição antes de `DB.flush()` ficou em 390 → 388 ms. O heap da medição de gravação após reabrir a base, sem coleta forçada, ficou em 53,0 → 57,9 MB. A candidata reduz o trabalho depois do preparo, enquanto a cópia e a normalização da entrada seguem dominando a latência na base grande.

Controles de navegação, tema claro, base grande. A primeira visita ao Início, logo após Cobranças no roteiro, caiu de 376 para 180 ms. Clientes ficou em 634 → 571 ms, Vender em 596 → 561 ms e Produtos em 471 → 471 ms. As três últimas rotas continuam acima da preferência de 300 ms. Os módulos dessas rotas ficaram fora da intervenção.

## Verificações

- Chrome com IndexedDB real e dados fictícios confirmou a leitura offline de dados e fila gravados pela V242.13, isolamento, ordenação de IDs duplicados ou ausentes, duas gravações concorrentes, erro de transação e retentativa, ajuste, recibo, estoque e estado sem mudança.
- Cobranças conferida em 360, 390, 412, 768 e 1366 px, em claro e escuro. Foram verificados foco, largura, totais, navegação por páginas, descarte de ação com mudança de Espaço e filtros. O ensaio em 390 px claro percorreu toda a lista e comparou os seis filtros com a ordenação anterior.
- Firestore Emulator: 12/12. Inclui primeira venda Fiado no piloto, venda offline em ordem, recebimentos, cancelamento, projeção, ajuste e paridade por Espaço. Foram usados projetos demo e fixtures.
- Suíte direcionada: 78/79 na referência, 78/79 na candidata. A mesma falha preexistente em ambos é `the receipt form guard uses the same archived-record rule exported by the sync module`. Lint, build, pacote público de 290 arquivos e 56/56 verificações de contenção passaram.
- A homologação em Android físico está pendente. Esta candidata mantém a versão e o cache de desenvolvimento. Na release, use novo cache e valide a atualização do PWA com dados e fila já existentes.

## Reprodução

Execute cada lado separadamente. As variáveis de seleção estão em [audit-performance-v24213.cjs](../../scripts/audit-performance-v24213.cjs). Use `PERF_BASE_REF=f24c386` somente para a referência, `PERF_ROUTES=clientes,cobrancas,inicio,vender,produtos` para a navegação e `PERF_STORAGE_ONLY=1` com `PERF_PROFILE=light-large,light-small` para a gravação dirigida. Informe um `PERF_RUNTIME_OUTPUT` distinto para cada execução. Os brutos ficam em `qa-artifacts/performance/`.

```powershell
node scripts/audit-performance-v24213.cjs
node scripts/summarize-performance-v24213.cjs
node scripts/audit-performance-v24214-functional.cjs
```

No resumo, `PERF_RUNTIME_OUTPUT` aponta ao JSON de navegação e `PERF_STORAGE_OUTPUT` aponta ao JSON da gravação dirigida. O commit da candidata usa a identidade de desenvolvimento. A versão pública, os identificadores de recursos e o cache ficam para a integração de release.
