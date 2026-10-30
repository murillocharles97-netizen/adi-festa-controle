# V217 — hotfix de interface do Google

Base publicada sanitizada: V216 `b58188d250edf299efe8cb47cfe7980cfc7626dc`.

Escopo: somente frontend/PWA. Corrige o seletor encoberto pelo login, o bloqueio indevido por estado do botão de senha, feedback de carregamento/falha/cancelamento e limite de espera do SDK GIS. Testes usam a ordem real dos estilos do aplicativo. Não altera o protocolo ou as verificações do broker.

Versão do frontend e Service Worker: 217. Cache estático: `veconi-v217-google-click-feedback`. Nenhum armazenamento comercial é apagado. A mudança de cache não invalida sessões nem filas.

Google público e cadastro Google permanecem desativados. Somente `https://veconi.app.br/?google-qa=v216` mantém a entrada de teste; a política privada do servidor continua sendo a autorização definitiva. Não há account linking.

## Publicação autorizada

1. Conferir main/domínio na V216, genealogia sanitizada, rulesets 25744131 e 25744311 ativos e credencial temporária exclusiva.
2. Criar commit apenas com os arquivos do hotfix, regressões, documentação e metadados da V217.
3. Preparar tag `rollback/v217-compatible-google-feedback`. O rollback fecha a entrada QA e usa um cache estático próprio, preservando os guards, identidades Google já criadas, métodos de senha e todos os recursos comerciais V216.
4. Enviar somente main e a nova tag por push atômico com leases individuais, sem mirror, com a credencial temporária. GitHub Actions publica exclusivamente a lista explícita de recursos estáticos.
5. Conferir Actions, conteúdo dos recursos, domínio e resposta GET_VERSION do Service Worker.
6. Em navegador descartável, abrir a URL QA, preparar somente o desafio de login, verificar o seletor e cancelar. Se acionado o botão oficial, observar somente a abertura do popup; não selecionar identidade nem concluir login.

## Verificações essenciais

Aproveitar as 103 regressões já aprovadas e os 11 cenários de navegador. Reexecutar os testes focados de interface/autenticação, contenção estática, lint/build e diff-check após integrar os metadados. Não há deploy de Functions, Rules, OAuth ou Firebase Auth.

Antes/depois: comparar somente metadados de UID, provedores, flags e datas de credenciais das cinco contas antigas. Nenhuma senha/token é incluída em relatórios. Confirmar Google nativo desativado, política privada inalterada e ausência de mudanças no inventário das 94 Functions e das Rules.

Login completo Google no domínio comercial continua pendente do teste separado do proprietário com a identidade secundária autorizada. A abertura do seletor não constitui homologação de autenticação completa.
