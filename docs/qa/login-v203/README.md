# Login definitivo VECONI — implementação local V203

Base sanitizada: `c80da0fffb0106aea4d23cf097ee33896522f07c` (V202), em `C:/Users/Murillo/Documents/VECONI-Sanitized-20261024`.

## Estado da entrega

O login real foi atualizado em HTML/CSS e no controlador existente. Não há imagem estática usada como interface, SDK substituto na aplicação ou backend novo. O SDK publicado continua Firebase Auth **10.13.2**. Não houve commit de release, tag nova, push, deploy ou ativação de Rules.

As sete alterações operacionais V203 de modais e revisão de vendas foram preservadas byte a byte. Seus hashes anteriores estão em `scope-baseline.json`; a verificação final confirmou igualdade em todos os arquivos. As capturas, galeria e documentação da prévia anterior também foram preservadas. A documentação anterior registra a etapa em que o login ainda era somente proposta; este documento descreve a integração posterior.

## Visual implementado

- Desktop: fundo azul-petróleo/turquesa, marca oficial na apresentação lateral, tagline, título aprovado e quatro benefícios com ícones locais Lucide. Card branco à direita, sem repetição visual da marca dentro dele.
- Mobile/tablet: apresentação lateral oculta, marca oficial no topo do card, título, subtítulo, campos, recuperação, Entrar, Criar minha conta e Ver planos.
- A composição usa o componente existente `VeconiBrand` e o SVG oficial `assets/veconi-symbol.svg`, sem alterar os assets ou desenhar uma marca aproximada. O componente oficial compõe o símbolo V com o wordmark existente.
- Nenhum slogan foi colocado na região inferior esquerda. A frase “Mais gestão. Mais resultados.” não aparece na interface.
- Medidas independentes para mobile, tablet e desktop; sem herdar o padding dos painéis administrativos. Rolagem vertical natural, safe-area insets, campos com pelo menos 16 px e ações acessíveis sem reduzir o zoom.

## Funcionalidade preservada

O formulário mantém os nomes dos campos, envio por Enter e `signInWithEmailAndPassword(auth,email,password)`. Cadastro, aceite de convite, recuperação autenticada já existente, logout, redirecionamentos, validação de membership, proteção de UID, namespaces, bootstrap, timeout e observador de sessão permanecem no caminho canônico.

O trecho completo do controlador a partir de `loadInvitePreview` até o final é idêntico à V202, normalizando apenas CRLF/LF. Isso inclui criação de conta, convites, bootstrap, estados de erro e sessão. Os imports de Firebase, Sync e serviços também são idênticos.

Melhorias restritas à apresentação/entrada:

- Label explícito para senha, com o botão mostrar/ocultar fora do label; `aria-pressed` e nome acessível atualizados.
- Campos com autofill `username` / `current-password`, preservação do e-mail após erro e nenhuma persistência de senha pela nova interface.
- Proteção de duplo envio do formulário e de respostas de UI obsoletas.
- Link de recuperação antes do login, usando **o mesmo `sendPasswordResetEmail` já importado**, sem criar endpoint, Function ou configuração do Firebase.
- Resposta de recuperação genérica, inclusive para e-mail inexistente. Isso não representa uma alteração ou auditoria da política de enumeração do Firebase no servidor.
- Erros de rede continuam sendo erro; o formulário permite tentar novamente ou recuperar acesso.
- Loading com indicador discreto, texto acessível e preferência por movimento reduzido. Timeout, detalhes técnicos, retry, saída e recuperação de configuração não foram removidos ou mascarados.

## Testes e resultados

| Bloco | Resultado |
| --- | --- |
| Novos testes Node do login | 8 aprovados, 0 falhas |
| Regressões operacionais V203 anteriores | 148 aprovados, 0 falhas |
| Conjunto ampliado de testes relacionados | 201 executados: 199 aprovados; 2 falhas legadas reproduzidas na V202 |
| Chromium + SDK Firebase Auth 10.13.2 + Auth Emulator | 28 cenários aprovados, 0 falhas |
| Lint e build | Aprovados |
| `git diff --check` | Aprovado |
| Rollback somente do login | `git apply --check` aprovado; não aplicado |
| Sete arquivos operacionais V203 | Hashes anteriores e atuais idênticos |

### Autenticação real no Emulator

Projeto dedicado `demo-veconi-login-v203`, Auth Emulator em `127.0.0.1:9198`, navegador com perfil separado. O teste carrega o controlador real com substituição somente de imports para dependências de QA. O **SDK 10.13.2 é o mesmo da produção**, servido localmente durante o teste. As requisições de Auth só podem ir ao Emulator; requisições externas do navegador são bloqueadas.

Login, senha incorreta, conta desativada, cadastro, envio de recuperação e persistência após reload usam o SDK real. Serviços comerciais são mocks; a continuação de bootstrap empresarial no observador de QA fica retida para impedir qualquer chamada comercial. A preservação do bootstrap real é verificada pelos testes de regressão e pela comparação do código. Não se trata de um smoke contra produção ou validação completa de backend empresarial.

Verificações incluídas:

