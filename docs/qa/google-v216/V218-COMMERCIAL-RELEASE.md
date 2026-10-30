# V218 — Google comercial por broker

Base sanitizada publicada: V217 `5037903625631a80418794d05c246282481c2a5e`. Abertura comercial expressamente autorizada pelo proprietário. Nenhuma vinculação de contas antigas.

## Escopo

Frontend: habilitar login e cadastro Google no domínio HTTPS exato `https://veconi.app.br`, mantendo senha, recuperação e convites. Os guards, feedback e modais corrigidos na V217 permanecem. Novas identidades chegam à tela de acesso pronto, sem empresa; somente a opção **Cadastrar minha empresa** inicia o onboarding existente.

Broker: republicar exclusivamente `prepareGoogleAccountAccess` e `completeGoogleAccountAccess` com `V216_GOOGLE_COMMERCIAL=true`, sem mudança de lógica, IAM, OAuth, authDomain ou Firebase Auth. As fontes já publicadas suportam a política comercial e login após onboarding. O provedor Google nativo permanece desativado e a unicidade de e-mail permanece ativa.

Política privada `googleRegistrationControl/active`: schema 2, registrationOnly=true, pilotOnly=false, requireNativeProbe=true, rolloutId `v218-commercial-opening-1`, origens exatas `https://veconi.app.br` e `https://adi-festa-controle.firebaseapp.com`. Janela inicial de cadastro até **30/10/2027 às 23:59:59 (São Paulo)**, 20 reservas/dia UTC, 12 desafios por sub/hora, limites globais e por sessão existentes (100/h e 8/h). Encerrar/pausar cadastro não expira login de usuários registrados. As cotas reduzem abuso e não são teto financeiro garantido.

Não há empresa, permissão ou assinatura criada pelo broker; a concessão legítima de owner em uma empresa nova pertence somente ao onboarding já existente, após opção explícita. Cada ID Google verificado resolve seu binding privado, nunca um UID fornecido pelo cliente ou localizado por coincidência de e-mail. Cadastro conflitante é recusado pela unicidade do Auth sem editar o usuário antigo.

## QA e limites de evidência

- Aproveitar a homologação real do proprietário na V217: Google assinado → broker → custom token → Firebase Auth e mesmo UID, em origem comercial.
- Conta QA nova, confirmação, Auth-only, onboarding transacional, logout e novo login validados com Auth SDK real e Auth/Firestore Emulator. Seleção usa identidade fictícia assinada com RSA e certificados exclusivos do laboratório; não se apresenta como OAuth Google real novo ou empresa criada em produção.
- Preservar os cenários de conflitos de senha verificada/não verificada, grants perdidos, idempotência, cotas, isolamento e Rules negando metadados privados.
- Navegador publicado: botões públicos, seletor acima do login, cancelamento, erro de rede e restauração de controles. Nenhuma credencial ou empresa real usada pelo agente.

## Ordem de publicação

1. Conferir main/domínio V217, cinco contas antigas, Google nativo desativado, Functions/Rules e dois rulesets ativos.
2. Commit isolado e rollback compatível, preservando genealogia sanitizada e arquivos locais não publicados.
3. Publicar somente as duas Functions do broker com flag comercial. A política v1 ainda mantém o piloto restrito durante esse deploy.
4. Conferir fontes/revisões, SA dedicada e demais 92 Functions/Rules intactas. Atualizar a política para schema 2 inicialmente com cadastro pausado, usando CAS por updateTime. Validar origem correta, origem indevida, prova inválida e injeção de UID.
5. Ativar cadastro na política pelo campo modes, sem tocar em bindings, Auth ou recibos. Publicar frontend/PWA e tag por push atômico com leases e credencial temporária; manter rulesets.
6. Conferir Actions, recursos allowlisted, domínio, versão 218, Service Worker, UI pública e preservação das contas antigas. Sem recuperação comercial, Sync ou limpeza de armazenamento.

## Rollback compatível

Tag `rollback/v218-compatible-commercial-google`. Primeiro pausar **somente modes.signup=false** com CAS no documento privado. Manter enabled=true, schema 2, signin=true, origens, verificação nativa, bindings, Auth e recibos. Frontend compatível mantém publicEnabled=true e newRegistrations=false, com cache estático novo, preservando **Continuar com Google**. Não voltar ao rollback de piloto que esconderia todo login Google; não reativar o provedor nativo.

Não há rollback de dados, apagamento de usuários ou invalidação indiscriminada de sessões. As duas Functions comerciais permanecem no piso compatível, permitindo retorno de usuários que já concluíram onboarding. A pausa de signup também impede completar provas de cadastro ainda não consumidas.

## Fora do pacote

Rules Firestore/Storage, Sync, permissões comerciais, vendas, estoque, Financeiro, Fiado, Trocas, recuperação de vendas e credenciais antigas. Pesquisas de linking, credenciais, evidências e fixtures não entram no pacote público.
