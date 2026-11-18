# V238 — integração final e publicação seletiva preparada

Preparação local em 18/11/2026. Sem push, merge, deploy ou escrita comercial em produção. A homologação funcional no Android será feita pelo proprietário após publicação; depuração no aparelho não é um gate.

## Integração e correção do Consolidado

Main remota conferida: `c94f60ac341745f952630948efd97342a5ed6072` (V237). Preservados `6f066d1` e `f190e72`, a entrega do Claude `a34c4bf` e sua correção `5303cd2`. Branch: `codex/v238-local-integration`.

De `5303cd2` foram incorporados modelo, apresentação e testes do recebido parcial, preservando os contadores V238 de serviços, km e duração. A cobertura dos pagamentos não é inferida da quantidade local, de um pagamento antigo ou da conclusão da consulta de vendas. O Consolidado mostra **Recebido na base consultada (parcial)** mesmo com cache vazio. Não apresenta esse valor como caixa total nem mínimo garantido.

Pagamentos repetidos por ID/operação, pendentes, rejeitados ou estornados não inflam o recebido. Fiado/parcelamento não é recebido à vista; a projeção preserva um marcador público mínimo de parcelamento. Custos/margens de serviço continuam estimativas, sem gerar despesa nem descontar combustível real novamente. Alterar configuração não recalcula snapshots históricos.

## Pacotes das fontes realmente ativas

Projeto `adi-festa-controle`, região `southamerica-east1`, Node.js 22. Fontes obtidas por leitura das revisões ativas. **Não publicar functions da raiz:** existem diferenças não autorizadas nela em relação à produção.

| Function | Revisão de origem | Delta seletivo |
|---|---|---|
| commitOperationalSync | `commitoperationalsync-00022-jim` | Validação/snapshot transacional, configuração privada e engine V238; 6 arquivos novos/modificados, 96 idênticos |
| readOperationalWorkspace | `readoperationalworkspace-00003-xiw` | Somente serviceExecution na projeção pública de itens; 1 arquivo modificado, 80 idênticos |
| getPerformancePage | `getperformancepage-00003-dad` | Execução sanitizada e marcador de parcelamento; 2 arquivos novos/modificados, 80 idênticos |

SHA-256 dos ZIPs ativos, na mesma ordem:

- `732d758d4aa00820adc44c10413759803144d20a6339ee3c02f7ae18b484f569`
- `bfcb8685640613cce62a1dd6698bde277400d69f15d0b41eb56c05e64861ee87`
- `8cfde88fdae680dd3f809fe59ee7fb0a24a68c75e9a78812ecf09cbc89c65e3b`

`scripts/package-v238-selective.cjs` gera pacotes forward/rollback independentes e manifesto de hashes. Entrypoints, dependências, Fiado, vencimento personalizado, recuperação e demais fontes ativas ficam preservados. O bloco de aliases 00022-jim permanece literalmente igual. Não habilita payment_recovery_review/apply existentes na árvore do repositório. Nenhuma outra Function ou trigger financeiro será publicado.

Backups/configuração e pacotes privados: `qa-artifacts/v238-final`, ignorados pelo Git e Pages. Não compartilhar esses diretórios.

## Rules e índices

Obtida a política ativa, diferente da main. `scripts/prepare-v238-rules.cjs` adiciona exclusivamente duas condições restritivas em create/update de products, proibindo serviceCostConfig no documento público. Os demais bytes e permissões permanecem iguais. Não publicar as Rules inteiras da raiz.

- SHA ativo: `016d78efa26bc7a248738c28e9912d874f6d819243a6849264ad4af58090540d`.
- SHA preparado: `b7a53cfb1317c62c46a0d3ffa3862b2a813211666a26298a28237d840fb550df`.
- Nenhum índice, fieldOverride, IAM ou Storage Rule precisa mudar.

Essas duas condições integram o pacote proposto para o próximo GO, ainda não aplicado. Evitam custo gravado acidentalmente no cadastro público por escrita direta.

## Testes e evidências

Backend testado nos próprios pacotes preparados, somente com empresas fictícias e Emulator em loopback.

- **55 testes críticos no Emulator aprovados:** serviços, pagamentos existentes, snapshots privados, duas execuções simultâneas, cesta mista, isolamento, V224, perda de resposta, idempotência, vendas/renovações legadas, vencimento personalizado/cancelamento e rollback.
- Aliases legados com venda posterior: quantidade/aliases consistentes; alias forjado recusado; replay preserva marcador. Concorrência na última unidade: uma confirmação e uma recusa, sem estoque negativo.
- **HTTP + Chrome 360/390 px aprovados:** formulário real → PDV → gateway transacional → recibo → Histórico → Desempenho. Resposta perdida conciliada pelo recibo. Venda offline sobreviveu ao reinício e sincronizou com IDs/envelope originais.
- Por largura: três corridas de R$30, R$47,50 e R$22; receita R$99,50, custo estimado R$52,15, margem R$47,35, 33,5 km. Exatamente três vendas/receitas, zero movimento de estoque; produto físico de controle permaneceu em 5 unidades. Fluxo de 6–8 toques conforme campos adicionais.
- **137 testes aprovados** de modelos/UI, sync/recuperação, versão e contenção/SW: `unit-verified.log`. Build aprovado: `build.log` (1.652 arquivos JS, incluindo fontes isoladas privadas). Manifesto público: **276 recursos incluindo CNAME**.
- Capturas sintéticas e resultados HTTP: `qa-artifacts/v238-homologation/` e `qa-artifacts/v238-final/http-verified.log`.
- Preflight final às 19:10 UTC: main, revisões e gerações das três fontes e hash das Rules permaneceram iguais; domínio oficial continuava com cache V237. Os três entrypoints dos pacotes importaram corretamente. Evidência privada: `fresh-preflight.json`.

