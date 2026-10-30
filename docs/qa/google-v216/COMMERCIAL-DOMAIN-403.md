# V216 — causa comprovada do 403 no domínio comercial

> Diagnóstico histórico anterior à alteração autorizada. A origem foi posteriormente acrescentada e o GIS passou a retornar 200, sem erro 5. Estado atual: [OAUTH-ORIGIN-APPLIED.md](OAUTH-ORIGIN-APPLIED.md). O broker continua fechado para a origem comercial.

Consulta de 30/10/2026, somente leitura. Não houve deploy, salvamento OAuth, alteração de usuários, empresa, Rules, Sync ou recuperação V215. Não foram repetidos os testes de cadastro/login já aprovados no Chrome Android e no PWA QA.

## Requisição e erro exatos

| Campo | Resultado |
|---|---|
| Serviço | Google Identity Services, não Cloud Functions |
| Requisição | `GET https://accounts.google.com/gsi/button` |
| Query do iframe SDK | `type`, `theme`, `size`, `is_fedcm_supported`, `client_id`, `iframe_id`, `cas` |
| Referer | `https://veconi.app.br/` |
| HTTP | **403** |
| Código no bootstrap GIS | **5**, enum interno do Google; não é um erro OAuth `origin_mismatch` capturado de uma autorização |
| Mensagem do console GIS | **The given origin is not allowed for the given client ID.** |
| Controle com mesmo cliente/SDK | Origem `https://adi-festa-controle.firebaseapp.com`: **HTTP 200**, sem erro GIS |

Não se registram valores transitórios de `cas`, iframe IDs, cookies, provas Google ou tokens. O client ID Web é um identificador público. A mensagem foi capturada do SDK e o código conferido no bootstrap do iframe e no mapeamento da biblioteca oficial servida pelo Google.

O teste foi um ensaio automatizado de frontend/rede em navegador efêmero, com documento de teste em memória e origem comercial. **Nenhuma página foi publicada em veconi.app.br; nenhum usuário Google foi selecionado; nenhum callback de credencial ocorreu.** Não foi um login no aplicativo comercial. Nenhum perfil do Chrome do usuário ou armazenamento comercial foi utilizado.

### Precisão da coleta

A sonda anterior permitia `www.gstatic.com`, mas bloqueava o recurso `ssl.gstatic.com` usado pela biblioteca do iframe. Isso escondia a mensagem de console e não era a causa do HTTP 403 do Google. Foi corrigida somente a instrumentação privada do teste. O controle autorizado então retornou 200, e a origem comercial retornou erro 5.

Uma chamada HTTP crua, sem o contexto completo do iframe SDK, retornou enum **9** também na origem autorizada. Ela foi descartada como teste comparativo de autorização de origem. A conclusão acima usa o SDK/iframe real e a configuração observada no console, não esse pedido incompleto.

## Cliente OAuth conferido no Google Cloud

Projeto: `adi-festa-controle`. Cliente **Aplicativo da Web**, nome **Web client (auto created by Google Service)**. Identificador público: `747098339926-ivtar0e0o403i1qudecitl4j9d15s31p.apps.googleusercontent.com`.

O ID coincide em cinco fontes: cliente exibido no Google Cloud; configuração efetivamente servida do laboratório; configuração preservada de `google.com` desativado no Firebase; variáveis das duas Functions publicadas; adaptador do candidato V216 local. Não há divergência de client ID.

As origens JavaScript observadas, sem editar o formulário, são exatamente:

- `http://localhost`
- `http://localhost:5000`
- `https://adi-festa-controle.firebaseapp.com`

**`https://veconi.app.br` está ausente.** O redirect existente é `https://adi-festa-controle.firebaseapp.com/__/auth/handler`; ele não precisa ser alterado neste fluxo GIS com callback JavaScript e broker custom token.

## Separação dos bloqueios

| Camada | Evidência | Tratamento |
|---|---|---|
| Origem OAuth do Google | `/gsi/button` 403/erro 5; origem ausente no cliente correto; mesma configuração funciona no laboratório | Acrescentar uma origem exata no cliente existente, após autorização |
| Restrição do broker/CORS | `OPTIONS prepareGoogleAccountAccess` vindo de veconi.app.br retorna 403, `access-unavailable`, mensagem “Acesso Google indisponível neste contexto.”, sem `Access-Control-Allow-Origin` | Restrição **intencional** do piloto, independente do erro GIS. Não remover nem liberar agora |
| Origem permitida do broker | `OPTIONS` vindo de firebaseapp.com retorna 204 e `Access-Control-Allow-Origin` exata | Preservar |
| Política privada | Schema 1, piloto habilitado, somente origem do laboratório e identidade/sub autorizados | Preservar até rollout comercial separado e autorizado |
| CSP do domínio | Resposta pública consultada não envia CSP/Report-Only; o erro GIS também ocorre em documento isolado sem CSP | Não é a causa deste 403. Não enfraquecer nenhuma política |
| Configuração Firebase Auth | Google nativo desativado; mesmo client ID preservado | Não reativar o provedor nativo |
| Aplicação comercial atual | V215 não publica o adaptador Google; Google comercial continua fechado | Nenhum hotfix comercial ou mudança de authDomain para corrigir a origem |

