# Complemento de evidências — hotfix local V236.1

Base: `31d0ccbf471d053764657fd525aa241b384c4a33`. Branch: `codex/recovery-intake-click`.

## Defeito reproduzido e correção

Na V236, `mount()` substitui os botões quando o texto do banner muda. Uma atualização entre pressionar e soltar cancela o clique no botão original. A substituição externa do conteúdo também perde os listeners, pois `recoveryMarkup` ainda coincide. Os dois comportamentos foram reproduzidos contra os bytes Git da base. A ausência de `#modal` e os guards de sessão, leitura e envio também podem terminar sem feedback. Sem o stack trace do aparelho, não é possível atribuir exclusivamente um desses caminhos ao clique real.

O hotfix mantém os nós dos botões, delega os cliques uma única vez, cria o contêiner da confirmação quando necessário e apresenta erros acessíveis. A confirmação mostra progresso, impede cliques simultâneos e detecta troca de sessão/espaço. O envio e a conferência remota têm timeout; resultado incerto oferece consulta, sem reenvio automático.

## Validação

- 112 testes direcionados aprovados: intake, acesso, envelopes, complementos, decisões existentes, cache, versão e contenção pública.
- Chrome 390 px com toque e 1366 px: clique real interrompido por renderização falha na base e funciona no candidato.
- Fluxo HTTP local, cliente de produção e Firestore Emulator `demo-veconi-intake-click`: confirmação, dois uploads, progresso 1/2 e 2/2, leitura e conferência dos IDs/hashes, reload e consulta somente leitura, envio idempotente em outro contexto de navegador.
- Dois envelopes inteiramente sintéticos usam os IDs do incidente apenas dentro do projeto demo, sem clientes ou produtos reais. A verificação no Emulator não representa o recebimento dos originais de produção.
- Cópias das fontes ativas: `submitSaleRecovery` revisão `submitsalerecovery-00007-rob` e `listSaleRecoveryReviews` revisão `listsalerecoveryreviews-00009-qer`. O mesmo fluxo passou usando separadamente o serviço de cada pacote publicado.
- Fontes desses serviços no teste: SHA-256 `63355f88e9332e193c69a6477643165f1179178e2013a4def989db758931e62b` e `35030d8e4c164e4e3db0887f05779ebb3bd33f5217cf5b17f1466dc7c0eb0081`.
- Originais locais byte-equivalentes, estoque sintético preservado e zero vendas, pagamentos, movimentações, assinaturas, clientes ou marcadores comerciais criados pelo fluxo. Só evidências privadas de recuperação foram gravadas no Emulator.
- Chrome controlado por Service Worker de QA, com reload. Android físico/PWA instalado será homologado após publicação autorizada.

Reprodução: definir `NODE_PATH` para as dependências Firebase/jsdom, executar `node --test tests/sale-recovery-intake-click.test.cjs` e executar `scripts/audit-recovery-intake-click.cjs` em `firebase emulators:exec --only firestore --project demo-veconi-intake-click`. O script exige Firestore Emulator em loopback. `PUPPETEER_MODULE`, `CHROME_PATH`, `QA_ARTIFACT_DIR`, `ACTIVE_SUBMIT_SERVICE` e `ACTIVE_LIST_SERVICE` permitem indicar dependências e cópias dos serviços publicados.

## Pacote e publicação futura

Arquivos operacionais: `js/sale-recovery-ui.js`; apenas import/versionamento em `js/firebase/firebase-ui.js`, `js/build-info.js`, `index.html` e `service-worker.js`. Testes, script e este relatório ficam fora do pacote público de 273 recursos.

Service Worker preparado: `veconi-v2361-recovery-intake-click-v1`. Protocolo, formato dos envelopes, autorização e contratos das Functions não mudam. Não há upload automático no carregamento ou troca de sessão.

GO técnico para publicação seletiva do frontend, sujeito à autorização. Nenhum push, merge ou deploy foi executado. Nenhum original real foi reenviado, recuperado ou removido. O backend de estoque já publicado permanece intacto.

Rollback: reverter somente este commit de frontend sobre a main vigente e publicar com uma versão de cache superior. Preservar Functions, Rules, evidências recebidas, IndexedDB e filas. Após autorização, conferir pacote/hash/SW e solicitar um único envio explícito da funcionária; verificar no servidor os dois originais e hashes antes de qualquer decisão comercial separada.
