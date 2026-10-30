# V216 — preparação comercial após homologação restrita

> Publicação atual autorizada: [CONTROLLED-RELEASE.md](CONTROLLED-RELEASE.md). Google público e novos cadastros continuam desligados; a origem comercial é aceita somente no piloto da identidade QA já fixada no servidor. A abertura comercial schema 2 descrita como proposta neste documento não é ativada nesta etapa.

Estado de 30/10/2026. Este documento substitui os estados de prontidão anteriores. **Nenhum deploy comercial ou alteração de usuário foi feito nesta preparação.** Em etapa pontual expressamente autorizada, acrescentou-se somente a origem OAuth `https://veconi.app.br`; a validação passou às 10:33 (São Paulo). Ver [OAUTH-ORIGIN-APPLIED.md](OAUTH-ORIGIN-APPLIED.md). Base: V215 sanitizada `285200d1d6c7cd668f991caf6b5d35dce7225887`.

## Resultado real, somente leitura

| Verificação | Resultado |
|---|---|
| Identidade secundária Google | Exatamente um UID Auth e um binding privado ativo |
| Recibos | Um cadastro e quatro logins, todos no mesmo UID/sub; três novos logins desde a primeira auditoria |
| Prova do bloqueio nativo | Todos os intents concluídos têm `nativeProbePassed=true`, após prova Google assinada |
| Cinco usuários anteriores | UID, password, disabled, emailVerified, validSince e passwordUpdatedAt inalterados |
| Identidade QA | Sem perfil users, empresa, onboarding, membership, member document ou claims comerciais |
| Auth real | Google nativo desativado; senha ativa; email único; nenhum blocking hook |
| Aplicativo comercial | V215 e recursos V212/V215 inalterados |
| Functions | 92 existentes inalteradas; duas do piloto ACTIVE, revisões originais preservadas |
| GitHub | Rulesets 25744131 e 25744311 ativos |
| Android físico | Cadastro/logout/login confirmados pelo proprietário no Chrome Android |
| PWA instalado | **Aprovado pelo proprietário**: mesmo UID no PWA Android QA instalado. A conferência remota confirma a identidade e os novos recibos; a identificação de PWA físico depende do teste informado pelo proprietário |

Evidência técnica privada: `C:/Users/Murillo/.codex/visualizations/2026/10/30/v216-commercial-preparation/REAL-GOOGLE-AUDIT.json`, `REAL-GOOGLE-AUDIT-AFTER-PWA.json` e `PRODUCTION-UNCHANGED.json`. A leitura posterior ao teste físico foi concluída em 30/10/2026 às 09:58 (São Paulo), sem mutações. Não publicar esses arquivos nem os documentos brutos do Auth. Os cinco usuários antigos não foram usados como alvo de login Google.

## Candidato local

- Tela inicial com **Continuar com Google** e cadastro com **Criar conta com Google**, usando o formulário real, marca oficial e carregamento aprovados. Sem vinculação em Minha conta.
- O adaptador permanece com `GOOGLE_SERVER_POLICY_READY=false`. Client ID Web e base do broker já estão preparados localmente; são identificadores públicos. O site comercial publicado continua sem Google.
- Seleção Google e confirmação explícita possuem camada acima do auth gate, rolagem, ações acessíveis e restauração de foco. A validação no navegador integrado encontrou e corrigiu a sobreposição antes da publicação.
- Cadastro cria somente uma nova identidade Auth. Sem empresa, membership, papel ou assinatura. O welcome oferece **Cadastrar minha empresa**, com consentimento explícito, usando `completeBusinessOnboarding` já existente. Aceitar convite permanece outro caminho existente.
- Novo cadastro com email de senha existente é recusado pela unicidade transacional do Auth. Não existe busca de UID por email, updateUser, providerToLink, Firebase Google nativo, troca de UID ou associação de conta antiga.
- Login resolve o sub Google verificado para o binding privado original. Só esse UID reservado pode receber custom token, sem privilégios comerciais.

