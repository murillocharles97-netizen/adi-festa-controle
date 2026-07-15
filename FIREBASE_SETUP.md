# Configuração segura do Firebase

1. No Firebase Authentication, habilite **E-mail/Senha**.
2. Crie o banco **Cloud Firestore** em modo de produção.
3. Publique o conteúdo de `firestore.rules` nas regras do Firestore.
4. No app, escolha **Criar meu acesso**. Somente o e-mail proprietário autorizado poderá criar o primeiro administrador.
5. Depois de entrar, acesse **Configurações > Sincronização Firebase**.
6. Clique em **Fazer backup primeiro** e depois em **Enviar dados para a nuvem**.

Os dados do aparelho não são apagados durante esse processo. A migração usa os mesmos IDs locais no Firestore, evitando duplicações em novas tentativas.
