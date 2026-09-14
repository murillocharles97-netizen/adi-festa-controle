# Auditoria de performance conservadora — VECONI v135

Base: `origin/main` em `3ad72a3c0623430ee82c874b7df04a2483cf1547`. Branch: `codex/performance-safe-cleanup`. O site é estático, sem bundler: “bundle inicial” abaixo significa arquivos JS/CSS declarados no HTML ou efetivamente pedidos pelo navegador; “total” significa os arquivos web versionados em `js/`, `css/`, `assets/` e HTML/SW/manifest da raiz. Os valores são bytes locais sem compressão e excluem os módulos Firebase externos do CDN.

| Métrica | Base | v135 | Diferença |
| --- | ---: | ---: | ---: |
| JS declarado no `index.html` | 80 arquivos, 2.224.580 B | 76 arquivos, 1.745.419 B | −479.161 B |
| CSS declarado no `index.html` | 46 arquivos, 595.159 B | 46 arquivos, 595.070 B | −89 B (conteúdo não editado) |
| JS + CSS declarados | 126 arquivos, 2.819.739 B | 122 arquivos, 2.340.489 B | −479.250 B (−17,0%) |
| Recursos locais pedidos no primeiro carregamento sem login | 3.099.493 B | 2.620.188 B | −479.305 B (−15,5%) |
| Todos os assets web versionados | 165 arquivos, 5.215.114 B | 165 arquivos, 5.213.968 B | −1.146 B |
| Precache do Service Worker | 154 arquivos, 4.410.043 B | 154 arquivos, 4.408.902 B | −1.141 B |
| Dependências npm diretas | raiz: 2; Functions: 2 | raiz: 2; Functions: 2 | nenhuma removida |

O primeiro carregamento caiu quatro pedidos de script: engine, UI e serviço do Financeiro (aproximadamente 476 KB juntos), e a biblioteca QR (aproximadamente 59 KB). Parte desses arquivos não entrava no mesmo instante da captura de rede inicial, por isso a redução medida no navegador é de cerca de 479 KB. Financeiro e QR continuam disponíveis sob demanda e no precache offline.

## Leituras e listeners em cenário controlado

O navegador Chrome headless fez login em `Auth` e `Firestore` locais, com o mesmo usuário, empresa e três espaços financeiros em ambas as revisões. O contador de repositório, que não instrumenta todas as APIs diretas do Firebase, mostrou **2 documentos recebidos no listener de produtos** nas duas revisões. A instrumentação temporária de `getDocs` do serviço financeiro mostrou **4 consultas tentadas / 3 concluídas / 3 documentos retornados / 1 `permission-denied` na base**, e **0 / 0 / 0 / 0 em Vender na v135**. Ao abrir Financeiro na v135, voltaram as mesmas quatro tentativas e três documentos. O `permission-denied` também ocorre na base para uma das consultas desse fixture; não foi introduzido pela mudança e as regras não foram alteradas. Esses números representam chamadas e documentos retornados no Emulator, não uma fatura de leituras do Firebase em produção. `getDoc` do bootstrap e eventuais leituras internas do SDK não fazem parte dessa contagem.

Listeners ativos após o login e a estabilização: **5 → 5** (produtos, configuração, metadados de sync, pedidos do catálogo, solicitações de resgate). Antes do login: **0 → 0**. O Financeiro não tem `onSnapshot`. O Catálogo iniciava os dois listeners antes da primeira publicação do documento público; se recebiam erro, o SDK os encerrava, mas o mapa e o contador continuavam a tratá-los como ativos. Agora o erro fecha e retira o par, permitindo novo registro após a publicação. Um teste do app completo observou `permission-denied`, fechamento e registro bem-sucedido do par; não houve alteração em permissões ou regras.

Três execuções de startup sem login, em processo local, variaram bastante: mediana de `DOMContentLoaded` **618 → 659 ms** e tela de login pronta **708 → 713 ms**. Login até Vender com o Emulator: **3.618 ms** na base e **3.604, 3.635 e 3.645 ms** após a mudança. A amostra não comprova redução de tempo perceptível; comprova redução de bytes e consultas financeiras fora da tela. O custo fixo do bootstrap, autenticação e sync continua dominante.

## Achados e decisões da auditoria

