# Configuração segura do Firebase

1. No Firebase Authentication, habilite **E-mail/Senha** e crie a conta que vai acessar o aplicativo.
2. Crie o banco **Cloud Firestore** em modo de produção.
3. Publique o conteúdo de `firestore.rules` nas regras do Firestore.
4. No Firestore, crie manualmente `users/SEU_UID` com:

```json
{
  "uid": "SEU_UID",
  "name": "Administrador",
  "email": "seu-email@exemplo.com",
  "role": "admin",
  "active": true,
  "businessId": "adi-festa"
}
```

5. Entre no app e acesse **Configurações > Sincronização Firebase**.
6. Clique em **Fazer backup primeiro** e depois em **Enviar dados para a nuvem**.

Os dados do aparelho não são apagados durante esse processo. A migração usa os mesmos IDs locais no Firestore, evitando duplicações em novas tentativas.
