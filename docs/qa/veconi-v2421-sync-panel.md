# VECONI V242.1 — painel de sincronização

**GO técnico para publicar somente o frontend após autorização.** Candidata em `codex/v2421-sync-ui`, baseada em `eea6178` (V242 em produção). A fila real, os dados do Android e as três operações de 19/11 ficaram fora dos ensaios.

## Diagnóstico e correção

O motor já bloqueia o reenvio de `service_configuration_missing`. Mesmo assim, o relatório bruto conta a rejeição como erro, e a V242 usava esse total e a cor vermelha para apresentar o estado geral. A V242.1 separa a apresentação em três números: pendências enviáveis, erros que exigem atenção e histórico bloqueado. Arquivados/resolvidos continuam separados.

A visualização só põe no histórico uma rejeição de configuração de custo bloqueada para reenvio, com data anterior à publicação da correção da V241 (21/11/2026 às 03:03:17 UTC, [GitHub Pages da V241](https://github.com/murillocharles97-netizen/adi-festa-controle/actions/runs/44859077171)). Erros da mesma família após a correção e datas ausentes continuam exigindo atenção. Offline, falha de conexão independente, fila ilegível e outras falhas reais mantêm os avisos. O histórico expõe os erros originais em seção expansível. A indicação visual neutra não declara confirmação nem resolução.

O rodapé anterior comprimia seis botões em uma linha. Os dois painéis agora usam o modal já existente com conteúdo rolável e rodapé independente, duas colunas no mobile, alvos de pelo menos 44 px e o espaçamento de área segura do app. O tema escuro aplica tokens apenas nesses painéis. O novo cache é `veconi-v2421-sync-panel-v1`. A versão é 242.1 e o release numérico para o servidor segue 242.

Sem mudanças em `sync.js`, checkout, validação de custos, Functions, Firestore Rules, contratos ou armazenamento. Os contadores brutos, exportações de diagnóstico, IDs, envelopes e bloqueios continuam com a semântica anterior. Não há operação nova que escreva ou tente recuperar/reprocessar o histórico.

## Evidências

- Chromium isolado: 360, 390 e 412 px em claro e escuro, antes e depois. As seis combinações da V242 reproduziram rótulos que não cabiam nos botões. Nas seis combinações novas, os botões habilitados passaram no teste de clique; todos cabem no rodapé, sem sobreposição. O corpo rola e o rodapé permanece no lugar. Foram testados 0 pendências, 0 erros acionáveis, 3 históricos e 2 arquivados/resolvidos. Um erro novo da mesma família apareceu entre os erros acionáveis, e a operação fictícia pendente habilitou somente o fluxo existente de sincronização. O perfil não tinha acesso a produção. A área segura usa `env(safe-area-inset-*)`; não houve teste em Android físico com recorte de tela.
- Firestore Emulator: 29 passaram, 3 opcionais ignorados. Incluiu gravação atômica da configuração, combustível, configuração ausente ou divergente, histórico e retentativas. Chrome com Emulator: seis corridas fictícias em dois perfis de largura, usando Pix, dinheiro e cartão. Incluiu bloqueio de configuração ainda não conferida, reinício offline, resposta perdida e confirmação sem duplicar, sem despesa de combustível ou movimento de estoque fictício.
- Suíte ampla: V242 e candidata com 2.393 testes em cada, 2.235 aprovados, 157 falhas com os mesmos nomes e 1 ignorado. Contenção pública, build de sintaxe e build público passaram.

Capturas e resultados locais: `qa-artifacts/v2421/painel/`, `qa-artifacts/v2421/emulator.log` e `qa-artifacts/v2421/unit-final.log`. Para reproduzir a matriz, rodar `node scripts/audit-v2421-sync-panel.cjs` com Chrome e puppeteer-core.

## Publicação e validação

Após aprovação, conferir se a main ainda corresponde à V242. Publicar só pelo GitHub Pages e verificar build 242.1, cache e os dois modos do painel usando um perfil isolado. Uma validação no aparelho original pode abrir o painel e expandir o histórico. Não é preciso reenviar vendas antigas nem limpar dados do dispositivo. Se surgir regressão crítica, reverter a apresentação por um novo commit e usar outra identidade de cache. Preservar o armazenamento e o backend da V241.
