# V171 — candidata a piloto, publicação controlada

Autorização do proprietário em 15/10/2026. Base funcional aprovada:
`7d28491149ff147c9c6d7782b5e677592ef573be`.

Rollback V170: `46f4affd2bc79aec7c429c734aa741a601817aa7`, tag remota/local
`rollback/v170-before-v171`. Não apagar dados nem restaurar caches/filas ao voltar
frontend. As Rules V171 mantêm os mesmos critérios de segurança da V170.

Release 171, cache `veconi-v171-order-recovery-scoped-stock`. Mantidos atualização
PWA, SKIP_WAITING, escopo raiz, IndexedDB e fila. Auth e firebase-ui importam a
MESMA URL `sync.js?v=171`, evitando instâncias duplicadas do motor de Sync.

Publicação mínima: Firestore Rules e frontend pelo workflow GitHub Pages existente.
Sem publicação de Functions (não há mudança nelas), Storage Rules, índices,
Firebase Auth, DNS/domínio, cobrança, assinaturas ou Mercado Pago. Sem migração.

Testes pré-publicação: app 674; backend 140; Auth/Firestore/Storage/Rules Emulator
181; lint app/backend, build e diff --check. Todos devem passar antes do deploy.

## Smoke exclusivamente QA

Empresa adi-festa, owner z3ao8ODMHzbGLIBHgcJbvZtXeDp2:

- VECONI QA: 3488517b-872d-4836-9796-aa488c1437f1.
- VECONI QA — isolamento: b746fc80-3ed8-4092-b07f-860e689cd93f.

Nenhuma loja real será ativada. Entrada histórica de R$25 protegida por hash e
updateTime; não reprocessar histórico. Auditoria antes/depois somente metadados.

Prioridade: retomar pedido `38c34218-1df7-48cf-a8fe-cd02b42ff9fe` pela fila já
preservada. Pré-conferência: claim no ator owner, pending; reserva vermelha1,
estoque vermelho1/azul1/pai2; sem sale/processedOperations/receipt na nuvem.
Conferir diagnóstico da fila no navegador original antes de atualizar o PWA.
Nunca recriar pedido, ajustar estoque manualmente ou limpar fila/cache.

Usar somente produtos fictícios QA existentes para novos cenários, sem modificar
seus preços ou dados reais. Finalizar somente QA. Habilitar Financeiro apenas no
QA B temporariamente para comprovar roteamento, sem conta bancária; restaurar
capability/automação original ao terminar. Receitas QA mantidas como evidência.

Scheduler existente a cada minuto, sem novo job/frequência/custo recorrente.
Expiração deve ser observada sem backdate nem varredura global manual.

Operador restrito: comprovado no Emulator; não criar usuário/alterar vínculo real
para alegar smoke cloud completo sem autorização específica.

Android físico indisponível (confirmado pelo usuário nesta etapa). Registrar como
pendência, nunca substituir por responsividade/desktop. Piloto real não liberado
até conclusão do smoke e validação física exigida.
