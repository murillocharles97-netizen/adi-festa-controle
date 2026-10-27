# V207 — confirmação de recuperação

Base exclusiva: V206 sanitizada `ffdee04`. Sem alterações em Rules, permissões, Sync comercial, Produtos, Trocas, Fiado ou cancelamentos.

## Causa e correção

A tela confundia cliente vinculado com cadastro novo retido: só apresentava as três confirmações operacionais quando `clientDependencies.related` existia. O servidor também as exige para clientes existentes. Todo pedido de recuperar original agora apresenta entrega, recebimento já realizado e ausência de recriação. Nenhum checkbox vem marcado. Não há nova cobrança.

Erros determinísticos não usam mais “Confirmar a mesma decisão”. Mensagens recebem foco e rolagem. Resposta incerta oferece consulta da situação, não retry comercial. Retornar à lista preserva aba, páginas e posição; os registros da página são apresentados em ordem cronológica. Respostas de outra sessão/espaço não atualizam o modal.

## Evidências anteriores à V205

Um original já aceito sem dependências não é substituído. Um envio explícito posterior da mesma conta pode acrescentar um único documento privado e imutável `saleRecoveryReviews/{saleId}/original/customer-dependencies`, validado contra o núcleo exato do original (packet, venda e movimentos). O hash original e `saleRecoveryOperations` permanecem intactos. O complemento tem hash próprio, autoria e timestamp. Mudanças no núcleo continuam sendo conflito; mudança de complemento é rejeitada sem sobrescrita.

Esse envio não aprova clientes, não recupera vendas e não resolve filas. Aprovação e decisão continuam exclusivas do owner ativo, individualmente, com os guards existentes. Cliente já confirmado no mesmo ID/empresa/geração pode ser utilizado sem inventar um cadastro negado. Cliente ausente mantém a recuperação bloqueada até envio e aprovação de sua evidência. Não há remapeamento ou deduplicação automática.

## Publicação e rollback

1. Publicar somente `submitSaleRecovery`, `listSaleRecoveryReviews`, `decideSaleRecovery`.
2. Conferir fontes publicadas e QA autenticado em Emulator, incluindo clientes V204/V205/V206, evidências anteriores, idempotência e isolamento.
3. Publicar frontend/PWA V207 pelo GitHub sanitizado e credencial temporária. Preservar os dois rulesets.
4. Confirmar recursos públicos e Service Worker; conferir o incidente real somente por leitura.

Rollback compatível: candidato com `RECOVERY_DECISIONS_ENABLED=false`. Republicar somente `decideSaleRecovery` do rollback pausa novas aprovações e recuperações; listagem, evidências, hashes, recibos e confirmações idempotentes de decisões finais permanecem válidos. Não reverter Functions ao protocolo antigo nem apagar complementos. Frontend V207 pode permanecer: o servidor explica a pausa. Nenhuma alteração de Rules.

## Operação real

O deploy não envia evidências nem decide pelas vendas reais. Quando o cadastro faltar, a funcionária precisa abrir a versão atualizada e usar **Enviar dados para recuperação → Confirmar**. O gestor aprova os cadastros e decide pelas vendas individualmente, começando pela mais antiga quando compartilham produtos. Se o complemento não conferir exatamente com o original, a operação permanece bloqueada para análise, sem replay ou reconstrução.
