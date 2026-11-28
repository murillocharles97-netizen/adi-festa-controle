# V242.15 — navegação, scroll e primeiras interações

Base publicada V242.14.1 (`67ea1a2`). A candidata preserva Vender (`2eef859`), Clientes (`568e550`) e o Service Worker de produção. O trabalho segue local em `codex/perf-v24215-vender`.

## O que mudou

- O cabeçalho, a seleção do menu e o skeleton aparecem na etapa de navegação. O navegador recebe uma oportunidade de pintura antes de gerar a lista da rota. Cada transição revalida hash, sessão, empresa e geração. Vender usa o descarte de rascunho já existente se o Espaço mudar antes da montagem.
- O menu instala o listener cancelável de `touchmove` somente quando há um gesto de borda elegível ou um gesto dentro do drawer. A intenção vertical remove o listener. A preparação da rota fecha o menu pelo fluxo existente.
- A montagem central evita rebinding duplicado de Espaços, reconstrução do FAB quando seu conteúdo já é válido e reconversão global de ícones já renderizados. A leitura da rota reaproveita o resultado para o mesmo hash.
- Clientes mobile monta o primeiro lote local de 10 cartões. Busca, filtros, ordenação e totais avaliam a mesma base autorizada. Produtos mobile calcula os contadores em uma passagem e reutiliza o formatador monetário. A busca atrasada de Produtos e atalhos pós-venda verificam a rota ou o Espaço antes de atuar. Atualizações da sincronização são incorporadas pela montagem que já está pendente.

## Medições

Chrome com viewport 390 × 844, CPU reduzida 4×, 80 ms e 200 kB/s. Três contextos por tema e versão. A base fictícia tem 2.006 produtos, 2.001 clientes, 5.001 vendas e 1.601 pagamentos. Tempos em ms, mediana e intervalo. A primeira seção pintada é estimada pelo ciclo de frames; ela não mede captura de pixels no Android.

| Tela | Dados úteis, claro base → candidata | Dados úteis, escuro base → candidata |
|---|---:|---:|
| Vender | 610 (591–616) → 350 (317–479) | 506 (486–514) → 341 (337–349) |
| Clientes | 595 (582–597) → 446 (417–790) | 606 (571–639) → 464 (444–541) |
| Produtos | 538 (520–548) → 443 (430–449) | 562 (557–714) → 431 (430–457) |
| Início | 202 (196–215) → 186 (181–368) | 204 (204–205) → 190 (190–198) |

O cabeçalho entrou no DOM em medianas de 15 a 22 ms. No escuro, a estimativa de primeira pintura da estrutura ficou em 19–50 ms de mediana. No claro houve caudas de até 357 ms. O tempo acumulado acima de 50 ms por tarefa em Clientes escuro caiu de 470 para 270 ms. No mesmo tema, o primeiro scroll após o gesto de Clientes passou de 44 para 23 ms de mediana. Com o skeleton mantido visível durante o teste de gesto, o scroll deslocou 151 px em 23–24 ms nos dois temas. O heap observado imediatamente após a troca ficou entre 14 e 27 MB nos dois lados, com aumento pontual em Início escuro. Por ser uma leitura pontual, isso não estabelece retenção ou vazamento.

## Verificação

- Troca rápida Clientes → Produtos com evento de sincronização no meio. O conteúdo de Clientes não montou após a troca. A navegação offline para Vender, busca de cliente além da primeira página, foco e scroll durante a estrutura passaram no cenário sintético.
- Venda fictícia concluída no roteiro de Vender. Na rodada de smoke de base grande e tema escuro, incluir item levou 81 ms e remover, 64 ms. Busca e abrir checkout ficaram acima de 100 ms. A gravação local genérica e a cadência de quadros no Android permanecem pendentes.
- Lint, build, pacote público de 290 arquivos, 61 testes de contenção e suite geral comparada por nome. As 65 falhas da base permaneceram as mesmas.

Rode `node scripts/audit-performance-navigation-v24215.cjs`. Para reproduzir a base, use `PERF_NAV_REF=67ea1a2`; para o cenário de toque durante carregamento, busca e offline, use a candidata com `PERF_NAV_SMOKE=1`. Os resultados ficam na pasta ignorada `qa-artifacts/performance/`.

## Android físico

Abra a candidata com `?perf-nav=1`. Nos primeiros 60 s, alterne Início, Vender, Clientes e Produtos, role após cada troca e abra o carrinho. Repita com rede instável ou offline em um dispositivo de teste com dados já disponíveis. Toque em **Copiar desempenho**. O relatório contém apenas nomes das rotas, tempos e durações de tarefas longas, sem envio automático ou acesso a registros. A versão servida, marca do aparelho, versão do Android e cenário podem ser registrados separadamente.

## Equipe e publicação

Os oito perfis locais usam as definições oficiais de cada ferramenta. Foram acionados Performance, UI/UX e Mobile/PWA no Codex. No host, foram localizadas as Skills `frontend-design`, `hyperframes`, `hyperframes-cli`, `hyperframes-registry`, `media-use`, `reverse-any-video` e `style-sampling` na pasta do Claude, além de um artefato de cache do plugin `agents-md`. A Skill `frontend-design` foi reutilizada. A ativação do plugin no Claude e a descoberta dos perfis numa sessão nova não foram executadas.

A homologação física segue pendente. Quando houver autorização, alinhar HTML e precache para os JS e o CSS modificados, além da nova identidade de versão/cache. O rollback seletivo pode reverter a montagem adiada em um novo commit e cache, preservando dados, fila, Vender, Clientes e a correção de inicialização.
