# V227 — compatibilidade com histórico financeiro confirmado

Base local: ec2016fcd3e18f91ab08ab7de8c998e4a6f19b07. Produção não modificada. Não foram alterados arquivos de Functions, modelos compartilhados usados pelas Functions, Rules, índices ou cobrança.

## Causa e solução de arquitetura

O ajuste tradicional atualiza saldo, versão e evento financeiro, mas não recompõe legacyBalanceRemaining nem redistribui seus efeitos pelas projeções das vendas antigas. Por isso, saldo agregado e ledger podem estar corretos, enquanto as projeções legadas não atendem ao invariante exigido pelo Crediário. O campo legado não é indispensável para provar o total: uma origem zero ou quitação zero confirmada, seguida de documentos, eventos e marcadores consistentes, pode prová-lo. Somente somar movimentos ou subtrair parcelas futuras de um saldo sem essa prova não é suficiente.

O núcleo local `scripts/lib/fiado-history-proof.cjs` apura sem escrever. Exige consulta completa/estável, escopo de empresa/geração, origens e eventos compatíveis, marcadores processed, cadeia anterior/posterior contínua e igualdade ao saldo atual. Não inventa saldo de abertura de importação. Bloqueia alias de operação sem prova, origem faltante/não confirmada, mudança concorrente, valores sem centavos, efeitos desconhecidos ou cadeia divergente. Uma quitação zero confirmada pode delimitar um histórico anterior, sem reescrevê-lo. Datas de aplicação ordenam a prova; vencimentos classificam o exigível/futuro.

Para parcelas, exige calendário canônico, principal consistente e alocação comprovada por recebimentos aplicados. Futuras são separadas antes de apurar o exigível; pagamento parcial/antecipado não cria outro saldo. O núcleo não grava, não chama APIs, não autoriza vendas e não foi incorporado ao frontend publicado. Ele é a implementação local verificável da prova e da classificação, não uma alteração disfarçada de backend.

## Limite do backend vigente

`loadFiadoAccount` continua chamando o projetor estrito. O leitor retorna null para conta sem parcelas e passa a exigir a projeção ao existir a primeira parcela. O commit de recebimento usa a mesma apuração. A validação da venda também impede reescrever o legado existente. Logo, trocar somente a mensagem da prévia ou ignorar o campo no navegador permitiria uma venda sem recebimento compatível. O teste Emulator reproduz esse bloqueio mesmo com histórico agregado inteiramente comprovado.

Há ainda risco na primeira venda: quando legacyBalance não existe, o fluxo vigente inicializa o legado pelo saldo total, incluindo vendas já rastreadas. A correção de inicialização do recebimento presente em ec2016f reconhece vendas applied, mas não muda essa regra da venda nem o contrato do servidor. Alterá-la apenas no navegador produziria um envelope rejeitado pelo backend.

A solução definitiva proposta é a apuração servidora do histórico confirmado com saldo agregado histórico auditável, separado dos calendários V227 e das novas alocações. Deve produzir a mesma base na leitura e na validação dos recebimentos, manter o legado antigo inalterado quando não for fonte confiável, preservar payloads/idempotência antigos e negar apuração incompleta. Essa integração necessita autorização para mudar o backend; não foi feita neste escopo, que proíbe alterar Functions.

## Proteção frontend local

Em `js/vendas.js`, antes de qualquer criação, fila ou estoque, novas vendas parceladas passam pelo projetor vigente e pela simulação da inicialização de legado que o backend atual espera. Calendário incompleto, histórico inconsistente, crédito positivo ou modelo indisponível bloqueiam a nova venda. Não há fallback de reparação. Repetições de operações existentes continuam pelo caminho idempotente anterior. Vendas Fiado tradicionais e vendas retroativas não entram nesta nova condição, exclusiva de installmentTerms.

Essa proteção reduz risco; não é liberação de contas históricas. Não há alteração de saldos, campos legados gravados ou recebimentos antigos. A prévia publicada permanece protegida; não foi criada uma prévia aparentemente liberada quando o servidor continuaria rejeitando o recebimento.

## Triagem somente leitura

Snapshot completo e estável de 158 contas da Adi Festa: 584 vendas, 167 recebimentos, 92 alocações, 42 ajustes, 662 eventos e 2.072 marcadores. O projetor vigente mantém 107 passes e 51 bloqueios. Nos 51:

| Causa inicial | Contas | Saldo agregado comprovado | Prova ainda insuficiente |
|---|---:|---:|---:|
| Legado remanescente divergente | 6 | 3 | 3 |
| Vendas/alocações rastreadas superiores à dívida agregada | 43 | 33 | 10 |
| Valores históricos incompatíveis com centavos estritos | 2 | 1 | 1 |
| Total | 51 | 37 | 14 |

Os 14 restantes apresentam quatro cadeias interrompidas e dez casos com evidências insuficientes/conflitantes, incluindo origem não confirmada, alias, efeito não suportado ou precisão não comprovada. Isso não autoriza declarar que os saldos estão errados. Uma conta do grupo de precisão possui prova posterior a uma quitação zero; não foi arredondado seu contrato antigo.

Nenhum dos 51 ganha elegibilidade segura para operação comercial com o frontend e backend vigentes. A simulação de primeira parcela detecta mais 11 riscos entre os 107 passes do projetor. Das 158, 58 têm prova agregada completa pelo critério conservador; 15 também são compatíveis com a primeira parcela e o backend atual. Os 15 não incluem contas QA e são apenas candidatos para homologação física individual, não autorização comercial automática. Contas sem âncora comprovada não foram tratadas como dívida errada.

Na conta do cenário, a prova retorna 247 exigíveis, zero futuro e 247 total, mantendo legado gravado 22. Uma futura venda de 20 com vencimentos futuros teria projeção econômica 247/20/267. O backend vigente não aceita essa base para os recebimentos enquanto permanecer dependente da projeção antiga. Não foi alterado o campo 22.

## Validação e decisão

85 testes direcionados aprovados; 27 cenários Auth/Firestore Emulator aprovados. Cobrem a prova do cenário equivalente de 247, ajustes, recebimentos, applied, cadeia verdadeira divergente, históricos incompletos, calendário, futuras/vencidas, pagamento parcial/antecipado, permissões, concorrência, resposta perdida, estoque único e bloqueio inerte antes de qualquer escrita. Build e diff-check aprovados.

As nove falhas herdadas foram reexecutadas, mantendo os mesmos resultados: cinco fixtures sem document, três extrações de sync sem readOperationalDocument e uma asserção de reversão no antigo caminho do navegador. O novo guard é exclusivo de installmentTerms; não foi relaxado para satisfazer essas fixtures. Testes DOM/domínio e Emulator atuais cobrem os caminhos afetados. Uma suíte adicional de integração V225/V226 apresentou três asserções antigas de hashes/arquivos/metadados V226, incompatíveis com o histórico V227; não se alteraram esses pinos históricos.

NO-GO para publicar como correção definitiva/liberação do histórico. GO para revisão local deste núcleo de prova e da proteção. Liberação dos 37 comprovados sem reparação de dados exige compatibilidade autorizada no backend. Para os 14 restantes, cada caso exige evidência individual; nenhuma proposta numérica foi inventada. Para três legados divergentes com prova suficiente, propostas individuais preservando saldo foram geradas somente em evidência privada, sem executar manutenção.

Nenhum push, deploy, migração, reparação ou acesso à fila Android. A operação rejeitada permanece intocada. O hotfix isolado do SpaceService não foi incorporado.
