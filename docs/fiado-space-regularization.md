# Regularizar saldo por cliente e espaço — candidata V238.5

Status: implementação local, sem push, deploy ou alteração financeira real.
Branch: `codex/fiado-space-regularization`, base publicada `5838512` (V238.4).

## Diagnóstico e implementação

O formulário antigo alterava o saldo agregado da empresa e era deliberadamente
bloqueado na visualização por espaço. Remover esse bloqueio misturaria contas.

A nova ação **Clientes → Mais opções → Regularizar saldo** está restrita ao
proprietário canônico (`business.ownerId` e vínculo ativo, conferidos no servidor).
Exige vínculo explícito do cliente ao espaço de vendas, conexão, conferência da
fila local, finalidade, motivo e confirmação do total final. Não concede acesso
administrativo a gerentes subordinados.

Reutiliza `balanceAdjustments`, `balanceEvents`, `processedOperations`,
`financialVersion`, o comprovador V2, a alocação por espaço e os recebimentos
existentes. Não cria outro executor, migração ou fila comercial.

O servidor calcula `diferença = total informado - dívida confirmada do espaço`.
Atualiza o saldo agregado **somente por essa diferença**, preservando a composição
dos outros espaços. Antes de escrever, reprojeta a conta e verifica os totais de
todos os espaços. Parcelas contratuais não podem ser reduzidas pela regularização.
O ajuste gera conta a receber, nunca venda, faturamento, pagamento, caixa ou estoque.

O evento imutável contém empresa, cliente, espaço, total anterior e novo do espaço,
diferença, justificativa, finalidade, data do servidor e autor. O saldo agregado
anterior/novo é mantido somente como parte do contrato financeiro de comprovação
já existente. As permissões atuais de leitura financeira não são ampliadas.

Confirmação usa transação e versão/cotação atuais. Mesmo ID e conteúdo devolvem o
comprovante original; ID reutilizado com outro conteúdo é recusado. Confirmações
concorrentes com a mesma cotação não sobrescrevem uma à outra. A interface preserva
o pedido original antes de enviar e consulta esse mesmo ID após perda da resposta
ou reinício, sem criar outra intenção automaticamente.

As contas regularizadas deixam de usar a atribuição visual de saldo residual ao
espaço padrão. A lista consulta o comprovante apenas dos clientes regularizados
visíveis, com cache e até quatro consultas em paralelo. Saldo não confirmado fica
“a conferir”. Cadastro antigo não regularizado mantém o comportamento anterior.

## Caso indicado: leitura real, nenhuma escrita

Em 19/11/2026, a consulta limitada à conta indicada encontrou saldo cadastral zero,
versão financeira zero e nenhuma venda Fiado de R$ 180 no Táxi. A consulta adicional
por `spaceId` e `financialSpaceId` não encontrou vendas nesse espaço. Isso descreve
o servidor naquele instante; **não comprova a ausência de rascunho ou operação no
celular**. Os IDs, documentos e contatos permaneceram somente nos artefatos privados
ignorados pelo Git.

Se o saldo continuar zero no momento da confirmação, total de R$ 1.889 significa
diferença de R$ 1.889. Se uma venda de R$ 180 chegar antes, a consulta mostrará esse
saldo e a diferença será R$ 1.709. Uma chegada concorrente invalida a cotação e exige
nova revisão. Não registramos os R$ 1.889 nem recriamos a corrida.

## Validação

- 12 testes no Firestore Emulator com os **dois pacotes seletivos finais**:
  zero/histórico, dívida prévia de R$ 180, diferença correta, dois espaços,
  correção para baixo e zero, concorrência, repetição, vínculo/permissões/empresa,
  recebimento pendente, recebimento de R$ 70 sobre R$ 150, caixa único, venda nova
  e cancelamento, parcelas preservadas, corte definitivo e rollback compatível.
- Rules ativas + overlay: teste com recusas de escrita direta no saldo regularizado,
  marcador e dois registros auditáveis; impede remover o marcador para editar;
  preserva edição cadastral legítima e isolamento empresarial.
- 117 testes direcionados aprovados: histórico, Clientes, desempenho da lista,
  combustível, beneficiário/pagador, aliases de estoque, versão e contenção pública.
- 21 regressões operacionais/serviços aprovadas no pacote final da Function; mais
  um teste dos leitores ativos e isolamento aprovado. Rollbacks antigos de serviços
  não relacionados não foram repetidos. Rollback desta entrega foi testado.
