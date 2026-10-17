# Preservação de vendas retidas — implementação local, sem deploy

Base publicada: V179 / 1670a3c6445e3c3a2183075d0ed54707fa438374.
Nenhuma captura ou transmissão das quatro operações reais nesta implementação.

## Arquivos desta entrega

Novos:

- functions/src/services/sale-recovery-service.js
- js/sale-recovery-client.js
- js/sale-recovery-ui.js
- css/sale-recovery.css
- tests/sale-recovery.test.js
- tests/emulator/sale-recovery.rules.test.js
- tests/fixtures/retained-sale-recovery.cjs
- tests/fixtures/sale-recovery.html
- tests/fixtures/sale-recovery-browser.js
- scripts/serve-sale-recovery-qa.cjs
- docs/sale-recovery-review-local.md

Alterados:

- functions/src/index.js
- functions/src/services/workspace-reset-policy.js
- firestore.rules
- firestore.indexes.json
- js/firebase/sync.js (apenas os adaptadores de captura/contagem desta entrega)
- js/firebase/firebase-ui.js
- index.html
- service-worker.js (lista de assets; versão de release ainda não alterada)

## Funcionária / aparelho de origem

Após atualização e login normal, o painel existente mostra “Há X vendas aguardando
análise” quando há vendas próprias retidas por permission-denied ou pelo bloqueio
de revisão. Há um botão “Enviar dados para recuperação” e uma confirmação simples
“Confirmar envio”. São dois toques deliberados, sem arquivos, DevTools ou comandos.

O capturador lê somente as operações da sessão/empresa/geração e seus registros
locais relacionados. Copia o packet completo (incluindo writes/data/before), a venda
local e os movimentos locais relacionados. O pacote original fica JSON canônico,
com SHA-256 conferido no servidor. Não é logado. Datas/erros desconhecidos não são
inventados. Autoria/horário originais permanecem no pacote; o resumo tem metadados
de recebimento separados.

Não há escrita no armazenamento local, nem recibo no item original. O sucesso
aparece após confirmação de IDs/hash/status de revisão pelo servidor. Após reload,
as operações ainda ficam retidas e o usuário pode consultar “Ver situação do envio”.
Enviar novamente é seguro e idempotente. Não prometer que a fila ficará zerada.

Só há upload após confirmação. Sequência serial; duplo toque compartilha uma única
promessa. Resposta perdida preserva tudo e permite nova tentativa explícita.
Uma falha interrompe a sequência; pacotes já recebidos continuam na nuvem.

## Backend / Rules

Callables novas:

- submitSaleRecovery: único ponto de entrada; nunca executa os comandos do payload.
- listSaleRecoveryReviews: lista paginada (20) de resumos autorizados.
- getSaleRecoveryOriginal: consulta privada do original, exclusivamente pelo owner.

Índice preparado em firestore.indexes.json: saleRecoveryReviews por actorUid +
spaceId para a consulta restrita do vendedor. Nenhum índice foi publicado.

Reutiliza Auth, memberships, vínculos de financialSpaces e assertWritable para
restauração/geração. Usuário e membro precisam estar ativos. Vendedor/Caixa precisa
de sales.create, mas não precisa de Financeiro ou permissões administrativas.
Validação de perfil/membro/empresa/espaço ocorre dentro da transação de entrada.

Escritas exclusivas:

```
businesses/{businessId}/saleRecoveryReviews/{saleId}
businesses/{businessId}/saleRecoveryReviews/{saleId}/original/payload
businesses/{businessId}/saleRecoveryOperations/{operationId}
```

Criadas atomicamente, usando os IDs comerciais originais. Pacote idêntico devolve
o recibo anterior sem regravar o original. Hash/IDs divergentes não sobrescrevem.
Até três conteúdos conflitantes por revisão são preservados privadamente em
`conflicts/{hash}`; após o limite, o conteúdo recusado continua no aparelho, sem
overwrite ou descarte local. Conflito nunca é confirmado como envio aceito.