- **Startup e dependências grandes:** `assets/lucide.min.js` (~358 KB), `js/financial-ui.js` (~215 KB), `js/firebase/financial-space-service.js` (~164 KB), `js/financial-engine.js` (~40 KB), `assets/qrcode.min.js` (~59 KB) e `assets/zxing-browser.min.js` (~441 KB). ZXing já era carregado apenas no scanner. Lucide é usado por todas as telas. O Financeiro e o QR eram os cortes independentes com ganho claro. CRM, Campanhas, Planos, Catálogo, Relatórios e Configurações ainda têm scripts/CSS globais e acoplamento com shell, venda, catálogo e permissões; separá-los completamente exige refatoração e regressão mais amplas, portanto ficou como trabalho futuro.
- **Firestore:** o serviço financeiro executava quatro `getDocs` no `firebase-auth-ready` mesmo em Vender. Agora só monta e consulta quando Financeiro é solicitado. Produtos mantêm um listener central necessário ao estoque em tempo real; configurações e sinal de sync usam listeners centrais. O Catálogo conserva dois listeners quando o catálogo universal está habilitado. O `sync` ainda pode fazer pull inicial de clientes e de outras coleções sem limites adequados a grandes contas; alterar isso exige uma estratégia de migração/offline e não foi feito. Há consultas por cartão/fatura com limite por cartão e potencial N+1 no Financeiro, também deixadas para análise futura. Nenhuma consulta por card de produto foi adicionada.
- **Código e arquivos supostamente mortos:** não houve remoção. Arquivos sem import estático podem ser usados por globais, HTML, manifest, Service Worker, importação dinâmica, Cloud Functions, webhooks ou dados legados. Ícones e marcas V133 continuam no manifest/precache. ZXing e QR continuam necessários. Nenhum helper/componente duplicado foi eliminado sem prova de equivalência funcional.
- **CSS e renders:** 46 folhas no HTML e seletores antigos/possivelmente sobrepostos; sem prova de ausência em todos os tamanhos e estados, nada foi removido. Os filtros de Vender continuam locais, sem query Firestore por tecla. A centralização atual de listeners e o cache local foram preservados.
- **Imagens:** os cards já preferem `imageThumbUrl`, usam carregamento tardio/decodificação assíncrona e preservam posição/zoom. Nenhuma imagem ou regra de enquadramento foi alterada.
- **PWA:** o precache continua incluindo Financeiro, QR e demais recursos para funcionamento offline. Apenas o identificador do cache mudou para v135, fazendo a ativação apagar caches antigos de assets do app. O código não apaga IndexedDB, persistência Firestore ou dados locais do usuário.
- **Dependências:** `firebase` CLI e `@firebase/rules-unit-testing` na raiz, `firebase-admin` e `firebase-functions` em Functions são usados. Nenhuma foi trocada ou removida por poucos KB.

## Validação

- `npm test`: 416/416; `npm run lint` e `npm run build`: 202 arquivos JavaScript; `git diff --check`: aprovado.
- Rules no Emulator: 76/76; Functions no Emulator: smoke tests aprovados. Os testes do navegador para Vender desktop, Início/Clientes, CRM mobile, Campanhas, Financeiro, Assinaturas/Mercado Pago, PWA/offline e estrutura mobile passaram.
- QA real no Chrome com Auth/Firestore Emulator: login; Vender com dois produtos, busca e carrinho com três itens; venda concluída (1 venda local, carrinho zerado); Início, Clientes, Produtos, Financeiro; retorno a Vender offline com produtos visíveis; reconexão; logout com 0 listeners restantes. Financeiro carregou seus três scripts apenas ao entrar na rota. O QR foi gerado no fixture depois de abrir seu diálogo. O fixture artificial emite `Cannot read properties of null (reading 'planId')` após logout nas duas revisões; não é regressão desta branch.
- Layout mobile validado em **320, 360, 375, 390, 412 e 430 px**. O teste `test:public-catalog-browser` falha em 1024 px na atualização do título tanto na base intacta quanto nesta branch; é falha preexistente, não corrigida nesta limpeza.

Reprodução das métricas: `node scripts/audit-performance-runtime.cjs` (ou `BASELINE=1` e `APP_ROOT=<worktree-da-main>`), e `firebase emulators:exec --only firestore,auth --project adi-festa-variations-test "node scripts/audit-performance-emulator.cjs"` com `FULL_APP=1` e opcional `BROWSER_QA=1`. O teste usa somente IDs e dados artificiais no Emulator.