### Abertura controlada do servidor

A política v1 do piloto continua compatível e restrita à identidade autorizada. **O código comercial novo não foi publicado nem a política real alterada.**

A política v2 proposta exige simultaneamente `V216_GOOGLE_COMMERCIAL=true`, `registrationOnly=true`, `pilotOnly=false`, rollout identificável e `requireNativeProbe=true`. O JSON proposto está em `google-v216-functions/control.commercial.proposed.json`, desabilitado por padrão. A identidade já criada pelo piloto permanece utilizável com o mesmo binding/UID/recibos.

Limites iniciais máximos: 100 desafios/hora globais, 8 por chave de sessão/hora, 12 desafios por sub verificado/hora e **20 reservas de cadastro/dia UTC**. A reserva é transacional; conflito ou resposta perdida não permite multiplicar a cota. A chave de sessão sozinha não prova um dispositivo: os limites globais, por sub assinado e de cadastro são independentes. Abertura inicial tem janela explícita para cadastro. O fim dessa janela **não expira login** de usuários já cadastrados.

Mudanças na política/origem/rollout invalidam provas antigas. Não há retry automático de criação ou de concessão. Consumo durável precede assinatura; resposta perdida exige consulta sem token e novo desafio Google. Native Google deve continuar fechado e sua configuração autoritativa é conferida em cada etapa.

No modo comercial, login em um UID originalmente criado pelo broker continua autorizado depois que ele concluir onboarding explicitamente. O broker não cria, altera nem revalida privilégios da empresa: o bootstrap comercial e as permissões existentes continuam responsáveis pelo acesso. No modo piloto, o bloqueio de qualquer perfil empresarial permanece.

## Prontidão e autorização de publicação

1. **Origem OAuth corrigida e validada:** `https://veconi.app.br` foi acrescentada ao cliente Web existente, preservando as três origens anteriores, client ID, authDomain e redirect. GIS agora retorna **200**, sem enum 5, na origem comercial e na origem do laboratório. O broker ainda recusa a origem comercial intencionalmente. Resultado em [OAUTH-ORIGIN-APPLIED.md](OAUTH-ORIGIN-APPLIED.md); diagnóstico histórico em [COMMERCIAL-DOMAIN-403.md](COMMERCIAL-DOMAIN-403.md).
2. A publicação futura precisa de autorização para atualizar exclusivamente as duas Functions Google, a configuração de origens/política do broker e o frontend. Esse rollout comercial ainda não foi aplicado; a única configuração efetivamente alterada foi a origem OAuth autorizada acima.

O bloqueador físico de PWA foi encerrado pela confirmação explícita do proprietário. Não é necessário repetir o cadastro ou o login no laboratório. A validação no domínio comercial continua dependendo da correção/verificação de OAuth da etapa 1.