- Chrome com HTTP local + Firestore Emulator em 360, 390 e 1366 px: formulário,
  diferença, confirmação, resposta perdida depois do commit, reinício, consulta do
  mesmo ID, saldo atualizado e bloqueio por pendência local. Nenhum erro JavaScript.
- Build completo aprovado (8.490 arquivos JavaScript); pacote público: 277 recursos.

Evidências privadas locais: `qa-artifacts/fiado-space-regularization/`, incluindo
capturas `conferir-saldo-360.png`, `conferir-saldo-390.png`, resultados, logs, fontes
ativas e manifestos de hash. Sem chamadas comerciais de escrita em produção.

## Arquivos

- Backend: `functions/src/services/fiado-space-regularization.js`,
  `operational-commit-service.js` e `functions/src/shared/fiado-history-account.js`.
- UI: `js/fiado-space-regularization.js`, `clientes-page.js`, `client-actions.js`,
  `clientes.js`, `installment-credit.js` e `css/clientes-page.css`.
- PWA: `index.html`, `js/build-info.js`, `service-worker.js`,
  `public-site.manifest.json`.
- Preparação: `scripts/package-fiado-space-regularization.cjs`,
  `scripts/package-fiado-space-rules.cjs`,
  `scripts/homologate-fiado-space-regularization.cjs`.
- Testes: `tests/emulator/fiado-space-regularization.test.cjs`,
  `tests/emulator/fiado-space-regularization.rules.test.cjs` e
  `tests/clientes-local-balances.test.cjs`.

## Publicação seletiva proposta — requer novo GO

1. Revalidar main, revisões e hashes ativos. Interromper se divergirem. Não utilizar
   a árvore inteira de Functions nem o arquivo de Rules desatualizado da main.
2. Aplicar apenas o overlay das Rules **sobre a versão realmente ativa**. São cinco
   substituições: proteção dos campos financeiros de contas regularizadas e
   criação/edição direta dos novos ajustes e eventos. Nenhuma permissão de leitura
   muda. Não há índice novo nem migração. Hash base:
   `b7a53cfb1317c62c46a0d3ffa3862b2a813211666a26298a28237d840fb550df`;
   hash candidato `61104dfd9a1184e98f1996b280efaa5b5441505624eaad4689020a482ed38d90`.
3. Publicar **somente `getOperationalSyncReceipt`**, base `00013-xet`:
   prévia/consulta do comprovante e leitura compatível da conta regularizada.
4. Publicar **somente `commitOperationalSync`**, base `00025-ked`:
   intenção administrativa, transação e bloqueio de ajustes globais/recebimentos
   sem escopo para essas contas. Validar após cada Function.
5. Frontend pelo fluxo protegido do GitHub Pages. Conferir 277 recursos e hashes,
   Service Worker `veconi-v2385-space-regularization-v1` e smoke sem confirmar saldo
   real. Todas as demais Functions, índices e dados permanecem preservados.

Os pacotes partem das fontes ativas verificadas individualmente. Somente três
arquivos mudam em cada pacote: serviço novo, roteamento e projeção. São preservados
100 arquivos de origem do gateway e 95 do leitor. A fonte raiz divergente não é
copiada sobre produção. `readOperationalWorkspace`, `getPerformancePage`,
cancelamentos e projeções financeiras existentes não precisam de deploy.

## Rollback e limites

Não restaurar cegamente backend/Rules anteriores depois de haver regularizações.
O rollback preparado pausa **novas** regularizações (`WRITES_ENABLED=false`), mantendo
comprovação, status/idempotência e recebimentos das contas já alteradas. O frontend
de contenção esconde a ação (`ENABLED=false`), preservando a exibição por espaço e
o PDV publicado. Manter os bloqueios seletivos nas Rules e os registros originais.
O teste recebe R$ 70 pela Function de rollback sem duplicar caixa.

PWAs anteriores continuam operando contas comuns. Um cliente sem contrato de
recebimento escopado atualizado é recusado ao tentar modificar conta regularizada;
nunca recebe fallback para a dívida agregada. Ajustes globais antigos dessa conta
também são recusados, sem reenvio ou exclusão. A atualização deve ser disponibilizada.

Nenhum servidor pode atestar uma fila offline desconhecida de outro aparelho.
O aplicativo verifica a fila do aparelho atual e orienta concluir sincronizações
nos demais; pendências financeiras remotas, versões desatualizadas e históricos
inconsistentes continuam bloqueados. A regularização não reconstrói nem legitima
históricos sem comprovação e não substitui parcelas contratuais.

**GO técnico para publicação seletiva mediante autorização. Nenhum GO para aplicar
o saldo real: isso será uma ação posterior e expressa do proprietário no aplicativo.**
