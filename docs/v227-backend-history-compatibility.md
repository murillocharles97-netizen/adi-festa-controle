# V227 — backend com compatibilidade histórica comprovada

Base local `3cf2fee7dcdffc9e6b73c40c91cda1aded717759`. Implementação e testes locais; não há autorização de deploy, push, escrita comercial ou reparação administrativa.

## Modelo e causas resolvidas

O núcleo de prova foi transferido para `functions/src/shared/fiado-history-proof.js`; o script de auditoria usa a mesma implementação. O servidor lê as origens, eventos, alocações e marcadores em uma transação, por empresa/cliente/geração, com consultas completas limitadas e deduplicadas por documento. Marcadores são lidos em lotes, sem consulta global de empresas ou clientes. Falta de prova, aliases contraditórios, origem/evento incompatível, geração ou empresa diferente, precisão não comprovada e cadeia interrompida mantêm o bloqueio. Nenhum parâmetro do navegador é aceito como prova.

`fiado-history-account.js` recompõe as obrigações históricas a partir da cadeia confirmada, delimitada por uma origem zero ou quitação zero comprovada. Créditos e recebimentos consomem essas obrigações por ordem determinística; calendários contratuais e seus recebimentos comprovados ficam separados. Vendas Fiado `applied` são aceitas. O saldo final tem de coincidir com o cliente. O campo legado não é usado para inventar dívida ou fechar uma diferença.

O modo histórico retorna conta versão 2 e linhas auditáveis com `historyEventId`, sem reescrever pagamentos, ajustes, alocações ou projeções antigas. O registro de cada novo recebimento continua no ledger e no marcador idempotente existentes. Parcelas futuras não entram no exigível; recebimento antecipado exige intenção explícita. A rotina não aplica juros/multa nem cria cobranças Pix/Mercado Pago.

Uma baixa de recebimento podia enriquecer a venda com `operationId=docId` ou com a identidade do recebedor, rompendo a ligação com o evento original. O validador agora conserva a identidade, autoria e aplicação financeira originais na venda, reconhecendo apenas os envelopes automáticos conhecidos. O recebimento tem sua própria autoria e operação. Não há reparação retroativa de vendas já divergentes.

## Primeira parcela e campos ausentes

Os 11 casos de primeira parcela foram reproduzidos. A inicialização anterior copiava o saldo integral para o legado, incluindo vendas já rastreadas. Durante uma NOVA venda, o servidor inicializa somente campos que ainda não existem, pelo residual canônico anterior ao contrato. Campos legados já registrados são preservados. No modo histórico, não se fabricam projeções legadas ausentes para forçar a decomposição antiga.

Os valores canônicos inicializados são enviados ao documento do cliente para que a confirmação remota sobrescreva os defaults temporários mantidos no cache antigo. Apenas omitir esses campos no servidor seria insuficiente: o merge do V226/V227 preservaria o default local errado. Não há migração de clientes ou varredura para escrever campos.

## Contrato e coexistência

Contas compatíveis continuam no contrato anterior. Fiado tradicional V226, vendas atuais e retroativas preservam suas rotas, autorizações e marcador idempotente. Novas contas com crédito positivo exigem revisão específica antes de parcelar.

Para usar a compatibilidade histórica, o cliente precisa declarar `item.payload.fiadoHistoryVersion=1`, `clientRelease>=227` e `fiadoSchedule.version=2` nos novos recebimentos. O servidor exige versão financeira atual, valor exato, Pix externo/dinheiro e igualdade das linhas enviadas com a alocação recalculada no servidor. Alterar tipo ou apagar a versão histórica de uma conta pelo envelope não é permitido. A ativação é registrada pelo servidor no mesmo commit de uma nova venda/recebimento autorizado, sem mudar o legado existente.

V226 em cache não é convertido silenciosamente. Ao tentar receber/alterar uma conta histórica ativada sem capacidade compatível, recebe `failed-precondition` com orientação de atualização e preservação da operação. Recibos já processados são reconhecidos antes da nova apuração; resposta perdida não reaplica dinheiro. Recebimentos/parcelamentos com rejeição permanente informada permanecem para revisão explícita. Falhas transitórias mantêm o caminho idempotente original. O recebimento antigo da Adi Festa não é modificado ou reenviado por esse mecanismo.

O leitor e o committer têm handshakes somente leitura: `fiadoHistoryReadVersion=1` e `fiadoHistoryWriteVersion=1`. O frontend futuro deve conferir AMBOS. O handshake do leitor isoladamente não comprova que o committer já foi atualizado. O committer também informa `historyActivationEnabled` e `newInstallmentsEnabled`; a consulta não cria marcador ou sinal de sincronização.

O frontend publicado ainda não usa o contrato histórico versão 2. Sua operação anterior é preservada. As 37 novas elegibilidades financeiras exigem frontend adaptado, autorização de publicação e homologação Android/PWA próprias antes de uso comercial. Este candidato não publica nem ativa essa interface.

## Isolamento e permissões

