# Loja Online sem legado — validação final local

14/10/2026, America/Sao_Paulo. Base: f23a8757bca6d72db959ffd8dfea86115c0ffe02.
Nenhum deploy nem gravação de teste em produção nesta etapa.

## Ambiente

Aplicação real servida em http://127.0.0.1:8188, com a única substituição de endpoints
Firebase para o projeto demo-veconi-online-qa. Auth 9098, Firestore 8098, Functions
5008 (proxy local 8189) e Storage 9298. Callables, Sync, transações e Rules são reais,
não mocks da lógica de negócio. Functions de billing/reset/providers não exportadas
pelo wrapper QA. Configuração não secreta do Emulator não afeta env de produção.

Espaços sintéticos VECONI QA e VECONI QA — isolamento; produtos exclusivos A/B e
uma unidade compartilhada para a corrida. Nenhuma loja criada no seed/bootstrap:
o owner deve configurar e publicar pela UI. Um pedido antigo sintético e seu pai
desativado exercitam o requisito de histórico preservado.

## Resultados até aqui

- Login owner pelo formulário e Auth Emulator: passou; Home/Sync/cache carregados.
- Loja A ausente: Em preparação; nenhum banner ou fluxo de migração.
- Marca, descrição, contato, catálogo, entrega/retirada, checkout e slug configurados
  pelo owner. Somente produtos de A e explicitamente compartilhados aparecem.
- Salvar configuração: um draft V2, published=false, v2Enabled=false, sem cobrança,
  pedido, venda ou reserva. Salvar não publica. Fonte inspecionada não cria catálogo global.
- O usuário informou confirmação A, mas a leitura do Emulator mostrou published=false,
  v2Enabled=false e somente uma chamada saveOnlineStore (o save anterior do rascunho).
  Após conferir ausência de diálogo ativo, uma nova tentativa abriu a confirmação.
  A extensão voltou a bloquear tanto a entrada quanto a captura de screenshot.
  Nova confirmação local solicitada; não há chamada de publicação nem repetição backend.

## Pendências que impedem conclusão

- Correção mínima autorizada e implementada localmente: histórico abre modal somente
  de consulta, sem status/vínculo/criação de cliente/conversão. Rotas de Pedidos não
  consultam mais uma flag legacy nem retornam à UI antiga. API local rejeita todas
  as mutações antes de tocar DB/Clientes/Vendas. Rules negam create/update/delete
  via frontend em catalogOrders e update de pedidos nos publicCatalogs antigos;
  leitura continua isolada por empresa/espaço. Callables V2 permanecem responsáveis
  pelas transições. Nenhum pedido preservado foi regravado.
- Home mobile/desktop não conta históricos aposentados como atendimento ativo
  (nem pedidos V2 expirados como pendência). Não houve redesign da Home.
- Loja B, publicação, links/QR, checkout, cancelamento/conclusão/expiração visuais,
  retry, SW, viewports e Sync/reload final ainda dependem de continuar o navegador.
- Android físico: usuário informou indisponível; registrar pendência. Viewport mobile
  e SW em loopback não equivalem a PWA Android instalado, teclado/background/rede real.

## Versão / rollback

Sugestão da próxima versão: V170, somente após validação/preparação; não incrementada
nem publicada. Produção permanece V169 e59b290b31d893e58f11b4ef40fe3bd4b77a26f9.
Rollback de frontend: V169. Não restaurar dados globais excluídos, não reativar migração,
não fazer rollback cego de handlers/Rules/reservas após novos pedidos. Pausar checkouts
do piloto mantendo recuperação, reservas, histórico e expiração; nenhum rollback apaga dados.

O commit final candidato e evidências serão registrados quando o smoke estiver concluído.

## Regressão da correção de histórico

- App: 656/656, backend: 131/131. Lint/build: 335 arquivos JavaScript; diff --check OK.
- Teste de UI em VM: mostra conteúdo histórico escapado; exclui outra empresa,
  registros sem permissão e pedidos V2; nenhum botão de mutação; Escape fecha;
  dados permanecem exatamente iguais. Isso é teste automatizado, não screenshot.
- Teste de API antiga: cada mutação rejeita antes de escrever; produtos, clientes,
  pedidos e vendas permanecem iguais. Estado salvo legacy=true não restaura UI antiga.
- Rules: owner pode consultar histórico, mas não editar status/vínculo, apagar ou
  recriar pedido antigo. Os testes V2 continuam passando, incluindo conversão canônica,
  reserva concorrente, repetição, 40 itens e variações.
- Primeira execução conjunta em portas QA misturou projeto adi-festa-variations-test
  com Storage iniciado como demo-veconi-online-qa, causando recusas de Storage.
  Repetição de Storage com projeto coerente: 13/13. Nenhuma Rule foi afrouxada.
  Suíte completa repetida com emulators:exec no projeto/portas padrão: 163/163,
  saída 0 e encerramento automático desses emuladores. Backend: 131/131.
- Expiração: comprovada transacionalmente com relógio de teste no limite de
  30 minutos, replay e pedido Confirmado preservado. Não equivale a observar o
  Cloud Scheduler nem esperar 30 minutos no navegador nesta etapa.
- Nenhuma gravação/limpeza/deploy em produção nesta validação. A limpeza aprovada
  da etapa anterior consta separadamente em legacy-store-retirement-audit.md.

## Decisão nesta etapa

A correção de histórico está validada automaticamente, mas o smoke visual completo
ainda não foi concluído. Não preparar/publicar V170 nem alegar validação física.
Servidor QA e emuladores exclusivos do navegador permanecem abertos para retomada.
A confirmação nativa deve ser resolvida pelo usuário somente na aba de loopback;
não repetir ações em produção. Os arquivos novos do harness QA ficam locais,
fora do commit de correção; não são uma alteração na configuração Firebase real.
