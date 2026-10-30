# V216 — publicação controlada, Google público desativado

Este é o escopo autorizado para a publicação atual, sobre V215 sanitizada `285200d1d6c7cd668f991caf6b5d35dce7225887`. Substitui a proposta de abertura comercial ampla nesta etapa. A origem OAuth comercial já foi acrescentada e validada separadamente.

## Ativação efetiva

- URL normal de veconi.app.br: login/cadastro por senha preservados; **nenhum botão Google público**.
- URL de QA: `https://veconi.app.br/?google-qa=v216`. Apenas a interface de login Google é habilitada; cadastro Google permanece desabilitado.
- O parâmetro de URL **não autoriza identidade**. O broker continua em política schema 1, `pilotOnly=true`, com email/sub privados já fixados para a identidade secundária autorizada. Outras identidades são recusadas mesmo conhecendo o endereço.
- Runtime e política passam a aceitar somente duas origens exatas: `https://adi-festa-controle.firebaseapp.com` e `https://veconi.app.br`. Sem wildcard, variantes `www`, localhost ou outros domínios.
- Na política do piloto, `modes.signup=false` e `modes.signin=true`. A identidade QA já existe; nenhuma criação, vinculação, alteração de senha ou usuário será executada.
- `V216_GOOGLE_COMMERCIAL=false`: a política schema 2 de abertura comercial não é ativada neste deploy. A validade original do piloto é preservada.
- O welcome da identidade Google informa homologação restrita e não apresenta botão para criar empresa enquanto o Google público estiver desligado. Nenhum vínculo comercial é criado automaticamente.

## Pacote

Atualizar somente `prepareGoogleAccountAccess` e `completeGoogleAccountAccess`, no codebase separado `google-v216-registration`, com a service account dedicada já existente, Node22 e os mesmos limites de runtime. Manter IAM, Google nativo desativado, client ID, OAuth secret e authDomain.

Frontend/PWA V216: carregamento horizontal com marca oficial aprovada; adaptador GIS + custom token; confirmação segura; guard de sessão; boas mensagens de cancelamento/resposta perdida. Nenhum arquivo de linking/authority da pesquisa antiga entra no pacote. A allowlist pública tem 244 recursos, sem implementação do servidor, diagnóstico, fixtures ou configuração privada.

Não há alteração em Functions comerciais, Rules, permissões, Sync, armazenamento comercial, pagamentos, vendas, Trocas, Fiado ou recuperação V215. Não há limpeza de cache comercial, IndexedDB, localStorage ou filas.

## Ordem e critérios

1. Commit isolado, varredura de genealogia/objetos contaminados, preservação dos dois rulesets e validação da credencial temporária de manutenção.
2. Preparar commit/tag de rollback compatível antes da primeira publicação.
3. Publicar as duas Functions do broker, preservando variáveis existentes e acrescentando somente a origem exata. Ajustar apenas `allowedOrigins` e `modes` no control privado, com precondição de versão; preservar hash/sub, identidade, UID, bindings, recibos e prazo.
4. Exigir CORS 204 para a origem comercial e 403 para origem indevida; desafio de signin permitido, prova inválida/UID injetado/signup/link recusados, status sem token. Validar Auth/isolamento/idempotência com QA em Emulator e, quando houver Google previamente autenticado no navegador QA, com a identidade secundária existente. Não adquirir/refazer credenciais de usuário comercial.
5. Verificar fontes publicadas por hash, 92 Functions anteriores e Rules inalteradas. Somente então publicar frontend/PWA pelo GitHub Pages com a credencial temporária e referências exatas.
6. Conferir versão 216/commit, Service Worker, allowlist pública, senha/recuperação e ausência de Google na URL normal. Validar o caminho QA com a conta de teste autorizada, sem criação de empresa. Se a escolha Google exigir interação humana, manter o Google público fechado e informar a ação exata.

Uma resposta 403 em origem comercial após runtime/control configurados é bloqueador para avançar. Não remover validações ou ampliar origens para obter sucesso.

## Rollback compatível

Tag prevista: `rollback/v216-compatible-google-broker`. Commit de rollback modifica somente `js/google-registration-release.js`, com `qaEnabled=false`, mantendo `publicEnabled=false` e `newRegistrations=false`.

Preserva os fluxos comerciais da V215 e o reconhecimento seguro da identidade Google já autenticada, evitando que o bootstrap antigo tente criar empresa para um UID de teste. Mantém Functions de autorização, Google nativo fechado, binding, recibos, Auth e dados comerciais. Não é um retorno integral ao código antigo de autenticação.

As Functions novas permanecem no piso compatível. Se houver falha crítica do broker, o procedimento de contenção pode desabilitar novas concessões por política privada, preservando identidades/recibos; não reativar Google nativo nem remover credenciais. Uma falha de rede comum não deve iniciar rollback ou reexecução de concessões automaticamente.

## Após a publicação

O resultado esperado ainda é **Google comercial desativado**. Para habilitar aos clientes será necessária uma autorização posterior para a abertura controlada do broker a novas identidades Google, janela/cotas de cadastro e ativação dos botões públicos, depois do aceite do fluxo real na origem comercial. Não associar contas antigas por email ou criar empresas automaticamente nessa evolução.
