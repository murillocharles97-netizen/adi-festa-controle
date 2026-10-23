# V194 — correção mínima do vínculo single_space

22/10/2026. Correção autorizada após publicação de Rules/15 Functions do candidato inicial. Frontend público permanece V193; não publicar V194 antes do smoke QA autenticado.

## Causa e correção

O formulário canônico de produtos grava os modos all_spaces, selected_spaces e single_space. Os serviços novos de troca e crédito aceitavam explicitamente apenas os dois primeiros, rejeitando um cadastro single_space válido antes de verificar seu vínculo. Não é um problema de estoque ou de Rules e não exige migração ou alteração do produto.

Novo helper backend `functions/src/shared/exchange-product-scope.js`, usado nos dois guards:

- Modos all_spaces/selected_spaces mantêm exatamente o comportamento anterior.
- single_space exige defaultSpaceId igual ao destino e allowedSpaceIds como array de exatamente um elemento, igual ao mesmo destino.
- spaceId redundante, quando preenchido, deve concordar. Dados ausentes, arrays amplos/duplicados, modo desconhecido e vínculos conflitantes são rejeitados.
- Produto ativo, empresa, geração, vínculo do operador, permissões, espaço ativo, estoque, variações e reservas continuam revalidados pela mesma transação. Não há privilégio especial para owner ou QA.
- Nenhuma alteração no modelo genérico da Loja Online, nas Rules, frontend, permissões, cadastros ou histórico.

## Superfície exata de republicação

Somente cinco Functions carregam o guard corrigido no caminho relevante:

1. quoteSaleExchange
2. confirmSaleExchange
3. quoteExchangeCreditSale
4. confirmExchangeCreditSale
5. cancelExchangeCreditSale

O último usa stocksFor({restore:true}) e precisa ser atualizado para restaurar estoque de uma venda com crédito usando produto single_space. Saldo, lookup, status, listagem, projeção econômica, guard de undo, Rules, índices, projetores financeiros e reset não precisam ser republicados por este fix.

## Validação local

- 121/121 testes direcionados app/backend, sem falha/skip.
- 110/110 Firestore Emulator, sem falha/skip: 45 regressões novas single_space + 65 cenários anteriores de crédito/troca/fences/Sync de vendedor.
- Novos casos: owner/seller, troca igual, emissão/consumo parcial/restauração de crédito, vínculo de outro espaço, ausência/conflito entre campos, troca de vínculo após cotação, geração/empresa conflitantes, legado ambíguo, variação, reserva, avaria, concorrência, replay e Fiado bloqueado.
- Lint/build aprovados (409 arquivos JS); diff-check aprovado. Emulator usado em instância local isolada na porta8196, encerrada após os testes. Nenhuma venda real usada em testes.

## V193 e produção

O HTML do domínio continua com SHA V193 `41b192c49d60279a7b621d60db50683f334732ac`. A sessão owner pública abriu Produtos normalmente, mostrou o único produto QA já criado com estoque20 e Nuvem com0pendências. Os testes de Rules confirmam venda manual normal e cancelamento autorizado de owner/seller com as Rules já publicadas. Isso não significa teste de venda real em produção: nenhuma foi executada.

## Rollback e smoke

Preservar imutáveis o commit67c16811f557f674bc2b8d30b75711400681b1b7 e sua tag antiga. Para preservar também o cancelamento de consumo single_space em um artefato completo, preparar/revalidar a referência `rollback/v194-compatible-sale-exchanges-single-space`, com o helper corrigido e a contenção de novos commits. Nunca voltar integralmente ao backend/Rules V193 após efeitos.

O navegador recusou acesso à prévia local do frontend em http://127.0.0.1:8195. Não houve tentativa de contorno ou publicação pública para substituir esse acesso. O smoke autenticado de nuvem depende de permissão explícita para essa prévia e login normal do owner; nenhum token/senha será extraído ou solicitado no chat. Até sua conclusão, não declarar frontend pronto e não avançar main.

Restrições de QA preservadas: somente VECONI QA/VECONI QA — isolamento; ambos finance=false, não alterar capacidade financeira; não há seller QA ativo, não ampliar permissões. Nenhuma operação comercial em loja real, replay de fila antiga ou limpeza local.
