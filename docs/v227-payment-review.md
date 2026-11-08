# V227 — recebimento rejeitado e dependências da fila

Preparado localmente em `codex/v227-rejected-receipt-review`, sobre
`9e5d3689ba0d60590553aabed69376a9907f6d6a`. Sem push, deploy ou recuperação real.

## Evidência remota e limite do diagnóstico

Leitura em 08/11/2026 01:22:09 UTC (07/11, Brasília), empresa `adi-festa`, operação
`d0611a1a-cd01-4a8a-821d-0bebc8a5207c`:

- Não encontrados pagamento pelo ID, marcador `processedOperations` pelo ID,
  eventos `payment_received:ID` / `credit_payment:ID`, nem auditoria pelo mesmo ID.
- Zero resultados nas consultas por operação em pagamentos, marcadores, eventos
  e alocações; também por `payments.id`, `balanceEvents.sourceDocumentId` e
  `paymentAllocations.paymentId` iguais ao ID conhecido.
- O comprovante canônico depende de pagamento + marcador + evento financeiro;
  não há confirmação de recebimento nos caminhos consultados.
- Functions ACTIVE: `getoperationalsyncreceipt-00006-pov` e
  `commitoperationalsync-00010-get`; frontend publicado `b197da1`.
- O envelope completo original não foi encontrado no servidor. Cliente, valor,
  data, versão, ID efetivo do pagamento, `legacyAmount`, writes, before e
  alocações originais continuam necessários. Ausência pelas referências
  conhecidas não prova ausência sob identificadores diferentes.

Evidência externa ao pacote público:
`C:/Users/Murillo/.codex/visualizations/2026/11/07/adi-receipt-review/REMOTE.json`.
Nenhum dado financeiro foi escrito nessa investigação.

## Causas comprovadas e hipótese financeira aberta

O validador lança a mensagem observada quando `legacyAmount` do recebimento
difere da parcela histórica calculada no servidor. Em modo histórico V2, essa
parcela vem das linhas comprovadas; no contrato tradicional, da projeção legada
ou da decomposição do saldo e das vendas abertas. A existência dessa mensagem
não comprova regressão da V227: a validação já existia anteriormente.

O backend atual bloqueia deliberadamente o reenvio comum de uma rejeição
permanente. Ter o V2 publicado não transforma automaticamente o envelope V226
em uma operação autorizada para reprocessamento.

Sem o original não é possível decidir se a diferença real é projeção obsoleta,
formato antigo, versão financeira desatualizada ou alocação monetária incorreta.
Nenhuma dessas hipóteses foi assumida como causa comprovada do caso real.

Dois defeitos operacionais foram reproduzidos no código da fila:

1. A dependência considerava qualquer referência ao cliente, bloqueando também
   vendas pagas que só alteram contadores comerciais.
2. A retenção de recebimento não tinha classificação/painel próprios de revisão;
   o erro continuava ativo e o aplicativo não oferecia exportação móvel do
   envelope nem conferência explícita segura.

## Alteração mínima do fluxo

| Operação | Comportamento do candidato |
|---|---|
| Original rejeitado | Imutável; sem reenvio pela sincronização automática ou manual |
| Novo recebimento/ajuste/Fiado/Parcelado do mesmo cliente | Retido por dependência financeira enquanto o original não for comprovado |
| Venda paga Pix, dinheiro ou cartão do mesmo cliente | Permitida se não alterar dívida, mantendo as demais autorizações |
| Venda ou recebimento de outro cliente | Independente; mantém as validações existentes |
| Cliente com saldo zero | Recuperação não cria crédito nem recebimento substituto |
| Prova ausente, contraditória ou saldo/versão alterados | Original permanece em revisão, sem correção monetária automática |

O cliente real afetado só poderá ser identificado inequivocamente pelo envelope.
Não foi feita uma triagem geral de contas. O frontend publicado continua com
o comportamento anterior até uma publicação autorizada deste candidato.

### Compatibilidade e confirmação explícita

O canal comum continua bloqueando rejeições permanentes. Foram preparados
comandos separados nas duas Functions existentes:

- Leitor: `payment_recovery_status`, sem escrita, verificando empresa, geração,
  autor, hash original, pagamento, marcador, evento, reversões e alocações.
- Validador: `payment_recovery_review`, executando as validações existentes com
  zero writes, retornando hash da revisão e fatos financeiros.
- Aplicação: `payment_recovery_apply`, somente com confirmação explícita e hash
  atual da revisão. Revalida tudo na transação e grava recebimento, efeitos,
  marcador e auditoria determinística `payment_recovery_OPERATION_ID` juntos.

Antes desses comandos, o frontend exige capacidades novas de **ambas** as
Functions. Assim, um backend antigo não pode interpretar uma conferência como
commit comum. Sem ambas, apenas a exportação local permanece disponível.

A adaptação aceita exclusivamente fatos monetários já comprovados: mesmo ID,
cliente, valor, data, saldo/versão esperados e alocações. Pode acrescentar linhas
canônicas de calendário e versão técnica; em V2 preserva as projeções legadas
registradas. Não corrige `legacyAmount` ou alocações monetárias por suposição.
A apuração usa a data comercial original, não antecipa parcelas futuras.

O marcador mantém o SHA-256 canônico do payload **original**, inclusive após a
adaptação técnica, para preservar idempotência. A auditoria registra também o
hash efetivo, revisão, autor, fatos financeiros e mudanças técnicas. Nenhum
estoque é alterado pela recuperação de um recebimento.

