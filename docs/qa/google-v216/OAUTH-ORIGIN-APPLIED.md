# V216 — origem OAuth corrigida e validada

Alteração pontual autorizada pelo proprietário em 30/10/2026. Validação concluída às **10:33, America/Sao_Paulo**. Não houve deploy comercial, teste de cadastro/login, criação de identidade ou mudança no broker.

## Única configuração alterada

Projeto `adi-festa-controle`, cliente Web existente **Web client (auto created by Google Service)**, ID público terminado em `ivtar0e0o403i1qudecitl4j9d15s31p.apps.googleusercontent.com`.

Foi acrescentada somente `https://veconi.app.br` às **Origens JavaScript autorizadas**. As três origens anteriores permanecem: `http://localhost`, `http://localhost:5000`, `https://adi-festa-controle.firebaseapp.com`. O redirect `https://adi-festa-controle.firebaseapp.com/__/auth/handler` permaneceu igual. Nenhum campo de segredo, escopo, client ID ou authDomain foi editado.

A configuração foi salva pelo console Google Cloud com a sessão autorizada. A página foi reaberta e a quarta origem confirmada por leitura. Não se fez nova tentativa de escrita após o salvamento.

## Resultado pós-alteração

| Verificação | Resultado |
|---|---|
| GIS `GET https://accounts.google.com/gsi/button`, origem veconi.app.br | **200**, sem código 5, sem mensagem de origem negada |
| Controle com origem firebaseapp.com e mesmo cliente | **200**, sem erro |
| Seleção Google, callback de credencial ou login | **Zero**; somente renderização isolada de frontend/rede |
| Broker, `OPTIONS` da origem comercial | **403 `access-unavailable`**, sem Allow-Origin; recusa intencional preservada |
| Política privada do broker | Schema 1/piloto; somente origem Firebase autorizada; não alterada |
| Functions do broker | ACTIVE; mesmas revisões e updateTimes antes/depois |
| Google nativo Firebase | **Desativado**, mesmo client ID |
| Cinco usuários anteriores | UID, provedores password, disabled, emailVerified, validSince e passwordUpdatedAt idênticos ao baseline |
| Usuários totais no Auth | **6 antes e depois**: cinco anteriores + identidade QA já existente; nenhuma criação |
| Aplicativo publicado | **V215**, commit `285200d1d6c7cd668f991caf6b5d35dce7225887` |
| Build-info, Service Worker e recuperação V215 | Conteúdo e hashes iguais antes/depois e à base publicada |
| Rules, Sync, permissões, empresas, filas e dados comerciais | Nenhuma alteração executada |

O teste de renderização foi executado em navegador descartável com documento em memória na origem comercial. Não foi publicada uma página de teste em veconi.app.br e nenhum perfil real do navegador foi utilizado. Os testes reais de cadastro/login Android/PWA anteriormente aprovados não foram repetidos.

## GO/NO-GO

**GO técnico para avançar à publicação controlada do pacote V216 já preparado.** O bloqueador OAuth está resolvido, e a homologação física anterior permanece válida. O broker continuar recusando a origem comercial é o comportamento esperado antes da liberação.

**A V216 não foi publicada nem liberada comercialmente.** A autorização desta etapa abrangia somente a origem OAuth. A próxima publicação ainda exige autorização específica para o candidato/release, as duas Functions compatíveis, as origens exatas e a abertura controlada da política do broker, e o frontend/PWA. Não se deve remover o piso de proteção de contas de senha nem ativar Google nativo para isso.

Nenhuma mudança adicional de OAuth, client ID, authDomain ou redirect é necessária para o fluxo atual. Os limites, antirreplay, unicidade de email, UID reservado por sub e rollback compatível descritos em `COMMERCIAL-READINESS.md` e `COMMERCIAL-ROLLBACK.md` permanecem obrigatórios.

## Evidências e reversão

Evidências privadas em `C:/Users/Murillo/.codex/visualizations/2026/10/30/v216-domain-403/`:

- `OAUTH-AUTHORIZED-ORIGINS-AFTER.png`: recorte da configuração persistida, sem segredos.
- `GIS-AFTER-ORIGIN.json`: 200 nas duas origens; nenhum erro 5/callback de credencial.
- `ORIGIN-SAFETY-BEFORE.json` e `ORIGIN-SAFETY-AFTER.json`: mesmas credenciais/provedores dos cinco usuários, Functions, política privada, versão e recursos públicos; Google nativo fechado.
- `OAUTH-ORIGIN-CHANGE.proposed.json`: proposta original preservada como evidência, agora executada somente quanto à inclusão da origem.

Reversão exclusiva, se futuramente autorizada: remover somente `https://veconi.app.br` das origens JavaScript deste cliente, mantendo as três anteriores e o Google nativo desativado. Não executar essa reversão automaticamente, não apagar usuários, bindings, recibos ou registros comerciais.
