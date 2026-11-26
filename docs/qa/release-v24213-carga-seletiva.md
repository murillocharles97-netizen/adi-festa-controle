# V242.13 — Carga seletiva e projeção por coorte

Use um pacote de Functions cuja entrada seja `src/customer-account-preparation-entry.js`. A entrada expõe exclusivamente `manageCustomerAccounts` e `projectCustomerAccount`. Prepare o pacote em pasta isolada a partir do commit validado, copiando `functions/src`, `functions/package.json` e `functions/package-lock.json`. Ajuste somente `main` da cópia do `package.json`. Use `firebase.json` com apenas `functions.source`, runtime Node 22 e exclusão de `node_modules`, `test` e logs. Não leve variáveis dos outros módulos para esse pacote.

## Antes de habilitar a carga

1. Conferir o HEAD remoto, as revisões em produção e o PITR. Registrar um ponto de recuperação em minuto UTC completo, entre a versão mais antiga disponível e o horário atual. Validar a leitura desse ponto. Usar a restauração já ensaiada como referência.
2. Publicar `manageCustomerAccounts` seletivamente após autorização, com `VECONI_ACCOUNT_LOAD_SCOPE=<empresa>:<geração>`. Omitir `VECONI_ACCOUNT_PROJECTION_SCOPE`. Escopo ausente ou diferente bloqueia a operação. Confirmar o comportamento antes de aplicar a primeira página.
3. Chamar `customer_account_backfill_preview` como proprietário com `businessId`, `workspaceGeneration`, `rules: []`, `limit: 10` e o `cursor` anterior. Conferir novamente a cobertura e excluir casos de revisão, migração ou arquivamento. Guardar os objetos `approval` somente em evidência privada. Repetir a prévia imediatamente antes de aplicar. Se a prévia mudar, obter aprovação da nova prova.

## Aplicação após GO

Separar a lista aprovada em páginas de até 10. Fixar um `runId` e um `pageId` único por página. Enviar o corpo abaixo à Function autenticada. Cada `approval` vem da resposta da prévia e a Function recalcula a prova em transação antes da gravação.

```json
{
  "kind": "customer_account_backfill_apply",
  "businessId": "<empresa>",
  "workspaceGeneration": 0,
  "runId": "<execucao>",
  "pageId": "pagina-01",
  "rules": [],
  "confirmed": true,
  "backupConfirmed": true,
  "items": [{ "clientId": "<cliente>", "financialVersion": 0, "proofHash": "<sha256-da-previa>" }]
}
```

Após perda de resposta, repetir o mesmo corpo com os mesmos identificadores. O recibo do item é gravado na mesma transação da conta. O recibo da página e os contadores avançam uma vez ao concluir todos os itens. Uma prova vencida resulta em `needs_review` para aquele cliente. A nova aprovação deve usar outra execução para preservar o recibo anterior. Conferir que `applied` e `needs_review` correspondem aos recibos e que a operação alterou apenas documentos derivados e da própria carga.

## Projeção e conferência após a carga

1. Com as páginas concluídas, retirar o escopo de carga da configuração. Sob autorização, publicar `projectCustomerAccount` e `manageCustomerAccounts` com `VECONI_ACCOUNT_PROJECTION_SCOPE=<empresa>:<geração>`. O gatilho usa somente contas marcadas pela carga seletiva. Manter a V242.12, as Rules e os gravadores vigentes.
2. Chamar `customer_account_backfill_catchup` como proprietário, com `businessId`, `workspaceGeneration` e `clientIds` das páginas aplicadas, em grupos de até 10. Repetir para toda a coorte, inclusive onde o gatilho não recebeu eventos. A reconstrução transacional incorpora eventos da janela sem reenviá-los e é segura em paralelo com o gatilho. Casos que perderem a prova ficam fora da leitura nova.
3. Conferir versão financeira, saldo por Espaço, itens e estados. Repetir nas contas que mudarem durante a conferência, preservando os recibos e as filas offline. Só em etapa posterior liberar Rules e leituras novas. Caso a ativação precise voltar, remover o escopo de projeção e manter o gravador compatível com pacotes pendentes. Preservar contas derivadas e recibos do lote para auditoria. Usar `customer_account_backfill_catchup` na retomada, com o gatilho novamente ativo.

Esta etapa mantém os comandos de migração, abertura, ajustes e reconciliação bloqueados no pacote de preparação. As Rules e os índices atuais são suficientes para a escrita pelo servidor.
