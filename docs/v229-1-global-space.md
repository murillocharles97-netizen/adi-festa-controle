# V229.1 — Contexto global de espaços

Início e Vendas mantinham escolhas independentes no `SpaceContext`. O Financeiro já usava os mesmos documentos `financialSpaces` para metadados e guardava seu próprio contexto de contas. Produtos já tinha os modos de disponibilidade por espaço. Clientes era um diretório por empresa e a consulta `fiado_account` devolvia a conta inteira do cliente.

A V229.1 reaproveita a preferência persistida de Vendas como única escolha operacional. Início, Clientes, Produtos e Vendas compartilham a seleção e suas opções autorizadas. A chave é isolada por usuário e empresa. Cada sessão revalida a preferência com espaços ativos, geração e acesso atuais. Um único espaço não apresenta controle de troca. `all_spaces` continua reservado e não é uma escolha global.

A troca invalida as projeções da tela e as leituras em trânsito. Voltar de B para A não aceita uma resposta iniciada na visita anterior a A. Um carrinho aberto bloqueia a troca voluntária até o atendimento ser encerrado. O contexto original de operações já enfileiradas permanece intacto.

Clientes segue com cadastro único. A tela usa referências explícitas do cadastro, vendas válidas e vigências com origem identificada. Um cliente pode aparecer em vários espaços sem cópia. O proprietário tem uma seção de cadastros cujo vínculo ainda não pôde ser confirmado pelos dados disponíveis. Em Vendas, o diretório da empresa continua sujeito às permissões existentes e permite usar um cadastro já existente em um novo espaço.

O saldo Fiado continua sendo uma conta da empresa. Na tela por espaço, o valor e o recebimento só são liberados quando a prova do servidor atribui integralmente a dívida ao espaço ativo. Contas mistas ou com origem desconhecida ficam sinalizadas. O proprietário pode consultar a conta original em um fluxo separado, com escolha explícita do caixa de recebimento. Consulte [Origem do Fiado e compatibilidade](v229-1-fiado-origem.md). Nenhum valor é repartido a partir de vendas ou de projeções legadas. A apuração por espaço depende dos vínculos que o operador tem autorização para ler. Uma vigência de outro espaço não pode ser reaproveitada na renovação pelo caixa.

Produtos filtra pela disponibilidade existente e mantém o formulário de cadastro. O estoque continua seguindo o contrato do produto, inclusive quando o cadastro é compartilhado. Financeiro mantém seu seletor e as contas de cada espaço. Relatórios, histórico geral e administração mantêm seus contratos próprios.

A mudança é de frontend. O candidato usa o Service Worker `veconi-v229-1-global-space-v2`. A referência anterior é `9a5b73cd535363d663269d031b96e1c743a97724`. Nenhum deploy, migração ou ajuste de dados foi executado. A homologação em PWA Android físico fica para a publicação controlada.