Referência primária: [Google Identity Services — configuração do cliente e origens JavaScript](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). Custom token: [Firebase Admin](https://firebase.google.com/docs/auth/admin/create-custom-tokens).

**GO técnico para avançar à publicação controlada da V216, ainda sujeita à autorização específica de release/deploy.** O bloqueador OAuth e o teste físico de PWA estão resolvidos. O site V215 e o broker piloto continuam publicados, sem liberação comercial Google. Não é necessário repetir cadastro nem criar uma conta de senha com o Google secundário.

## Testes desta preparação

- **61 testes focados Node/DOM/backend**: cadastro/login, conflitos verificados/não verificados, consentimento, proibição de linking, sessão antiga, nonce/claims, origem/CSRF, concorrência, resposta perdida, política comercial, rollback de cadastro e preservação de senha/convites/logout/recuperação.
- **16 cenários Auth + Firestore Emulator** (`demo-veconi-google-only`): transações reais, UID único, password preservado, onboarding explícito idempotente e login posterior, transição do piloto, concorrência da cota diária, limite de sub e Rules negando metadados privados. Sem produção.
- **47 regressões de contenção**: allowlist pública, dados históricos bloqueados, worker sem limpeza de cache comercial/IndexedDB/filas.
- **11 cenários Chromium com HTML/CSS/controller reais e credenciais simuladas**: 320/360/390/430, tablet, notebook, desktop, viewport de teclado, seleção/consentimento acima do gate, cancelamento e nenhuma criação automática de empresa. Zero requisições externas. Não são OAuth real nem PWA físico.
- **11 regressões de navegador do laboratório** reexecutadas: conflito com senha, consentimento, UID, resposta perdida, consulta sem replay e layouts. São simulações isoladas, sem requisições de produção.
- Lint, build e diff-check do preflight registrados no manifesto privado. Pacote público tem 243 recursos explícitos, sem backend, laboratório, fixtures, relatórios privados ou código antigo de linking.

Capturas locais em `commercial/screenshots/`: login 1440/768/390, cadastro, consentimento e welcome 390. O teste real do Google secundário é independente dessas simulações.

## Sequência futura — depende de autorização

1. Revalidar somente estado Auth/provedores, bindings e piloto; preservar as cinco contas e a identidade QA. Nunca reabilitar o Google nativo.
2. Origem do cliente OAuth existente **já corrigida e validada**. Preservar client ID, authDomain, Rules, IAM, OAuth secret e redirect. Não repetir a inclusão ou remover as origens anteriores.
3. Publicar somente `prepareGoogleAccountAccess` e `completeGoogleAccountAccess` do codebase separado, ainda com política piloto v1. Validar compatibilidade do piloto e login da identidade já existente.
4. Ativar v2 explicitamente, com janela inicial e cotas propostas, preservando os bindings/recibos. Origem do laboratório e `veconi.app.br` exatas no runtime e documento privado. Sem novos grants IAM ou recursos pagos de QA.
5. Preparar commit isolado sobre V215, habilitar flag comercial somente depois das verificações e publicar frontend/PWA. Não incluir pesquisas antigas de linking/authority em `functions/src`, diretórios gerados, diagnósticos ou credenciais.
6. Smoke consentido com Google secundário e conta de senha QA. Para validar onboarding real com a identidade secundária, solicitar antes a opção explícita de criar uma empresa QA; esta preparação não cria nenhuma. Não usar empresas ou usuários comerciais.

## Rollback compatível e limites

Ver `COMMERCIAL-ROLLBACK.md`. Não basta voltar ao frontend V215 depois da abertura: novos usuários Google precisam continuar tendo um caminho de login. O piso é broker compatível, Google nativo fechado, binding/recibos preservados e signin acessível. Sem restauração de dados.

Não há novo faturamento no projeto QA. O projeto real já utiliza Functions/Firestore; chamadas e quotas consomem seus recursos. Cotas do aplicativo não são teto financeiro garantido. Não foi ativado App Check, serviço de abuso externo, TTL, limpeza ou recurso adicional.

O limite global de desafios também pode ser esgotado por solicitações ainda não autenticadas, causando recusa temporária de novos logins Google até a próxima janela horária. O login por senha continua independente. Na abertura limitada, monitorar recusas e volume; expansão posterior pode exigir controle de abuso adicional aprovado. Não se apresenta a cota por chave de sessão como bloqueio contra um atacante que troca de chave.

Mudança externa inesperada de email, providerData, MFA ou claims no UID Google bloqueia o broker sem reparar/remover credenciais. Essa política conservadora inclui adicionar senha externamente por recuperação. O fluxo comercial de suporte dessas identidades deve manter os registros e não improvisar associação. O login de senha dos usuários antigos permanece independente do broker.

IAM de assinatura não restringe UIDs matematicamente; essa restrição está no código e nos bindings privados. IAM Firestore é por projeto/base, não por documento. A service account dedicada não recebe users.update/delete nem configs.update. Manutenção autorizada, revisão e proteção do código continuam necessárias. Nenhum segredo ou token entra em logs ou pacote público.
