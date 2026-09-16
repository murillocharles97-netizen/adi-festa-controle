# Espaços Globais VECONI V1

## Decisão estrutural

O Espaço Global V1 reutiliza o documento físico já existente em `financialSpaces/{spaceId}`. Essa escolha preserva, sem cópia ou redirecionamento:

- o ID de cada espaço;
- todas as referências por `financialSpaceId`;
- as subcoleções financeiras (`entries`, contas, cartões, recorrências e demais recursos);
- a automação financeira ligada ao espaço `business_{businessId}`;
- as Rules e os serviços financeiros legados que ainda interpretam `type`.

Não existe uma segunda coleção `spaces` nesta fase. Na interface e no código de domínio, esses documentos passam a ser tratados como Espaços VECONI. O valor técnico `all_spaces` é exclusivamente uma visão agregada em memória; tanto `all_spaces` quanto o alias legado `all` são IDs reservados e nunca podem ser gravados como espaço ou `sale.spaceId`.

## Schema aditivo

Os campos abaixo são acrescentados ao documento existente:

```js
financialSpaces/{spaceId} = {
  // Campos legados preservados
  id,
  ownerUid,
  name,
  type,               // business | personal | other (não é renomeado)
  linkedBusinessId,
  active,
  automation,

  // Contrato global V1
  businessId,         // string; null em espaço financeiro pessoal legado ainda não associado
  operationalType,    // unit | operation | personal | other
  status,             // active | archived
  capabilities: {
    finance,
    sales,
    products,
    inventory,
    goals
  },
  isDefault,
  globalSpaceSchemaVersion: 1
}
```

O `type` físico continua sendo financeiro por compatibilidade. `SpaceEngine.normalizeSpace()` expõe `type` como o tipo operacional para os módulos novos e mantém o valor antigo em `legacyFinancialType`. Assim, o Financeiro continua recebendo `business|personal|other`, enquanto Home, Vender e Produto trabalham com `unit|operation|personal|other`.

### Defaults de promoção

| Registro legado | `operationalType` | capabilities iniciais |
| --- | --- | --- |
| `type=business` | `unit` | Financeiro, Vendas, Produtos, Estoque e Metas |
| `type=personal` | `personal` | Somente Financeiro |
| `type=other` | `other` | Somente Financeiro |

Campos já configurados são preservados, inclusive chaves adicionais já presentes no mapa `capabilities`. Um espaço como Casa não aparece em Vender apenas por existir no Financeiro. IPTV ou outra operação legada passa a aparecer em Vender somente depois de `capabilities.sales=true` e de sua associação explícita à empresa atual.

Espaços pessoais/outros legados sem vínculo inequívoco recebem `businessId: null`; a migração não adivinha a qual empresa pertencem. Ao habilitar explicitamente uma capacidade operacional na tela de gerenciamento, o adapter associa esse espaço à empresa em uso, sem alterar seu ID, `type` financeiro ou conteúdo.

Na V1, `type=personal|other` continua privado ao `ownerUid`, mesmo quando o proprietário habilita uma capability operacional e associa `businessId`. A promoção não amplia leitura para caixa, gerente ou demais membros da empresa, evitando expor finanças pessoais. Compartilhamento seletivo desses espaços fica adiado para uma versão com RBAC/`allowedSpaceIds`; espaços colaborativos da equipe devem usar `type=business`.

## Espaço padrão

Para uma empresa ativa sem nenhum espaço real, ativo e com `capabilities.sales=true`, é criado no máximo um padrão determinístico:

```text
financialSpaces/business_{businessId}
```

Ele usa `type=business`, `operationalType=unit`, todas as capabilities V1 e preserva o contrato de automação financeira existente. A criação:

- só ocorre depois de uma leitura remota completa das consultas limitadas;
- no cliente, só pode ser provisionado pelo owner da empresa; a migração Admin cobre o legado em lote;
- verifica a leitura consolidada e não reutiliza um ID ativo já ocupado;
- não consegue sobrescrever um documento arquivado ou conflitante: no cliente as Rules rejeitam o update e, na migração Admin, a criação exige a precondição `exists=false`;
- não ocorre se qualquer outro espaço operacional de vendas já atende a empresa;
- é repetível sem criar duplicatas.

Espaços adicionais de unidade/operação mantêm `type=business` e `linkedBusinessId` para compatibilidade, mas nascem com automação financeira desabilitada. Isso evita gerar entradas automáticas duplicadas; a automação principal continua ancorada no espaço determinístico.

## Leitura, cache e offline

`js/firebase/space-service.js` faz duas consultas paralelas, limitadas e sem N+1:

1. `linkedBusinessId == businessId`, `type == business` e `active == true` para espaços da empresa;
2. `ownerUid == uid`, `type in [personal, other]` e `active == true` para espaços financeiros pessoais/legados acessíveis ao proprietário.

Os filtros de `type` fazem parte das consultas porque Rules não funcionam como filtro: assim, uma consulta nunca pode tentar retornar um espaço de empresa somente por coincidir o `ownerUid`. Os resultados são deduplicados por ID e entregues de uma vez ao `SpaceContext`. Não há listener nem consulta por espaço. As duas consultas usam apenas igualdades/`in`, que podem ser atendidas por index merging dos índices automáticos de campo único; por isso V1 não acrescenta índice composto.

