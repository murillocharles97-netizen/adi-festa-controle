# V195 — rollback compatível com o escopo de Vendas do Dashboard

Artefato local de contenção. **Sem autorização de publicação, push ou deploy.**

- Base preservada: `2d77ebe723338f6d88994800bf1ae41846b7f979`, tag `rollback/v194-compatible-sale-exchanges-single-space`.
- Nova branch: `codex/v195-compatible-rollback-dashboard-scope`.
- Nova tag local: `rollback/v195-compatible-sale-exchanges`.
- A tag original `rollback/v194-compatible-sale-exchanges` / `67c16811` também permanece intacta.

## Diferença em relação ao rollback V194 atualizado

Somente o módulo de leitura `js/exchange-economics.js` recebe a correção do candidato V195: filtra espaços elegíveis para Vendas, considera permissões e entitlement efetivos, invalida consultas entre sessões/espaços/permissões e não confirma ajustes históricos excluídos ou consultas com erro. Não escreve dados, não cria operação de Sync e não aplica efeitos comerciais.

O módulo usa o mesmo conteúdo Git do candidato V195 `55a4be9e972d766a3d44d8b7072ec72f8c8b1d4e`. SHA-256 do texto com LF: `a6943863b0329664c23c95d5afbeb7288ab1153bd5b510f781ae1ac8a138e36e`; blob Git: `34055f692fd6ca3c161ebbe05828df73c9c0b998`.

PWA/build são identificados como release `195`, canal `compatible-rollback`, cache `veconi-v195-compatible-rollback`. As URLs alteradas do módulo e build usam `195-rb`. Os testes atualizados e duas novas suítes de escopo acompanham o artefato.

## Piso de segurança intacto

Todas as Functions, Rules, índices e demais módulos de aplicação permanecem idênticos à base `2d77ebe`. Isso inclui os bloqueios transacionais de novas confirmações de Trocas/crédito, helper canônico `single_space`, ledger, recibos, projetor financeiro, bloqueio de reset, cancelamento específico de venda que já consumiu crédito, Sync, Fiado e sanitização de campos sensíveis. Nenhuma migração, limpeza de fila/cache, compensação ou replay é executada.

O modo de uso futuro é o mesmo documentado em `docs/v194-compatible-rollback.md`: somente após autorização explícita, publicar os dois confirmadores de contenção, aguardar prontos e então este frontend compatível. Não substituir Rules/projetores ou o cancelamento corrigido por versões antigas. Não retornar integralmente à V193 depois da emissão de trocas/crédito.

## Validação local

Acompanham este artefato os nove contratos de UI/rollback e as suítes de escopo/economia/custo-lucro/domínio do candidato V195, executadas contra o próprio módulo deste worktree: **94 testes aprovados, zero falhas e zero skips**. Lint e build validaram **411 arquivos JavaScript**; diff-check aprovado. Os seis testes Emulator prévios do rollback `2d77ebe` continuam preservados e não foram repetidos neste sucessor, cujo backend é idêntico. A validação do candidato V195 contém 110 testes Emulator aprovados, sem alteração de backend/Rules.

Não utilizar dados reais para validar a contenção. O smoke em nuvem de Trocas continua restrito aos espaços QA e depende de acesso seguro.
