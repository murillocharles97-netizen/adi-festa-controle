# V216 — clique Google sem resposta: reprodução e correção local

Base sanitizada publicada: `b58188d250edf299efe8cb47cfe7980cfc7626dc`.
Nenhum commit de release, push, deploy, alteração OAuth ou de usuários foi realizado nesta correção.

## Causa comprovada

No endereço de homologação comercial, um clique real chega ao handler. O preflight do broker responde 204 e `prepareGoogleAccountAccess`, `begin/signin`, responde 200 com a origem comercial autorizada. O seletor é criado, mas permanece atrás do login: seu `z-index` calculado é 60, contra 10000 do gate. A regra posterior `.modal-bg` sobrescreve `.google-registration-overlay`, de mesma especificidade. A interface aguarda a seleção invisível e mantém os botões desabilitados.

A reprodução ocorreu em Chromium descartável controlado por depuração. Nenhuma conta foi selecionada. Não houve falha CORS, de origem ou de autorização nessa etapa. O popup ainda não tinha sido solicitado: ele depende do botão oficial dentro do seletor encoberto.

Defeito adicional reproduzido: o handler retornava silenciosamente se o botão de senha estivesse desabilitado, mesmo sem requisição de senha em andamento. Esse estado não causou a reprodução inicial, em que o botão estava habilitado.

## Correção mínima

- Especificidade restrita aos overlays Google, acima do gate, respeitando a ordem real do CSS.
- Texto de progresso, instruções para abrir o seletor oficial, cancelamento visível e retorno ao login.
- Bloqueio entre métodos apenas enquanto há uma requisição de senha efetiva; nenhuma chamada de autenticação foi substituída.
- Mensagens para falha de rede e timeout, preservando os limites do broker e a consulta segura de resposta perdida.
- Carregamento do SDK GIS limitado a 12 segundos, com liberação do estado de carregamento em falha e nova tentativa possível. A requisição ao broker continua limitada a 30 segundos.
- Restauração dos rótulos e estados anteriores dos botões; campos digitados preservados.
- Harness do navegador passa a usar todos os stylesheets na mesma ordem do `index.html`; o anterior carregava Google por último e mascarava a regressão.

## Validação

- 103 testes app/DOM, broker e contenção aprovados, incluindo 11 regressões novas para o clique, carregamento GIS, falhas do broker e requisição de senha em andamento.
- 11 cenários de navegador local aprovados, com oito tamanhos de viewport e a ordem real do CSS.
- Página publicada carregada em navegador descartável com apenas os seis arquivos locais de frontend substituídos para o teste: camada calculada 10020 > 10000, botão oficial clicável e popup aberto em `accounts.google.com/v3/signin/identifier`.
- Cancelar/fechar o popup e cancelar o seletor libera Google e senha. Em 390 px, botão de retorno acessível e sem overflow horizontal.
- Lint/build e diff-check aprovados; pacote local confere a lista explícita de 244 arquivos, incluindo CNAME.

Isso comprova a correção do clique e da abertura do seletor. Não constitui aprovação de login completo: nenhuma identidade foi selecionada e nenhum custom token foi solicitado no teste real desta correção.

## Arquivos

Frontend: `css/google-auth.css`, `js/google-registration-ui.js`, `js/google-registration-client.js`, `js/google-identity-picker.js`, `js/firebase/google-auth.js`, `js/firebase/auth.js`.

Regressões: `scripts/audit-google-commercial-v216.cjs`, `tests/google-click-feedback-v216.test.cjs`, `tests/google-picker-loading-v216.test.cjs`, `tests/google-broker-feedback-v216.test.cjs`.

As evidências privadas de reprodução, JSONs e capturas estão em `C:/Users/Murillo/.codex/visualizations/2026/10/30/v216-google-click-issue/`, fora do pacote público.

## Publicação e limites

É necessário outro deploy somente frontend/PWA, proposto como V217, com atualização do identificador de cache do Service Worker para entregar os arquivos corrigidos. Não requer Functions, Rules, OAuth, authDomain ou política do broker. Google público e novos cadastros continuam desativados.

Não foram modificados contas, credenciais, dados comerciais, filas, cache de usuários ou evidências de recuperação. Validações de nonce, sessão, identidade, assinatura, origem e autorização do broker permanecem intactas. O rollback compatível V216 `08cffcf0d974579fd29863d151529fd5eec330ef` e a tag `rollback/v216-compatible-google-broker` permanecem preservados.

Após autorização e publicação, repetir somente o acesso Google restrito pelo domínio comercial, com a identidade QA, para concluir o smoke autenticado. Nenhuma liberação pública está implícita.
