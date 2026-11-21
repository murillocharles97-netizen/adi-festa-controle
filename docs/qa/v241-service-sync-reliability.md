# V241 — confiabilidade de novas vendas de serviço

Candidata local na branch `codex/service-sync-reliability`, baseada em `0dbac1e` (V240). Preserva `887673e`, `25943d9`, `706b4a6` e `0dbac1e`. Nenhum push, deploy, leitura de produção ou alteração financeira real foi realizado.

**Parecer: GO técnico para integração; publicação depende do GO do usuário.** As suítes gerais têm falhas preexistentes, discriminadas no JSON acompanhante. Não se promete recuperação das três corridas antigas.

## Causa demonstrada

`diffWrites()` envia diferenças do cadastro. O motor `commercial-commit-engine.js` só gravava a versão privada em `productFinancials.serviceCostConfigs` dentro do ramo que recebe `custo`/`cost` numérico. Alterar combustível/configuração sem alterar esse número podia confirmar o novo ID público sem persistir seu custo privado. O checkout aceitava esse cadastro local; o validador da venda corretamente rejeitava o ID inexistente.

O teste `service dependency regression: delta with unchanged numeric custo...` falhou antes da correção: o ID público existia e a versão privada estava ausente. Passa depois da correção. É uma reprodução sintética do defeito de código, não uma reconstrução dos valores ou da sequência exata das três operações reais.

## Correção

- Cadastro público e versão privada persistem na mesma transação do gateway, mesmo sem `custo` no delta. Tarifa omitida vem do produto canônico, nunca de `write.before`.
- O delta leva a configuração completa, seu custo e tarifa quando esses campos mudam. Cada salvamento explícito pelo responsável gera uma nova versão, preservando versões anteriores e os parâmetros informados.
- Versões existentes não podem ter custos/tarifas reescritos. Rules impedem criação/alteração direta do mapa; o gateway rejeita mapas nulos/vazios que poderiam apagar históricos. Não há recalculadora de vendas antigas.
- Antes de registrar uma nova venda, o checkout confere os IDs exatos no servidor via modo somente leitura de `getOperationalSyncReceipt`. Confere empresa, usuário, geração, espaço, produto, tarifa e custo autorizado. Não expõe custos privados a vendedores.
- A prova local, persistida antes da venda, só vale para a mesma identidade/configuração. Uma versão já conferida permite o fluxo offline; uma nova versão ainda não confirmada bloqueia a conclusão e preserva o carrinho. Retorno perdido na conferência admite somente prova anterior válida. Retorno perdido após commit conserva a idempotência existente.
- O servidor continua validando cada venda integralmente. Prova local não significa venda confirmada: sem conexão, a operação fica pendente até confirmação remota. Restrições anteriores de cliente/Fiado/offline continuam em vigor.
- Os três envelopes antigos com a rejeição original ficam inelegíveis para reenvio. Não foram lidos, recuperados, apagados, alterados ou reenviados. Não há alteração de formato/protocolo de fila.
- Estimativa de combustível continua gerencial, sem criar despesa ou saída de caixa. Não foi alterada a fórmula.

A conferência agrega uma chamada antes do checkout online, com limite de oito segundos e até 50 descritores de serviço. Não varre histórico de vendas. Não foi medida latência em rede móvel real.

## Evidências

| Verificação | Resultado |
|---|---|
| Unitários direcionados, combustível e salvamento | 29 aprovados |
| Serviços no Firestore Emulator | 29 aprovados; 3 casos opcionais de rollback/leitores ignorados |
| Navegador Chrome, larguras 360 e 390 | 3 corridas em cada largura; offline/reinício, resposta perdida e bloqueio inicial com dados intactos |
| Integração financeira V240 | Cenários de ativação, Fiado, parcial, despesas manuais e isolamento aprovados |
| Rules financeiras V240 | 25 aprovados |
| Unitários V240 / identidade de versão | 10 / 5 aprovados |
| Contenção do pacote público | 56 aprovados |
| Build JS / pacote público | 550 arquivos JS / 277 arquivos permitidos |
| Suíte geral contra base registrada | 1185 passam; mesmas 97 falhas; nenhuma nova |
| Backend contra base registrada | 247 passam; mesmas 3 falhas; nenhuma nova |

Emulator cobre primeiro cadastro, configuração existente, edição seguida imediatamente de venda, várias corridas, prova offline, interrupção de conexão, ausência/divergência/histórico, resposta perdida, isolamento de empresa/espaço e imutabilidade. Exemplo de combustível: 20 km / 8 km/L × R$ 3,70 = R$ 9,25; depois de alterar a configuração, a venda original conserva R$ 9,25. Nova versão a R$ 3,71 resulta em R$ 9,28, sem arredondar antecipadamente.

