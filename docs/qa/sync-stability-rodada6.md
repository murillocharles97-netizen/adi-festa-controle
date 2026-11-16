# Estabilização do Sync, rodada 6: revisão ativa, D3, integridade, Fase 3 e homologação

Nada foi publicado. Nenhum dado real foi alterado. Leituras de produção feitas **somente** com `firebase functions:list --json`, `firebase functions:log --json` e o `build-info.js` público.

## 1. Revisão ativa da `commitOperationalSync`
- **Ativa:** `commitoperationalsync-00019-xol`.
  - Fonte enviada em 15/11 às 19:23:30 UTC; rollout às 19:24.
  - Desde então, 100% das requisições nos logs vêm da 00019.
  - A configuração de tráfego do Cloud Run não foi lida diretamente.
- **Origem:** o hash gravado pelo Firebase CLI (`1ec0e910…`) é reproduzido **exatamente** pelo pacote `VECONI-commitOperationalSync-pkg`.
  - O pacote não muda desde 15/11 às 06:24 UTC.
  - Logo, **00017, 00018 e 00019 têm o mesmo código.**
- **Conclusões anteriores:** o número citado antes (00017) estava errado, mas o código auditado era o publicado, e as conclusões se mantêm.
  - Detalhes em `sync-stability-plano.md`, seções 1.5 e 1.6.
- **Base de publicação:** nenhum pacote local serve de base por si só. A base precisa reproduzir o hash ativo **no momento** da publicação (seção 4).

## 2. D3: recuperação automática segura (corrigido, `0ec5e63`)
Detalhes em `d3-servidor-inacessivel-vira-erro.md`. Cenários testados sobre o código real da fila (`tests/sync-d3-recovery.test.cjs`):

| Cenário | Resultado |
|---|---|
| Internet instável | Pendente (sem erro ativo) → recibo → 1 envio. |
| Wi-Fi sem internet | Espera de 15 s → 5 min, sem gastar envios, e retomada sozinha. |
| Firebase indisponível (`unavailable`) | Mesmo caminho seguro. |
| Timeout (`deadline-exceeded`) | Mesmo caminho seguro. |
| Servidor aplica, resposta perdida | O recibo confirma; não há segundo envio. |
| Fechar e reabrir | A fila retoma pelo recibo; pacotes antigos com erro D3 são requalificados. |
| Troca de usuário | A sessão nova não envia nem confirma a fila da anterior. |
| Troca de empresa | A operação só volta para a empresa de origem. |
| Permissão revogada | Recusa definitiva, preservada, sem retentativa. |
| Várias operações acumuladas | Ordem por produto respeitada; cada uma aplicada 1 vez. |
| Retorno da conexão | `online`/reabertura antecipa a retomada. |
| Conflito de estoque | Definitivo; nunca tratado como internet. |
| Exceção real repetida do servidor | Máximo de 6 envios, depois revisão. |
| Recebimento com resultado desconhecido | Exige prova positiva; nunca é reenviado às cegas. |

- **Mutações:** 23 de 23 detectadas (14 das fases 1/2 e 9 do D3).
- **Homologação no PC (candidato):** venda offline como vendedora → servidor de volta → venda aplicada **sozinha** em ~11 s, uma vez.

## 3. Falso aviso de integridade (corrigido, `7935749`, branch do estoque legado)
- **Causa:** a comparação via `controlaEstoque:false` (nuvem, legado) e `controlaEstoque:false` + `semControleEstoque:true` (local normalizado) como diferença.
- **Correção:** os dois lados são projetados pela regra do `ProductModel` compartilhado, a mesma do app e do servidor.
  - Equivalências comprovadas passam.
  - Diferença real de controle continua aparecendo.
  - As quantidades de estoque continuam comparadas.
  - Sem o modelo, a comparação usa os campos crus.
- **Só auditoria:** nenhum documento é alterado.
- **Por que nessa branch:** a correção depende da correção do legado (`a55b18b`). Sem ela, o modelo da V231.1 ainda trata o legado como "controla estoque".
- **Confirmado no PC:** o aviso de `semControleEstoque` sumiu.
- **D4 (observação, não corrigido):** depois de uma venda, a cópia local mantém o alias `totalStock` antigo em produto simples (`estoqueAtual` 9, `totalStock` 10).
  - Existe na V231.1.
  - O servidor está correto, e o app só usa `totalStock` em produto com variação.
  - Aparece como diferença real de estoque na auditoria; por regra, não foi escondida.

## 4. Fase 3: manifesto e verificação pré-deploy (`71e2cbe`)
- **`functions-deploy-manifest.json`:** as 101 Functions publicadas, com hash, data de envio, runtime e limites.
  - Não contém variáveis de ambiente nem segredos.
  - `commitOperationalSync`: 00019-xol, origem comprovada por hash.
