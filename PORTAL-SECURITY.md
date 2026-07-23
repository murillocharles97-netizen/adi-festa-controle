# Segurança do Portal do Cliente

O Catálogo Online usa um link público por visita e mantém os dados pessoais fora da URL. A identificação procura somente o hash SHA-256 do telefone normalizado, sem listar clientes, e cria uma sessão aleatória armazenada no aparelho. Os documentos públicos expõem apenas nome/telefone mascarados, pedidos daquela visita e progresso de campanhas. Saldo, fiado, pagamentos, observações internas e histórico financeiro não são publicados.

## Limitação conhecida nesta versão

O projeto está no plano gratuito do Firebase e não usa Cloud Functions. Por isso, a verificação do telefone é uma consulta exata protegida por hash, mas ainda não possui código SMS, bloqueio por IP ou rate limit no servidor. A sessão serve para impedir navegação casual e evitar identificadores abertos; ela não deve ser usada para liberar saldo, fiado ou qualquer informação financeira.

Antes de exibir dados financeiros no portal, implementar uma função de servidor com App Check, limite de tentativas e confirmação por código enviado ao telefone. A arquitetura atual já separa `phoneIndex`, `portalSessions` e `portalProfiles` para permitir essa troca sem alterar a experiência do cliente.
