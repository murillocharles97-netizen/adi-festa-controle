# V242.15 — Clientes

O incremento local parte do trabalho em Vender (`2eef859`) e incorpora a release de inicialização (`67ea1a2`). O filtro prepara a busca uma vez para todo o conjunto de clientes. A lista mobile reutiliza o formatador de reais. Os filtros de saldo, fontes financeiras, ordenação e paginação continuam pelos caminhos existentes.

Chrome headless em 390 × 844, CPU 4×, rede de 80 ms e 200 kB/s, com 2.001 clientes, 5.001 vendas e 1.601 pagamentos fictícios. Três contextos por tema e versão, com o mesmo roteiro para a primeira abertura. Tempos em ms, mediana e intervalo.

| Indicador | Base | Candidata |
|---|---:|---:|
| Primeira abertura, claro | 729 (684–766) | 661 (618–687) |
| Primeira abertura, escuro | 694 (689–704) | 683 (660–689) |
| JavaScript na abertura, claro | 250 (249–263) | 215 (206–234) |
| JavaScript na abertura, escuro | 251 (243–256) | 215 (207–246) |

O heap oscilou entre 17 e 27 MB nos dois lados. A abertura ficou acima de 300 ms. O roteiro original pode medir a primeira atualização intermediária da busca antes de aparecer o estado vazio. Um teste de navegador separado aguardou o resultado final e confirmou busca por cliente fora da primeira página, estado vazio, limpeza e foco em 360, 390, 412, 768 e 1366 px, em claro e escuro. Os 51 testes direcionados passaram.

Próxima prioridade: Produtos. O roteiro de medição é `scripts/audit-performance-runtime-c643cc5.cjs`, com `PERF_ROUTES=clientes,inicio`, `PERF_PROFILE=mobile-light,mobile-dark`, `PERF_VOLUME=large` e `PERF_SKIP_STORAGE=1`. Os JSON e logs deste ensaio estão em `qa-artifacts/performance/`.