O cache do `SpaceContext` é separado por `uid + businessId`. A seleção também possui chaves distintas para Home e Vender. Quando o navegador está offline, a lista cacheada e a última seleção válida permanecem utilizáveis. Escritas do adapter entram na fila persistente do SDK Firestore e atualizam a UI de modo otimista; uma falha online restaura o snapshot anterior.

Falha em qualquer consulta remota impede a criação automática do espaço padrão. O cache é mantido e um evento `veconi-space-service-error` é emitido, evitando que uma leitura parcial seja confundida com “empresa sem espaço”.

O `SpaceContext` não fabrica espaço de venda provisório. Antes de a leitura/cache fornecer um documento real, a venda fica bloqueada; somente o `SpaceService` ou a migração Admin pode provisionar o ID determinístico. Isso evita gravar uma venda local contra um documento que talvez não exista.

## Adapter de persistência

`window.SpaceService` e o adapter instalado em `SpaceContext` oferecem:

- `list()` — snapshot normalizado em cache;
- `load()` / `refresh()` — leitura consolidada e promoção aditiva;
- `create(input)` — cria espaço com UUID estável;
- `update(spaceId, input)` — altera nome, tipo operacional e capabilities no mesmo documento;
- `archive(spaceId)` — arquiva sem excluir documento ou subcoleções;
- `getReadStats()` e `getMigrationReport()` — diagnóstico de consultas e promoção.

O adapter nunca grava `type=unit|operation`: unidade/operação usa `type=business` no armazenamento e `operationalType` no contrato global. Atualizações nunca modificam `type`, `linkedBusinessId`, `ownerUid` ou o ID legado.

## Compatibilidade de referências

- Entidades antigas podem continuar usando `financialSpaceId`.
- Os módulos V1 resolvem `spaceId` primeiro e usam `financialSpaceId` somente como leitura legada.
- Novas vendas precisam de um `spaceId` real; `all_spaces` é inválido.
- A migração de Espaços não preenche `sale.spaceId` retroativamente, pois isso inventaria uma atribuição sem evidência.
- Produtos antigos sem configuração de disponibilidade são interpretados pela aplicação como `all_spaces`; o migrador não regrava produtos.

## Migração Admin

O script `scripts/migrate-global-spaces-v139.cjs` usa a credencial do Firebase CLI e opera em modo dry-run por padrão:

```powershell
node scripts/migrate-global-spaces-v139.cjs
```

Nesse modo o script somente lê, calcula e imprime o relatório; nenhum espaço ou registro de auditoria é gravado.

Depois de revisar integralmente `manualReview`, `changes`, `businessActions` e os inventários antes/depois, a execução explícita é:

```powershell
node scripts/migrate-global-spaces-v139.cjs --execute
```

O migrador:

1. inventaria `financialSpaces` e empresas ativas;
2. bloqueia a execução diante dos IDs reservados `all`/`all_spaces`, `type` legado desconhecido, campos globais explícitos malformados, vínculo empresarial ausente/desconhecido/conflitante, owner ausente ou colisão do ID determinístico;
3. acrescenta somente os seis campos do contrato global aos documentos existentes;
4. cria o padrão determinístico apenas para empresas realmente sem espaço de vendas;
5. usa precondição por `updateTime` para não sobrescrever alterações concorrentes;
6. relê e verifica IDs, `type`, campos globais e quantidade de documentos;
7. só então grava o audit em `spaceMigrations/global_spaces_v1_v139_2026_09`.

O relatório registra explicitamente zero documentos movidos, zero subcoleções escritas, zero vendas/produtos lidos ou escritos e zero backfills de `sale.spaceId`. Uma segunda execução sem mudanças produz `already-applied-and-verified` e não altera os dados.

## Rollback e segurança

A migração é aditiva. Uma reversão de aplicação pode simplesmente deixar de carregar a camada global: o Financeiro antigo ignora os novos campos e continua no mesmo caminho físico. Não é necessário — nem recomendado — remover campos ou recriar documentos para rollback.

Vendas novas criadas após a ativação mantêm `spaceId` como dado válido mesmo se a UI for revertida. O campo não deve ser apagado. Da mesma forma, `financialSpaceId` pode coexistir durante a transição.

## Limites intencionais da V1

Esta fundação não implementa RBAC por espaço, funcionários, estoque por filial, terminais/maquininhas, fiscal/NFC-e ou nova empresa. O estoque físico segue global. IDs e `businessId` já deixam preparado um futuro `member.allowedSpaceIds`, mas as consultas atuais respeitam apenas as autorizações existentes nas Rules.

Na V1, um documento financeiro legado físico `type=personal|other` continua legível somente por seu `ownerUid`, mesmo depois de o proprietário associá-lo à empresa e habilitar uma capability operacional. Essa restrição é deliberada: ampliar a leitura para membros da empresa nesta fase também poderia expor as subcoleções financeiras pessoais. Espaços físicos `type=business` continuam visíveis pelos vínculos empresariais atuais. O compartilhamento de espaços pessoais/outros com equipe será tratado junto do futuro RBAC por espaço, sem afrouxar a proteção financeira agora.

Contas e cartões continuam recursos financeiros globais com suas próprias regras de acesso; Espaço apenas fornece contexto e não volta a duplicá-los por unidade.
