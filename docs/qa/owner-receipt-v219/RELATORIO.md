# V219 — recebimento Fiado do proprietário

Base sanitizada publicada: V218 `8ece6bc822807313518c2a9cf008299a557e3aee`.
Implementação e testes locais; nenhum deploy, push ou recebimento real executado.

## Causa comprovada

O owner não perdeu permissão. A leitura canônica confirmou Auth ativo, perfil ativo na Adi Festa, UID do perfil igual ao proprietário canônico, member owner ativo com acesso a todos os espaços, membership ativo e plano internal ativo. `customers.receiveDebt` já estava true. Não é necessária reparação ou concessão de acesso.

O caminho é:

`Confirmar recebimento → Fiados.receber → alocar pagamento em vendas Fiado → createPaymentOperation/diffWrites → PermissionMutations.assertWrites → sales update recusado como sales.cancel`.

O guard introduzido na V210 aceitava criação/cancelamento de vendas, mas rejeitava incondicionalmente a atualização dos campos de quitação causada por um recebimento. Isso ocorria mesmo com owner e todas as permissões. A exceção aparecia antes da criação da fila e da publicação da projeção financeira local, com a mensagem genérica de falta de permissão. Foi reproduzida com os arquivos reais de Fiado, campanhas, TeamAccess e diff de Sync; a correção faz essa regressão passar.

Ao validar a operação inteira no servidor foram comprovados dois bloqueios adicionais:

1. O gateway tratava um patch como venda completa: numa baixa parcial `creditSettled=false` permanece inalterado e não vem no delta. Comparar `undefined` com false recusava o recebimento válido. A validação agora combina a venda canônica com o patch antes de verificar valores finais. Totais, cliente, itens, autoria e escopo histórico continuam imutáveis.
2. A ordem canônica deste caso inclui R$2 de uma venda histórica sem spaceId. O gateway exigia spaceId até para essa baixa pelo proprietário. Agora somente um owner ativo e autenticado desta empresa pode abater a venda legada sem espaço, com recebimento em espaço válido. O documento permanece no mesmo caminho empresarial e sem espaço inventado; funcionários continuam bloqueados nesse caso. Vendas com espaço continuam exigindo o vínculo correto e autorização de espaço.

Não há evidência de que a V216/V218 tenha removido permissões: os arquivos de autorização/recebimento relevantes não foram alterados no lançamento Google. A negativa primária já existe na V210. Os guards de saldo, status da empresa, assinatura, workspace generation, identidade e servidor permanecem.

## Recebimento real — somente leitura

- Um cliente canônico corresponde à dívida exibida de R$214. Saldo Firestore: **-214,00**, financialVersion **16**.
- Não encontrado pagamento recente de R$50 para esse cliente nem evento `payment_received` de R$50. As consultas não atingiram os limites.
- Nenhum recibo associado a esse recebimento foi identificado; pagamentos/efeitos/recibo são atômicos no canal autorizado. Sem operationId fornecido e sem ler o aparelho não se afirma uma busca global por um recibo local desconhecido.
- A fila local do aparelho **não foi inspecionada**. Não houve retry, reprocessamento, limpeza ou nova tentativa real.
- Distribuição que o fluxo atual produziria após uma confirmação futura: R$29 de saldo legado, R$2 de venda histórica, R$14 de uma venda e R$5 de outra. Saldo final esperado **-164,00**, se estado e condições permanecerem iguais. Nenhum desses efeitos foi aplicado em produção.

Relatórios privados sem nomes/telefones em `C:/Users/Murillo/.codex/visualizations/2026/10/30/v219-owner-receipt/`. IDs e metadados mínimos ficam fora do pacote público.

## Correção

