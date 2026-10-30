# V216 simplificada — Google somente para novos cadastros Google

> Registro histórico da preparação anterior ao deploy restrito. O estado real, a homologação e o GO/NO-GO atuais estão em [COMMERCIAL-READINESS.md](COMMERCIAL-READINESS.md). As afirmações abaixo sobre Google nativo habilitado, ausência de conta QA e ausência de laboratório publicado não representam mais a produção atual.

Esta decisão substitui a vinculação opcional. Não há ação de vincular Google em Minha conta, API de link ou reautenticação por senha no broker proposto. As pesquisas anteriores foram preservadas, mas não são o pacote desta versão.

Base sanitizada local: V215 `285200d1d6c7cd668f991caf6b5d35dce7225887`, checkout `C:/Users/Murillo/Documents/VECONI-V216-Google`. Nenhum release commit, push, deploy ou configuração de produção foi executado nesta etapa.

## Estado real comprovado por leitura

- Projeto `adi-festa-controle`, Firebase Auth clássico `FIREBASE_AUTH`.
- **5 usuários ativos, todos password; 0 Google; 0 outros provedores; 0 MFA**.
- Identidade secundária aprovada: ainda não existe no Auth real. Seu endereço não foi colocado no pacote público.
- Google nativo **ainda habilitado**. Senha habilitada. `allowDuplicateEmails=false`. Nenhuma blocking function.
- 92 Functions existentes; nenhuma das duas novas; nenhum trigger Auth-create encontrado.
- Frontend público permanece V215. Nenhuma sessão Auth foi criada nesta auditoria; nenhuma consulta comercial foi realizada.

O inventário é uma fotografia. Deve ser repetido imediatamente antes da mudança. Se surgir qualquer usuário Google, interromper a desativação e tratar essa dependência, sem remover provedores ou revogar sessões.

## Arquitetura implementada localmente

1. Google Identity Services seleciona a conta. Não é utilizado login/link nativo Firebase Google.
2. `prepareGoogleAccountAccess`: desafio de três minutos, nonce, CSRF e chave de sessão do cliente; prévia explícita de cadastro ou login; consulta segura de resultado.
3. Assinatura Google é verificada pela biblioteca oficial, com issuer, audience/azp fixos, exp/iat, sub, email_verified e nonce. Decodificação no navegador nunca autoriza uma identidade.
4. Piloto exige a identidade secundária autorizada no servidor. O hash do e-mail selecionado é conferido somente depois da prova Google; o primeiro sub verificado é fixado transacionalmente. Depois disso, outros subs são recusados mesmo com email coincidente. O endereço não seleciona um UID existente.
5. Cadastro é explícito. O servidor reserva um **UID novo aleatório** e chama somente `createUser`. A unicidade de email é aplicada atomicamente pelo Auth. `email-already-exists` recusa a operação e orienta método original. Nunca se busca um UID por email, atualiza credenciais, associa ou mescla conta antiga.
6. O vínculo privado `Google sub → UID novo` é ativado após conferência canônica do Auth. Não há `providerToLink`, `updateUser`, `linkWithCredential`, `signInWithPopup` ou `signInWithCredential` neste codebase.
7. Login exige esse vínculo privado ativo. O UID não é aceito do navegador. Tokens só podem ser emitidos para o UID reservado pela origem `google-registration-v216`, com prefixo específico e registro canônico compatível.
8. A concessão é consumida em transação **antes** da assinatura. Uma prova repetida nunca gera outro token. Resposta perdida é consultada sem token e sem mutação; um novo login exige desafio/nonce Google novo.
9. O custom token contém apenas marcador de método, sem papel ou permissão comercial. Nenhuma empresa, perfil, membership, assinatura ou claim de acesso é criada.
10. Para esta homologação restrita, existência de perfil empresarial no UID Google interrompe o broker. A liberação comercial futura exige revisão explícita desse limitador do piloto.

**Representação no Firebase:** essas contas novas usam Custom Authentication. `firebase.sign_in_provider` é `custom`, com marcador `veconi_google_v216`; a identidade Google/sub fica no binding privado. Não se adiciona o provedor Google nativo ao Auth. A ausência de `google.com` em providerData não é falha do cadastro; ela é deliberada nesta arquitetura, que mantém o endpoint nativo fechado.

## Proteção de contas de senha

