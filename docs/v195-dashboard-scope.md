# V195 — escopo de consulta dos ajustes de Trocas

Preparação local, sem autorização de deploy. Base publicada: V194 `4ae78b90bc9405fb9d8aaa66da652a3cb804268c`. Branch: `codex/v195-exchange-dashboard-scope`.

## Causa

O frontend consultava todos os espaços ativos da empresa, inclusive espaços pessoais/financeiros sem Vendas. `listSaleExchangeAdjustments` corretamente exige espaço com Vendas habilitado; uma negativa invalidava o agregado e mantinha o Dashboard com totais provisórios.

## Correção, somente frontend

`ExchangeEconomics` usa os espaços de Vendas do contexto e confere defensivamente empresa, vínculos coerentes, status ativo, capacidade `sales === true` e espaços autorizados. Exige a permissão operacional existente `sales.create OU sales.viewAll`, resolvida pelo controle efetivo do usuário. Não concede permissões nem cria exceção para owner/QA.

O entitlement de leitura é a matriz efetiva `access.features.basicSales`. Não se usa limite mensal, `canCreateSale` ou `canMutate`: plano em modo leitura não perde a consulta de histórico que o backend autoriza.

Chave e tickets incluem UID, empresa, geração, perfil, permissões, vínculo, plano/entitlements, capacidades/lista de espaços e seleções. Mudanças invalidam imediatamente o cache em memória e avisam os consumidores. Bootstrap com perfil de outra conta ou espaços ainda não carregados não consulta. Respostas antigas não publicam resultados. Refresh explícito de ajustes invalida a leitura anterior em voo, sem tocar no Sync comercial.

Páginas autenticadas não reutilizam `data.saleExchangeAdjustments` como fallback após erro ou mudança de contexto. Consulta autorizada que falha, resposta de outra empresa ou delta incoerente continuam não confirmados; não se converte erro em lista vazia confirmada.

### Estados e textos

- Confirmado: “Valores de vendas incluem os ajustes de trocas concluídas.”
- Escopo conhecido sem Vendas e sem histórico comercial conhecido: “Nenhum espaço de Vendas habilitado neste escopo.” Sem chamada proibida, sem erro financeiro artificial.
- Perfil/plano sem acesso: “Consulta de ajustes de troca indisponível neste perfil ou plano.” Não confirma números financeiros artificialmente.
- Bootstrap/capacidade ainda desconhecida: “Confirmando ajustes de troca. Totais provisórios.”
- Falha real autorizada: “Ajustes de troca não confirmados. Totais provisórios.”
- Espaço desabilitado/arquivado com histórico comercial conhecido: “Histórico de espaço indisponível para consulta. Ajustes de troca não confirmados. Totais provisórios.” Não se confirma faturamento bruto omitindo ajustes anteriores.

O último caso usa somente IDs de espaços vistos nas respostas validadas, em memória separada por UID/empresa/geração, e uma inspeção somente leitura de vendas já disponíveis no namespace atual. Nenhum valor pessoal é persistido. Falha nessa inspeção também impede certeza financeira. Isso não é auditoria de ausência de histórico remoto desconhecido.

Nenhuma mudança em normalização/migração de espaços legados. Capacidade desconhecida no contexto aguarda confirmação; divergência entre cadastro legado normalizado e servidor continua sendo erro real visível. O backend permanece autoridade para os documentos canônicos.

## Consumidores e efeitos

Dashboard mobile/desktop, metas, fechamento e Desempenho continuam usando a mesma projeção econômica. Venda original, ajuste da troca, crédito e recebimento monetário não foram recalculados nem regravados. Histórico operacional mantém o escopo compartilhado autorizado e não recebe filtro por autoria.

Custos/lucro/margem permanecem em revisão quando falta confirmação ou há troca no período. Seller continua sem campos privados e sem Financeiro. O aviso da projeção não altera contadores, erros reais, fila, quarentena ou recuperação do Sync.

## Arquivos do pacote

