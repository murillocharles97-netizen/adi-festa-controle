# D3: servidor inacessível vira "erro" em vez de "aguardando conexão"

- **Status:** defeito real, reproduzido na homologação local. **Ainda não corrigido**, por regra (documentar antes de corrigir).
- **Base:** existe na V231.1 (`557e365`). Não foi introduzido pela Fase 1 nem pela Fase 2.

## Reprodução (Emulator, dados fictícios)
1. Inicie `scripts/homolog/android-homolog.cjs start` e entre com qualquer conta fictícia.
2. Rode `android-homolog.cjs offline`. O servidor fica inacessível, mas o navegador continua `navigator.onLine === true`, como acontece com sinal fraco, Wi-Fi sem internet, portal cativo ou DNS falhando.
3. Faça uma venda.

**Resultado observado**, igual para dono, vendedora, uma loja e várias lojas:
- A venda é salva no aparelho e o pacote vai para a fila.
- A primeira tentativa falha com `code: "internal"` e `message: "internal"`. É o que o SDK do Firebase Functions devolve quando o `fetch` não alcança o servidor.
- `internal` **não** está em `transientSyncCodes`. O pacote fica `status: "error"` e "Erros ativos: 1", e o ícone mostra "Erro na nuvem".
- Depois que o servidor volta, o pacote **não é reenviado sozinho**: ficou em erro por mais de 50 s, com `sendable: false`.
- A tela mostra "O servidor não confirmou esta operação". Isso não diz ao usuário que foi só falta de conexão.
- Só "Sincronizar agora" (manual) envia. O servidor aplicou cada venda **uma única vez**, com estoque e movimentos corretos (sem duplicação).

## Impacto
Uma venda feita com internet instável aparece como erro e fica parada até alguém sincronizar manualmente. Isso combina com o relato de "instabilidade" sem perda de dados. Também infla "Erros ativos" e o diagnóstico, que hoje não distingue esse caso de uma recusa real.

## Causa
- O SDK usa `internal` tanto para "não alcancei o servidor" quanto para "exceção inesperada no servidor".
- O cliente trata todo `internal` como permanente.
- O motivo estável da Fase 1 deixa o caso visível (`rejectionCategory: "unclassified"`, sem `details`), mas não muda a decisão.

## Correção proposta (não implementada)
- **Diferenciar pela evidência, não pelo texto:**
  - Uma recusa real do servidor sempre chega com `details.reason` (Fase 1) ou com um código de negócio.
  - Um `internal` **sem** `details` e sem resposta HTTP do servidor é uma falha de transporte.
  - Esse caso entra no caminho transitório que já existe: `syncConfirmationPending`, e o recibo `getOperationalSyncReceipt` é consultado antes de reenviar.
  - Assim nada é reaplicado às cegas, e a idempotência por `operationId` continua valendo.
- **Fallback para a Function publicada (sem `details`):** um `internal` vindo do servidor também pode ser exceção real. Por isso ele segue o mesmo caminho de recibo antes de qualquer reenvio, com o limite atual de 6 tentativas e depois revisão.
- **Testes necessários:**
  - Emulator com o portão de rede desligado e religado: a venda é enviada automaticamente uma única vez.
  - Uma exceção real do servidor não entra em loop.
  - Recusas tipadas continuam permanentes.

## O que não fazer
- Não presumir conexão para todo `internal`: o `internal` vindo do servidor pode esconder um defeito.
- Não reenviar sem consultar o recibo.