Navegador usa código real do checkout e da conferência, IndexedDB sintético, adaptador HTTP local, gateway transacional e runner da fila. Em cada largura: R$ 99,50 de receita, R$ 52,15 de custo, três vendas e três entradas, zero movimentos de estoque e nenhuma despesa estimada. O primeiro envio recebe resposta perdida após commit; a consulta do comprovante resolve sem duplicar. Não é teste no Android original nem teste de produção.

Comparação das falhas por nome em `v241-service-sync-results.json`, usando a base/V240 previamente registrada em `v240-review-results.json`. Os logs e capturas locais estão em `qa-artifacts/service-sync-review/` e `qa-artifacts/service-sync-homologation/`.

## Publicação seletiva — somente após GO

1. Conferir main remota e integrar sem reescrever commits. Se houver mudanças posteriores, repetir testes afetados. Não fazer push em main antes de preparar o backend: o workflow Pages publica automaticamente.
2. Publicar somente `commitOperationalSync` e `getOperationalSyncReceipt`, a partir desta candidata. Essas duas Functions carregam os serviços alterados. Não publicar indiscriminadamente todas as Functions.
3. Se a V240 ainda não estiver publicada, incluir também `configureFinancialSpaceAutomation` e `readFinancialSpaceAutomation`, conforme o plano V240. Não ativar automação por deploy.
4. Publicar as Firestore Rules desta candidata. Não publicar Storage Rules, indexes, billing, triggers ou projetores financeiros não alterados.
5. Publicar frontend com versão 241, cache `veconi-v241-service-sync-v1` e imports de sync coerentes em auth/firebase-ui. Não limpar dados do navegador, IndexedDB ou filas. Confirmar build/versão no app.

Comandos previstos (não executados):

```powershell
firebase deploy --project adi-festa-controle --only functions:commitOperationalSync,functions:getOperationalSyncReceipt
# Somente se a V240 ainda não estiver publicada:
firebase deploy --project adi-festa-controle --only functions:configureFinancialSpaceAutomation,functions:readFinancialSpaceAutomation
firebase deploy --project adi-festa-controle --only firestore:rules
```

Rollback: conter novas vendas de serviço se surgir erro; publicar um novo commit/cache de frontend revisado, mantendo a barreira de conferência ou bloqueando esse checkout. Não simplesmente voltar ao checkout que confirmava versões desconhecidas. Preservar backend corrigido, Rules, versões históricas e fila. Não apagar comprovantes/lançamentos nem reenviar os antigos. Reversão de UI não desativa automação financeira; eventual desativação segue o fluxo autorizado da V240.

## Validação simples após publicação, sem USB

1. Abrir VECONI com internet e confirmar versão 241. No Táxi, abrir o serviço Corrida já existente, conferir os valores de combustível/consumo/taxa e salvar uma vez. Isso cria uma versão nova para próximas corridas, com o mesmo produto; não recupera as antigas.
2. Aguardar a sincronização do cadastro. Se aparecer pedido de conferência, manter o carrinho e aguardar; não cadastrar outro serviço nem recriar uma venda.
3. Registrar uma única corrida nova e real, com km, valor e pagamento corretos. Conferir comprovante e histórico. Aguardar confirmação remota dessa nova operação; os três erros antigos podem continuar visíveis, portanto não exigir contador global zero.
4. Conferir a nova corrida em outro dispositivo já conectado, no mesmo espaço. Comparar valor, km e pagamento. Se automação estiver ativada, deve haver somente uma entrada para venda paga; combustível estimado não aparece como despesa. Fiado não entra até receber.
5. Usar offline apenas depois de essa versão ter sido conferida online. A venda ficará pendente até reconectar. Não repetir a venda por estar pendente. Se houver novo erro, interromper novas vendas desse serviço e preservar os dados.

## Reproduzir localmente

```powershell
npm run test:service-sync
npm run test:v240
node --test tests/sync-version-identity.test.js
$env:NODE_PATH=(Resolve-Path functions/node_modules).Path
firebase emulators:exec --config firebase.v240-qa.json --only firestore --project demo-veconi-service-sync "node --test tests/emulator/flexible-services-v238.test.cjs"
firebase emulators:exec --config firebase.v240-qa.json --only firestore --project demo-veconi-service-sync "node scripts/homologate-flexible-services-v238.cjs && node functions/test/financial-space-automation-emulator.js && node --test tests/emulator/financial-spaces.rules.test.js"
npm run test:public-containment
npm run build
npm run build:public
```

Chrome/Puppeteer do runner usam os caminhos locais existentes (Puppeteer pode ser indicado por `PUPPETEER_CORE_PATH`). Todos os testes financeiros exigem Emulator loopback e usam dados fictícios.
