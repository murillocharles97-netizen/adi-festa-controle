# V229.1 · desempenho da tela Clientes

## Causa

A V228 hidratava automaticamente o Fiado histórico e parcelado dos cartões montados. Para Fiado tradicional na visão da empresa, usava o saldo contábil local. A V229.1 manteve o mesmo hidratador e passou a considerar qualquer saldo não zerado elegível quando o contexto de Clientes é por espaço. O hidratador processava os cartões em até quatro requisições concorrentes. Cada onda de respostas podia renderizar a lista inteira em um elemento temporário para extrair totais e contadores. Mais cartões, expiração da prova, sincronização e reconexão podiam disparar novas consultas. A prova durava 60 segundos e vivia em memória. Uma recarga descartava o progresso.

A leitura individual autentica o contexto e carrega cliente, vendas e, quando há parcelamento, alocações. Para prova V2, o leitor percorre 13 consultas de origem em vendas, pagamentos, ajustes, eventos e alocações, além de marcadores de operação e verificações de espaço. O custo em leituras de documentos depende do histórico de cada conta. Não há contrato publicado de total canônico do Fiado por espaço. O saldo contábil da empresa também inclui principal ainda não vencido e registros legados sem origem comprovada. O relatório anterior da empresa, portanto, não fornece o total exigível de Adi Festa.

## Hotfix local

- A listagem por espaço não solicita provas financeiras na abertura, na rolagem, na troca de espaço, nem após recarga ou reconexão. Os cartões podem solicitar uma conta por vez pela ação Consultar saldo. O detalhe e as ações financeiras mantêm as validações e a autorização existentes.
- O cabeçalho por espaço informa que o total está indisponível. Contas consultadas não alimentam um total parcial. Os filtros financeiros usam somente saldos verificáveis e a interface indica essa cobertura.
- Na visão de um único espaço, o comportamento de consulta da V228 é preservado. O resumo explicita o universo de cadastros carregados e omite valores quando houver conta a conferir.
- A resposta autenticada continua limitada à empresa, à geração do workspace, à sessão, ao espaço, ao cliente, à data comercial e à versão financeira. As provas ficam em memória, por até 60 segundos, e consultas idênticas em trânsito compartilham a mesma requisição. Eventos locais com cliente identificado retiram somente a prova afetada. Atualizações remotas sem identidade financeira suficiente invalidam conservadoramente as provas, sem lançar outra varredura.
- A conta original do Fiado continua disponível ao proprietário, com escolha explícita do caixa. A consulta individual mantém parcelas futuras separadas e não atribui origens legadas nem combina dívidas de espaços diferentes.

## Proposta para total canônico por espaço

Materializar uma projeção **derivada**, separada da dívida e dos documentos originais. A unidade de apuração é a entrada de dívida com origem comprovada. A chave inclui empresa, geração, espaço e cliente. Entradas sem prova de origem ficam em categoria separada e marcam a cobertura como incompleta. A API devolve data comercial, versão da projeção e status de cobertura. Pode devolver os totais completos apenas para a cobertura que foi comprovada e deve sinalizar atraso ou origem ausente.

Consumir eventos financeiros confirmados com o identificador da operação e a versão financeira do cliente. Aplicar cada delta uma vez, junto a um marcador de projeção. Usar faixas de vencimento para separar exigível e futuro, com avanço idempotente na data comercial. Alocações e estornos alteram as faixas originais. A leitura de resumo deve consultar um documento agregado por espaço e a listagem deve paginar a projeção por cliente. Ambos os leitores precisam revalidar empresa, geração e espaço autorizado.

Antes de ativar, popular a projeção em paralelo ao leitor vigente e comparar amostras e somatórios com a prova V2. Registrar lacunas, versões e origens não confirmadas. Expor os totais apenas quando a reconciliação e a cobertura estiverem verificadas. A contenção desabilita a leitura da projeção e retorna à consulta individual, preservando operações comerciais e registros canônicos. Essa implementação e a carga histórica exigem autorização separada.
