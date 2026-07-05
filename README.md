# Adi Festa Controle

PWA responsivo para controle de vendas, clientes, produtos e fiados da Adi Festa. Funciona no celular e no computador, sem backend, com os dados armazenados localmente no navegador.

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

Os dados ficam no `localStorage` do navegador. Faça backups JSON regularmente, especialmente antes de limpar dados do navegador, trocar de aparelho ou importar outro backup.
