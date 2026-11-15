# Personalizar vencimento (ativação e renovação)

Branch local `claude/vencimento-personalizado`, a partir da `main` febe48d, no clone sanitizado. Nada foi publicado.

## Como funciona
- No modal "Venda com renovação" (ativação ou renovação) há o seletor **Personalizar vencimento**, **desligado por padrão**. Desligado, vale o cálculo automático existente, sem nenhuma mudança.
- Ligado, aparecem um calendário (começa no dia do cálculo automático) e um **horário opcional**:
  - **Sem horário**, mantém-se o horário do cálculo automático; só o dia muda.
  - O resumo mostra "Renovado até · personalizado" e o texto "Vence em 15/12/2026 às 10:30 · cálculo automático: 14/12/2026 (+1 dia)".
- A data e o horário são convertidos no fuso de São Paulo para um instante exato (`recurringActivation.customExpiry = { expiresAt, timeSet }`), que viaja na própria venda.

## Onde a data é respeitada
- **Servidor:** o `commitOperationalSync` refaz a venda com `functions/src/shared/engagement-domain.js` e compara campo a campo.
  - A regra nova está **espelhada de forma idêntica** no app (`js/customer-subscriptions.js`) e no servidor; um teste garante essa paridade.
  - `expiryOverride` entrou nos campos verificados (`versionedFields`).
  - Uma escrita que não seja a venda correspondente não pode criar nem alterar `expiryOverride`.
- **Assinatura:** `expiresAt` recebe a data escolhida e `expiryOverride` guarda `{ expiresAt, automaticExpiresAt, saleId, timeSet }`.
- **Calendário mensal ou anual:** a referência passa a ser o dia escolhido, então as próximas renovações automáticas mantêm esse dia.
- **Auditoria:** evento `expiry_customized`, com nota verificada pelo servidor: "Vencimento personalizado: 16/12/2026 10:30 (cálculo automático: 15/12/2026 15:00)". Aparece no perfil do cliente e na Central de Atividades.
- **Venda, recibo e item:** `subscriptionExpiresAt` com a data escolhida, mais `subscriptionAutomaticExpiresAt` e `subscriptionExpiryCustomized`.
- **Lembretes e indicadores de Renovações:** usam `expiresAt`, então refletem a data nova. A lista mostra "· personalizado" e o perfil, "Vencimento personalizado".

## Regras preservadas
- **Renovação antecipada:** o cálculo automático continua somando ao vencimento atual. A personalização substitui apenas o resultado final, e a próxima renovação automática parte da data personalizada e zera o `expiryOverride`.
- **Valores financeiros:** preço contratado, pagamento e Fiado não mudam.
- **Idempotência:** reaplicar a mesma venda não duplica a vigência nem os eventos.
- **Cancelamento:** restaura a vigência anterior com `expiryOverride: null` explícito.
- **Compatibilidade:** assinaturas existentes não exigem migração.
  - Versões antigas do app continuam funcionando com o servidor novo.
  - Um app novo diante do servidor antigo só falha, com segurança (rejeição), se usar a personalização.
  - Apps anteriores a esta versão copiam o `expiryOverride` sem alterá-lo ao renovar ou cancelar. O servidor aceita essa cópia inalterada, mas nunca um marcador novo ou editado, nem a cópia numa venda que personaliza a data. Testes no emulator usam o código do app anterior (`tests/fixtures/customer-subscriptions-pre-custom-expiry.js`).
  - Rollback: o servidor anterior ignora `expiryOverride`, e apps antigos renovam e cancelam assinaturas já personalizadas mantendo o dia escolhido (teste "rollback safety", aprovado também contra o código ao vivo 00016).
- **Validações, no app e no servidor:** a data precisa ser posterior à venda, ficar no máximo 1 ano além do cálculo automático (protege contra erro de digitação no ano), estar em formato ISO exato e usar a política de renovação atual. Pacotes legados não podem personalizar.

## Testes
- `tests/customer-subscriptions.test.js`: 30 de 30, sendo 8 novos. Cobrem:
  - ativação personalizada com idempotência;
  - renovação mensal antecipada com o dia de referência;
  - inválidos (passado, mais de 1 ano, texto livre, legado);
  - reversão;
  - conversão de data e hora em São Paulo;
  - paridade do código entre app e servidor;
  - o modal com a personalização ligada e desligada.
- Emulator com o validador real do servidor (`tests/emulator/operational-compatibility.rules.test.js`, novo caso):
  - forjas rejeitadas: data trocada na venda, data removida, data no passado e personalização sem venda;
  - repetição idempotente;
  - auditoria e reversão corretas.

  Arquivo completo junto com `customer-subscriptions.rules.test.js`: 41 aprovados, 2 pulados, 0 falhas.
- Testes de Functions: 250 de 250.
- Suítes completas comparadas com a `main` febe48d: **nenhuma falha nova** (`.test.js` e `.test.cjs`).
- Lint ok; build público com 263 arquivos; contenção 56 de 56.

## Validação no app real (emulador local, dados fictícios)
- Venda concluída de verdade no emulador (Pix): Renovações → Renovar "Personal 2x semana" → personalizar 16/12/2026 às 10:30 (automático 15/12/2026) → concluir.
- O servidor aceitou e gravou:
  - `expiresAt` 2026-12-16T13:30Z;
  - `expiryOverride` com o automático;
  - referência no dia 16;
  - valor de R$ 140 inalterado;
  - os eventos `renewal` e `expiry_customized`.
- O recibo mostra "Renovado até 16/12/2026". Renovações, o lembrete ("vence em 32 dias (16/12/2026)") e o perfil refletem a nova data.
- Capturas em 320, 390 e 1366 px: sem rolagem horizontal, campos legíveis. Em 320 px os campos empilham.

## Para publicar (somente com autorização)
1. **Functions primeiro:** `commitOperationalSync`, que usa `engagement-domain.js` e `operational-engagement-validation.js`. Sem isso, renovações personalizadas seriam rejeitadas (com segurança) pelo servidor antigo.
2. Depois o frontend, com versões de cache e service worker atualizadas.
3. Não há mudança em Rules, índices, Mercado Pago ou assinaturas da VECONI.
