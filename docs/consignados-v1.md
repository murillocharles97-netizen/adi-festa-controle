# Consignados V2

O proprietário abre **Gestão → Consignados**, ao lado de Renovações, e ativa o módulo no espaço selecionado. A configuração também fica acessível em **Configurações → Consignados**. Pontos de venda, documentos e saldos pertencem à empresa, ao espaço e à geração do ambiente. A confirmação exige conexão e usa o saldo disponível naquele momento, inclusive nas entregas retroativas.

## Estoque, vendas e recebimentos

- Entrega e reposição transferem unidades do estoque próprio para o ponto de venda, preservando reservas de pedidos online. O preço da entrega fica registrado por lote. A transferência não cria venda ou lançamento financeiro.
- Na conferência, vendas são a diferença entre as unidades esperadas e a soma de unidades encontradas, devolvidas, perdidas e avariadas. Somente devoluções voltam ao estoque próprio. A comissão é calculada sobre o valor bruto das vendas confirmadas.
- A conferência cria uma entrada líquida no Financeiro. Se ficar pendente, a entrada aparece a receber. O acerto atualiza essa mesma entrada e credita a conta autorizada uma vez. Um acerto posterior não gera outra venda.
- Início exibe o bruto das vendas consignadas do dia no espaço ativo em um indicador próprio. Histórico inclui Consignação, Reposição, Conferência e Acerto.
- Os PDFs usam a logo da empresa ou do catálogo do espaço. O arquivo de conferência registra as vendas, o período e a comissão. O PDF de estoque preserva o saldo completo daquela operação. Registros V1 guardam apenas as linhas entregues e continuam com o comprovante original.

O estoque aceita até 400 linhas de produto e preço por estabelecimento, e cada entrega aceita até 40 linhas. O módulo mantém a restrição V1 a proprietários. Produtos sem controle de estoque ou sem vínculo explícito ficam fora da operação.

## Publicação e reversão

Dependem de autorização o novo índice composto de `deliveries`, a callable `manageConsignment` e o frontend. Antes da publicação, confirmar que as Rules ativas negam acesso direto às coleções privadas e impedem edição direta dos lançamentos automáticos. Criar somente o índice ausente e esperar `READY`. Implantar a callable isoladamente, validar o fluxo técnico e publicar o frontend por último. A V233 pode ser restaurada como frontend anterior. Preservar a callable e os comprovantes se já houver registros, para permitir consulta e acerto.

Desativar o módulo preserva estoques, saldos e comprovantes e permite acertar conferências já confirmadas. O reset genérico deve continuar bloqueando as coleções de consignação até existir um procedimento explícito de encerramento do estoque externo.

## Validação local

Rode `firebase emulators:exec --only firestore --project demo-veconi-consignment "node --test tests/emulator/consignment.integration.cjs"`. Para a prévia, defina `VECONI_CONSIGNMENT_PREVIEW=1` e use `node --test --test-name-pattern=preview tests/emulator/consignment.integration.cjs` como comando interno. A prévia usa o ponto fictício Ponto Centro, com estoque já consignado, e escuta apenas no localhost. A porta padrão é 8791 e pode ser alterada com `VECONI_CONSIGNMENT_PREVIEW_PORT`.

A reemissão preserva os dados comerciais do documento. Se a logo referenciada tiver sido removida do catálogo, o proprietário pode selecionar a imagem novamente antes de gerar o PDF.
