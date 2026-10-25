# V204 — atualização de leitura entre vendedor e gestor

Base sanitizada: V203 `66cf5723aaaaa6a31ecef9b91982aa50c0285763`, descendente da V199 sanitizada `3265f375a6bcd6276e202646725ce63e06a8d20c`. Pacote local; publicação depende de nova autorização. Nenhuma alteração de Rules, índices, permissões, UX, capturas comerciais, protocolos de escrita ou dados reais.

## Correção delimitada

- `commitOperationalSync` passa a publicar identidade e revisão explícitas do servidor/operação (`server:{operationId}`), no mesmo commit autorizado, sem colisão entre operações executadas no mesmo milissegundo. O merge não pode herdar a identidade de outra sessão. O corpo comercial, validações, idempotência e recibos são idênticos à V203.
- O receptor não considera `sourceSessionId` uma prova de leitura. Só confirma uma revisão depois do download e da persistência durável. Publicar um sinal também não confirma que os dados foram lidos.
- Escopo de leitura inclui geração da sessão, UID do Sync e do Auth, empresa, geração do workspace, ACL/permissões e espaços atuais. Validação de perfil, hidratação, callbacks, projeção de clientes e conclusões dos coordenadores auto/manual não podem escrever ou confirmar a sessão seguinte. Promessas antigas não liberam a coordenação da sessão nova.
- Falha de leitura preserva a invalidação separadamente da fila comercial. Máximo de quatro novas tentativas: 1, 3, 10 e 30 segundos. Sinais repetidos não reiniciam esse orçamento. Reconexão/retorno visível podem iniciar novo ciclo limitado. Erros permanentes não entram em loop e continuam visíveis. Nenhum retry deste controlador chama o envio comercial.
- Metadados de leitura: `adiFesta:{namespace}:pendingReadInvalidations:v204`, com UID/empresa/geração e versões por coleção. Não contêm vendas ou payloads. O namespace comercial existente não muda; nenhuma fila, ID, tentativa, checksum ou arquivo histórico é migrado, limpo ou reescrito.
- Uma leitura completa de vendas por ACL/política atualiza o cache que poderia ter confirmado versões sem baixar documentos. Essa leitura usa a reconciliação já existente, preservando alterações locais pendentes. É somente leitura canônica e projeção local, nunca uma recriação/reenvio.
- Consulta incremental usa cursor `DocumentSnapshot`, incluindo a chave de desempate quando timestamps coincidem. Máximo de 20 páginas de até 500 documentos por consulta. Ao exceder, falha explicitamente sem aplicar resultado parcial nem avançar o cursor. Não exige índice novo. A compatibilidade de datas legadas dos pedidos online permanece.
- Diagnóstico exportado acrescenta protocolo confirmado e estado do download/retry; não exporta credenciais. Ausência de pendências comerciais continua não sendo prova de presença remota.

## Evidência e limites

Consulta de produção exclusivamente de leitura em 25/10/2026 às 19:23 BRT: sete vendas alvo, R$302,00, dez movimentos e recibos autorizados, todas nas consultas canônicas de vendas/Histórico do gestor. Versões das sete vendas e IDs dos movimentos iguais ao levantamento anterior. Quatro decisões históricas e respectivos bloqueios de replay preservados. Evidência detalhada permanece privada, fora do repositório e do pacote público; nomes/telefones de clientes não foram coletados no relatório.

Isso comprova persistência e disponibilidade canônica dessas sete vendas, não o conteúdo atual do aparelho da funcionária. Eventuais vendas exclusivamente locais dependem do JSON atual, a ser analisado separadamente. O defeito de empate de 500 documentos é latente: não é atribuído como causa deste conjunto real de sete vendas.

## Validação

Resultado final do candidato: **260 testes críticos Node/DOM aprovados**, mais os seis testes funcionais de reconciliação legados e **11 cenários autenticados de Emulator aprovados**. Quatro vendas fictícias produzem exatamente quatro recibos e quatro movimentos, mesmo com resposta perdida e tentativas concorrentes. Os 1.001 documentos adicionais são fixtures de paginação somente no Emulator. Lint, build, diff-check e pacote público aprovados. Cinco controles negativos falham como esperado na V203 intacta e passam com a V204.

