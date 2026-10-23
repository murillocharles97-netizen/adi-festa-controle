# V179 — hotfix Equipe/Sync e retenção segura de vendas antigas

Base e rollback: V178, `94784cb2ec89f3b700875867b6d93d4a7e8f7ac1`.
Tag de referência: `rollback/v178-before-v179-team-sync`.

## Escopo publicado

- Retirada completa do runtime, estilo, ativação e hooks de timing temporários.
  Checkout e confirmação pós-commit preservam a lógica canônica limpa da V177;
  a otimização de leituras paralelas preparada separadamente NÃO integra este hotfix.
- Vendedor/Caixa não precisa consultar ajuste financeiro privado para enviar venda.
  As Rules impedem criação de venda cujo tombstone de conciliação está resolvido.
- Leitura de marcador de estoque inexistente é permitida a membro com inventory.view
  na própria empresa; registros existentes continuam isolados por espaço e custo.
- Venda com permission-denied anterior fica retida para revisão. Bootstrap,
  sincronização automática, force/manual e preflight não liberam o envio nem
  normalizam/removem o pacote original. Novas vendas podem seguir sem drenar as antigas.
- Painel Nuvem explica a retenção e desabilita a ação em lote quando todos os itens
  estão retidos. O diagnóstico existente acrescenta IDs/permissões e metadados técnicos;
  ele não exporta o payload bruto nem inventa a data da primeira falha.

Nenhuma alteração de Functions, billing, Auth operacional, domínio, índices,
clientes, estoque ou dados existentes acompanha a publicação. O endpoint/backend
de revisão das vendas antigas ainda NÃO foi implementado ou publicado. Nenhum
payload real é enviado por este hotfix; nenhuma recuperação automática é executada.

## Publicação e verificação

Workflow existente Deploy GitHub Pages por push a main. Apenas Rules pelo Firebase
CLI com `--only firestore:rules`; publicar a proteção de servidor antes do frontend.
Os clientes antigos continuam sem acesso ao documento financeiro privado; clientes
novos retêm os trabalhos já negados. Não usar workflow/artefato de medição.

Validar o conteúdo selecionado em uma extração limpa, lint, build, diff-check e
testes de Equipe/Sync/estoque/Rules/retention. Testes de persistência/replay de fila
usam fixtures do Emulator, não a fila real. A retenção de quatro pacotes deve
permanecer byte-equivalente após bootstrap e sync forçado, enquanto uma nova venda
é confirmada. Testar também novos pedidos multiproduto com Vendedor e Caixa.

Após publicar: conferir versão/commit/Sync/UI/SW e o hash das Rules; ler somente
IDs técnicos previamente auditados para verificar que não apareceram commits das
operações retidas. Não executar venda ou reprocessamento real como smoke.

## Rollback

Restaurar os arquivos da árvore anterior por commit restrito e workflow Pages;
jamais resetar caches, filas, Firestore ou estoque. A V178 reintroduz o bug e o
diagnóstico temporário (desligado por padrão): rollback é contingência, não solução.
Manter a nova Rule que protege vendas conciliadas é seguro com V178, mas voltaria
a falhar a leitura operacional do cliente antigo. Reverter Rules somente se necessário,
com fonte/hash anterior preservados fora do repositório, e sem reprocessar pendências.
Preferir um hotfix de avanço preservando a retenção a remover essa proteção.

## Recuperação posterior (não incluída)

Preparar uma área por empresa de registros de revisão, distinta de sales e das
coleções que disparam efeitos comerciais. Preservar payload original imutável e
mesmos saleId/operationId, com upload idempotente, leitura por owner e visão
operacional própria pelo vendedor. Materializar o registro não executa a venda.
Decisões futuras: vincular representação existente sem efeitos, ou executar a
operação original após validação explícita. Nenhum desses comandos é habilitado aqui.
