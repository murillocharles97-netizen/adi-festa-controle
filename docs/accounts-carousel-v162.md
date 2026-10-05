# Contas e cartões — V162

## Escopo e arquitetura

Reforma restrita à apresentação de Contas e cartões na Home financeira. A aplicação usa JavaScript vanilla, CSS e Lucide locais. Não há Swiper/React no projeto; nenhuma dependência foi instalada. Recebemos a especificação textual, mas não as imagens e o código da referência citados nela.

O agrupamento existente `institutionGroups`, o dashboard autorizado já carregado e as ações existentes de instituição foram preservados. `FinancialInstitutionCard` apresenta os dados; `FinancialAccountsCarousel` cuida de posição, navegação e snap. A lista completa de instituições e os detalhes não foram redesenhados. No contexto de espaço específico, o carrossel usa o dataset autorizado dessa visão, substituindo o antigo resumo compacto de cartões, sem nova consulta.

## Comportamento

- Card central em escala 1, laterais 0,94, demais 0,92. Sem rotação 3D, autoplay, clones ou saldo repetido.
- Desktop: cards de 360 px. Mobile: até 82vw, máximo 360 px, com próximo card parcialmente visível e sem overflow da página.
- Snap CSS obrigatório centralizado, com conclusão programática para o centro mais próximo. Drag mouse, touch nativo, trackpad horizontal, setas, Home/End e paginação. Animação de 300 ms, easing cubic-bezier(0.2,0.8,0.2,1); reduced motion sem deslocamento animado.
- Primeiro clique lateral centraliza. Detalhes/menu só executam no card ativo; reutilizam os handlers atuais. Até 5 instituições: indicadores discretos; acima disso: contador. Uma instituição não exibe navegação. Estado vazio tem CTA funcional de inclusão.
- Estado ativo somente em memória, isolado por empresa, usuário, geração e visão de espaços. Listeners, timers e ResizeObserver encerrados no repaint/saída. Nenhum write de navegação.
- Aria-label, posição da instituição, aria-current, foco visível, botões nomeados e teclado; cards laterais não colocam ações secundárias na sequência de Tab.

## Dados e segurança financeira

- Conta/carteira: saldo disponível do agrupamento canônico existente; não adiciona limite de crédito.
- Cartão: total da fatura já calculado, situação e vencimento da fatura aberta. Fatura paga não recebe alerta de vencimento. Cartão sem fatura não inventa data.
- Conta + cartão: uma instituição, com saldo e fatura separados. Identificação mostra somente últimos quatro dígitos já disponíveis.
- Investimento: patrimônio registrado, não zero fictício de saldo disponível. Não altera a inclusão/exclusão de investimentos no saldo disponível da Home.
- Limites só aparecem quando os valores e compromissos são conhecidos. Várias linhas de cartão na mesma instituição usam “Limites somados”; valor desconhecido omite a barra, não supõe zero.
- Iniciais e pequenos acentos locais, sem baixar logos. Nenhuma consulta extra por hover, drag ou mudança de card; zero listeners Firestore novos. Saldo/resumo antes e depois da navegação é idêntico no teste.
- Não houve alteração em Engine, serviço financeiro, contas, transações, faturas, Rules, backend, espaços, reset, Payment Engine ou sync. Sem migração e sem escrita em dados reais.

## Validação

`tests/financial-accounts-carousel.test.js`: sete novos testes de tipos, faturas, investimento, limites ausentes/zero, escape de conteúdo, snap, easing e cardinalidades.

`scripts/audit-accounts-carousel-v162.cjs`: Chromium real com dataset local de QA. Larguras 320/360/375/390/412/430/1024/1280/1366/1440/1600/1920; overflow da página zero; centro com erro inferior a 2 px após mouse drag, touch emulado, wheel horizontal, setas e Home/End. Testes de 0/1/2/3/8/12 instituições, primeiro clique lateral, detalhes, ações, reload, reduced motion e zero queries de navegação.

594 testes unitários passaram. Lint/build: 288 arquivos JS. Smoke no app completo com Auth/Firestore/Functions emulados passou: login, Home, Vender, venda normal/fiado, recebimento, Payment Engine mock, WhatsApp individual/sequência, Financeiro, Histórico, Equipe, sincronização em dois contextos e reload. A auditoria Desempenho V161 também passou, incluindo PWA/service worker, cache de assets e prévia offline. Os campos de versão legados nos scripts de regressão não indicam o build executado.

Android físico e WhatsApp real não foram testados; o touch foi emulado. Não foram criadas instituições fictícias em produção. Capturas da implementação com dados de QA:

- `screenshots/accounts-carousel-v162/1440-inter.png`
- `screenshots/accounts-carousel-v162/1440-c6.png`
- `screenshots/accounts-carousel-v162/390-inter.png`

## Arquivos e release

Novos componentes: `js/financial-accounts-carousel.js`, `css/financial-accounts-carousel.css`. Integração: `js/financial-ui.js`, lazy load em `js/app.js`, stylesheet em `index.html`, assets no service worker. Fixture e testes locais, este relatório e screenshots. Identificadores de build/cache e respectivas expectativas de teste atualizados para 162 após QA.

Um único commit final e um único push de frontend. Não é necessário deploy de Firebase. APP_VERSION 162; cache `veconi-v162-accounts-carousel`. O commit da entrega é aquele que contém este relatório. O resultado do deploy e SHA são informados na conversa após verificação pública, sem declarar publicação antecipadamente neste documento.

Rollback: frontend V161, `a52d937055d07c17929aac13a8631c95afa063e3`. Sem downgrade de Rules/backend ou geração de workspace. URL: https://murillocharles97-netizen.github.io/adi-festa-controle/