Permanecem os vínculos ativos, assinatura com acesso de escrita, geração, permissões de clientes/venda/recebimento e escopo de espaços. Histórico sem espaço continua exigindo proprietário; funcionário só consulta/recebe com os direitos e espaços existentes. Contextos restritivos V3 são negados, sem ativação ou ampliação de permissões. Ajustes em conta histórica não podem consumir principal de parcelas futuras. Cancelamentos admitidos mantêm a prova de reversão e a devolução de estoque única; venda histórica já recebida exige revisão individual.

## Validação e elegibilidade

- 149 testes locais dirigidos e de contenção aprovados.
- 66 cenários Emulator aprovados, incluindo réplicas das 37 contas com nova parcela e leitura posterior, rejeição de leitura e gravação das 14 insuficientes, 107 contas inicialmente consistentes e os 11 casos de inicialização. Reexecução final dirigida cobre a proteção contra rejeições permanentes e replay de operação realmente processada.
- Casos 247 exigíveis / 20 futuros / 267 total; 330 → 230 → 510; parcial, antecipação, calendário mensal, datas comerciais, concorrência, resposta perdida, FIFO entre dívida histórica e parcelas, recibos, financeiro, isolamento, funcionários, V3 e estoque único.
- Vendas retroativas V226 foram exercitadas no Emulator, inclusive datas, estoque, confirmação concorrente, métricas e negações de acesso.
- Build de 649 JS, lint Functions e diff-check aprovados.

Elegibilidade financeira sob o contrato compatível: 144/158 contas, compostas pelos 107 casos consistentes e 37 casos históricos comprovados. As 14 com prova insuficiente continuam bloqueadas. Os 11 riscos da primeira parcela foram resolvidos sem dupla dívida. A contagem inclui as sete fixtures QA já existentes; não equivale a autorização comercial ou a validação de todos os aparelhos/escopos reais. Não houve escrita de testes em produção.

As nove falhas herdadas já identificadas nas fixtures/asserções antigas não foram mascaradas. Uma execução adicional do verificador V201 encontrou quatro pinos/proveniências antigos que também não pertencem ao conjunto atual de release; os arquivos gerados de aritmética/engajamento não foram regenerados ou modificados para satisfazê-los. Os testes atuais de contenção e os fluxos reais no Emulator passaram. Resultados e limitações ficam no relatório de evidências, sem afirmar que toda a suíte histórica está verde.

## Manifesto e sequência seletiva

Functions a atualizar: exclusivamente `getOperationalSyncReceipt` e `commitOperationalSync`. Não há Function nova, agendamento, índice, Rules, Storage Rules, alteração de plano ou recurso de cobrança. `functions/src/index.js`, bindings e configuração de deploy não são alterados. `payment-confirmation-read.js` é dependência do leitor existente. `commitPriorSale` não requer publicação nesta etapa: sua construção de venda anterior não depende das novas projeções e foi revalidada.

1. Sob autorização futura, preflight imediato: revisions ACTIVE, Rules aprovadas, configurações, source hashes, assinatura/extensão preservadas e ausência de mudanças inesperadas. Usar pacote imutável extraído do commit; não publicar diretório de trabalho sujo.
2. Publicar apenas `functions:getOperationalSyncReceipt`. Conferir ACTIVE, hash/configurações e leituras autenticadas sem escrita. Não ativar cliente histórico nesta janela.
3. Publicar apenas `functions:commitOperationalSync`. Conferir ACTIVE e handshake de escrita por autenticação, sem registrar venda/pagamento real.
4. Verificar os dois handshakes, compatibilidade legada, logs e configurações. Só então preparar frontend compatível em etapa autorizada separada; depois QA físico e autorização comercial.

Comandos seletivos previstos: `firebase deploy --project adi-festa-controle --only functions:getOperationalSyncReceipt`, seguido de `firebase deploy --project adi-festa-controle --only functions:commitOperationalSync`. Não executar deploy genérico nem push em main, que poderia disparar o workflow de frontend. O candidato herda alterações locais de frontend ainda não publicadas.

Interromper por divergência de commit/pacote/revisão/Rules/configuração, acesso fora do escopo, perda de compatibilidade V226, saldo não comprovado, duplicidade ou regressão crítica. Não adaptar fila, apagar cache ou executar reparação como parte da publicação.

## Contenção

Antes de ativar histórico, avaliar o estado real antes de qualquer retorno de revisão. Depois de existir conta/recebimento histórico v2, NÃO voltar ao backend antigo que depende do legado.

O candidato de contenção preserva os mesmos leitores/validadores e altera somente `INSTALLMENT_CREATION_ENABLED=false` e `HISTORY_ACTIVATION_ENABLED=false`. Pausa novos parcelamentos e novas ativações, mantendo leitura e recebimentos das contas já ativadas e replay idempotente. O Emulator comprova que a contenção não apaga dívidas ou recebimentos. Aplicar apenas ao committer após avaliação; não há rollback automático.

GO técnico para preparar publicação seletiva do backend, condicionado ao preflight imediato e à autorização específica. NO-GO para liberar uso comercial histórico no frontend atual. Nenhuma das três propostas administrativas foi executada; não houve push, deploy, migração, limpeza local ou alteração da 3 Lindas/SpaceService.