Limites iniciais: 500 KiB por pacote, 350 writes, 200 itens, até 20 operações por
envio. Exceder limite interrompe com mensagem segura; não há truncamento. O JSON
diagnóstico anterior não contém os payloads brutos, portanto não comprova o tamanho
nem a compatibilidade integral dos quatro reais antes da captura no aparelho.

Rules negam leitura/escrita direta de todas essas coleções, subdocumentos e conflitos,
inclusive ao owner. A leitura passa pelos callables. Vendedor vê apenas seus próprios
resumos no espaço autorizado, sem custos/payload bruto. Nesta V1, administração de
revisão está restrita ao owner real da empresa; nenhum papel admin/manager ganha
acesso adicional automaticamente. Owner consegue ler o original pelo callable privado.

Não existe trigger de recuperação. Os triggers comerciais continuam vinculados às
coleções comerciais anteriores. Não há escrita em sales, produtos, estoque, saldo,
Financeiro, metas ou atividade comercial. Novas coleções são classificadas como
operacionais no reset existente para não bloquear a auditoria de coleções futuras;
nenhum reset ou migração foi executado.

## Painel do owner

Entrada “Vendas aguardando revisão” no Início/Histórico existentes. Lista mostra
horário local de exibição, usuário original, espaço, itens/quantidades, valor,
pagamento, status e possíveis vendas semelhantes do gestor. Aviso permanente:

> Registro preservado para análise. Nenhum efeito comercial foi aplicado por esta recuperação.

Sugestões são apenas comparação de conjuntos de produto/variação/quantidade,
valor e pagamento, com horário apresentado lado a lado. Busca limitada a até 100
vendas do owner no mesmo espaço e dia UTC, usando índice spaceId/data já existente.
Ausência de sugestão NÃO descarta duplicidade; campos de data legados incompatíveis,
mais de 100 vendas e vendas em outro dia podem não aparecer como sugestões. Falha
na busca de sugestões não impede a lista de revisão. Não há decisão automática.

## Fora do escopo

Sem execução/cancelamento comercial, deduplicação, envio silencioso, Scheduler,
política empresarial global, limpeza de fila ou novo ID de venda. Uma revisão não
é adicionada ao array normal de vendas. Os efeitos locais antigos que já estavam
visíveis no aparelho não são reparados nem alterados por esta entrega.

Importante: a otimização de leituras paralelas de Fiado já existia como alteração
local de sync.js antes desta tarefa. Foi preservada, não criada por esta entrega,
e deve continuar separada de eventual release de recuperação.

## Verificação

Resultado final local: 24 testes unitários/direcionados + 23 testes no Firestore
Emulator aprovados, sem skips. Lint e build aprovados (377 arquivos JS);
git diff --check sem erros. Os logs de permission-denied nos testes negativos
de Rules são esperados. Não houve deploy, commit, captura real ou recuperação.

UI local conferida em 320, 360, 390, 430 e 1024 px sem overflow horizontal.
Teste de resposta perdida mostrou falha clara; nova tentativa confirmou quatro
revisões e os dados originais da fixture permaneceram inalterados. Capturas QA
foram guardadas fora do repositório público. Android físico não foi testado.

- Testes unitários de capturador/controlador/adapter, retenção V179 e diagnóstico.
- Firestore Emulator: quatro fixtures com 3/11/9/3 writes e onze movimentos, produtos
  compartilhados B/C, estoque remoto zero para A; somente coleções de revisão mudam.
- Duplicação, concorrência, resposta perdida, conflito com evidência imutável;
  autenticação, vínculo, geração, empresa, espaço e autoria; Rules negam acesso
  direto, vendedor só recebe os próprios resumos, owner recebe os da empresa.
- Snapshot antes/depois de coleções comerciais, Financeiro e metas sem mudanças.
- Navegador: fixture sem conexão externa, confirmação, sucesso, painel owner e
  responsividade. Não equivale a captura real nem a Android físico.

QA visual: `node scripts/serve-sale-recovery-qa.cjs` (porta local dinâmica).
Nenhuma operação ou conta real é usada pela fixture. Não publicar a fixture como
substituta do app. Versão/commit de release serão definidos somente com autorização.
