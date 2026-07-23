# Adi Festa Controle — auditoria de preparação para produção

Data da auditoria: 23/07/2026  
Escopo: Firebase, sincronização, cache, paginação, offline, Service Worker, isolamento multiempresa e performance.

## Resumo executivo

A principal origem de consumo excessivo foi confirmada no sincronizador:

- 16 listeners administrativos eram abertos simultaneamente;
- cada visita relevante adicionava 2 listeners;
- com aproximadamente 30 visitas, o total chegava a 76 listeners;
- além dos listeners, as 16 coleções eram relidas a cada 30 segundos;
- a publicação do portal podia regravar o índice e o perfil de todos os clientes.

O núcleo foi alterado para:

- 5 listeners administrativos realmente necessários;
- no máximo 3 visitas acompanhadas, com 2 listeners por visita;
- máximo administrativo de 11 listeners;
- leitura incremental das outras 11 coleções a cada 5 minutos;
- cache compartilhado de consultas;
- carregamento inicial paginado;
- encerramento explícito de listeners;
- publicação de perfis somente quando o conteúdo muda;
- telemetria de desenvolvimento para leituras, gravações, consultas, listeners e latência.

## Inventário das operações Firebase

| Área | Operação | Origem | Frequência anterior | Frequência atual |
| --- | --- | --- | --- | --- |
| Autenticação | `getDoc(users/{uid})` | `firebase/auth.js` | login | login |
| Validação de perfil | `getDoc(users/{uid})` | `firebase/sync.js` | várias operações | cache de 5 minutos |
| Empresa | `getDoc(businesses/{businessId})` | `firebase/sync.js` | teste de conexão | teste de conexão, sem releitura redundante |
| Dados centrais | `onSnapshot` | `firebase/sync.js` | 16 listeners | 5 listeners |
| Dados secundários | `getDocs` | `firebase/sync.js` | 16 consultas a cada 30 s | 11 consultas incrementais a cada 5 min |
| Fila offline | `runTransaction` | `firebase/sync.js` | por operação pendente | por operação pendente, idempotente |
| Catálogo administrativo | `onSnapshot` | `firebase/catalog-bridge.js` | 2 por visita, sem limite | 2 por visita, máximo de 3 visitas |
| Publicação do catálogo | `setDoc` | `firebase/catalog-bridge.js` | ao publicar/alterar pedido | mantido |
| Perfis do portal | `setDoc` | `firebase/catalog-bridge.js` | até 2 gravações por cliente/publicação | grava somente fingerprints alterados |
| Catálogo público | `getDoc(publicCatalogs/{token})` | `catalogo-publico.js` | 1 por abertura | mantido |
| Identificação pública | `getDoc` por token exato | `catalogo-publico.js` | sob ação do cliente | mantido |
| Perfil público | `onSnapshot` de documento | `catalogo-publico.js` | podia duplicar | 1 por cliente identificado |
| Pedido público | `onSnapshot` de documento | `catalogo-publico.js` | um por pedido salvo, sem limite | somente pedidos ativos, máximo 5 |
| Pedido público | `setDoc` | `catalogo-publico.js` | 1 por pedido | mantido, com trava de envio e timeout |

## Comparativo de consumo

### Listeners simultâneos

- Antes, administrador: `16 + (2 × visitas)`.
- Cenário observado: `16 + (2 × 30) = 76`.
- Depois, administrador: `5 + (2 × min(visitas relevantes, 3))`.
- Máximo atual: 11.
- Redução no cenário observado: 85,5%.

No catálogo do cliente, os listeners de pedido deixaram de crescer sem limite. O máximo passou a ser 1 listener de perfil e 5 pedidos ativos.

### Consultas periódicas

- Antes: 16 consultas a cada 30 segundos, equivalentes a 1.920 consultas/hora por sessão ativa, sem contar documentos retornados.
- Depois: 11 consultas incrementais a cada 5 minutos, equivalentes a no máximo 132 consultas/hora quando a tela está visível.
- Redução de frequência: aproximadamente 93,1%.

As leituras cobradas dependem do número real de documentos retornados. Consultas incrementais sem alteração ainda podem ter cobrança mínima do Firestore, por isso a telemetria deve ser acompanhada com dados reais.

### Gravações

- foi removida a gravação de teste de conexão a cada validação;
- foi removida uma leitura redundante do marcador após transação;
- a publicação de 121 clientes podia gerar até 242 gravações por visita;
- após fingerprints, uma republicação sem mudanças gera zero gravações de perfil/índice;
- metadados de sincronização só são gravados quando houve envio, erro ou recebimento.

## Cache e sincronização

- cache compartilhado em memória por empresa, coleção e variante de consulta;
- TTL padrão de 60 segundos para listas;
- invalidação após criação, alteração ou remoção;
- marcador incremental separado por `businessId` e coleção;
- documentos são buscados por `updatedAt`;
- bootstrap é paginado em blocos de 200 por ID de documento;
- fila offline mantém `operationId`, tentativas, proprietário e empresa;
- transações usam marcador idempotente em `processedOperations`;
- alterações temporariamente rejeitadas permanecem na fila.

## Retry e tratamento de erros

Tratamento amigável incluído para:

- `permission-denied`;
- `unavailable`;
- `deadline-exceeded`;
- `resource-exhausted`;
- `network-request-failed`;
- `unauthenticated`;
- `failed-precondition`;
- `invalid-argument`.

Backoff:

