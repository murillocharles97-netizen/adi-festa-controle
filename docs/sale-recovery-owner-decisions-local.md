# Recuperação — decisão explícita do proprietário (local)

Base: V181, `41a107fcc673393a16cf1d5da3780df259f7b5a8`. Sem commit/deploy, alteração de versão ou acesso às quatro operações reais.

## Fluxo

- Em revisão: sugestões não são decisões. Cada ação abre confirmação própria.
- **Confirmar: já foi registrada**: valida venda existente do owner, empresa/espaço/geração, itens, quantidades, total e pagamento. Grava somente a decisão e vínculo nos documentos privados de recuperação. Não cria marcador comercial, venda, receita, baixa, cancelamento ou estorno.
- **Não é a mesma venda**: audita o descarte desta sugestão; mantém o original pendente.
- **Recuperar venda original**: lê exclusivamente o original imutável armazenado, confere SHA-256/índices/ator, vínculo/permissões atuais, geração, plano e espaço. Revalida estoque/reservas e ausência de qualquer efeito original. Aplica delta sobre o estoque ATUAL, com saleId/operationId/movementIds originais, numa transação que também resolve a revisão e cria o marcador idempotente.
- Operações pendentes anteriores com produtos compartilhados precisam ser decididas primeiro, inclusive produtos compartilhados entre espaços da mesma empresa.
- **Resolvidas**: resultado, data, responsável e venda vinculada. Funcionário consulta apenas os próprios registros nos espaços autorizados; decisões são exclusivas do owner ativo.

## Segurança e idempotência

Novo callable: `decideSaleRecovery`, com os mesmos limites/região/opções dos callables existentes. Não há trigger na coleção de recuperação. Submissão/listagem nunca executam a venda.

Revisão exige confirmação literal, hash e revisão esperada. Transações leem original e índice imutáveis. Decisões concorrentes incompatíveis não podem vencer juntas. Resposta perdida permite repetir a MESMA decisão; decisão diferente é rejeitada.

As Rules continuam negando leitura/escrita direta dos pacotes, inclusive ao owner. Também impedem criação de uma venda preservada para revisão e replay de suas saídas de estoque por clientes antigos. O callable faz a materialização autorizada no backend, sem bypass específico de QA.

A fila comercial, erros e payloads locais NÃO são apagados, regravados nem marcados como concluídos. A retenção existente no cliente permanece, e a trava remota protege mesmo clientes antigos. Reenvio do pacote de evidência após resolução é idempotente e devolve o status atual. A contagem do banner representa registros preservados, não promete que todos continuam sem decisão.

## Efeitos comerciais

Somente a decisão `recover_original` cria uma venda canônica. O horário da venda e a autoria original são preservados; `recoveredAt/recoveredByUid` identificam a intervenção. Movimentos preservam seus IDs, mas registram estoque anterior/novo reais no momento da recuperação. Variações recalculam o resumo do pai a partir das variações atuais.

Não altera preço/cadastro do produto nem sobrescreve snapshots antigos de estoque. Reservas online são respeitadas; não força negativo, nem se o cadastro permitir vendas negativas. Qualquer evidência parcial (venda, marcador, movimento esperado/inesperado, snapshot financeiro ou receita) bloqueia a operação inteira.

Financeiro, custos e atividade reutilizam as projeções já existentes para vendas canônicas, sem novo trigger de recuperação. `finance=false` continua sem receita. O roteamento/idempotência financeiro continua por empresa/espaço/saleId; a projeção de receita é assíncrona como no fluxo normal. Metas/faturamento contam a única venda canônica na sua data original. Um vínculo sem venda nova não entra nesses agregados.

## Limites explícitos desta entrega

- Executor de vendas manuais pagas, sem cliente vinculado/efeitos auxiliares, até 40 itens e 500 variações agregadas por transação. Produtos simples e com variações.
- Fiado, cliente com projeções, campanhas, integrações, recorrências e tipos desconhecidos permanecem preservados para revisão técnica. Não são parcialmente executados.
- Sugestões continuam limitadas a até 100 vendas do gestor no mesmo dia UTC/espaço. Ausência de sugestão não prova ausência de duplicata. Não há deduplicação automática.
- Não substitui smoke pós-deploy nem validação Android físico. Nenhuma das quatro decisões reais foi tomada nesta entrega.

## Arquivos

- `functions/src/services/sale-recovery-decision.js` (novo): plano estrito, estoque/transação canônica.
- `functions/src/services/sale-recovery-service.js`: decisões, auditoria privada e consulta de resolvidas.
- `functions/src/index.js`: novo callable explícito.
- `firestore.rules`: proteção adicional contra replay de registros em revisão.
- `js/sale-recovery-ui.js`, `js/sale-recovery-client.js`, `css/sale-recovery.css`: UX/confirmações/resolvidas/recibos atuais.
- `tests/sale-recovery-decision.test.js` e `tests/emulator/sale-recovery-decision.rules.test.js` (novos), `tests/fixtures/sale-recovery-browser.js`: testes e fixture exclusivamente fictícios.

A alteração de Fiado que já estava em `js/firebase/sync.js` antes desta tarefa permaneceu intocada e não faz parte deste bloco.

## Validação

45 testes direcionados do app; 9 testes de backend financeiro/custos/workspace; 33 testes de serviços/Rules no Firestore Emulator (incluem os 9 novos cenários com quatro amostras sintéticas, concorrência, resposta perdida, zero efeitos ao vincular, estoque/reserva, variações, isolamento e replay). Lint, build e diff-check. Conferência visual na fixture local sem conexão externa.

Para futura publicação, após autorização: publicar backend/Rules compatíveis antes da UI, versionar caches no fluxo já existente e smoke somente QA. Base de rollback permanece V181. Não recuperar as quatro operações reais como parte do deploy; cada decisão será do proprietário.
