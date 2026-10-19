# V186 — hidratação sem operações comerciais

Base/rollback: V185, `1b5157d77ebb5ec2a537de6dae49d1c98cfe3421`.

## Escopo

- OperationMode.applyRemote usa DB.hydrateOperation: estágio local somente da configuração, sem normalizar entidades nem passar pelo wrapper comercial DB.alterar.
- A normalização mantém a sanitização do TeamAccess: defaults não reaparecem como custo/lucro no cache restrito.
- operation-settings separa cache por empresa/UID/principal/geração, invalida respostas de sessão antiga e limita persistência a alteração explícita do usuário. Bootstrap não envia migração nem reconciliação automática de configurações.
- Diagnóstico não rotula lote simple/legacy contendo vendas como credit_sale.
- Sem alteração de Rules/backend, permissões, estoque, vendas, saldo ou configuração de espaço. Diferença 14/4 produtos fora do escopo.
- Operação de incidente 9b4edfc5-ef7c-4af1-aac0-01087d29b4a4 permanece intacta; sem retry, conversão, descarte, migração ou tratamento especial por ID.

## Validação pré-publicação

40 testes app aprovados: seis regressões específicas, ciclo de sessão/cache V185 e Dashboard/Histórico V184; fila legítima preservada, venda explícita capturada uma vez, hidratação repetida owner/seller sem fila nova, cache restrito, respostas obsoletas, isolamento por namespace, duas abas e CAS.

19 testes Firestore Emulator aprovados: vendas owner/seller/cashier, simples/variações, idempotência, fila retida preservada e restrições de dados sensíveis/espaço. Testes negativos emitiram permission-denied esperado.

Lint e build: 387 arquivos JS. git diff --check aprovado.

Nenhuma venda real executada. Smoke autenticado pós-deploy registrado separadamente; não confundir resultados em VM/Emulator com validação de login físico. Não publicar otimização Fiado preexistente e não aprovada neste hotfix.
