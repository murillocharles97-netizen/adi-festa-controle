# V178 — diagnóstico temporário de latência do Fiado

Base e rollback: V177, `f47156616414b132411f168aded766717733a30f`.
Frontend somente, sem deploy Firebase/backend/Rules, migração ou alteração de dados.

## Flag e acesso

URL técnica: `https://veconi.app.br/?fiado-timing=1#/configuracoes`.
O parâmetro solicita o diagnóstico, mas NÃO autoriza a coleta. O módulo verifica o
usuário Firebase autenticado e lê do servidor, em paralelo, a empresa interna
`businesses/adi-festa` e seu membership. Exige ownerId igual ao UID autenticado,
plano interno ativo e membership owner ativo. Cache, perfil local, uma flag de
localStorage ou apenas a URL não concedem acesso. Falhas de rede negam acesso.
Nenhuma nova permissão de dados é concedida por este código: as Rules permanecem
idênticas. Como qualquer UI, não é uma barreira contra JavaScript alterado pelo
próprio operador no DevTools; a ferramenta não fornece privilégios no backend.

Sem parâmetro: nenhuma leitura extra, painel, recorder ou captura. Com parâmetro
e acesso negado: nenhuma captura. Com acesso válido: painel aparece DESATIVADO.
Somente o clique em **Ativar uma coleta** arma uma tentativa de checkout Fiado.
Nenhuma venda é criada pelo diagnóstico. No fluxo da venda só são observadas as
Promises originais e etapas existentes, sem reads/writes adicionais, mudança de
ordem, alteração de resultado, retry, transação, saldo ou idempotência.

## Uso

1. Abrir a URL técnica autenticado como owner interno e confirmar V178.
2. Clicar **Ativar uma coleta**. Navegar normalmente para Vender sem reload.
3. O proprietário realiza UMA venda Fiado legítima. O agente não faz a venda.
4. Após concluir OU falhar, clicar **Exportar tempos** e enviar apenas
   `veconi-fiado-timing.json`. Se travar em Processando, exportar o trace corrente;
   NÃO repetir a venda nem recarregar a página para tentar novamente.
5. Clicar **Desativar e apagar coleta**. Isso elimina apenas o relatório em RAM e
   retira a flag da URL, sem apagar cache/IndexedDB ou dados operacionais.

Uma tentativa consome a coleta, mesmo em erro. Não há reativação automática em
retry. A coleta se desarma ao terminar; o relatório continua exportável. Reload
perde a coleta, pois nada é persistido. Logout/troca de identidade elimina os
tempos e revoga a autorização. A sessão técnica expira após 30 minutos, incluindo
a retenção dos tempos. A flag deixa de funcionar em 25/10/2026 00:00 UTC mesmo
que a remoção de código ainda não tenha sido publicada.

## Dados e limites

Somente etapa allowlisted, categoria, timestamp, duração e resultado genérico.
Não exporta nomes, valores, cliente, saldo, documentos, businessId, UID, paths,
token, payloads ou mensagens de erro. A operação é associada apenas internamente,
na memória, e descartada ao fim. Máximo: um trace e 400 spans; truncamento explícito.
Sem analytics, transporte de telemetria, storage, listener ou backend novo.

Spans podem se sobrepor. `exclusiveMs` particiona o total, enquanto linhas brutas
são inclusivas. Firestore mede SDK + rede + servidor, não somente rede. Persistência
inclui CPU e IndexedDB. Tempo sem atribuição permanece explícito. Commit, staging
e confirmação são distintos; nenhuma confirmação existente foi removida.

## Impacto e remoção

Usuário comum recebe somente o pequeno módulo de flag/política e chamadas opcionais
inertes nos pontos instrumentados; não recebe o recorder nem faz novas consultas.
O SW pré-carrega os arquivos estáticos para compatibilidade PWA. Com flag válida,
duas leituras server-only autorizam a sessão, fora da finalização da venda. Durante
a coleta há medições em RAM e callbacks leves de conclusão. Nenhum ganho de
performance é prometido: esta versão mede, não otimiza.

Remoção após análise: retirar `sale-timing-access.js`, `sale-timing-policy.js`,
`sale-timing.js`, `sale-timing.css`, sua entrada HTML/SW e os hooks de timing em
checkout/Sync; manter as versões de cache atualizadas. Não reverter todo o produto
se houver outros hotfixes posteriores. Para rollback imediato, republicar o código
V177 pelo mesmo workflow Pages. Nenhuma reversão de dados ou Firebase é necessária.

## Validação

Suites direcionadas: recorder/acesso, Fiado/saldo, checkout/venda, fila e diagnóstico
Sync. Cobrem flag ausente, usuário comum, membership negado, rede falhando, resposta
obsoleta, logout, expiração, captura única, Promise/erro originais, ordem e número
de consultas, privacidade e versão/singleton Sync. Lint, build e diff-check também
são exigidos antes do push. Smoke em produção não executa venda: versão, estado
default sem painel, autorização e ativação da coleta, aguardando o proprietário.
