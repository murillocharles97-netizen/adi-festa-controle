# Revisões de recuperação resolvidas — hotfix local sobre V192

Base: cfee4bc8a76769ec80deeaab1848f9f5842f4737. Worktree independente de Trocas, da Loja V3 e da otimização de Fiado. Sem commit ou deploy nesta etapa.

## Comportamento

O Sync consulta `listSaleRecoveryReviews` pelo canal autenticado existente com até 20 identificações e hashes de payload por chamada. O modo de consulta é somente leitura; nenhuma decisão ou efeito comercial é executado. Não retorna snapshots privados, dados financeiros ou produtos.

O servidor confere vínculo ativo, empresa, espaço autorizado, ator original, geração, saleId, operationId, SHA-256 do original preservado e coerência entre revisão e recibo de recuperação. Compara o hash SHA-256 do payload original com o payload local. Não reconstrói o envelope com dados atuais, pois venda/movimentos locais podem ter sido atualizados depois da preservação.

Decisões finais reconhecidas: `already_recreated`, `closed_without_effects`, `recovered`. A resposta inclui apenas identificação, decisão, hashes e responsável/data. Ausência, erro de consulta ou divergência deixa a ocorrência como revisão pendente e continua bloqueando replay.

O aparelho guarda a confirmação em `queueKey():recoveryResolution:{operationId}`. A chave usa o namespace atual da fila, separado por usuário/empresa. O conteúdo inclui geração, identificação, hashes, checksum local e data de verificação. Fila, payload, IDs, erro original e contagem de tentativas não são regravados, removidos ou reconhecidos como um novo commit comercial.

Metadados válidos sobrevivem ao reload. Respostas atrasadas de outra sessão não gravam confirmação. Alteração de payload ou identidade invalida o reconhecimento. A proteção de revisão continua impedindo envio inclusive quando os metadados faltam, estão corrompidos ou a consulta está indisponível.

## Interface e contadores

- Pendências enviáveis: operações que podem entrar na fila normal.
- Erros ativos: erros fora de quarentena/revisão manual.
- Revisões manuais: ocorrências ainda sem confirmação final válida; mensagem “Revisão manual — confirmação pendente”.
- Arquivados/resolvidos: evidências arquivadas e decisões finais confirmadas; mantém consulta à decisão e à venda vinculada.

Para as quatro ocorrências já auditadas, após confirmação autenticada espera-se 0 / 0 / 0 / 4. Mensagem quando somente essas ocorrências permanecerem: “Nenhuma sincronização pendente. 4 ocorrências resolvidas preservadas para auditoria.” Falhas de rede, listener, integridade ou outras operações continuam sendo reportadas por seus caminhos existentes. Esta correção não modifica saldos, registros comerciais nem elimina divergências reais da auditoria.

## Testes

89 testes Node passaram: leitura e cache de resolução; pendência/erro de consulta/hash divergente; reload e namespace owner/seller; execução do loop real auto/manual sem commit; quatro resoluções com contadores 0/0/0/4; quarentena, configurações sem permissão e fluxos existentes de recuperação.

28 cenários Emulator passaram: consultas de três estados finais e pendente; hash original/payload, ator, espaço e identificação; ausência de revisão; leitura sem escrita comercial; decisões e isolamento existentes. Rules permanecem byte a byte iguais à base.

Lint/build/diff-check executados. A validação local não alterou as quatro operações reais; o resultado no aparelho precisa ser conferido após publicação autorizada.

## Publicação proposta

Após autorização, preparar V193 sobre V192. Publicar somente a Function existente `listSaleRecoveryReviews` e frontend/PWA. Não publicar Rules ou outras Functions. Nenhum índice, migração, mudança de permissão, retry ou job é necessário.

Preservar rollback V192 / cfee4bc8a76769ec80deeaab1848f9f5842f4737 para frontend e callable. Implantar primeiro a callable, que mantém o contrato anterior; depois frontend/PWA. Antes de sua publicação, a versão antiga da callable pode rejeitar a consulta nova: o cliente mantém revisão pendente, sem replay. Depois, conferir no aparelho da funcionária os quatro hashes/IDs, contadores, tentativas e checksum após reload e Sync manual. Sem vendas, reprocessamento ou decisões adicionais.