As duas Functions permanecem ACTIVE nas revisões `preparegoogleaccountaccess-00001-gij` e `completegoogleaccountaccess-00001-jef`, aceitando somente a origem Firebase do piloto. Corrigir OAuth não libera automaticamente o broker ou as contas antigas.

## Correção mínima preparada — não aplicada

No cliente OAuth Web acima, em **Origens JavaScript autorizadas**, usar **Adicionar URI** e acrescentar somente:

```text
https://veconi.app.br
```

Conservar as três origens anteriores. Não adicionar caminho, wildcard, domínio `www` não usado ou URI de redirect. Não trocar client ID, client secret ou authDomain. Não modificar escopos, Google nativo, IAM, Functions, política do piloto, Rules ou usuários.

Antes de salvar, conferir que o cliente e as três origens não mudaram. A alteração aguarda **autorização específica do proprietário**. Adicionar uma origem no cliente OAuth é uma mudança de produção mesmo sem deploy do aplicativo.

Referência primária: [configuração do Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). A autorização do domínio no Firebase Auth não substitui a origem JavaScript deste cliente OAuth.

## Teste restrito depois da autorização

1. Aplicar somente a origem proposta, sem abrir o broker comercial.
2. Executar novamente apenas o teste de renderização GIS com o mesmo cliente e origem comercial em navegador isolado, documento em memória, sem sessão, sem One Tap e sem selecionar Google.
3. Exigir `/gsi/button` 200 e ausência da mensagem/enum 5. Considerar o prazo de propagação indicado pelo Google; não ficar alternando origens/clientes como tentativa de contorno.
4. Conferir que o Google nativo continua desativado e que o broker segue recusando veconi.app.br. Essa recusa será **esperada**, não uma falha da correção OAuth.
5. Só depois autorizar o pacote comercial V216 já preparado: origens exatas no broker, política de abertura controlada, duas Functions e frontend. Sem retirada da proteção de contas de senha, sem linking e sem ativação das Rules pendentes.

Um teste de login completo em uma página realmente publicada no domínio exigiria autorização adicional para essa página e para a origem exata do broker, conservando o allowlist/sub do tester no piloto. Não é necessário para provar/corrigir o erro de renderização atual e não foi executado.

## Persistência no PWA comercial

- A aplicação usa `auth` compartilhado de `js/firebase/firebase-config.js`, com `setPersistence(auth, browserLocalPersistence)`.
- O adaptador Google do candidato importa **esse mesmo singleton** e usa `signInWithCustomToken`; não chama `setPersistence` nem troca o authDomain.
- A observação inicial de sessão aguarda `FirebaseAuthPersistenceReady`. Portanto o login Google comercial seguirá a persistência local já configurada para senha, inclusive no PWA, enquanto o navegador permitir armazenamento e até logout/remoção de dados pelo usuário.
- O laboratório, em origem separada, escolhe deliberadamente `browserSessionPersistence`. Essa configuração temporária não é copiada para o app comercial.
- Em indisponibilidade de armazenamento, o aplicativo já registra falha de persistência; não se promete persistência física que o navegador recuse. Nenhuma fila, cache ou IndexedDB é limpa para tratar esse caso.

Referência: [Firebase — persistência do estado de autenticação](https://firebase.google.com/docs/auth/web/auth-state-persistence).

## Evidências e rollback

Diretório privado: `C:/Users/Murillo/.codex/visualizations/2026/10/30/v216-domain-403/`.

- `GIS-BROWSER-NETWORK.json`: requisição SDK/iframe e comparação 403/200, código/mensagem, nenhum callback de credencial.
- `READONLY-CONFIG-AND-HTTP.json`: igualdade de IDs, estado do provedor, revisões, origens do runtime/política, CORS e persistência.
- `OAUTH-AUTHORIZED-ORIGINS.png`: recorte somente das origens vistas no console, sem segredos.
- `OAUTH-ORIGIN-CHANGE.proposed.json`: objeto exato da mudança preparada; não é payload de API nem foi aplicado.

Rollback exclusivo desta configuração: remover somente a nova origem comercial, se já tiver sido adicionada e houver motivo autorizado. Conservar origens anteriores, redirects, provedor nativo fechado, identidade QA, bindings, recibos e usuários. O rollback comercial V216 permanece separado.

**GO para a mudança mínima de origem, condicionada à autorização específica. NO-GO para deploy/liberação comercial nesta etapa.** Nenhuma credencial ou dado comercial foi modificado.
