# V202 — pacote local de publicação controlada

Base publicada: V201 sanitizada `66e6969ba3b8cdc16053466ab2ae6c80e286ba78`, descendente da V199 limpa `3265f375a6bcd6276e202646725ce63e06a8d20c`. Branch `codex/v202-authorization-hardening`. Este documento não autoriza publicação.

## Escopo

Somente autorização e compatibilidade operacional já aprovadas. Três Functions novas: `commitOperationalSync`, `getOperationalSyncReceipt`, `commitFinancialMaintenance`, região `southamerica-east1`. Firestore e Storage Rules restritivas. Frontend/PWA V202 com bridge autenticada, consultas financeiras escopadas e caminho tipado das quatro manutenções. Nenhum índice novo, migração, alteração de permissões, limpeza, reparo comercial ou reprocessamento de fila.

As quatro manutenções são reconciliação de saldo somente local, recuperação comprovada de venda somente local, reconciliação canônica de saldos e compensação de recebimento duplicado. Exigem owner ou administrador com os grants existentes; vendedor não ganha autorização. Detalhes e inventário de fontes em [compatibilidade operacional](security-v202-operational-compatibility.md).

Os serviços existentes de Trocas/crédito, Fiado, cancelamento seguro, pedidos online, recuperação e projeção de receitas ficam preservados. As fontes comerciais retidas e a allowlist pública são comparadas byte a byte com V201 pelo verificador local. Geradores têm paridade conferida. Nenhum arquivo privado, teste, relatório ou evidência é adicionado ao site.

## Protocolo e dispositivos antigos

- O commit autenticado exige protocolo 1 / release >=202 no limite callable. Isso é um requisito de compatibilidade, **não** substitui autenticação, permissões nem validação canônica de cada operação.
- `getOperationalSyncReceipt(kind=sync_protocol)` confirma o canal para a sessão autenticada, empresa e geração. É somente leitura; não cria recibo, não lê saldo e não concede Financeiro. A confirmação em memória é invalidada por troca de sessão/empresa/geração. A UI mostra a confirmação nos detalhes da Nuvem.
- Bundle antigo/misto ou bridge ausente bloqueia novos enfileiramentos e envios no runtime novo com orientação de atualização. Falha de handshake bloqueia envio antes de incrementar tentativas. Não há fallback de escrita direta em navegador; a aritmética legada no fonte é mantida somente como origem do gerador e harness de regressão, sob backstop obrigatório das Rules.
- **Somente novas operações V202** recebem metadados de protocolo fora do payload. Pacotes antigos não recebem selos, IDs novos ou checksum refeito.
- Na V202, filas anteriores sem protocolo ficam retidas em metadados separados (`sync_protocol_upgrade_review`) **antes** da compatibilidade. Auto-sync, forçar Sync e retry manual não as executam; esta ação também não permite arquivá-las como incidente descartável. Exige avaliação explícita da operação e dos efeitos remotos antes de qualquer recuperação. Quarentenas/decisões anteriores continuam com seu motivo/resolução.
- Texto: “Operações de versão anterior preservadas para revisão. Nenhuma será reenviada automaticamente. Não refaça vendas; solicite análise da fila.” Filas de operações novas legítimas continuam funcionando.
- Uma V201 que permaneça aberta não pode receber retroativamente uma UI de atualização. Depois do fechamento das Rules, suas escritas diretas são negadas atomicamente; sua fila permanece no aparelho e a mensagem antiga pode ser genérica. **Não é garantia de que o aparelho atualizou.** Não orientar recriação da venda, troca para owner, limpar dados ou insistir em retries. Atualizar normalmente e analisar a fila preservada. Não há bloqueio/normalização automática de dados comerciais locais antigos nem logout forçado.

## Gates e ordem exata — execução depende de autorização