- Mobile 320, 360, 390 e 430 px; tablet 768 e 1024 px; notebook 1366 px, desktop 1440 px e altura reduzida de 560 px.
- Reflow equivalente a zoom 100%, 125%, 150% e 200%; teclado simulado por viewport de 390×360; botões alcançáveis por rolagem, sem overflow horizontal.
- Tab, Enter, labels, mostrar/ocultar, autofill, contraste das cores principais e redução de movimento.
- Login real por Enter e duplo submit com **exatamente um POST**. A contagem inicial do teste incluía OPTIONS/preflight; o coletor foi corrigido para distinguir método e endpoint, sem alterar o login para contornar o teste.
- Sessão Firebase preservada após reload e erro de conta desativada mantido.
- Recuperação real no Emulator com registro de OOB e apresentação genérica para conta existente/inexistente; nenhum e-mail real enviado.
- Cadastro pelos três passos existentes, usando Auth real e conclusão empresarial simulada, sem criar empresa comercial.
- Convite fictício: e-mail preservado, criação de acesso e retorno ao login; nenhum convite real consumido.
- Navegação para planos e retorno usando o binding existente, com tabela fictícia no harness.
- Estados reais do formulário e apresentações de loading/falha com retry/saída preservados.

### Duas falhas legadas, não introduzidas pelo login

1. `Sync response after account switch cannot acknowledge, remove or change any queue in the new identity`, em `tests/cache-session-hotfix.test.js`: o sandbox do teste não fornece `window` ao caminho atual do Sync; lança `ReferenceError: window is not defined`.
2. `service worker V135 migra apenas caches do app e preserva os assets V133`, em `tests/veconi-pwa-branding-v133.test.js`: expectativa desatualizada de cache `veconi-v173-session-team-hotfix`, incompatível com o Service Worker V202 já existente.

Reprodução somente leitura: `node scripts/check-login-v203-baseline.cjs`. O loader usa blobs da V202 sanitizada para reproduzir exatamente as duas falhas, sem mudar checkout, código ou testes de Sync/Service Worker. Não houve correção desses módulos nesta demanda.

### Limites restantes

- Android/iOS físicos, teclado real, barras dinâmicas e safe areas físicas não foram testados. A implementação usa `dvh`, insets e rolagem natural; recomenda-se uma conferência física curta antes do deploy.
- Zoom validado por viewport CSS equivalente, não pelos menus do navegador do usuário.
- Não foi realizado login, cadastro, reset de senha ou alteração de sessão em conta real.
- As Rules restritivas da V202 continuam fora desta entrega; sua ativação depende de processo e autorização separados.

## Arquivos novos/modificados desta etapa

### Produção — somente três arquivos

1. `css/firebase.css`: layout, cores, responsividade, ações, foco e loading, com regras novas escopadas ao `#auth-gate`.
2. `js/firebase/auth.js`: shell de apresentação e formulário; link de recuperação usando SDK existente. Fluxos comerciais/empresariais posteriores preservados.
3. `index.html`: cache keys locais do CSS e módulo de Auth. `build-info` e Service Worker continuam V202; o fechamento de versão/PWA será feito no preparo do release autorizado.

### QA/documentação — fora da publicação explícita

- `tests/login-redesign-v203.test.cjs`.
- `tests/fixtures/login-integrated-v203.html`, `login-auth-deps-v203.mjs`, `login-auth-emulator.json`.
- `scripts/audit-login-redesign-v203.cjs`, `check-login-v203-baseline.cjs`, `preview-login-integrated-v203.cjs`.
- Esta pasta: relatório, galeria, resultados, capturas, fingerprints e patch de rollback.

Não foram alterados Functions, Rules, Firebase config, permissões, SDK, Sync, Fiado, Trocas, estoque, filas, cache empresarial, manifest de publicação ou componente/assets oficiais da marca.

## Preparação da próxima versão e rollback

Proposta: **V203 UX frontend/PWA**, incorporando o bloco operacional já preparado e o login integrado, com os dois escopos claramente separados no diff. A integração do login não sobrescreveu o bloco operacional. O pacote final, bump de versão, commit/tag e deploy dependem de autorização — nada foi publicado ou marcado como release.

Rollback compatível de apresentação: `rollback-login-only.patch`, validado com `git apply --check`. Reverte **somente** os três arquivos de login à base sanitizada, mantendo as sete alterações operacionais V203 e todo o piso de autorização V202. Não executa rollback de Functions, Rules, recibos, protocolo, dados, namespaces ou filas. Não foi aplicado. Após o fechamento de versão/cache do candidato, esse patch deverá ser regenerado e validado contra o commit final antes de criar a tag proposta `rollback/v203-compatible-login`.

O rollback de autorização já existente `ff4c9f72720a0029e4e4ccd4142730c4cf2ab004` / `rollback/v202-compatible-authorization` foi preservado. Nenhuma proteção do GitHub foi alterada.

Ordem futura proposta, sem autorização de deploy nesta etapa:

1. Revisar o pacote frontend/PWA final e seus hashes, sem incluir código de QA, fixtures, screenshots, SDKs de teste ou arquivos históricos sensíveis.
2. Fechar versão/cache PWA, executar os testes essenciais e validar o rollback contra o candidato final.
3. Após autorização, publicar somente frontend/PWA; nenhuma mudança de Functions/Rules.
4. Smoke não destrutivo de login/saída/recuperação e acessibilidade, sem operações comerciais reais.

## Reproduzir

```text
node --test tests/login-redesign-v203.test.cjs
firebase emulators:exec --only auth --project demo-veconi-login-v203 --config tests/fixtures/login-auth-emulator.json "node scripts/audit-login-redesign-v203.cjs"
node scripts/check-login-v203-baseline.cjs
npm run lint
npm run build
git diff --check
git apply --check docs/qa/login-v203/rollback-login-only.patch
node scripts/preview-login-integrated-v203.cjs
```

A prévia visual navegável usa mocks sem acesso à rede; não utilize credenciais reais. A validação de autenticação é feita separadamente no Emulator, não na prévia visual.
