# Recuperação acessível à equipe — correção local após V180

Estado: somente local, sem commit/deploy e sem envio das quatro operações reais.
Base: V180, `2cd4ec0af33b25e60191340dd7d39701da644208`.

## Auditoria somente leitura (17/10/2026)

O perfil, o documento de membro e o vínculo da funcionária existem e estão ativos
como `seller` (Vendedor / Caixa), no mesmo negócio e no único espaço autorizado.
Firebase Auth não indica conta desativada. Pro está ativo. Não foram encontrados
`readOnly`, `blocked`, `suspended`, `planLock`, reset ou troca de geração no negócio.

Permissões verdadeiras no membro: `sales.create`, `sales.cancel`, `customers.view`,
`products.view`, `inventory.view`. Financeiro, custos, lucro, Equipe e Configurações
continuam negados. A atualização de permissões, às 15:51 BRT, não apagou as quatro
permissões básicas. Isso não equivale a observar o estado efetivo no aparelho.

O navegador disponível está na sessão do proprietário, não na da funcionária.
Não houve login, troca de senha ou alteração da conta real. O usuário não consegue
enviar uma imagem da tela. Portanto, o congelamento/bloqueio visual completo do
aparelho não foi diretamente reproduzido e sua causa exata não está comprovada.

## Falhas confirmadas no código

1. A V180 só procurava evidências na fila/cache da assinatura de permissões atual.
   O acréscimo de `sales.cancel` muda essa assinatura. Uma fila anterior fica
   preservada em outro namespace, mas o contador da recuperação não a encontra.
   A separação de caches já existia; a descoberta incompleta da recuperação é V180.
2. O backend exigia `sales.create` até para preservar a evidência do próprio ator.
   Isso contraria a política de recuperação independente de permissão comercial.
   Como essa permissão está verdadeira na conta real, esse requisito isoladamente
   NÃO explica o bloqueio total relatado nessa conta.
3. O assistente de configuração inicial podia abrir para um funcionário sem
   `settings.manage` quando o cache novo estivesse vazio. O bootstrap também podia
   tentar gravar a configuração local mais recente sem essa permissão. São falhas
   anteriores à V180, reproduzidas de forma sintética; não foi comprovado que o
   assistente é a tela que bloqueou o aparelho real. A configuração remota atual
   da empresa informa onboarding concluído.

## Correção mínima implementada

- `js/business-cache.js`: leitor de evidências estritamente `readonly`, por UID,
  empresa e geração, incluindo namespaces anteriores de permissões. Consulta
  chaves e filas primeiro e só lê snapshots relacionados a evidências retidas.
  Não lê coleções privadas de Financeiro/clientes, não hidrata caches antigos,
  não importa filas e não confirma, normaliza, remove ou reprocessa operações.
- `js/sale-recovery-client.js`: mantém o snapshot de origem de cada operação;
  confere cópias idênticas e interrompe diante de conteúdo conflitante. Prepara
  todos os envelopes antes do primeiro envio e mantém os envios seriais.
- `js/sale-recovery-ui.js` e `css/sale-recovery.css`: painel fora do conteúdo das
  rotas comerciais, mas dentro da sessão autenticada/validada. Usa o leitor de
  evidências, não depende do Sync iniciado, reage à sessão/contexto e preserva
  acessibilidade mesmo em rota negada ou plano somente leitura.
- `functions/src/services/sale-recovery-service.js`: remove somente a exigência
  comercial `sales.create`. Permanecem Auth, perfil e membro ativos, negócio ativo,
  espaço autorizado, geração, ator original, hash, pacote imutável e idempotência.
  O funcionário continua vendo apenas suas revisões, e não obtém o payload privado
  de outros atores nem acesso a módulos financeiros.
- `js/operation-mode.js` e `js/firebase/operation-settings.js`: funcionário sem
  `settings.manage` não abre o assistente de configuração nem tenta persistir
  configuração no bootstrap/retry. As Rules não foram alteradas.

Não há novas Functions/triggers nem novos destinos comerciais. A coleção de
recuperação continua sem trigger que produza venda, estoque, faturamento ou saldo.
Não há exceção por usuário, loja, produto ou ID QA.

## Testes

- 39 testes direcionados: recuperação, cópias, conflito, quatro operações/11
  movimentos, resposta perdida, duplo clique, retenção da fila, tenant, geração,
  sessão e configuração inicial da equipe.
- 24 testes no Firestore Emulator: preservação, imutabilidade, idempotência,
  isolamento, acesso sem qualquer permissão comercial ou plano ativo; vendedor e
  caixa, venda simples/variação e rejeição de operações proibidas sem efeito parcial.
- Navegador local com IndexedDB real e CSP `connect-src 'none'`: quatro operações
  no namespace anterior, namespace atual vazio, todos os módulos comerciais
  bloqueados e rota negada. Botão acessível; confirmação enviou quatro pacotes ao
  mock local. Os registros antigos ficaram byte-equivalentes e os 11 movimentos
  preservados. Zero efeitos comerciais e zero gravações de configuração.
- Validação visual em 390 px, não Android físico. Lint/build/diff-check executados
  ao concluir. Sem teste invasivo em produção.

Um fixture de teste usava hora 24 ao criar a décima amostra; foi corrigido para
horas válidas. A primeira execução do Emulator falhou por esse dado sintético;
a repetição dos 24 cenários passou sem relaxar validação de datas.

## Publicação e uso esperado

Requer hotfix de frontend e do serviço das três callables de recuperação; não
requer alteração de Rules nem migração/permissões da conta. A publicação não foi
executada. Ao preparar a próxima versão, atualizar o cache/SW e as referências dos
arquivos alterados. Rollback técnico para V180 acima, lembrando que a limitação de
descoberta da V180 volta se houver rollback.

Após publicação autorizada, no MESMO aparelho e navegador/PWA de origem: abrir a
conta normalmente, tocar em **Enviar dados para recuperação** e confirmar. Nenhum
procedimento técnico, senha compartilhada, acesso a Configurações ou retry de
venda é necessário. Owner consulta as revisões após o recebimento confirmado.

Não é possível comprovar a captura das quatro vendas reais antes do envio pelo
aparelho de origem. Se aparecer conflito/corrupção ou o vínculo estiver revogado,
o fluxo para com mensagem explícita e preserva tudo; não executa reparo automático.

A otimização de confirmação de Fiado preexistente em `js/firebase/sync.js` ficou
intocada e NÃO pertence a este hotfix. Nenhuma fila/cache/dado real foi alterado.