Regressões executam os trechos reais do receptor, coordenadores e repositório. Há controles negativos que falham com a V203 intacta para sinal herdado, retorno de sessão obsoleta, perda da invalidação na rede e paginação de 501 documentos. Validação de autorização usa SDK real de Auth, Functions e Firestore em projeto demo exclusivamente loopback, com identidades fictícias owner/seller, vendas pagas/Fiado, resposta perdida, concorrência/retry, recibos, ausência de leitura financeira indevida e 1.001 timestamps iguais. Nenhuma operação comercial é realizada em produção.

Gate `scripts/verify-v204-release.cjs`: 27 fontes/Rules/manifestos protegidos exatamente iguais à V203; três blocos de captura/commit/processamento de fila byte a byte iguais; única mudança de serviço no servidor é o sinal; Auth/UI só alteram a query de cache do singleton Sync. Worker altera apenas release/nome do cache, sem nova limpeza. Build público mantém os 224 arquivos da allowlist V199, sem testes, diagnósticos ou fixtures.

O verificador V202 foi atualizado somente para reconhecer a chamada de layout de Trocas já publicada na V203, mantendo comparação integral dessa fonte com a V203. O teste histórico `client-cross-device-sync` tem uma asserção obsoleta de release V171 que já falha na V203; não é alterada/ocultada. Seus seis testes funcionais são executados separadamente; o alinhamento atual dos módulos é coberto pelos testes V204. Não se declara a suíte global integralmente verde.

## Ordem de publicação, somente depois de autorizada

1. Revalidar candidato/tag, árvore limpa, `main` V203 e rulesets `25744131`/`25744311` ativos. Somente credencial temporária de manutenção; não mudar guards nem pushurl. Não usar worktrees de genealogia antiga.
2. Publicar exclusivamente `functions:commitOperationalSync`. Não publicar outras Functions, Firestore/Storage Rules ou índices. Sinal novo é legível pelas sessões V202/V203; seu identificador de servidor não pode coincidir com o UUID de uma sessão de navegador.
3. Fazer QA do sinal e recibo sem vendas reais. A atualização do servidor não relê nem reenvia operações antigas.
4. Publicar frontend/PWA V204 via workflow sanitizado/allowlist. Manter todas as Rules publicadas atuais; Rules restritivas V202 permanecem pendentes.
5. Confirmar commit/release no domínio e PWA. Smoke QA owner/seller: sinal, Histórico/Dashboard, rede/reconexão, reload/troca de conta e ausência de duplicações. Produção: apenas consultar as sete vendas e os bloqueios históricos.
6. Aparelhos precisam abrir/atualizar normalmente para receber os fences e retry do frontend. Não solicitar recriação de vendas, limpeza, logout forçado ou Sync histórico como procedimento de correção. Sessões antigas ganham a identidade corrigida do servidor, mas não se afirma que receberam os fences novos sem conferir o build.

## Rollback compatível

Preparar commit/tag `rollback/v204-compatible-read-hydration` descendente do candidato. Preserva integralmente origem do servidor, autorização V202, recibos, guards de sessão, paginação, contenção, filas/quarentenas, projeções e estruturas comerciais. O rollback conservador pausa apenas os retries de leitura acionados por temporizador (`backoff=[]`), mantendo invalidações e leitura no reload/reconexão, com cache estático identificado separadamente. Não restaura os defeitos conhecidos da V203 nem o uploader inseguro.

Validação: `node scripts/verify-v204-rollback.cjs <SHA completo do candidato>`, testes de escopo/preservação e contenção. Reversão deve publicar somente frontend/PWA compatível; manter a Function de sinal corrigida e todas as Rules atuais. Nenhum rollback de dados ou exclusão de metadados é necessário.

Riscos residuais: aumento pontual de leituras na primeira atualização da política; indisponibilidade/permissão/limite de páginas continuam produzindo erro explícito sem sucesso falso. Android físico e estado local atual da funcionária não foram acessados nesta preparação. Nenhum bloqueador exige intervenção comercial.
