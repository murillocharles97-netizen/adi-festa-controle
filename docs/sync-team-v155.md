# V155 — Equipe e diagnóstico global de sincronização

## Status de entrega

Implementação local na branch `codex/sync-team-v155`. **Não publicada.**
Produção continua na V154, commit `be5f10d540d5d1dc5ac6b1eaf0a35a56c1459f3d`.
O erro específico do celular ainda precisa do diagnóstico do aparelho. Não declarar a sincronização global corrigida nem o teste multidispositivo físico aprovado apenas com os testes locais abaixo.

## Sincronização: evidências e correções

1. **Caso real:** na V154 publicada, a conta existente no Chrome desktop concluiu a sincronização manual com fila 0, erros 0 e atualização do horário. Não foi reproduzido ali o erro relatado no celular. Não há exceção real do celular capturada nesta execução.
2. **Regressão confirmada por código:** `setUser()` restaurava `adiFesta:<business>:lastSync`, enquanto manual/automático gravavam `adiFesta:<business>:<uid>:<permissionSignature>:lastSync`. O reload podia voltar a exibir um horário legado. Agora lê a chave correta e usa a antiga somente como fallback. A mesma correção vale para tentativa e última sincronização completa.
3. **Falha confirmada por teste injetado:** gravar metadados de horário podia lançar `QuotaExceededError` antes/depois da transferência e invalidar o resultado. `writeSyncTime()` mantém o status em memória e registra o aviso quando somente esses metadados não puderem ser persistidos. Não suprime falhas de gravação de dados ou de cursores.
4. **Erro genérico:** `manualSync()` escondia o código/estágio e nem sempre atualizava o estado global. O caminho agora reporta `syncFailure`, com etapa, serviço, coleção/consulta, código, mensagem técnica e horário. Erro de quota no banco local inclui chave, bytes UTF-8 quando disponíveis e bytes UTF-16 — nunca o conteúdo do banco.
5. **Instrumentação:** `syncStep()` identifica perfil, negócio, fila, upload, cada coleção do download, aplicação local e cursor. `syncTrace` guarda no máximo 40 entradas em memória; informações de desenvolvimento só são impressas em localhost ou modo dev. Falhas são registradas com `[SYNC ERROR]`. O JSON exportado foi atualizado para diagnóstico versão 3.
6. **Rules:** nenhuma alteração. Os 104 testes de Rules passaram. Não foi observado `permission-denied` no sync desktop real. Isso não prova que a falha do telefone não seja de autorização; a causa desse aparelho permanece aberta.
7. **Órfãs:** `compareDeviceWithCloud()` é uma auditoria explícita separada, não uma etapa automática de `synchronizeNow()`. Por isso “Não verificado” não comprova que ela causou a falha. Adicionados `integrityStatus` e `integrityFailure`: uma falha na auditoria não apaga o resultado/horário de uma transferência bem-sucedida.
8. **Comparação local/nuvem:** um pull bem-sucedido com fila vazia atualiza a última transferência mesmo se a comparação encontrar diferenças. A UI informa dados atualizados com integridade pendente; `complete` continua falso enquanto houver divergência. Não há reconciliação financeira automática.
9. **Concorrência:** toques repetidos compartilham a mesma execução manual. Ela aguarda uma execução automática já em andamento; o automático não inicia outra durante a manual.
10. **Reads:** não foram adicionadas consultas ou listeners ao sync. Mantidos pull completo explícito e pull incremental automático com TTL existente. Auditoria de órfãs não é disparada no boot. Antes/depois da Equipe: duas consultas por carregamento (`members` e `teamInvites`); filtros/busca fazem zero consultas. Convites mantêm as consultas existentes, agora transacionais, com possível releitura em conflito. Não foi feita medição comparativa de cobrança Firestore em dois dispositivos reais.

Nenhum banco foi limpo, nenhuma fila descartada e nenhuma venda, pagamento ou saldo real foi ajustado. A instrumentação não resolve por si só eventual falta de espaço para persistir um snapshot completo: nesse caso ela expõe a causa e bloqueia a alegação de sucesso.

## Equipe

