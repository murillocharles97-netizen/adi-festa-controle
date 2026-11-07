# Liberação controlada do frontend V227

Este parecer substitui o bloqueio geral ligado à coleta do recebimento antigo. O responsável adiou essa recuperação e autorizou a preparação da liberação com isolamento comprovado. GO técnico para publicação controlada do candidato local desta entrega, mediante autorização específica. A homologação Android por aparelho antecede o uso comercial nesse aparelho.

## Isolamento do recebimento antigo

A operação d0611a1a-cd01-4a8a-821d-0bebc8a5207c permanece fora de qualquer procedimento de recuperação nesta entrega. As consultas anteriores não encontraram efeito remoto com seu Operation ID. O backend rejeita a divergência histórica dentro da transação, antes de aplicar saldo, pagamento, ledger ou alocações. Os testes Emulator anteriores demonstraram rejeição atômica e replay único do envelope consistente.

A inspeção final encontrou uma lacuna no frontend b45c5f1: erro de pagamento era ignorado no Sync automático, mas ainda podia ser elegível ao retry manual. Foi adicionada uma proteção genérica para recebimentos rejeitados com permission-denied. O processador agora os ignora antes de alterar status/tentativas, inclusive no Sync manual. A compatibilidade também preserva esses pacotes. Não há regra especial por Operation ID ou empresa.

Os testes verificam que payload, checksum, tentativas, mensagem e identificadores do pacote retido permanecem iguais. O processador continua com vendas e recebimentos de outros clientes. Operações do mesmo cliente, usuário, empresa e geração ficam retidas, e a interface impede novas movimentações dependentes quando encontra o recebimento rejeitado na fila desse dispositivo. Não se trata de uma marcação remota do cliente. Outros aparelhos não recebem um bloqueio global novo.

O teste da fila usa pacotes sintéticos com a mesma classe de rejeição. O aparelho afetado e o payload real continuam indisponíveis. A evidência permite demonstrar a política do candidato, mas não inspecionar o conteúdo atual daquele IndexedDB. Até atualizar esse aparelho, seu código V226 mantém o comportamento antigo. Orientar o operador a preservar a ocorrência e evitar Sync manual/reentrada do recebimento nesse aparelho. Não é necessário extrair o payload Android para publicar este frontend.

## Compatibilidade e validação dirigida

- 130 testes locais e de contenção aprovados. Incluem isolamento da fila, pendência dependente, recebimento independente, cliente obrigatório, calendário, Fiado tradicional, permissões, atualização e extração readonly.
- Um teste adicional no Chromium utiliza dois contextos independentes, proprietário e funcionário, atualização efetiva de Service Worker, recarga e alternância offline/online. Compara integralmente fila e registro IndexedDB antes/depois.
- 15 cenários Emulator aprovados. Incluem venda parcelada, baixa única de estoque, 330 → 230 → 510, antecipação, alocações, resposta perdida, concorrência, isolamento e financeiro sem duplicação.
- QA responsivo sintético em 390 e 1366 px aprovado novamente.
- Revisões getoperationalsyncreceipt-00005-tim e commitoperationalsync-00009-yot ACTIVE, demais 97 Functions conferidas, Rules de calendário e extensão 3 Lindas verificadas por leitura remota nesta rodada. O documento da empresa mantém a versão da extensão autorizada e status financeiro pendente.
- Fiado tradicional continua com o fluxo existente. Em conta parcelada, backend exige fiadoSchedule. Cliente antigo recebe failed-precondition antes da gravação. V227 com marcador de conta parcelada e calendário incompleto bloqueia novo recebimento local.

Na primeira execução do teste novo, o mock da fila não incluía payments em CLOUD_NAMES. Foi corrigida essa configuração do teste. Uma expectativa indevida sobre quantidade de chaves locais também foi substituída por verificação de ausência de arquivamento/quarentena. A compatibilidade pode criar backup da operação independente, enquanto o pacote rejeitado é preservado. Logs iniciais e finais foram mantidos nas evidências externas.

## Publicação e atualização

O candidato desta entrega deriva de b45c5f1 e modifica sync.js, a guarda de Fiado e seus testes. Inclui a preparação PWA já presente em b45c5f1. Não incorpora o commit isolado do SpaceService. Nenhuma Function, Rule, política V3 ou cobrança recebeu alteração local.

O manifesto externo frontend-manifest.json identifica cada recurso e SHA-256 do pacote permitido. O commit final do candidato está no campo candidate do manifesto e na entrega. O pacote inclui somente os arquivos públicos da allowlist. O identificador do Service Worker corresponde ao candidato de transição. Não publicar a raiz do repositório.

Após autorização, conferir novamente revisões, Rules, domínio, branch publicada, manifesto e estado de cobrança. Usar o workflow seletivo de frontend existente. Conferir resultado de GitHub Actions, commit de build, domínio, recursos, Service Worker e QA autenticado. Nenhuma operação comercial real é necessária para o smoke inicial.

Por aparelho, concluir/salvar formulários antes de aceitar atualização. Conservar filas e IDs. Aguardar persistência local, aceitar ativação e recarga, conferir versão V227, empresa e espaço. A primeira atualização de um aparelho V226 usa a implementação antiga de aviso/recarga. Os novos avisos e a confirmação adicional passam a existir após carregar V227.

## Homologação Android e uso comercial

Android físico e múltiplos aparelhos reais permanecem pendentes por indisponibilidade de ambiente conectado. O teste Chromium foi uma simulação controlada com os módulos de atualização, sem alegação de instalação física Android.

1. Homologar primeiro proprietário e funcionário em ambiente sintético, com dois aparelhos. Registrar versões, perfil, empresa, espaço e IDs pendentes antes/depois da atualização.
2. Conferir preservação de IndexedDB/fila, formulários salvos, recarga, interrupção da rede e reconexão. Não reinstalar nem limpar armazenamento.
3. Exercitar cliente obrigatório, calendário completo/incompleto, parcial, antecipação, recibos e 330 → 230 → 510. Confirmar estoque único e idempotência no ambiente sintético.
4. Conferir aparelho antigo numa conta parcelada, com rejeição segura e orientação de atualização. Atualizar todos os aparelhos que operarão contas parceladas.
5. Liberar novos lançamentos comerciais somente nos aparelhos homologados. Manter o recebimento antigo preservado e as movimentações dependentes dele aguardando avaliação. A recuperação financeira terá autorização própria.

## Interrupção e contenção

Interromper publicação/homologação por divergência de fonte, revisão, permissão, perda/mutação de fila, duplicidade, apuração incorreta, execução de pacote retido ou calendário incompleto aceito como Fiado tradicional.

A referência ad773aa958031f002117a72482922f5eef78926c contém pausa de novas parcelas e mantém dívida, recebimentos e calendário. Ela antecede a proteção local de fila desta entrega, portanto não deve ser aplicada mecanicamente como rollback completo. Uma contenção deve conservar o isolamento de fila e a apuração V227, pausar novas criações e ser revisada contra o estado efetivo. A pausa no backend depende de autorização própria. Não voltar ao V226 puro se já existirem contas parceladas, restaurar dados ou reprocessar fila. Nenhum rollback foi executado.
