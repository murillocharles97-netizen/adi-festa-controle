# V228 — carregamento do saldo exigível

Correção somente de frontend sobre e84de00c49707ad8e4e187eebb999950a17e422e.

## Causa e limites

A listagem chamava `InstallmentCredit.account`, mas não solicitava `refresh`. O cache de apurações existia somente na memória. Contas históricas V2 recusavam corretamente a projeção legada sem prova remota e permaneciam indefinidamente em “a conferir” após reinício. O mesmo caminho existe na V227; não foi identificada mudança financeira introduzida pela V228.

O perfil CRM usava saldo contábil na identificação do débito e seu contêiner `.crm-profile-scroll` não era alcançado por `mountCustomer`. A cobrança móvel e os recebimentos já consultavam a conta canônica, explicando valores diferentes entre caminhos. A cobrança desktop agora também consulta esse leitor antes de compor a mensagem.

A leitura `fiado_account` é por empresa e cliente. Não depende da seleção manual de espaço; o servidor continua verificando o acesso aos espaços das origens financeiras. Nenhuma alteração do SpaceService foi incorporada.

## Correção

- Consultar automaticamente a prova dos clientes históricos/parcelados exibidos; quatro leituras concorrentes no máximo, deduplicação e intervalo após falhas.
- Usar somente apuração remota válida para apresentação dessas contas, conferindo empresa, sessão, cliente, data comercial, versão e identidade contábil. Validade de apresentação de 60 segundos; consulta ao retomar/reconectar e atualização por eventos financeiros.
- Atualizar fragmentos financeiros dos cards, indicadores e detalhe sem substituir busca, formulários ou gestos. Exibir parcelas futuras separadas e sinalizar totais parciais quando houver contas ainda não comprovadas.
- Preservar “a conferir” para rede indisponível, prova insuficiente/contraditória e resposta de outra sessão.
- Nenhuma alteração de saldo, calendário, cálculo financeiro, filas, contratos, Functions ou Rules.

Service Worker candidato: `veconi-v228-fiado-balance-v1`. Publicação futura exclusivamente de frontend, com a proteção existente contra recarga insegura. Nenhum push/deploy nesta etapa.

## Validação

`tests/fiado-balance-display-v228.test.cjs`: montagem mobile/desktop, reinício de contexto, espaço automático/sem seleção manual, desconexão/reconexão, prova incompleta, validade do cache, sessão diferente, atualização parcial, resumo/indicadores, CRM real, perfil alternativo, recebimentos e composição do WhatsApp. Não envia WhatsApp nem grava recebimentos.

`tests/emulator/fiado-history-backend-v227.cjs`: cenário sintético histórico de 247 + venda de 2800 em dez parcelas, primeira exigível, demais futuras, recibo parcial, repetição idempotente e baixa única. Os outros cenários direcionados cobrem contratos V226/V227, concorrência, isolamento e contenção. A reprodução opcional de lote histórico depende de snapshot externo e não integra este hotfix.

Comparação de renderização isolada com os mesmos dados sintéticos: base e candidato em 390 e 1366 px. Base não inicia a consulta; candidato exibe 527 exigíveis, 2520 futuros e recupera após reconexão. Testes de navegador usam transporte sintético; contrato real é testado separadamente no Emulator.

A consulta real foi administrativa somente leitura, em snapshot transacional encerrado explicitamente, com o leitor comprovadamente idêntico à revisão publicada. Não representa teste de sessão do Android físico.

## Publicação e contenção

GO técnico para hotfix seletivo de frontend, condicionado à autorização específica e ao preflight de publicação. Sem necessidade de Functions, Rules ou reparação financeira. Referência anterior: e84de00c49707ad8e4e187eebb999950a17e422e. Eventual contenção exige avaliar operações pendentes e preservar o backend/ledgers; não limpar armazenamento nem reverter finanças. Homologação física após publicação: abrir Clientes sem entrar antes em cobrança, conferir card/detalhe, fechar e reabrir o PWA e reconectar, sem concluir recebimentos de teste na conta real.
