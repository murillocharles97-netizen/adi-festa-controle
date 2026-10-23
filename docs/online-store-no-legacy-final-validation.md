# Loja Online V2 sem legado — validação final local

14/10/2026, America/Sao_Paulo. Base de retirada do legado: 88cf8e97aff93b6c50a9c66b49bc1858e7eb67bf.
Correção de histórico somente leitura: 1ac5279efcaef7823d1feda176a18ffcf792a4d2.
Nenhum deploy, migração ou gravação de teste em produção nesta validação.

## Decisão

O bloqueador da projeção pública foi corrigido localmente após autorização explícita.
Resultados atualizados em online-store-public-availability-validation.md; nenhuma publicação realizada.
V170 sugerida para a próxima publicação autorizada, com smoke em nuvem/Android ainda pendente.
Android físico permanece pendente por indisponibilidade informada pelo usuário.

## Ambiente

App real em http://127.0.0.1:8188, exclusivamente demo-veconi-online-qa:
Auth 9098, Firestore 8098, Functions 5008 (proxy 8189), Storage 9298.
SDKs, Sync, transações e Rules reais, não mocks da lógica operacional.
Wrapper não exporta billing/reset/providers. Configuração Firebase real não foi alterada.
Servidor e emuladores QA permanecem abertos; dados inteiramente sintéticos.

Business online-integrated-qa-mv8845wu, espaços VECONI QA (qa-main-mv8845wu) e
VECONI QA — isolamento (qa-isolation-mv8845wu). Quatro produtos QA, sem clientes reais.
Um pedido antigo sintético preservado exercita a consulta histórica desativada.

## Smoke em navegador + Emulator

| Cenário | Resultado |
| --- | --- |
| Owner/Auth, Home e reload | Aprovado; sessão mantida no Auth Emulator |
| Loja ausente por espaço | Em preparação, sem loja criada automaticamente |
| Marca/tema/contato/catálogo/entrega/checkout/slug | Configurados pela UI, separadamente A/B |
| Salvar rascunho | Não publica nem reserva; published=false e v2Enabled=false |
| Publicar | Callables autenticadas explícitas A/B aprovadas; não automático |
| Confirmação nativa de publicação | Não comprovada pela extensão: bloqueou repetidamente; usado endpoint local após autorização, sem alegar sucesso do diálogo |
| Catálogo por espaço | A: exclusivos A + compartilhado; B: exclusivo B + compartilhado |
| Permissões | Manager A lê A; callable B, leitura/edição produto B negadas |
| Links e QR | Slugs A/B distintos, imagens QR carregadas; links oficiais distintos |
| QR no Android/câmera | Pendente; não escaneado fisicamente |
| Carrinho/checkout | Carrinho não move estoque; resumo antes do envio |
| Entrega | Endereço vazio bloqueia envio; endereço sintético aceito |
| Duplo clique em enviar | Um pedido, uma reserva |
| Reserva | No commit de pedido Novo; estoque físico não baixado |
| Cancelamento visual | Segunda confirmação inline; reserva liberada; zero venda |
| Novo → Confirmado → Preparando → Pronto | Histórico preservado; sem baixa antes de concluir |
| Reload em Pronto | Estado e ações recuperados |
| Concluir pelo fluxo canônico | Uma venda, uma baixa/movimento; business/space/actor corretos |
| Resposta perdida após submit | 503 após commit no proxy QA; reload recupera mesmo ID sem novo submit |
| Resposta perdida após conclusão | Mesmo saleId/operationId recuperado; não repete estoque/venda |
| Última unidade A/B concorrente | Uma tentativa aprovada, outra FAILED_PRECONDITION; reserva uma vez |
| Expiração Novo | Serviço transacional executado com tempo controlado; UI mostra Expirado, data/motivo e liberação |
| Confirmado não expira/replay/job duplicado | Aprovado em testes transacionais; não esperar 30 minutos reais nem observar Scheduler |
| Histórico antigo | Modal somente consulta, sem status/vínculo/criação de cliente/conversão; dados originais intactos |
| Link antigo | Catálogo encerrado ou indisponível; não abre fallback |
| Banner/migração/bootstrap global | Ausentes na UI/source V2; load não escreve loja global |
| Sync manual | dataSynced=true, integrityStatus=completed |
| Índice local/SW/reload | IndexedDB, queue pending/errors/total=0, swControlled=true |
| Android/PWA instalado | NÃO testado; standalone=false no navegador local |
| Responsividade | Loja/admin/histórico/catalogo/checkout em 320/360/375/390/412/430/768/1366; sem overflow horizontal após ajuste mínimo do título público |

