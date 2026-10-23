# V189 — saída de conta acessível a todas as funções

Base e rollback: V188, `8760afc2cf7616ec07b0db5df077dc9a9a8d632a`.

- Avatar do cabeçalho é um botão acessível, com nome “Sair ou trocar de conta”.
- Abre a confirmação existente “Sair da conta?”, sem depender de Configurações ou permissões comerciais.
- Reutiliza o logout existente: encerra callbacks/sessão e libera o namespace; não apaga IndexedDB, localStorage, filas, IDs ou evidências.
- O handler exige correspondência com a identidade Auth e com a sessão ativa. Rebind não duplica listeners; shell antigo em cache pode ser atualizado para botão.
- Sem alterações em backend, Rules, permissões, transações, processamento da fila ou dados comerciais.
- Incidente arquivado na V188 permanece preservado e bloqueado contra replay.
- Otimização local de confirmação do Fiado e diferença de Produtos owner/seller ficam fora desta versão.

Validação pré-publicação: 36 testes direcionados (8 saída, 10 cache/sessão, 8 Sync/sessão, 4 convite, 6 bootstrap), lint, build e diff-check.

Publicação somente do frontend por GitHub Pages. Rollback por workflow no ref preservado `rollback/v188-before-v189-account-exit`, sem reset local, exclusão de cache, rollback de Rules ou remoção de arquivos/tombstones de incidentes.

Smoke autenticado depende dos logins feitos pelo usuário. Não realizar vendas, retry, recuperação ou reprocessamento durante a troca de contas. Comparar diagnóstico/namespace antes e depois; não afirmar validação owner/seller sem ambas as sessões reais.
