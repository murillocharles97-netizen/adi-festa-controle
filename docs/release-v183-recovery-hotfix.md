# V183 — encerramento de revisão e patches parciais

Base/rollback: V182, `82709db6cbcc092a25756ee231dee8d7492e3985`.

- Decisão explícita do proprietário: “Não recuperar / encerrada sem efeitos”.
- Original/IDs imutáveis; responsável, horário e decisão auditados; nenhuma venda,
  baixa, receita ou meta aplicada pelo encerramento. Existência de efeito prévio
  bloqueia o encerramento. A mesma decisão é idempotente.
- Recuperação valida snapshot anterior combinado com patch parcial. Ausência de
  `totalStock` mantém o valor anterior na validação, não vira remoção/zero.
- Delta inválido, patch sem baixa, estoque insuficiente, reserva inconsistente,
  ator/empresa/espaço inválido e efeitos anteriores continuam bloqueados.
- Estoque simples existente mantém aliases canônicos coerentes; recuperação usa
  estoque atual e IDs originais. Venda/movimentos/recibo/revisão são atômicos.
- Tela Resolvidas identifica encerramento sem venda vinculada. Reenvio de pacote
  resolvido confirma preservação e não altera a fila comercial do aparelho.
- Sem novas permissões, Rules, triggers, migração, retry em lote ou timing.

Validação: testes direcionados do app/backend, Emulator, lint, build, diff-check
e UI local isolada. Cenário sintético: duas revisões previamente vinculadas
imutáveis; encerramento sem efeitos; recuperação parcial 6 → 5 com uma venda,
um movimento e uma receita quando habilitada; concorrência/reenvio sem duplicação.

Deploy seletivo: frontend via workflow GitHub Pages existente e somente
`functions:decideSaleRecovery`. Rules não são alteradas/publicadas.

Rollback: restaurar frontend e Function da V182. Nunca reverter automaticamente
as decisões, vendas ou estoque já efetivados. Manter os registros de recuperação
e as proteções de replay existentes na V182. Uma revisão encerrada pode mostrar
rótulo antigo na UI V182; não decidir novamente nem remover evidência.

Intervenção real, quando autorizada: somente registros expressamente indicados,
uma decisão por transação, revalidando estado/IDs/hash/estoque antes da aplicação.
Nunca usar credencial da funcionária, limpar fila ou substituir IDs.