A extensão não concluiu o diálogo nativo de publicação: não houve chamada no backend
quando a UI ainda mostrava rascunho. Publicação QA feita explicitamente pela mesma
saveOnlineStore, com Auth owner, confirmação, revisão e escopo. Não contornar a
confirmação de produção nem chamar isso de prova visual do diálogo.

Os links/QR apontam ao domínio oficial com slugs sintéticos; abrir a loja QA exigiu
substituir somente o host pela origem do Emulator. Não abriu/executou loja real.

## Artefatos de teste e transparência

- O primeiro teste visual de expiração adiantou o relógio do serviço e gravou updatedAt
  futuro no fixture, adiantando o cursor incremental QA. Isso foi identificado; apenas
  timestamps do pedido/reserva sintéticos foram reenquadrados para passado-30min/agora.
  Status, estoque, saleId, operationId e conteúdo operacional não mudaram. Sync completo
  então recuperou todos os pedidos. O helper foi ajustado para envelhecer o fixture antes
  de executar expiração com relógio real. Não houve alteração no código de Sync por isso.
- Uma aba administrativa antiga foi corretamente bloqueada por cache alterado em outra
  aba; reload permitiu continuar sem sobrescrever dados novos.
- Na sequência de resize/click da automação ocorreu um envio QA adicional, com outra
  tentativa/ID. Ele foi cancelado e sua reserva liberada, sem venda. Voltar ao carrinho
  foi revalidado com layout estável/teclado e não enviou; a fonte já usa type=button.
  Não classificar esse incidente como duplicação automática do mesmo pedido.
- Capturas verificadas individualmente após estabilização (as primeiras capturas em
  loop não são evidência final): verified-store-admin-desktop.jpg,
  verified-public-stock-desktop.jpg e verified-history-readonly-mobile.jpg.

## Bloqueador comprovado na validação anterior: disponibilidade pública (corrigido)

Produto qa-main-product, na loja A:
- Firestore canônico após a venda: estoqueAtual=2, onlineReservedStock=0.
- publicCatalogs da mesma loja: availableQuantity=3, reservedStock ausente.
- Nova abertura pública ainda mostra “3 disponíveis”.
- A venda/reserva valida o estoque canônico transacionalmente e nega consumo em excesso;
  o dado exibido é que fica antigo, até republicação.
- Inspeção do backend não encontrou projeção V2 de estoque disparada pela baixa.
- Não reparar estoque nem regravar vendas para resolver a projeção.
- Correção autorizada e implementada: atualização scoped da disponibilidade pública,
  cobrindo reserva/liberação/baixa, inclusive variantes, sem catálogo global ou listener
  global do frontend, sem expor custo/dados privados nem aumentar reads sem justificativa.

## Estado final QA

6 pedidos V2: 4 Cancelados, 1 Concluído, 1 Expirado. Um histórico legado sintético.
Uma venda (online_77e92956-1be2-4194-b2a9-b9f93c86280e), operationId
online-sale:77e92956-1be2-4194-b2a9-b9f93c86280e; um movimento de estoque.
Nenhuma reserva ativa. Estoques: main=2, cancel=2, last-unit=1, isolation=2.
Nenhum saldo/venda/pagamento de produção foi tocado. A limpeza aprovada na etapa
anterior tem auditoria separada em legacy-store-retirement-audit.md.

## Testes e ajustes locais

- App: 658/658; backend: 131/131; Firestore/Storage Emulator: 163/163.
- Lint/build: 335 arquivos JavaScript; git diff --check aprovado.
- Rules testam consulta owner e bloqueio de create/update/delete histórico, mantendo
  callables V2, concorrência, confirmação, venda canônica, variantes e 40 itens.
- Primeira execução em portas QA misturou IDs de projetos e falhou em Storage;
  Storage no projeto coerente: 13/13. Suíte completa em emulators:exec coerente: 163/163.
  Nenhuma Rule foi afrouxada.
- Histórico read-only também em testes de API/VM: nenhum dado alterado, conteúdo escapado,
  isolamento por empresa/permissão; flag legacy antiga não restaura UI.
- Badge mobile passa a contar somente Novos V2 autorizados/ativos, não históricos.
- CSS público: nome longo pode encolher com ellipsis; carrinho/voltar não encolhem.
  Corrigido corte do carrinho observado em 320 px; sem redesign ou mudança financeira.
- Harness, wrappers e scripts de publicação/rebase ficam locais fora do commit operacional.

## Versão e rollback

Bloqueador resolvido e testes locais repetidos; detalhes no relatório complementar. APP/SW ainda 169.
Sem push/deploy. Produção V169: b5c1aed4066c569d2665ad43749ecffd934b9f86.
Rollback frontend: V169. Não restaurar dados globais excluídos nem fazer rollback cego
de Rules/handlers após pedidos V2: pausar checkout mantendo reservas, recuperação,
expiração e histórico. Nenhum rollback deve apagar registros.
