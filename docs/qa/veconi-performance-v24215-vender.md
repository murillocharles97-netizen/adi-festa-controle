# VECONI V242.15 — primeiro incremento em Vender

Base publicada `cdafa3efff322d340214cbdb7edbb58bcb5f8ea8`. Trabalho local em `codex/perf-v24215-vender`. A candidata ainda usa a identidade de desenvolvimento da V242.14. Versão pública e cache ficam para a futura release.

## Alteração

- Vender no celular monta a opção avulsa e recupera o cliente do rascunho quando aplicável. O seletor visual consulta todo o diretório permitido no momento do uso. O seletor nativo carrega a lista ao receber foco. A seleção por atalho, a repetição de venda e a restauração do rascunho continuam verificando o cliente no contexto disponível.
- A vista do catálogo consulta o histórico por Espaço ao usar as listas de recentes ou a ordenação de mais vendidos. O índice é descartado quando a vista é reconstruída. O desktop mantém a faixa de recentes. O primeiro lote continua com até 36 produtos.
- A alteração é de leitura e apresentação. O checkout usa os mesmos cálculos, validadores, contratos, estoque, provas de saldo e persistência já publicados. O cache local e a Central de Cobranças da V242.14 continuam na base.

## Laboratório

Mesmo roteiro nas duas versões, Chrome headless, 390 × 844, CPU 4×, 80 ms e 200 kB/s durante a rota. Três contextos por tema e versão, base grande com 2.006 produtos, 2.001 clientes e 5.001 vendas. A medição termina depois de duas oportunidades de pintura. O heap é o valor reportado pelo CDP naquele ponto. O ensaio usa apenas dados fictícios e origens de loopback.

```powershell
$env:PERF_BASE_REF = 'cdafa3e'
$env:PERF_PROFILE = 'mobile-light'
$env:PERF_VOLUME = 'large'
$env:PERF_ROUNDS = '3'
node scripts/audit-performance-selling.cjs --baseline --release-smoke
node scripts/audit-performance-selling.cjs --release-smoke
```

Repita com `mobile-dark`. Use `--functional` e volume `medium` para validar busca, filtros, código de barras, seleção e rascunho com fixtures. O roteiro coloca os JSON e perfis em `qa-artifacts/performance/`.

| Cenário | V242.14, mediana (mín–máx) | Candidata, mediana (mín–máx) |
|---|---:|---:|
| Primeira abertura, claro | 627 (595–931) ms | 545 (483–825) ms |
| Primeira abertura, escuro | 643 (643–1.047) ms | 541 (492–915) ms |
| Retorno, claro | 497 (452–501) ms | 354 (348–355) ms |
| Retorno, escuro | 489 (458–543) ms | 292 (170–390) ms |
| Abrir carrinho, claro | 259 (237–345) ms | 135 (128–269) ms |
| Abrir carrinho, escuro | 291 (259–357) ms | 121 (121–250) ms |

Na abertura, o DOM de `#app` passou de 2.952 para 951 elementos, com 36 cartões nos dois lados. O seletor começou com uma opção no lugar de 2.002. O heap JavaScript da abertura foi de 16,8 para 15,8 MB e, no retorno, de 28,1 para 26,0 MB. A amostra de heap ao abrir o carrinho subiu de 14,4 para aproximadamente 16,7 MB. Os tempos de bloqueio acima de 50 ms por tarefa na primeira abertura passaram de 313 para 237 ms no claro e de 313 para 227 ms no escuro. A busca digitada por EAN oscilou entre rodadas, com medianas de 388 → 451 ms no claro e de 402 → 352 ms no escuro. A primeira abertura continua acima de 300 ms.

O comparativo funcional passou em mobile claro/escuro e desktop claro. Incluiu o mesmo ranking de mais vendidos, os recentes, o catálogo completo atrás dos lotes, busca de cliente fora da lista inicial, restauração de cliente e itens, filtros, EAN, variantes, Fiado, estoque e isolamento. A seleção e a recuperação do cliente no rascunho também passaram com o Chromium offline. As 12 rodadas de desempenho, somando as duas versões, concluíram as vendas fictícias à vista e no cartão. Os 60 testes direcionados passaram nas duas versões. Lint e build passaram na candidata.

## Sequência

A próxima intervenção é em Clientes, seguida de Produtos, gravação local, Dashboard e renderizações da sincronização. A ordem e os pontos que serão medidos estão no [plano da release V242.14](release-v24214-desempenho.md).