### Asserções herdadas classificadas, sem ocultação

Duas expectativas da suíte herdada não correspondem às Rules ativas: negar leitura de balanceEvents a perfil legado e negar absolutamente escrita direta de campanhas/projeções. Ambas falham também com fontes e Rules já publicadas, sem V238 (`baseline-contract.log`). Não foram contadas como aprovadas nem alteradas silenciosamente. A rodada crítica exclui nominalmente essas duas expectativas; os efeitos de estoque/financeiro e recusas dos perfis V3 foram testados. Não ampliar/alterar a política legada neste deploy.

Uma transação fechada sob contenção do Emulator passou na repetição isolada e rodada final. Fixtures usam empresas demo únicas, evitando dados de rodadas anteriores. Nenhum retry comercial foi modificado para fazer testes passarem.

Não foi demonstrado bloqueador novo da V238. Os dois desvios de política legada permanecem registrados como risco já ativo, fora deste pacote; este GO não os considera corrigidos nem autoriza endurecimento adicional.

## Compatibilidade e atualização dos PWAs

- Backend primeiro. Produtos físicos, serviços antigos sem serviceConfig e filas legadas mantêm o contrato anterior. Nenhuma conversão automática.
- Execução V238 exige atualização. O servidor verifica a configuração real do produto e recusa execução/snapshot ausente antes de efeitos; não confia em marcador de versão manipulável.
- Atualizar os aparelhos antes de cadastrar/usar serviço flexível. Não converter item com fila antiga ainda não resolvida. Um PWA antigo que tente serviço já convertido recebe bloqueio seguro; a operação é preservada, não reconstruída nem descartada.
- A atualização não limpa IndexedDB/filas e não força recarga no meio de venda. Após deploy, aceitar atualização/reabrir e confirmar V238 antes das corridas reais; não exige depuração ou exportação do Android.
- SW final: **veconi-v238-services-consolidated-v1**, app/release 238.
- Todos os espaços consolida apenas espaços autorizados da mesma empresa, nunca empresas independentes.

## Sequência exata após GO definitivo

1. Reconfirmar main, três revisões/ZIPs e hash das Rules acima. Mudança exige comparar/reconstruir antes de executar. Validar manifesto final e backups; dependências pelo lock.
2. Do diretório `commitOperationalSync/forward`, publicar somente `functions:commitOperationalSync` no projeto adi-festa-controle. Confirmar nova revisão ACTIVE, runtime/entrypoint e saúde antes de avançar; não executar replay real.
3. Do pacote próprio, publicar somente `functions:readOperationalWorkspace`; confirmar revisão e leitura autorizada/recusa indevida, sem gravação comercial.
4. Do pacote próprio, publicar somente `functions:getPerformancePage`; confirmar consulta por espaço e privacidade de custos. Nunca deploy geral de Functions.
5. Publicar somente `firestore:rules` com firebase.json isolado apontando para firestore.selective.rules, depois de repetir comparação da origem. Confirmar hash publicado; não incluir índices/IAM/Storage.
6. Integrar candidata por branch/PR autorizado respeitando proteções, conferir árvore e publicar pelo workflow Deploy GitHub Pages. Acompanhar uma execução até sucesso; não incorporar outras branches.
7. Conferir os 276 recursos no domínio oficial por SHA-256 dos bytes Git/Linux, descontando somente carimbo commit/data do workflow no index. Confirmar SW final e smoke autenticado somente leitura de V237, Produtos, PDV, Histórico/Desempenho e permissões. Escritas fictícias ficam no Emulator.
8. Proprietário atualiza o PWA e homologa corridas reais: valor, km, custo estimado, recibo/Histórico e Desempenho. Não registrar venda ou pagamento fictício em produção.

## Rollback compatível

- Frontend V237 c94f60a exportado em bytes Git/Linux, com hashes. Restaurar somente software; preservar dados/filas.
- Gateway: pacote de contenção derivado da V238, preservando snapshots e reconhecimento de operações processadas. Pausa apenas novas configurações/execuções flexíveis; vendas físicas/legadas continuam. Testados replay confirmado, bloqueio atômico de nova execução e venda física normal.
- Leitores: backups/pacotes independentes das revisões acima; voltar junto com frontend compatível ou manter projeções V238 aditivas.
- Rules: conservar as duas proibições de custo público após rollback da interface. Backup anterior é evidência, não restauração automática de acesso mais amplo.
- Nunca restaurar cegamente o gateway antigo depois de existirem filas V238. Preservar IDs/envelopes até retomada; não compensar estoque/saldo nem reenviar rejeições.

Nenhuma venda recuperada da 3 Lindas, estoque, assinatura, saldo, pagamento, caixa ou evidência real foi alterado. A preparação não executa novamente a recuperação.

**GO técnico para solicitar publicação seletiva, com recebido explicitamente parcial e política legada preservada. Execução aguardando autorização definitiva.**