- `js/exchange-economics.js`: seleção, cache, estados e fences de leitura.
- `js/build-info.js`, `service-worker.js`, `index.html`: release/cache V195 e URLs somente dos dois assets alterados.
- `tests/exchange-scope-regression.test.js`: regressões de escopo, sessão, erro e histórico.
- `tests/exchange-scope-dashboard.test.js`: integração dos módulos reais de permissões, espaços, projeção e consumidores.
- `tests/exchange-economics.test.js`: fixtures autenticadas realistas e hidratação confirmada, sem enfraquecer as expectativas econômicas.
- `tests/team-sync-release-v179.test.js`: contrato V195 preserva URLs V194 dos singletons intocados e verifica seus hashes exatos.
- Este documento.

Functions, guards servidor, Rules, índices, Sync, Auth, Fiado, checkout, histórico e armazenamento comercial permanecem byte-idênticos à V194. Não há migração, nova permissão, Scheduler ou dependência.

## Validação local

- **175/175 testes direcionados** app/backend, zero falhas/skips, incluindo 37 regressões de escopo e três integrações com consumidores reais.
- **110/110 Firestore Emulator**, zero falhas/skips: 45 single_space, 26 crédito, 14 troca, 10 fences e 15 vendedor/Sync. Backend/Rules/índices verificados iguais à V194 antes da execução; instância isolada encerrada.
- Lint, build e diff-check executados. A suíte global não é declarada verde; suas falhas históricas estão documentadas no preflight V194, fora deste hotfix.

Integração fictícia: duas vendas R$80/R$100, ajustes -R$30/+R$10. Owner consolidado: R$160, duas vendas, meta R$1.000 em 16%. Owner e seller no espaço A: R$50, uma venda, meta em 5%. Nenhuma consulta ao espaço financeiro; nenhum write local ou financeiro; configurações de meta imutáveis.

Testes também preservam cancelamento normal, emissão/consumo/restauração de crédito, idempotência, reservas, Fiado bloqueado, isolamento e ocultação de campos privados. São testes locais/emulados, não smoke em nuvem nem Android físico.

## Publicação proposta — aguardar autorização

1. Conferir commit, pacote e rollback compatível.
2. Publicar **somente frontend/PWA**. Não publicar Functions, Rules ou índices.
3. Confirmar SHA/release/SW no domínio. Recarregar normalmente sem limpar armazenamento comercial.
4. Conferir owner/seller: contexto e fila corretos, Dashboard/Histórico/metas, nenhum request de ajuste a espaço sem Vendas; erros autorizados continuam alertando.
5. Retomar smoke comercial fictício apenas em `VECONI QA` e `VECONI QA — isolamento`: troca igual, complemento, emissão, uso parcial e cancelamento da venda com crédito; estoque apto/avariado, mesmos IDs/recibos e saldo de Fiado inalterado.
6. Não alterar memberships nem habilitar Financeiro para fazer o teste passar. Seller QA/Financeiro ativo e Android físico exigem acesso autorizado próprio; não usar funcionária real nem loja real.

Parar em qualquer conflito, erro financeiro, escopo indevido ou efeito inesperado. Não usar Reprocessar todos, retry de filas antigas, ajuste manual de estoque ou compensação financeira. Trocas não está liberado para uso comercial até o smoke necessário passar.

## Rollback

Preservar imutável o rollback compatível `2d77ebe723338f6d88994800bf1ae41846b7f979` e sua tag. Ele mantém ledger, recibos, guards, projetores, cancelamento específico e pausa novas operações, mas seu frontend antigo contém o aviso de escopo V194.

Para conter operações sem reintroduzir esse aviso, o sucessor local usa a referência `rollback/v195-compatible-sale-exchanges`, derivada de `2d77ebe` com o core corrigido e metadados V195. Não mover tags antigas, restaurar banco, excluir créditos/eventos ou retornar integralmente à V193.

Nenhum push, deploy, acesso comercial de produção, operação QA em nuvem, retry, replay ou limpeza de fila/cache foi executado nesta preparação local.
