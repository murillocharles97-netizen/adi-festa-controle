# Consignados V1

O proprietário abre **Configurações → Consignados** e ativa o módulo no espaço selecionado. O cadastro de pontos de venda, os saldos e os comprovantes pertencem à empresa, ao espaço e à geração do ambiente. O campo de data registra a entrega efetiva, inclusive retroativa. A movimentação usa o saldo disponível no momento da confirmação e preserva reservas de pedidos online.

O fluxo do PrimeDocs inspira o painel, a reposição aditiva, os saldos antes e depois e o comprovante. A VECONI registra a saída da loja e a entrada no ponto em uma transação. O recibo usa a identidade configurada na empresa ou no catálogo do espaço. O operador pode selecionar um arquivo de logo para o PDF. O compartilhamento usa o sistema do dispositivo e oferece download para anexar onde o compartilhamento de arquivos não é suportado.

Esta versão exige conexão e reutiliza o aviso de fila local e o sinal de atualização do estoque. Uma resposta perdida é conferida com o ID original. As entregas aceitam até 40 linhas. O painel aceita até 200 pontos por espaço e pagina histórico e estoque. Produtos sem controle de estoque ou sem vínculo comprovado com o espaço ficam fora da operação. Nenhum registro de venda, pagamento, comissão ou receita é criado.

## Publicação e reversão

A publicação depende de autorização separada. O escopo de backend é a nova callable **manageConsignment**. Ela verifica proprietário, empresa, geração e espaço. As novas coleções são privadas e acessadas via callable. Validar a negação de acesso direto com as Rules efetivamente ativas antes da implantação. Nenhum índice composto e nenhuma mudança em assinaturas ou na fila de sincronização fazem parte do candidato.

A ativação pode ser revertida pelo proprietário sem apagar pontos, entregas ou saldos. Para retirar o módulo de circulação, desative-o antes de reverter o frontend. Consignados requer tratamento explícito em futuras restaurações do ambiente. O reset genérico bloqueia coleções operacionais desconhecidas, preservando o vínculo entre os dois estoques.

## Etapas futuras

1. Conferências e devoluções com saldo esperado, contagem real, tratamento de divergências e movimentos inversos auditáveis.
2. Vendas consignadas e acertos com conciliação por ponto e data. Receita e caixa surgem somente da confirmação apropriada, com referência à venda e prevenção de duplicidade.
3. Comissões, lucratividade e relatórios por ponto, período e produto. Preservar as regras de custo e permissões financeiras da VECONI e os fluxos correspondentes do PrimeDocs.

## Validação local

Execute os testes com `firebase emulators:exec --only firestore --project demo-veconi-consignment "node --test tests/emulator/consignment.integration.cjs"`. A sessão de prévia usa o mesmo serviço de estoque e apenas dados fictícios. Quando precisar reabri-la, defina `VECONI_CONSIGNMENT_PREVIEW=1` e troque o comando interno por `node --test --test-name-pattern=preview tests/emulator/consignment.integration.cjs`. Acesse `http://127.0.0.1:8791`.
