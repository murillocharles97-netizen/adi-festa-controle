# Arquitetura SaaS multiempresa

## Isolamento

O contexto autenticado é resolvido nesta ordem: `Firebase Auth` → `users/{uid}` → `businesses/{businessId}` → `BusinessContext`. Nenhum componente administrativo recebe um `businessId` digitado pelo navegador.

Os documentos operacionais ficam em `businesses/{businessId}/{collection}/{documentId}` e carregam o mesmo `businessId`. O banco local, a fila offline, o marcador de sincronização e o último sync usam chaves separadas por empresa.

## Empresa original

`businesses/adi-festa` continua no mesmo caminho e não tem suas subcoleções movidas ou duplicadas. No primeiro login do proprietário, a migração idempotente completa os campos ausentes e aplica:

- plano `internal`;
- assinatura `active`, sem expiração;
- papel `owner`;
- limites internos sem bloqueio das funções atuais.

Antes de qualquer operação manual em produção, exporte o JSON pela tela Configurações. A migração não apaga documentos.

### Bootstrap e migração legada

A versão atual da migração é `1`. A conclusão é registrada em `migrationVersion` tanto no perfil `users/{uid}` quanto em `businesses/adi-festa`. O bootstrap considera a migração concluída somente quando os dois documentos possuem essa versão.

Campos preenchidos somente quando necessário:

- perfil: `uid`, papel `owner`, `permissions`, `migrationVersion`, `migratedAt` e `updatedAt`;
- empresa: `slug`, `onboardingCompleted`, `businessType`, assinatura interna ativa, limites internos, `migrationVersion`, `migratedAt` e `updatedAt`.

A tentativa automática possui uma trava em memória por usuário e só pode começar uma vez por sessão. Chamadas simultâneas reutilizam a mesma Promise. O aplicativo só inicia os listeners gerais depois que a migração terminou e o `BusinessContext` está pronto.

Em caso de falha, o proprietário pode usar o botão **Completar migração manualmente** na tela de erro. Para suporte técnico, com o proprietário autenticado, o mesmo comando está disponível no console:

```javascript
await window.LegacyMigrationAdmin.complete()
```

Para consultar o estado sem expor dados sensíveis:

```javascript
window.LegacyMigrationAdmin.state()
```

O bootstrap tem limite máximo de 15 segundos. Erros de cota, permissão, rede e falhas inesperadas levam a estados de erro explícitos; nenhum deles mantém o aplicativo indefinidamente em loading.

## Cadastro sem backend

Enquanto não há Cloud Functions, a criação usa um batch protegido pelas regras:

- somente `biz_{uid}`;
- uma empresa por UID;
- perfil `owner` pareado com a empresa no mesmo commit;
- trial entre 6 e 8 dias;
- plano obrigatoriamente `trial`;
- assinatura e limites não podem ser alterados pelo cliente depois da criação.

Essa solução é adequada para a fase atual, mas cobrança real, webhooks, alteração de plano, convites e administração da plataforma devem migrar para backend confiável.

## Planos

Os planos de referência estão em `plans.seed.json` e também no serviço local somente para exibição e limites. O botão de contratação registra apenas uma intenção simulada. O navegador nunca confirma pagamento.

## Catálogo público

O token da URL é o ID exato de `publicCatalogs/{visitToken}`. O documento público contém a identidade, empresa, visita, produtos e configurações mínimas. Pedidos repetem `businessId` e `visitId`, e as regras exigem correspondência com o catálogo.

## Implantação Firebase

As regras precisam ser publicadas no projeto antes de liberar cadastro:

```powershell
firebase deploy --only firestore:rules,storage
```

O GitHub Pages publica somente os arquivos do PWA; ele não publica regras do Firebase.

## Próximas etapas antes de clientes pagantes

1. Cloud Function `createBusinessAccount`.
2. Verificação de e-mail e recuperação de senha.
3. Convites de uso único com aceite no backend.
4. Provedor de cobrança e webhooks idempotentes.
5. Painel separado para `platform_admin`.
6. Testes de regras com Firebase Emulator Suite no CI.