- Os cinco usuários atuais não são migrados, relidos por email para associação ou modificados.
- A service account proposta não recebe `firebaseauth.users.update` nem delete. O código sequer disponibiliza esses métodos.
- Google nativo deve ser desabilitado por `updateMask=enabled`, preservando as demais configurações, **somente após autorização específica**.
- O broker verifica esse fechamento e a unicidade de email a cada etapa, inclusive imediatamente antes do token. Configuração desconhecida, falha de leitura ou Google nativo ativo bloqueiam Google.
- Nenhum hook é adicionado ao login por senha. Login, recuperação, convites, memberships, sessões e Sync antigos permanecem independentes do broker.
- Uma conta de senha com email coincidente é recusada, verificada ou não, sem gerar sessão Google, alteração do UID ou remoção da senha.

O Google nativo atual continua sendo um bloqueador: esconder botões não oferece a proteção global. **Não há comprovação do fechamento do endpoint de produção enquanto essa configuração não for autorizada e testada.**

## Dados e limites

Coleções privadas: `googleRegistrationControl`, `googleRegistrationIntents`, `googleRegistrationBindings`, `googleRegistrationReceipts`, `googleRegistrationLimits`. As Rules transitórias V215 já negam acesso direto; comprovado no Emulator, sem alteração de Rules.

CSRF usa Origin exata, JSON, chave aleatória mantida na memória do cliente e desafio CSRF separado, vinculados ao intent; não depende de cookies de terceiros. CORS tem lista exata, sem wildcard ou credenciais. Intent expira em três minutos. Rate limit inicial: 100 desafios/hora globais e 8 por chave de sessão/hora. O piloto tem validade explícita, proposta de 24 horas, e allowlist de uma identidade verificada. Não há tokens, senhas, client secrets ou chaves privadas persistidos/logados.

Retenção proposta: intents e limites por sete dias, com remoção administrativa posterior autorizada; bindings e recibos são preservados para login/auditoria. Nenhum TTL pago, scheduler, exclusão ou limpeza foi ativado.

## Conteúdo proposto

| Componente | Alteração |
|---|---|
| `google-v216-functions/` | Codebase separado, apenas duas novas Functions e dependências fixadas |
| `firebase.google-v216.proposed.json` | Configuração de publicação proposta; não executada |
| `js/google-registration-client.js` | Apenas cadastro/login, consentimento, antiduplo clique, leitura após resposta perdida |
| `js/google-registration-ui.js`, `google-registration-dialog.js` | Botões de entrada/cadastro, confirmação acessível; zero UI de vinculação |
| `js/firebase/google-auth.js` | Custom token; flags e configuração continuam fechadas |
| `js/firebase/auth.js` | Adaptação estreita de entrada e welcome explícito, sem empresa automática |
| `public-site.manifest.json`, `service-worker.js` | Excluem todos os módulos antigos de linking/authority do pacote |
| Configurações desktop/mobile | Novamente idênticas à V215; sem botão de vincular |
| `registration-only/public/` | Página de homologação proposta, separada; configuração desabilitada e credenciais Web vazias |

O visual aprovado e a tela de carregamento previamente preparados permanecem locais. Nenhuma alteração monetária, V212/V215, vendas, estoque, Fiado, filas, Rules ou Functions comerciais entra no novo codebase Google.

## Testes

- **27 testes novos/focados app/DOM/backend**, com conflitos verificados/não verificados, consentimento, isolamento de sessão, origem, CSRF, claims, replay, concorrência e resposta perdida.
- **10 cenários integrados Auth + Firestore Emulator**, projeto `demo-veconi-google-only`, tokens descartáveis assinados com certificado de QA. Uma venda ou registro comercial real não foi acessado.
- **47 testes de contenção** do pacote e Service Worker; pacote local **243 arquivos explícitos**.
- **16 regressões** de login por senha, recuperação, convites, bootstrap e logout.
- **11 verificações de navegador simuladas**, incluindo 320/360/390/430/768/1440 px, cancelamento, cadastro e login no mesmo UID, conflito e consulta sem replay. Não são OAuth real nem Android físico.
- Lint/build/diff-check são registrados no preflight final.

Dois testes antigos de comparação exata precisaram reconhecer o nome do novo adaptador e a ramificação estreita do welcome Google. O restante do contrato de convites/membership/logout continua comparado integralmente com a base. Não se enfraqueceu uma validação comercial para obter resultado verde.

## Publicação que ainda exige autorização

