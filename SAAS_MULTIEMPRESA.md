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
