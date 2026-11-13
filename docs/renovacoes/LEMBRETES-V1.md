# Lembretes de renovação — V1

Branch local `claude/renovacoes-v1`, sobre os commits V1 (fca7993, d31b27a, 15084c7), que **não foram reescritos**. Nada foi publicado nem enviado.
Não houve alteração em Rules, Functions, índices, Mercado Pago, webhooks ou assinaturas da VECONI. Este módulo trata das mensalidades dos clientes do comerciante.

## Como cada mensagem fica presa à assinatura certa
1. **Seleção por assinatura.** Em Renovações, cada caixa marca uma assinatura, não um cliente. O lote só existe com um espaço escolhido, a mesma regra da V1.
2. **Retrato da seleção.** `RenewalMessages.buildContext` congela, por cliente, apenas as assinaturas marcadas daquele espaço. Para cada uma guarda: plano, variação, valor contratado, vencimento, espaço e a impressão da vigência (`renewalSnapshot`). O retrato fica gravado na sequência da Central, no IndexedDB do motor existente, e sobrevive a um recarregamento.
3. **Uma mensagem por cliente.** Com vários planos, `{{renovacoes}}` gera uma linha por plano, cada uma com plano, valor e vencimento juntos. `{{plano}}`, `{{valor}}`, `{{vencimento}}` e `{{situacao}}` só funcionam com um plano. Com dois ou mais, a tela bloqueia o envio e pede `{{renovacoes}}`.
4. **Revalidação antes do WhatsApp.** A conferência acontece na pré-visualização e de novo ao tocar "Preparar mensagem". Cada assinatura é relida da nuvem e conferida: mesmo cliente, mesmo espaço, espaço ativo e autorizado, não cancelada, não pausada, vigência igual à da seleção.
   - Se algo mudou (renovada, cancelada, outro espaço, sem conexão, leitura falhou), o plano **sai da mensagem** com um aviso claro.
   - Se nenhum plano for confirmado, a mensagem não é preparada.
   - Se algo mudou entre a pré-visualização e o toque em preparar, a tela volta para revisão.
5. **Sem Fiado.** O tipo "Lembrete de renovação" não oferece `{{saldo}}` nem `{{ultima_cobranca}}`. Se o texto contiver essas variáveis, o envio é bloqueado. O registro confirmado não grava valor de cobrança, não altera o cliente e não cria cobrança: o `publishConfirmedMessage` existente só toca cliente e cobranças no tipo `charge`.

## Envio e estados
- O envio é manual, um cliente por vez, sempre com pré-visualização.
- **Mensagem preparada:** o texto final fica salvo no aparelho, mas nada sai ainda.
- **WhatsApp aberto:** registrado em `openedAt`, sem mudar a revisão da sequência.
- **Envio confirmado pelo operador:** gravado com `confirmation: "operator"` e `deliveryVerified: false`. A tela informa que o WhatsApp não confirma entrega.
- O evento confirmado vai para o `messageHistory` existente com `subscriptionIds`, `renewalSpaceId`, `renewalItems`, `preparedAt` e `whatsappOpenedAt`.

## Já lembrado hoje
- O histórico existente marca "Lembrado hoje" por assinatura, considerando o dia de São Paulo.
- Os atalhos de seleção deixam essas assinaturas de fora e avisam quantas ficaram de fora. Para repetir, é preciso marcar individualmente.
- No composer, repetir exige marcar "Enviar novamente mesmo assim".
- Para valer entre aparelhos, foi criada `SyncFirebase.queryMessageHistorySince`: leitura do dia por `sentAt` (índice automático), no máximo 200 registros, só leitura.

## Seleção e atalhos (Renovações)
- Atalhos: Hoje · Amanhã · Até 7 dias · Vencidas · **Lembretes do dia**. O último usa os dias 7/1/0 que o produto grava em cada assinatura.
- A barra mostra "N assinaturas · M clientes" e leva para "Preparar lembretes".
- A Central abre em modo renovação: lista só os clientes do lembrete, mostra "N planos", tem o botão "Iniciar lembretes" e o voltar leva para Renovações. Ao final, "Concluir" também volta para Renovações.

## Problemas encontrados e corrigidos nesta etapa
| Problema | Correção |
|---|---|
| A normalização local (`storage.js`) convertia `messageHistory`/`messageTemplates` de tipos desconhecidos em `custom`. O lembrete voltava da nuvem como "custom" e não era reconhecido em outro aparelho | Incluído `renewal` nas duas listas, com teste de regressão |
| "Lembrado hoje" não aparecia num aparelho novo (o `messageHistory` não faz parte da carga inicial) | Leitura do dia com `queryMessageHistorySince` antes de decidir a repetição |
| "2 planos" aparecia em vermelho (cor de dívida) na Central | Cor neutra |
| A pré-visualização ficava abaixo de 10 botões de variáveis | Pré-visualização primeiro; editor em "Editar mensagem" |
| O selo "Lembrado hoje" ficava dentro da pílula de prazo | Selo separado da pílula |
| A tela final dizia "enviados" | "N confirmados por você", com nota de que o WhatsApp não informa entrega |

**Observações, sem alteração:**
- No desktop, o composer usa o mesmo visual da Central V2 para os outros tipos.
- Num perfil novo de navegador, o onboarding "Como sua empresa trabalha?" aparece por cima do app logo após o login. É pré-existente e não tem relação com Renovações; nas capturas ele foi fechado sem salvar.

## Testes
- `tests/renewal-reminders.test.js`: **11 testes**, com motor e composer reais em jsdom:
  - variáveis, várias assinaturas e bloqueio de Fiado;
  - um plano com todas as variáveis;
  - fluxo completo preparada → WhatsApp aberto → confirmada, com o evento e a volta para Renovações;
  - assinatura renovada ou cancelada durante o fluxo;
  - troca de espaço, sem conexão e falha de leitura;
  - lembrete de hoje com ação consciente, o de ontem não bloqueia e WhatsApp apenas aberto não conta;
  - contexto de um espaço só;
  - garantias do motor;
  - Central e ausência de Mercado Pago;
  - lembrete vindo de outro aparelho;
  - normalização do tipo.
- `tests/renovacoes-page.test.js`: 14 testes, incluindo seleção por assinatura, atalhos, "Lembrado hoje" e o retrato enviado à Central.
- Suíte completa: **1189 testes, 1105 passam, 84 falhas, todas pré-existentes e nenhuma nova**. Lint ok.

## Validação no app real (emulador local, dados fictícios)
Fluxo completo homologado: Renovações (Loja Centro) → "Lembretes do dia" → 2 assinaturas da mesma cliente → Central → pré-visualização com uma linha por plano → preparar → abrir WhatsApp (interceptado no QA; URL conferida) → "Sim, enviado" → Concluir → Renovações com "Lembrado hoje".
- No Firestore do emulador: 1 registro `renewal` confirmado pelo operador, com as 2 assinaturas e o espaço; 0 cobranças; cliente sem alteração.
- Capturas em `docs/renovacoes/lembretes/` (320, 360, 390 e 1366, mais a revalidação), com medições em `medicoes.json`: sem rolagem horizontal em nenhuma largura.

## Pendências para publicar
- Subir as versões de cache dos scripts alterados (`mensagens*.js`, `message-sequence*.js`, `storage.js`) e do service worker, além do build-info.
- Integrar com as correções de Rules do Codex (P1/P2) antes da publicação.