Depois da aplicação, uma leitura independente confirma os efeitos. Somente
então o aplicativo registra metadados separados de confirmação e permite
atualização local a partir do servidor. O pacote e seu erro original permanecem
na fila, sem exclusão ou arquivamento. Se a resposta se perder, consulta-se o
servidor; não há segunda aplicação automática. Falha da leitura deixa o caso
sem confirmação até nova conferência explícita.

### Exportação sem USB ou computador

Após publicação e atualização autorizadas:

1. No próprio Android/PWA, abrir **Sincronização → Ver detalhes → Recebimentos
   preservados → Exportar ou conferir original**.
2. **Exportar dados financeiros** salva JSON local com before, writes relevantes
   e SHA-256 canônico do payload; omite nomes, contatos e observações.
3. Se necessário ao suporte autorizado, **Exportar original privado** exige
   confirmação e inclui o envelope exato desserializado, com hash adicional.
   Pode conter dados pessoais; não é enviado automaticamente. Detecção de
   credenciais ou segredos bloqueia a exportação.
4. A extração abre IndexedDB somente em `readonly`, fecha o banco, consulta
   somente a fila da sessão/empresa/autor/geração e compara cópias persistidas.
   Divergências interrompem o procedimento. `peekItem` evita a importação
   preguiçosa do armazenamento legado durante a exportação. Não chama flush,
   sync, limpeza, migração ou APIs de gravação do servidor para exportar.
5. Comparar o original com a confirmação remota e a prova contábil. Não registrar
   substituto, alterar projeções ou concluir recuperação por ausência de um ID.
6. Somente após autorização financeira específica e prova suficiente, conferir
   servidor, revisar os fatos e confirmar explicitamente o original. Verificar
   marcador, evento, alocações, auditoria e saldo depois. Se houver divergência,
   preservar e encaminhar para análise individual.

Esta implementação não executou esses passos no Android real. O aparelho não
foi acessado e a operação real não foi exportada nem reenviada.

## Testes e evidências

- **183 testes locais aprovados**, cobrindo fila, isolamento por sessão,
  dependência financeira, exportação sem PII, segredo bloqueado, leitura IDB,
  backend antigo, conexão indisponível, resposta perdida, preservação e
  resoluções anteriores. DOM do painel exercitado em 390 e 1366 px, incluindo
  cancelamento da confirmação; isso não substitui homologação física/layout.
- **27 testes de Emulator aprovados; 1 dispensado**: triagem ampla de 158 contas
  já auditada, não necessária para esta correção. Incluem V226 tradicional,
  histórico comprovado de R$247 preservando R$22 de legado, parcial/antecipação,
  calendários V227, prova insuficiente, concorrência/idempotência, versão
  desatualizada, autor/empresa/espaço, proprietário e funcionário, resposta
  perdida, saldo zero, vendas pagas independentes e estoque uma única vez.
- **6 testes de Emulator da recuperação repetidos e aprovados** após as últimas
  proteções de valor e data. Não somar esses seis como cenários únicos novos.
- Build/sintaxe validado; empacotamento público local aprovado com **258 arquivos**.
  `git diff --check` aprovado. Sem testes financeiros em produção.
- Logs em `C:/Users/Murillo/.codex/visualizations/2026/11/07/adi-receipt-review/`:
  `regressions-all-final.log`, `emulator-final.log`, `emulator-final-guards.log` e
  `build-final.log`.

## Publicação e contenção propostas — não executadas

GO técnico para novo preflight e publicação controlada da correção. Ordem
proposta: leitor `getOperationalSyncReceipt`, smoke somente leitura; validador
`commitOperationalSync`, smoke sem recebimento real; depois frontend. Somente
essas duas Functions e os recursos frontend modificados são necessários.
Rules, índices, cobrança, assinaturas e SpaceService não foram alterados.

Pré-condições: conferir revisões/produção e Git/Linux novamente, empacotar
exatamente o commit aprovado, testar disponibilidade das duas capacidades,
validar atualização Android sem perda de fila. O SW preparado é
`veconi-v227-payment-review-v1`; tags de scripts modificados usam `2273`.
A estratégia existente de atualização exige ação do usuário e flush local
antes de atualizar; não foi introduzida limpeza de IndexedDB/filas ou recarga
forçada. O pacote de teste local não é um manifesto de deploy aprovado.

A base local já contém os guards de `3cf2fee` e o reconhecimento de vendas
`applied` de `ec2016f`. Eles também diferem do frontend publicado `b197da1`.
Portanto, o próximo preflight deve comparar o candidato completo com `b197da1`,
não somente este novo commit com seu pai. A integração integral da interface
histórica V2 do Crediário continua sendo uma etapa distinta; este painel de
recuperação não libera por si só as contas históricas na prévia do Parcelado.

Contenção: frontend anterior desabilita o novo painel; backend base `9e5d368`
mantém leitura V2 e recibos originais com o hash original. Antes de qualquer
rollback, avaliar pagamentos/auditorias já confirmados e compatibilidade do
frontend; nunca apagar auditorias ou efeitos. Se apenas uma Function for
atualizada, o frontend bloqueia a recuperação pela negociação de capacidades.

**NO-GO para recuperar o recebimento real neste momento**: faltam envelope e
comprovação individual; não houve autorização para executar recuperação aqui.
**NO-GO para afirmar liberação comercial global do Crediário** a partir deste
teste. A homologação física Android/PWA e a publicação continuam pendentes.
