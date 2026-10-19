# V190 — integridade no escopo autorizado

Base / rollback de frontend: V189, `7dd7583cfba8dceca6703a1e3f0bcbce7b5a63a5`.

- Auditoria usa permissões efetivas e omite fontes não autorizadas, inclusive quando há prefetch.
- Seller sem acesso financeiro não consulta `payments`, `balanceAdjustments` ou `balanceEvents`. Exibe “Financeiro não auditado neste perfil”, sem certificar saldo zero nem apontar divergência financeira por falta esperada de acesso.
- Owner mantém auditoria completa de pagamentos, ledger e projeções privadas.
- Erros reais em fontes autorizadas continuam com coleção, etapa e motivo; não há catch que esconda `permission-denied`.
- Prefetch e resultados são vinculados ao namespace/sessão; callbacks antigos não publicam na identidade nova.
- Contagens técnicas também respeitam o escopo autorizado.
- Nenhuma alteração em Rules, permissões, backend, operações comerciais, dados, filas ou registros arquivados.

Validação: 85 testes do app; 4 do Firestore Emulator com SDK/repository/Rules reais e dados fictícios; lint; build; `git diff --check`. Cobrem owner/seller, reload, troca de conta, Sync manual, auditoria completa, erros genuínos, fila preservada e ausência de efeitos comerciais. Dois harnesses antigos foram atualizados para carregar dependências já existentes, sem remover assertions.

Publicação somente do frontend via GitHub Pages. Otimização local de confirmação do Fiado, fora deste escopo, não é incluída.

Rollback: publicar o ref `rollback/v189-before-v190-integrity-scope` por workflow/reversão controlada. Não resetar dados locais nem apagar arquivos, filas, tombstones ou evidências. Manter backend e Rules da V188, inclusive o bloqueio persistente de replay.
