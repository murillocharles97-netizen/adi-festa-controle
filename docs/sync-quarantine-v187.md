# V187 — operações em quarentena

Base de rollback: V186 `53ae5e184c4e166328dc75d92d5de1a6cf29a273`.

Pacotes retidos recebem classificação efetiva `quarantined` em metadados separados. O pacote comercial permanece intacto, incluindo payload, IDs, erro, tentativas e checksum. A evidência local é imutável; divergências são bloqueadas. A quarentena impede migração, reescrita, remoção e envio, inclusive pela sincronização forçada.

Lotes antigos de atualização de projeções privadas sem evento comercial explícito são retidos pela estrutura do pacote, sem lista de usuários ou IDs de incidentes no código. Não bloqueiam a leitura de atualizações canônicas nem transformam vendas históricas em pendências comerciais. Vendas reais negadas continuam usando o canal de recuperação existente.

Erros permanentes não voltam ao uploader por tempo decorrido ou force interno. O retry de erros comuns exige a ação manual da interface; a mesma ação continua sem liberar pacotes retidos. Nenhuma ampliação de permissões ou alteração de Rules/backend.

Validação pré-deploy: 56 testes do app, 20 do Firestore Emulator, lint, build e diff-check. Incluem fila mista, idempotência, operação antiga inerte em error/pending/syncing, troca de identidade, callbacks obsoletos, isolamento e dados sensíveis.

Somente frontend. O arquivamento definitivo de evidências e o bloqueio persistente de replay após arquivamento são uma etapa separada. Esta versão mantém os registros na fila e não os descarta. A otimização de confirmação Fiado preexistente e não publicada não integra este release.