1. Conferir commit aprovado, genealogia sanitizada, allowlist, tag de rollback e rulesets `25744131`/`25744311` ativos. Usar exclusivamente credencial temporária de manutenção, sem alterar rulesets nem proteções locais. O push URL permanece desabilitado nesta preparação.
2. Publicar somente `functions:commitOperationalSync,functions:getOperationalSyncReceipt,functions:commitFinancialMaintenance`. Não publicar todo o backend. Verificar as três Functions e handshake com owner e seller QA enquanto as Rules antigas ainda estão ativas.
3. Publicar o frontend/PWA V202 pelo fluxo Pages sanitizado. Confirmar versão, commit e SW. Não liberar coleta comercial nos aparelhos ainda não conferidos.
4. **Gate antes das Rules**: inventariar cada aparelho operacional conhecido (incluindo Android PWA e aparelho da funcionária), conta/empresa/espaço, release exibida, canal confirmado, contadores e diagnóstico somente leitura. Uma sessão desktop não comprova atualização do Android. Atualizar usando o aviso normal do app, sem apagar caches/IndexedDB ou forçar logout. Filas antigas devem ficar intactas e explicitamente retidas; não há autorização de replay neste release.
5. Executar smoke QA do caminho V202 owner/seller e confirmação de recibo, resposta perdida/retry, recebimento, Fiado/cancelamento, estoque, troca/crédito, campanhas/renovações, finalização online e manutenções autorizadas. Demonstrar negações no Emulator e o canal efetivo no ambiente publicado. Se Functions/frontend ou algum aparelho operacional necessário não puder ser confirmado, interromper **antes** das Rules. Documentar aparelhos desconhecidos/offline; seu acesso direto remoto será bloqueado pelas Rules, com fila preservada.
6. Publicar somente `firestore:rules,storage` com config validado. Não executar deploy de índices nem migração. A janela permissiva permanece um risco até esta etapa e deve ser curta/controlada, não um estado final.
7. Repetir smoke essencial QA após fechamento, verificar isolamento e negações, nenhuma alteração de lojas reais. Não executar rotinas administrativas em registros reais. Falha: interromper novas operações QA, registrar resultado e manter proteção; nunca reabrir Rules antigas.

## Rollback compatível

Tag local prevista: `rollback/v202-compatible-authorization`. Branch local: `codex/rollback-v202-compatible-authorization`.

O fallback mantém o shell/comportamento comercial V201 junto de **todo o piso de autorização V202**: três Functions, validadores, ledger, recibos, Rules restritivas, bridge, retenção de fila antiga, consultas escopadas, isolamento e estruturas Trocas/crédito. Só a identificação de canal de rollback/cache muda. Não faz restauração de banco, execução de pendências nem downgrade de protocolo.

Limite importante: como o pacote não contém evolução visual opcional, o fallback conserva o código de autorização validado do candidato. É um ponto restaurável do piso seguro, **não** uma reversão de defeitos nesse piso. Falha no gateway/Rules exige correção incremental validada; não existe retorno seguro ao uploader/permissões V201. Um dispositivo V202 que já gravou operação mantém IDs/payload/recibo após o fallback. Comparar hashes do piso e rodar regressões do canal/contensão no candidato e no fallback antes de declarar pronto.

Rollbacks históricos permanecem preservados, mas não devem ser publicados integralmente após ativar V202.

## Validação e pendências de produção

Rodada final crítica: **172 testes Node e 143 cenários Emulator aprovados**, sem falhas ou skips. Lint, build, diff-check e build público de 224 arquivos aprovados; três geradores com paridade verificada. Regressões cobrem canais autorizados e negados, owner/seller, múltiplos espaços, saldo/estoque/eventos/recibos protegidos, comércio legítimo, finalização online, manutenções, resposta perdida, retry, duplo clique, reload e isolamento de callbacks. Os testes de contenção atualizam somente a versão esperada V201→V202, mantendo asserções de anonimato/allowlist e proibição de cache antigo. Logs fictícios ficam fora do repositório em `C:/Users/Murillo/.codex/visualizations/2026/10/24/security-authorization-v202/`.

Nenhuma fila ou conta real foi consultada/modificada nesta preparação. Inventário dos aparelhos/filas reais, confirmação em nuvem dos novos callables e smoke de transição são **gates ainda pendentes para a publicação**, não resultados presumidos dos testes locais. Não foi feito push/deploy nem houve edição dos rulesets.