- **`node scripts/functions-manifest.cjs verify <candidato> --only <fn> --base <dir> --changes <json>` bloqueia:**
  - base que não reproduz o publicado (pacote antigo ou repositório): testado com o 00016 e com `functions/`, os dois bloqueados;
  - produção alterada desde o manifesto;
  - alteração não declarada ou declarada e ausente;
  - recusa sem motivo estável.
  - Em caso de aprovação, imprime o hash esperado após a publicação.
- **`node scripts/release-version-check.cjs`:** bloqueia uma release do app cuja `appVersion` não seja posterior à publicada.
  - Hoje o site publicado declara `release "229"`.
  - Também bloqueia Service Worker ou cache divergentes, e mudança acidental de protocolo ou formato.
- **Candidato de Functions sobre o código publicado:** `C:\Users\Murillo\Documents\VECONI-commitOperationalSync-candidate-fase1`.
  - É uma cópia do 00019 com só 3 mudanças da Fase 1.
  - O verificador aprovou: hash esperado `fee2538f…`.
  - O teste do Emulator passa com o servidor real.
  - **Não publicado.**
- **Não ligado ao `firebase.json`:** isso mudaria o fluxo de deploy que o Codex usa na V232. Ligar a verificação ao `predeploy` faz parte da integração.

## 5. Homologação física no Android (candidato `claude/sync-candidate`)
Inclui: Fases 1–2, D3, estoque legado, D2, a correção da auditoria e a ferramenta Android.
1. No PC: `scripts\homolog\iniciar-homologacao.cmd` (worktree `VECONI-Sync-Candidate`). Com o celular por USB: `... usb`.
2. Roteiro mínimo (contas fictícias em `scripts/homolog/seed.cjs`):

| # | Perfil | Passos | Esperado |
|---|---|---|---|
| 1 | Dono, 2 espaços | Venda online com produto controlado + legado | Controlado baixa, legado não |
| 2 | Dono | `... offline` → venda → `... online`, sem tocar | Venda pendente, depois enviada sozinha (≤ 5 min; normalmente segundos) |
| 3 | Vendedora | Igual ao 2 | Igual |
| 4 | Vendedora | Venda offline → fechar o Chrome → `online` → reabrir | Enviada uma vez |
| 5 | Dono | Modo avião com o app aberto → venda → desligar o modo avião | Enviada sozinha (evento `online`) |
| 6 | Dono, 1 espaço | Produto novo com estoque inicial | Não pede o espaço |
| 7 | Dono, 2 espaços | Produto novo com estoque inicial | Pede o espaço (D2) |
| 8 | Qualquer | Sincronização → Comparar com a nuvem | Sem aviso de `semControleEstoque` |

3. Após cada caso: `Sincronização → Exportar diagnóstico` (sem dados reais).

## 6. Integração com a V232 do Codex
Quando a V232 de assinaturas estiver publicada:
1. Criar uma branch nova a partir da `main` publicada.
2. Fazer cherry-pick, na ordem, dos commits do candidato, sem tocar nos arquivos de cobrança:
   - `ff85595`, `c6e4fc8`, `6d858e3`, `0ec5e63`, `71e2cbe` e os docs;
   - legado: `a55b18b`, `7935749`;
   - D2: `2c5ca7f`;
   - ferramenta: `4852ce2`, `088b94e`, `20ccb80`.
3. Conflitos esperados apenas em `index.html`, `service-worker.js` (cache/versão) e `js/build-info.js`. Usar a **versão nova** em `appVersion`; o `release-version-check` impede esquecer.
4. Reexecutar a suíte, as 23 mutações, os testes de cobrança do Codex sem alteração e o roteiro Android.
5. Ligar `functions-manifest.cjs verify` ao fluxo de publicação das Functions, de comum acordo com o Codex.

## 7. Recomendação
- **Candidato do app (`claude/sync-candidate`): GO para a homologação física no Android. NO-GO para publicar** até:
  - o roteiro da seção 5 passar no celular;
  - a integração sobre a V232 publicada (seção 6), com a suíte sem falhas novas.
- **Functions (Fase 1) — tecnicamente pronto, publicação opcional e independente:**
  - o app novo funciona com o servidor publicado sem motivos (testado);
  - publicar só com o verificador aprovando sobre o hash ativo no dia e com sua autorização.
- **Riscos residuais:**
  - **Celular físico não testado.**
  - **Wi-Fi sem internet:** sem o evento `online`, a retomada depende do timer (no máximo 5 min).
  - **D4:** aviso de auditoria em `totalStock`.
  - **Logs de produção:** só 7 dias lidos (limite da CLI).
