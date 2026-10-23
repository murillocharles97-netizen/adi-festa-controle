# Confirmação de recebimento — WhatsApp sem telefone

V196 preparada na branch `codex/receipt-whatsapp-ux`, base/rollback frontend V195 `ebe49c9a58623192440f27cc999ae9d42220b10a`. Publicação autorizada pelo owner após isolamento e testes. O incidente de bootstrap Android é uma investigação separada e não foi incorporado.

## Causa e comportamento

`ClientesPage.paymentSuccess` desabilitava WhatsApp pelo comprimento do telefone e só registrava o handler quando havia número. Mobile e desktop compartilham essa confirmação. A confirmação de venda (`Recibos`) e as cobranças não fazem parte deste hotfix.

O botão permanece clicável. Telefone válido usa a mesma mensagem pronta e URL `wa.me`. Telefone ausente ou inválido abre “Cliente sem WhatsApp cadastrado”, com cadastro de telefone, compartilhamento, cópia e WhatsApp Web.

No celular com Web Share, a ação explícita abre a lista nativa; o aplicativo não escolhe o destinatário nem presume envio concluído. Cancelar essa lista mantém o recebimento. Desktop, API ausente ou falha oferecem copiar e abrir WhatsApp Web. Falha da área de transferência permite seleção manual do texto, sem alegar cópia bem-sucedida.

Cadastro exige a permissão existente `customers.edit` e respeita modo somente leitura. Sem edição autorizada, o compartilhamento continua disponível e o motivo da indisponibilidade do cadastro aparece. Número é validado com PhoneUtils; duplicata local é rejeitada. O save altera somente telefone, normalizedPhone e atualizadoEm do cliente vivo no namespace atual. Não usa formulário completo que possa sobrescrever outros campos.

## Integridade e acessibilidade

O fluxo usa o recebimento já retornado pelo pipeline existente. Não chama Fiados.receber, não cria operationId comercial, não modifica pagamento, saldo, venda, estoque, Financeiro ou configuração. Somente salvar telefone explicitamente produz a atualização normal do cadastro pelo Sync existente.

Respostas/handlers são vinculados à conta, empresa, geração e escopo de acesso de origem. Há proteção contra duplo envio, inclusive durante flush local. Dialogs têm título acessível, status anunciado, foco inicial, contenção de Tab/Shift+Tab, Escape e retorno de foco. Botões têm pelo menos 44–46 px, texto quebra, mensagem pode ser selecionada, layout mobile usa coluna e considera área segura.

## Arquivos

- `js/clientes-page.js`: somente closure paymentSuccess e seus helpers internos.
- `css/clientes-page.css`: estilos restritos ao dialog de confirmação.
- `tests/payment-confirmation-sharing.test.js`: regressões com dados fictícios e DOM/eventos em memória.
- `tests/fixtures/payment-confirmation-sharing.html`: página QA com interface real e dados/APIs fictícios em memória, sem acesso ao armazenamento ou serviços da aplicação.
- `index.html`, `service-worker.js`, `js/build-info.js`: somente atualização dos assets da confirmação e metadados/cache V196.
- `tests/team-sync-release-v179.test.js`: contrato da release V196 mantém os singletons protegidos V194 e os ajustes V195 intactos.
- Este documento.

**56/56 testes direcionados aprovados**, incluindo 17 regressões novas do compartilhamento e três contratos de preservação da release. Lint/build: 412 arquivos JavaScript aprovados; diff-check aprovado. Os testes relacionados incluem concorrência de recebimentos, retomada/paginação de clientes, recibo de venda e armazenamento. Não houve teste físico Android nem compartilhamento com contato real. A página QA permite validar o DOM publicado; as APIs externas são simuladas e não substituem o teste físico.

## Publicação futura

Somente frontend/PWA. Atualizadas as URLs de clientes-page JS/CSS e build-info e os metadados/cache da release V196. Imports de Auth/Sync e código de Trocas/Fiado preservados. Functions e Rules não são necessários. Rollback deste ajuste visual usa V195, sem restaurar dados nem remover telefones cadastrados legitimamente. O rollback compatível de Trocas `038725b34b0930e1f6f468e68611fc7da7e1720f` e anteriores continuam preservados.

Tag proposta antes da publicação: `rollback/v195-before-v196-payment-sharing`.
