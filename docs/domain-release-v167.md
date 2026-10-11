# V167 — domínio oficial

Publicação restrita à migração para https://veconi.app.br em 11/10/2026.
Base/rollback: V166, 803705b110eddb19e15a46eb07e21ac3ea2e1e30.

## Alterações

- ADI_FESTA_APP_URL=https://veconi.app.br (configuração e default).
- Retorno de novos checkouts usa URL e termina em /#/planos, com ou sem barra final na configuração.
- og:url, og:image e twitter:image no domínio oficial.
- Release 167 e cache veconi-v167-official-domain; mecanismo de atualização existente preservado.
- Paths relativos de assets, manifest, start_url, scope e worker preservados.
- Nenhuma regra ou redirecionamento para www adicionado.

## Escopo de publicação

GitHub Actions/Pages existente e somente as Functions createSubscription e
createTeamInvite. Não publicar Rules, Storage, índices, webhook, schedulers ou
createSpreadsheetProducts. Importação V2 permanece fora deste commit.

Sem seeds, migrações de dados, alterações de usuários/planos/recorrências ou
modificações de checkouts emitidos anteriormente. A URL do webhook continua igual.
Os IDs Firebase são infraestrutura e não devem ser renomeados como se fossem URLs.

## Validação prévia

- 624 testes do app, 131 do backend, lint/build e diff-check aprovados.
- Ensaio Chromium em / e /adi-festa-controle/: 194 entradas de cache em cada base,
  assets sem erro e reload offline do shell preservando rota de Planos.
- Teste de URL de retorno verifica exatamente https://veconi.app.br/#/planos.
- Asserções de release/cache dos testes existentes atualizadas para 167; sem
  alteração das regras de negócio.

## Validação em produção e limites

Verificar a revisão publicada e navegar em sessão real por Home, Produtos, Clientes,
Vender, Financeiro e Planos, recarregando a página sem sair da conta. Não efetuar
venda, recebimento, importação, convite nem contratar/cancelar assinatura durante
o smoke test. Um pagamento real/3DS não faz parte desta migração de URLs.

O PWA instalado pelo origin antigo não troca de identidade automaticamente.
Não limpar armazenamento local nem desinstalar antes de conferir filas pendentes.
O smoke desktop não substitui a verificação do Android físico pelo usuário.