1. Revalidar provedores e manter main/produção na base esperada. Confirmar novamente ausência de dependência Google nativa.
2. Aprovar e aplicar apenas a desativação de `google.com` nativo, preservando senha e `allowDuplicateEmails=false`. Não fazer upgrade Identity Platform nem registrar blocking functions.
3. Criar service account de runtime exclusiva, sem chave exportada. Permissões propostas: Auth users.get/users.create/configs.get; Firestore databases.get/entities.get/create/update; `signBlob` só sobre si mesma. Não usar a service account ampla das Functions comerciais. Papel de deploy/actAs separado.
4. Criar cliente OAuth Web dedicado no projeto real para as origens do laboratório, sem mudar authDomain. Manter a configuração do provedor nativo desabilitada. O client secret não vai ao frontend; o clientId é público.
5. Preparar control privado, inicialmente desabilitado, com hash do tester, sub ainda não capturado, origens exatas, prazo de 24h e modos signup/signin. Nenhuma identidade será criada nesse preparo.
6. Publicar **somente** `prepareGoogleAccountAccess` e `completeGoogleAccountAccess` do codebase `google-v216-registration`, runtime Node22, service account dedicada, minInstances=0/maxInstances=1/concurrency=8/timeout=30s. As 92 Functions comerciais não são republicadas. Uso e recursos auxiliares podem gerar cobrança no projeto real; não se promete custo zero. QA permanece sem faturamento.
7. Criar site Firebase Hosting separado. URL **proposta, ainda não publicada/reservada**: `https://veconi-google-v216-lab.web.app` (alternativa firebaseapp.com). Não alterar o domínio GitHub Pages `veconi.app.br` nessa homologação.
8. Conferir configuração canônica; habilitar o piloto somente para o secundário e sub verificado. Antes de concluir cadastro, comprovar a recusa do endpoint nativo com token Google genuíno do tester, sem usar contas comerciais como alvo. Falha mantém Google bloqueado.
9. Usuário testa cadastro Google explícito, logout e login posterior, preservação do UID, cancelamento e Chrome Android/PWA. Nenhuma etapa pede senha/token/DevTools ou cria empresa.
10. Somente depois desse aceite preparar o release comercial; flags do site principal continuam desligadas nesta entrega. Incluir `veconi.app.br` em origens/rollout geral é outra autorização.

Não existe URL real pronta para teste no projeto de produção nesta etapa. O site QA antigo isolado pertence à pesquisa anterior; não comprova este fluxo contra o Auth de produção.

## Riscos e rollback

- **NO-GO para ativação agora:** Google nativo real ainda ativo, broker não publicado e OAuth real/Android/PWA ainda não homologados. Os testes de providerToLink do QA anterior não substituem a nova semântica sem linking.
- O caminho Google possui dependências novas (broker/Firestore/verificador/IAM), mas o login de senha existente não passa por elas. Uma indisponibilidade do broker deve afetar somente Google.
- IAM de assinatura não permite restringir matematicamente um custom token por UID; essa restrição depende do código, vínculo privado, conta de serviço isolada e controles de deploy. Nenhuma entrada aceita UID arbitrário. IAM Firestore é amplo por projeto/base, não por coleção; não se afirma uma restrição por documento que o serviço não oferece.
- Mudança posterior inesperada de credenciais/provedores na nova identidade Google é recusada, sem apagar ou reparar credenciais. A política comercial de recuperação dessas contas precisa ser homologada; não se adiciona uma rota de vinculação por recuperação nesta versão.
- A privacidade de erros e os limites reduzem enumeração/abuso, mas limites de instância/orçamento não são teto financeiro garantido.
- Após o primeiro cadastro, preservar Auth, UID, bindings, nonce/recibos e evidências. Pausar novos cadastros com `modes.signup=false`; conservar signin dos UIDs já cadastrados enquanto houver dependência. Não remover provedores nem revogar sessões antigas.
- **Nunca reabilitar Google nativo como rollback.** Não restaurar linking, Sync antigo, Rules permissivas ou dados anteriores. O frontend V215 permanece operacional para senha e os endpoints Google compatíveis permanecem para os novos usuários consentidos. Se o piloto expirar ou for pausado, renovar somente mediante decisão explícita.

Não foi criado hash/tag de release/rollback de produção. O material é candidato local sujeito à autorização específica das configurações e da homologação restrita.
