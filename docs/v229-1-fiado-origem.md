# V229.1 — Origem do Fiado e compatibilidade do recebimento

Em 09/11/2026, a leitura transacional da empresa `adi-festa` classificou os documentos pelo `spaceId` ou `financialSpaceId` registrado. A consulta incluiu vendas Fiado e Crediário, recebimentos, alocações, ajustes, eventos de saldo, marcadores de operações e projeções de caixa associadas. O levantamento distingue campo de origem e evidência em outro documento. O espaço do caixa não prova, sozinho, o espaço da venda.

| Documentos | Adi Festa explícito | Outro espaço explícito | Sem campo de origem |
| --- | ---: | ---: | ---: |
| Vendas Fiado/Crediário | 246 | 4 | 292 |
| Recebimentos | 31 | 0 | 137 |
| Alocações | 6 | 1 | 88 |
| Ajustes de saldo | 0 | 0 | 43 |
| Eventos de saldo | 73 | 4 | 589 |

O IPTV não apresentou vendas Fiado, recebimentos ou projeções de caixa de Fiado. Das quatro vendas registradas em outros espaços, três estão em VECONI QA e uma em Emprestar cartão. Não apareceu cliente com vendas abertas de Fiado em dois espaços explicitamente identificados. Esse último achado é limitado às vendas abertas com origem registrada, sem atribuir saldos residuais. Entre 137 pagamentos sem campo de origem, 57 têm um lançamento de caixa de Adi Festa com o mesmo identificador de origem. Os outros 80 não têm essa evidência. Entre 589 eventos sem campo de espaço, a primeira triagem encontrou 205 fontes diretas em Adi Festa, duas em outros espaços e 382 sem fonte com origem identificada. As 292 vendas sem espaço não têm vínculo inequívoco de origem com um evento de espaço identificado no cruzamento por venda, cliente, operação e geração.

A venda parcelada da Mãe de R$ 2.800,00 em dez vezes está gravada no espaço Emprestar cartão. A leitura pelo código da revisão publicada do Fiado V2 confirmou versão financeira 13, R$ 527,00 exigíveis, R$ 2.520,00 futuros e R$ 3.047,00 no total. A parte histórica de R$ 247,00 permanece sem origem de espaço no resultado da prova. A atribuição comercial informada pelo proprietário orienta a revisão, mas não muda o registro do servidor.

## Fluxo mantido na V229.1

Em Clientes, **Consultar conta original do Fiado** está disponível ao proprietário da empresa com sessão válida e permissão de consulta e recebimento. A busca seleciona um cadastro da empresa, inclusive cadastros sem vínculo no espaço ativo. A consulta por cliente é separada dos indicadores por espaço. Para Crediário, a prova do servidor é obrigatória, e o formulário separa exigível e futuras. Para Fiado tradicional, uma prova histórica incompleta não impede por si só o fluxo de recebimento da V228 e suas validações canônicas. A abertura do formulário é uma consulta, sem registro de pagamento.

Para confirmar, o operador indica expressamente onde o dinheiro entrou. O campo começa vazio e o recebimento usa exatamente o caixa escolhido dentre os espaços autorizados. O espaço ativo do app, a origem da venda e as parcelas existentes continuam como estavam. O formulário revalida acesso, versão, saldo e caixa e usa a operação idempotente existente. Quando a prova ou as vendas abertas disponíveis mostram dívida em mais de um espaço conhecido, a conta pode ser consultada e o pagamento conjunto fica indisponível neste fluxo de caixa único.

## Atribuição histórica proposta

1. Gerar um manifesto somente leitura por tipo e documento. Registrar empresa, geração, ID, versão ou `updateTime`, hash original, espaço proposto, fonte da prova, aprovador e motivo. Separar relações de venda, de dívida e de caixa.
2. Revalidar identidade, valores, status e cadeia de referências. Começar pelas origens deriváveis de fonte explícita ou caixa com ID confirmado. Nenhum vínculo de venda é inferido pelo caixa do pagamento, pelo espaço ativo ou pela declaração comercial. Os registros sem prova e os registros de outros espaços ficam em revisão individual. A venda da Mãe requer análise específica.
3. Se houver aprovação futura, gravar apenas uma atribuição auditável e reversível por documento, fora dos registros históricos. Usar chave idempotente e precondições para impedir que o manifesto seja aplicado sobre registros alterados. Preservar IDs, saldos, versões financeiras, parcelas, recibos, alocações, eventos e marcadores. A apuração por espaço deve ler essa atribuição explicitamente. A contenção retira a projeção da leitura e preserva a auditoria. Não reexecutar automações de caixa ou reescrever `spaceId`/`financialSpaceId` dos documentos financeiros, que participam do roteamento e da proteção contra projeções duplicadas.

## Contrato futuro de recebimento único em múltiplos espaços

O backend atual confirma a conta por cliente e empresa e aceita um único espaço financeiro no pagamento. O projetor cria a entrada integral nesse caixa. As alocações às obrigações não formam partições independentes de caixa por espaço. Por isso o contrato atual não basta para receber um Pix único e distribuir os resultados.

Uma evolução deve retornar, de uma única versão confirmada da conta, exigível, futuro e total por espaço, total consolidado e uma faixa explícita de origem pendente. O operador informa um Pix externo único, a conta bancária que de fato recebeu e a distribuição proposta. O servidor valida permissão para cada obrigação e caixa, fecha a soma em centavos, define ordem estável de alocação e registra pagamento mestre, subalocações, eventos por espaço e recibo único sob a mesma chave idempotente. Uma partição nunca pode contabilizar o Pix inteiro de novo. Se o dinheiro entrou em uma conta só, a contabilidade separa a entrada bancária da distribuição entre negócios por compensações explícitas, com relatório e reversão simétricos. Projeções repetidas, respostas perdidas, concorrência e tentativas com permissões diferentes devem convergir ao mesmo resultado confirmado.

Nada nesta etapa altera Functions, Rules, índices, atribuições históricas ou produção. A referência de produção permanece o frontend V228 `9a5b73cd535363d663269d031b96e1c743a97724`. O candidato permanece na branch `codex/v229-1-global-space`.