- Frontend permite somente os campos de quitação derivados de um pagamento autorizado, com cliente, valor, alocação, IDs e origem conferidos. Não concede sales.cancel, financial.view, customers.edit ou outro privilégio ao funcionário.
- Owner continua com todas as permissões operacionais da própria empresa, inclusive com mapa vazio ou false. Acesso platform_admin não é concedido por ser owner. Perfil legado só usa a evidência canônica já existente, sem reparar membership.
- Estados loading/error/inativo/read-only passam a ter mensagens específicas. O recebimento exige correspondência de sessão, perfil, empresa e vínculo antes da mutação; mudança após abrir o modal invalida a tentativa.
- Formulário compartilhado de recebimento valida antes de abrir/confirmar, preserva valor/PIX/observação quando falha, mostra erro dentro do modal e restaura controles. Há ação explícita para reabrir a sessão sem limpar armazenamento quando necessário.
- Um identificador estável por tentativa, single-flight e reaproveitamento do registro preparado impedem segundo recebimento por duplo clique/falha de persistência. Nenhum retry comercial automático foi adicionado.
- Sucesso distingue gravação local de confirmação remota. Recibo pendente é identificado como salvo no aparelho; não promete confirmação na nuvem.
- O servidor mantém a validação definitiva e a transação/recibo idempotente existentes. Nenhum contrato de Sync, payload antigo, ID, checksum ou fila é alterado.

## Testes

- **202 testes app/DOM/contenção aprovados**: owner V2/legado/mapa vazio, seller/stock/manager negados, funcionário autorizado sem Financeiro, revoke/grant, troca de conta/empresa, loading/error/assinatura, recebimento parcial/total, campos imutáveis, falha de gravação e single-flight; regressões de Fiado/cancelamento, Trocas/crédito, permissões, protocolo Sync e Google comercial.
- **11 cenários Auth + Firestore Emulator aprovados**, usando SDK Auth e serviço canônico real: owner V2, owner legado, funcionário autorizado, total, venda legada sem espaço apenas owner, recusa de funcionário com papel forjado no navegador, resposta perdida/reload/retry, adulterações, isolamento e distribuição exata do incidente. Pagamento, saldo, alocações, evento e recibo únicos; nenhum movimento de estoque.
- **8 verificações Chromium aprovadas**: desktop, tablet, 320 px, 390 px, viewport baixa de teclado; botões acessíveis, cancelamento, falha preservando formulário e mesma operação, status local honesto. Somente dados fictícios em memória; zero requisições externas.
- Lint/build, pacote allowlist e diff-check conferidos no manifesto de preparação.

As falhas iniciais e sua causa estão preservadas nos logs de baseline; não foram ignoradas. A tela real do usuário não foi inspecionada diretamente: estado local e stack dessa tentativa não estão disponíveis, mas o código publicado, o estado canônico e a reprodução determinística explicam a mensagem e os bloqueios.

## Arquivos do hotfix

`js/permission-mutations.js`, `js/team-access.js`, `js/fiados.js`, `js/app.js`, `js/clientes-page.js`, `js/client-actions.js`, `css/clientes-page.css`, `functions/src/services/operational-commit-service.js`, `js/build-info.js`, `service-worker.js`; testes/helper/fixture de recebimentos e script de navegador.

## Publicação e rollback

Necessita **somente commitOperationalSync** no backend, primeiro, e depois frontend/PWA V219. Não publicar todas as Functions que compartilham o arquivo. O ajuste é compatível com os envelopes anteriores, não modifica o protocolo e não reenvia registros antigos. Functions Google, OAuth, Rules, permissões comerciais reais e demais serviços ficam fora.

1. Conferir fonte publicada, V218/main, dois rulesets ativos, credencial temporária, metadados das contas e saldo/recibos somente leitura.
2. Publicar apenas commitOperationalSync e validar QA. Manter as validações restritivas corrigidas.
3. Publicar frontend/PWA V219 com novo cache estático; sem limpar armazenamento dos usuários.
4. Smoke exclusivamente QA, seguido de leitura do estado canônico real. A operação de R$50 continua sendo decisão do usuário, não do deploy.

Rollback compatível preparado localmente: manter backend corrigido e recibos já emitidos; pausar somente novas tentativas de recebimento pela interface (`receiptCreationPaused=true`) se o rollout precisar ser interrompido. Manter Google comercial, sessões, Sync e filas existentes. Não restaurar guard quebrado, permissões inseguras ou snapshots de dados. A pausa não executa nem apaga operações existentes e não afeta o processamento autorizado já enfileirado.

Risco residual: disputas legítimas de saldo/financialVersion ou dados históricos inconsistentes continuam sendo recusadas. Funcionário que encontre venda histórica sem espaço precisa do proprietário; não recebe acesso genérico. A correção não reconcilia débitos antigos, não afirma pagamentos recebidos e não concede permissões para contornar conflitos.

**Pacote local para revisão. Nenhuma publicação está incluída nesta etapa.**
