# Hotfix local de cache e troca de sessão

Base: V184, commit d0468ac5a80ecd2ef5b5052e17e4317445ea2931. Release V185 preparada para publicação autorizada em 18/10/2026. Rollback: republicar a V184; nenhuma migração de schema ou de dados necessária.

## Causa e proteção

O IndexedDB compara a revisão persistida com a revisão carregada antes de qualquer escrita. Uma aba antiga é corretamente rejeitada com `local-cache-conflict`. O lifecycle anterior tentava fazer flush desse mesmo estado conflitante antes de abrir outra sessão, mantendo o bootstrap preso. A troca de identidade também não invalidava imediatamente todo o runtime anterior. A tela genérica apresentava indevidamente uma explicação de UID divergente.

## Alterações

- `js/business-cache.js`: escritor exclusivo por namespace com Web Locks; BroadcastChannel informa revisões; CAS continua obrigatório. Abertura/liberação serializadas e suspensão imediata da sessão antiga. Em conflito com alterações ainda não persistidas, cópia imutável com hash no mesmo IndexedDB, separada do cache canônico. Falha de preservação impede a transição. Nenhuma mesclagem ou replay automático.
- `js/storage.js`: token de abertura e chave capturada impedem que uma abertura atrasada substitua o namespace novo.
- `js/firebase/auth.js`: encerra callbacks e Sync antes de trocar identidade; aguarda liberação segura; mensagem específica e botão para atualizar a sessão com segurança.
- `js/firebase/sync.js`: geração/UID conferidos em leituras/escritas transacionais e antes de confirmar/remover itens da fila. Diagnóstico inicial não tenta gravar deviceId antes do cache estar pronto.
- Testes: `tests/cache-session-hotfix.test.js`, `tests/helpers/cache-lifecycle-harness.cjs`, `tests/fixtures/cache-session-hotfix.html`, `tests/fixtures/cache-session-hotfix.js`; adaptação do contexto VM em `tests/emulator/team-manual-sale-sync.rules.test.js`.

## Comportamento

Mesmo namespace em duas abas: a primeira mantém a escrita; a segunda recebe orientação para usar a aba ativa ou fechá-la antes de atualizar. Namespaces de usuários distintos têm caches/locks separados. Firebase Auth com persistência local pode propagar troca de conta entre abas do mesmo perfil: a identidade anterior é invalidada; o hotfix não promete dois logins Firebase independentes no mesmo perfil.

Owner → seller → owner preserva cada fila no namespace de origem. Resposta de rede antiga não confirma nem remove itens da conta nova. Uma transação já enviada ao servidor pode terminar na identidade original; a confirmação local fica preservada para o retry idempotente habitual. Não se promete cancelar um commit que o servidor já recebeu.

Sem Web Locks, a checagem transacional de revisão permanece como barreira final. Conflitos reais não são mesclados. A cópia preservada retém filas e IDs; operações elegíveis de recuperação continuam consultáveis pelo mesmo usuário/empresa/geração. Filas genéricas conflitantes permanecem preservadas para revisão técnica, sem incorporação automática à fila ativa.

Texto: “A VECONI está aberta em outra aba ou sessão com dados mais recentes. Atualize esta aba para continuar com segurança.” O aviso de UID fica restrito a erros de identidade reais.

## Evidências

- 65 testes direcionados do app aprovados, incluindo 10 de cache/sessão: concorrência, troca de conta, callback tardio, fila preservada, quota, CAS e aviso correto.
- 19 testes Firestore Emulator aprovados: fluxo canônico seller/cashier/owner, produto simples/variação, resposta perdida, idempotência, isolamento e dados sensíveis negados. Rejeições permission-denied nos testes negativos são esperadas.
- Navegador local: 7 cenários aprovados com IndexedDB/Web Locks reais em contextos independentes; fallback CAS e cópia preservada comprovados. Duas abas reais também comprovaram segundo escritor bloqueado, namespaces separados e seller → owner com fila/IDs intactos.
- Reabertura em contexto novo comprovada na fixture. A tentativa adicional de reload de aba real ficou sem conclusão quando o navegador interno se desconectou; não é evidência de login em produção.
- Lint, build e diff-check aprovados. Sem alteração de Rules/backend ou dados de produção.

## Limites e separação de mudanças

Não foi executado login real, retry de vendas reais, limpeza de cache ou migração de dados. Smoke de autenticação em produção e Android físico ficam para uma eventual publicação autorizada.

Existe otimização de Fiado anterior e não publicada em `verifySaleQueueCommit`, no mesmo `sync.js`. Ela foi separada deste commit e será mantida apenas como alteração local após a publicação. A V185 mantém as confirmações de Fiado da V184.