- Header global preservado. Nenhum card, banner, botão ou status de sincronização adicionado ao conteúdo da página Equipe.
- Resumo compacto de membros, ativos e convites; filtros Todos/Ativos/Pendentes/Inativos com contadores. Busca por nome/e-mail a partir de cinco registros, com filtragem local.
- CTA textual “Adicionar funcionário” também no mobile; cards com iniciais, cargo, espaços e estado.
- Menu de funcionário para editar, alterar cargo/espaços e revisar ativação/desativação no formulário. O owner atual não pode selecionar a própria desativação/demissão; a regra transacional de manter o último owner continua no servidor.
- Bottom sheet com inputs compactos, ícones, campos associados a labels, scroll interno, rodapé fixo dentro do modal, fechamento por Escape e navegação de foco no formulário.
- Presets de cargo mantidos. Atalhos para Vendas/Clientes/Produtos refletem as permissões granulares; personalização avançada recolhida. Owner só é oferecido a owner.
- Todos os espaços ou seleção específica em chips. Seleção vazia bloqueada; troca de empresa bloqueia envio de formulário antigo. `allowedSpaceIds` e controles do servidor preservados.
- Duplo toque bloqueado no frontend. O backend agora recusa convite pendente duplicado para o mesmo e-mail.
- Reenviar gera novo link, substitui atomicamente o convite pendente anterior e invalida seu aceite. Duas tentativas concorrentes não criam dois convites pendentes. O link ainda precisa ser compartilhado pelo usuário; não há envio automático de e-mail.

## Testes executados

- 534 testes Node da aplicação: aprovados.
- 104 testes Firestore/Auth/Storage Emulator e Rules: aprovados.
- 3 testes unitários do serviço de equipe: aprovados.
- Functions Emulator: owner legado, criação/duplicidade/reenvio concorrente, invalidação do link anterior, aceite seller em espaço específico, permissões, desativação/reativação e proteção do último owner.
- Equipe: 20 verificações de layout em 320, 360, 375, 390, 412, 430 e desktop 1440; sem overflow. Interações adicionais: filtros sem reads, owner protegido, duplo toque, preset de estoque, permissão rápida, cancelar/reabrir e viewport reduzida para teclado.
- WhatsApp individual: saldo canônico, cancelamento, idempotência, cliente sem dívida, offline e permissões. Dados sintéticos; nenhuma mensagem real enviada.
- Sequência V154: três contatos, 80 com localStorage cheio, 1/10/125 selecionados, reload/retorno, pular, cancelamento, offline/outbox, duas abas e falha IndexedDB.
- Login/reload: Firebase Auth Emulator com persistência real de sessão; bootstrap do fixture simulado. Não equivale a novo login físico Android.
- Home/Clientes, shell desktop, venda controlada em fixture, quatro auditorias de Financeiro, PWA, lint, build e `git diff --check` aprovados.
- **Ainda pendentes:** reprodução do erro de sync no celular; convergência celular/desktop com alteração controlada; smoke integrado completo da V155 com o fluxo real de autenticação, Histórico e telefone. As verificações por módulo não são declaradas como esse smoke integrado.

## Screenshots

Arquivos em `artifacts/team-access-v155/`:

- `equipe-mobile.png`
- `modal-adicionar-funcionario.png`
- `funcionario-ativo.png`
- `convite-pendente.png`
- `1440-owner.png`

Inspecionados visualmente contra as referências: hierarquia, cores turquesa, cards claros, chips e modal compacto preservados; painel de sync omitido intencionalmente. Screenshots usam dados QA e shell de fixture, não dados fictícios incorporados ao produto nem captura do header global em produção.

## Arquivos e publicação

Produção: `js/team-page.js`, `css/team.css`, `js/firebase/sync.js`, `js/firebase/firebase-ui.js`, `js/storage.js`, `functions/src/services/team-access-service.js`.
Versionamento: `js/build-info.js`, `index.html`, `js/firebase/auth.js`, `service-worker.js`.
QA: `tests/global-sync-v155.test.js`, fixture/script Equipe V150 (ampliados para V155), smoke Functions Equipe e expectativas de release nos testes existentes.

APP_VERSION local **155**; cache **veconi-v155-sync-team**. Não houve push nem deploy desta versão.
URL atual: https://murillocharles97-netizen.github.io/adi-festa-controle/ (V154).
Quando liberada, a publicação precisa incluir **createTeamInvite** antes do frontend, além do único deploy Pages, pois o reenvio depende da transação nova. Não é necessário publicar Rules modificadas: não houve modificação nelas.

Para retomar: obter diagnóstico do telefone imediatamente após “Sincronizar agora” falhar; confirmar código/etapa e corrigir a causa evidenciada; completar smoke integrado e multidispositivo; então fazer a publicação única. Não usar limpeza de storage ou ajustes financeiros como atalho.
