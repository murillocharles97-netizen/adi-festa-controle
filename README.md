# Adi Festa Controle

PWA responsivo para controle de vendas, clientes, produtos, fiados e pedidos antecipados da Adi Festa. O painel trabalha offline-first e sincroniza os dados do negócio com o Firebase.

## Funcionalidades

- Dashboard com vendas, lucro, fiados e fechamento diário
- Cadastro de clientes e produtos
- Controle de débito, crédito e ajustes de saldo
- Vendas pagas ou fiadas, descontos e preço editável
- Recibo em PNG e mensagens para WhatsApp
- Pagamentos parciais ou totais
- Histórico de vendas, pagamentos e ajustes
- Desfazer a última venda em até cinco minutos
- Importação de clientes do Kyte
- Backup e restauração em JSON
- Instalação como PWA e funcionamento offline
- Visitas com catálogo online compartilhável
- Carrinho e pedidos antecipados pelo celular
- Acompanhamento do pedido e conversão em venda paga ou fiado

## Catálogo online

No painel, abra **Visitas**, crie uma visita, selecione os produtos e use **Compartilhar**. O cliente abre `catalogo.html` pelo link recebido, escolhe os itens e envia o pedido sem precisar instalar o app ou criar senha.

O carrinho é preservado no aparelho do cliente. A confirmação do pedido exige internet; o painel recebe os pedidos pelo Firestore e mantém a conversão em venda idempotente para não baixar estoque ou saldo duas vezes.

## Como rodar localmente

O arquivo `index.html` pode ser aberto diretamente para testes básicos. Para testar instalação e funcionamento offline, use um servidor local:

```bash
python -m http.server 8080
```

Depois acesse `http://localhost:8080`.

## Publicar no GitHub Pages

1. Suba o projeto para um repositório no GitHub.
2. Abra **Settings > Pages**.
3. Em **Source**, selecione **Deploy from a branch**.
4. Selecione a branch **main**.
5. Em pasta, selecione **/root**.
6. Clique em **Save** e aguarde o link do GitHub Pages.

Todos os caminhos são relativos, portanto o PWA funciona mesmo quando publicado em uma subpasta do GitHub Pages.

## Instalar no celular

### Android / Chrome

1. Abra o link do GitHub Pages no Chrome.
2. Toque no menu de três pontos.
3. Escolha **Instalar app** ou **Adicionar à tela inicial**.

### iPhone / Safari

1. Abra o link no Safari.
2. Toque em **Compartilhar**.
3. Escolha **Adicionar à Tela de Início**.

## Dados e privacidade

O painel mantém uma cópia local para continuar funcionando offline e sincroniza as coleções do negócio no Firebase. Faça backups JSON regularmente, especialmente antes de limpar dados, trocar de aparelho ou importar outro backup.