- padrão: 5 s, 15 s, 30 s, 60 s e 5 min;
- cota esgotada: 5 min, 15 min, 30 min e 60 min;
- erros temporários não viram falha terminal;
- erros permanentes são interrompidos após tentativas limitadas;
- não existe loop infinito imediato.

## Paginação e lazy loading

- Clientes mobile: blocos de 50 com `IntersectionObserver`;
- Produtos mobile: blocos de 50 com `IntersectionObserver`;
- Histórico: blocos de 100 com ação “Carregar mais”;
- Pedidos online: blocos de 50 com ação “Carregar mais”;
- Bootstrap Firestore: páginas de 200 documentos;
- participantes de campanha em detalhes: limite visual de 12.

Campanhas e visitas são mantidas integralmente no cache offline porque normalmente são listas pequenas. Antes de bases com milhares desses registros, deve-se mover a paginação também para o repositório remoto.

## Dashboard

O dashboard não consulta o Firestore diretamente. Todos os KPIs são calculados a partir do banco local já sincronizado, portanto abrir ou renderizar o dashboard não gera leituras extras na nuvem.

Uma etapa futura pode persistir agregados diários no servidor quando o volume de vendas por empresa ultrapassar a capacidade confortável de cálculo local.

## Service Worker

Correções:

- cache atualizado para `adi-festa-v41-saas`;
- arquivos novos do monitor de uso incluídos no precache;
- `Response.clone()` ocorre antes da resposta ser consumida;
- `cache.put()` é aguardado;
- falhas de rede têm fallback seguro;
- caches antigos são removidos na ativação;
- catálogo público e módulos multiempresa receberam versionamento `v41`.

Isso elimina o fluxo que podia causar `Failed to execute 'clone' on 'Response'`.

## Telemetria de desenvolvimento

O monitor registra por sessão:

- leituras estimadas;
- gravações;
- consultas;
- listeners ativos;
- pico de listeners;
- erros;
- latência média;
- operações agrupadas por tela e coleção.

Ativação manual fora de localhost:

```js
localStorage.setItem('adiFestaDevMetrics', '1');
location.reload();
```

Consulta pelo console:

```js
FirebaseUsageMonitor.snapshot()
```

Essa medição é diagnóstica no cliente e deve ser comparada com o painel oficial de uso do Firebase.

## Isolamento multiempresa

Pontos confirmados:

- dados administrativos ficam em `businesses/{businessId}/...`;
- o `businessId` é obtido do perfil autenticado;
- regras verificam `currentBusinessId() == businessId`;
- filas carregam `businessId` e `userId`;
- filas de outro proprietário são arquivadas e removidas do fluxo ativo;
- backups só podem restaurar dados da mesma empresa;
- catálogo público usa somente documentos sanitizados fora da árvore administrativa.

## Segurança

Proteções presentes:

- catálogo público permite `get` por token exato e bloqueia `list`;
- dados administrativos exigem autenticação e empresa correspondente;
- pedidos públicos validam status, telefone, quantidade de itens, valor, pagamento e token;
- exclusão física permanece bloqueada pelas regras;
- tokens públicos possuem alta entropia.

Pendências obrigatórias antes de comercializar para terceiros:

1. substituir o bootstrap `firstOwner()` e o e-mail fixo por provisionamento seguro em Cloud Functions ou painel administrativo;
2. criar papéis com menor privilégio para funcionários; hoje um membro autorizado da empresa possui escrita ampla dentro da empresa;
3. ativar Firebase App Check para reduzir abuso dos endpoints públicos;
4. implementar rate limit server-side para pedidos, sessões e resgates públicos;
5. criar testes automatizados das regras com Firebase Emulator Suite;
6. separar ambientes `dev`, `staging` e `production`;
7. configurar alertas de orçamento, quota e erros.

Não foi liberado `allow list` no catálogo público nem exposta coleção administrativa.

## Arquitetura e manutenção

Responsabilidades agora estão mais claras:

- `firestore-repository.js`: acesso, cache, paginação e listeners;
- `sync.js`: fila, reconciliação, incremental e retry;
- `usage-monitor.js`: métricas;
- `catalog-bridge.js`: projeção administrativa para o catálogo público;
- `catalogo-publico.js`: experiência pública por token;
- `storage.js`: fonte local offline-first;
- `firestore.rules`: fronteira de autorização.

## Testes executados

- verificação de sintaxe dos módulos alterados;
- regressão de visitas e pedidos;
- teste estático de hardening;
- carregamento do login local;
- catálogo público em modo não autenticado;
- renderização de 4 produtos;
- ausência de overflow horizontal;
- ausência de tela de erro no catálogo;
- validação estática de acesso público por `getDoc` exato;
- validação estática do limite de listeners;
- validação estática do ciclo seguro de `Response.clone()`.

## Capacidade e próximas etapas

Esta rodada remove o maior multiplicador de custo e estabiliza o cliente atual para dezenas ou centenas de empresas com uso moderado. Para 1.000 empresas ou mais, as próximas prioridades são:

1. provisionamento multiempresa server-side;
2. agregados diários do dashboard;
3. Cloud Functions para pedidos públicos, campanhas e rate limit;
4. App Check;
5. índices compostos orientados por consultas reais;
6. observabilidade central (Crashlytics/Analytics/Cloud Logging);
7. testes de carga e orçamento por empresa;
8. retenção/arquivamento de histórico antigo.

O app está significativamente mais eficiente e previsível, mas a liberação para clientes pagantes deve ocorrer somente depois das pendências de provisionamento, papéis, App Check e testes de regras em staging.
