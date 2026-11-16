# Homologação Android isolada (Emulator + app local + USB)

Ambiente para testar no celular, antes de qualquer publicação, vendas, vendas offline, estoque, permissões e sincronização.
**Não acessa produção.**

- Projeto Firebase `demo-veconi-homolog`: projetos `demo-*` nunca chegam ao Google Cloud.
- Auth, Firestore, Functions e Storage rodam emulados no PC.
- O app é servido pelo PC, com a configuração reescrita **só em memória**. Nenhum arquivo do app é alterado.
- Login Google e Mercado Pago ficam desligados nesse ambiente. Use as contas de e-mail fictícias.

## Uma vez só (preparação)
1. **No PC:**
   - Node.js;
   - Firebase CLI (`firebase --version`);
   - Java;
   - Android Platform-Tools (`adb`). Fica em `%LOCALAPPDATA%\Android\Sdk\platform-tools`. Ou defina `ADB=<caminho do adb>`.
2. **No worktree:** `npm ci` e `npm --prefix functions ci`.
3. **No celular:**
   - Configurações → Sobre o telefone → toque 7 vezes em "Número da versão". Isso ativa as Opções do desenvolvedor.
   - Opções do desenvolvedor → ative **Depuração USB**.
   - Conecte o cabo e aceite "Permitir depuração USB" no celular.

## Todo dia de homologação
1. Dê dois cliques em `scripts\homolog\iniciar-homologacao.cmd`.
   - Ou rode `node scripts/homolog/android-homolog.cjs start`. Use `--reset` para começar com dados novos.
2. Quando aparecer `No celular, abra no Chrome: http://localhost:5180/`, abra esse endereço **no Chrome do celular**.
3. Entre com uma das contas fictícias. A senha de teste está em `scripts/homolog/seed.cjs`.
   - `dono@homolog.test`: dono, empresa com **2 espaços** (Loja Centro e Loja Bairro);
   - `vendedora@homolog.test`: vendedora, só na Loja Centro;
   - `loja-unica@homolog.test`: dono, empresa com **1 espaço**.
4. Produtos fictícios já cadastrados em cada empresa:
   - legado com **só** `controlaEstoque:false`;
   - produto com estoque 10;
   - serviço;
   - plano recorrente sem estoque;
   - plano recorrente com 5 licenças.
5. Celular conectado depois de iniciar? Rode `iniciar-homologacao.cmd usb`.

## Simular perda de conexão
O modo avião **não** corta o cabo USB, e o PC não tem modo avião para `localhost`. Por isso o app fala com os emuladores através de um "portão de rede" (portas 19099, 18080, 15001 e 19199), e existem dois comandos:
- `iniciar-homologacao.cmd offline`: o PC **e** o celular perdem o servidor (Auth, Firestore, Functions e Storage). O app continua aberto e as vendas ficam na fila local.
- `iniciar-homologacao.cmd online`: o servidor volta. Abra Sincronização ou aguarde o envio automático.

Os comandos funcionam com a homologação em execução, a partir de outra janela.

Para um offline "total", ligue também o modo avião depois que o app já estiver carregado. O SDK vem da internet na primeira abertura.

## Encerrar
- `Ctrl+C` na janela do script. Os dados ficam salvos em `%TEMP%\veconi-homolog-data`, para o próximo dia.
- `iniciar-homologacao.cmd reset` apaga tudo.
- O log dos emuladores fica em `%TEMP%\veconi-homolog-emulators.log`.

## Homologar uma branch
O script serve os arquivos **da pasta onde ele está**. Para homologar uma correção:
1. Use o worktree da branch da correção.
2. Copie a pasta `scripts/homolog` para esse worktree, ou faça cherry-pick do commit desta ferramenta.
3. Rode o comando a partir de lá.

As Functions emuladas são as do repositório. Para correções só de frontend isso basta. Para mudanças de servidor, lembre que a Function ao vivo pode diferir do repositório.

## Verificação feita (PC, 16/11/2026)
- Os emuladores sobem, o seed cria 25 documentos e 3 contas, e o app abre em `localhost:5180`.
- Login do dono feito: Início com 2 clientes e 5 produtos.
- Venda Pix de 1 unidade concluída. No Emulator: 1 venda `pago` no espaço ativo, movimento −1 (10 → 9) e produto com `estoqueAtual` 9.
- **Não testado:** o celular físico. Nenhum Android estava conectado (`adb devices` vazio). O `adb reverse` e os comandos `offline`/`online` foram executados, mas sem um aparelho para confirmar.
