# V226 — conclusão da investigação local do lucro na Home

Branch: `codex/v226-ui-regression-hotfix`.
Base desta investigação: `7eaa39306af0fb174df2d3fec6fcb2d9ceb9b46b`.
Produção de referência: `5957fb9b1e78481f940f58766e17257cc1b0336f`.
Nenhum push, deploy, rollback ou alteração de dados de produção autorizado/executado nesta tarefa.

## Conclusão

**O desaparecimento persistente do lucro no Android original continua sem causa comprovada.** A leitura canônica da conta está correta. O componente e seu CSS não foram removidos na V226, nem deslocados pelo código para outra seção. Os cenários QA com owner válido continuam exibindo o cartão.

Foi reproduzido um defeito de apresentação relacionado: `PerformanceAccess.render()` interpretava uma sessão em `loading` ou `error` como perfil sem indicadores. O owner podia ver “Pronto para atender / Os indicadores de desempenho não estão disponíveis neste perfil” enquanto a identidade ainda não estava validada. Esse comportamento já existe em V225 e V226; os testes com os arquivos dos dois commits o reproduzem. **Isso não comprova que essa condição ocorreu no aparelho relatado.**

A correção mínima muda somente esse feedback: “Verificando seu acesso” durante loading; “Não foi possível verificar seu acesso” em caso de erro. Não mostra dados protegidos antes de validar o acesso. O evento de contexto válido restaura a Home normal de owner, sem alterar permissões. Nenhum cálculo de lucro foi modificado.

## Caminho de renderização e condições

| Condição | Comportamento confirmado |
| --- | --- |
| Viewport até 767 px | `app.js → inicioCompleto → MobileHome.render`. “Lucro hoje” fica na linha de indicadores principais, depois de “Vendido hoje” e antes dos resumos. |
| Viewport desktop | `DesktopDashboard.render`; o KPI chama-se “Lucro estimado” e refere-se a hoje. A diferença de rótulo já existia na V225. |
| Owner ativo, sessão pronta, membership válido | `TeamAccess.has` concede acesso operacional integral ao owner; um mapa de permissões de funcionário vazio ou com `profit.view: false` não o restringe. |
| Loading ou erro da sessão | As verificações de acesso negam temporariamente os indicadores. Agora o estado é apresentado como validação/erro da sessão, sem alegar uma restrição definitiva do perfil. |
| Funcionário diário sem histórico | Usa a Home diária. Não recebe o cartão de lucro por apenas possuir `performance.daily`. Essa política foi preservada. |
| Funcionário com histórico, sem `profit.view` | Pode ver a Home completa autorizada, mas não o cartão de lucro. Nenhuma permissão foi ampliada. |
| Owner sem meta configurada | A configuração da meta muda o cartão de meta, não elimina o lucro. |
| Dia sem vendas ou espaço sem vendas | O cartão continua existindo, com valor zero na fixture sintética. |
| Dados de custo incompletos | Podem afetar o número calculado; não são uma condição de remoção do cartão nesse renderer. O teste comprova presença, não a integridade dos dados no aparelho real. |
| Consulta de trocas ainda não confirmada | O valor passa a “Em revisão”, mantendo “Lucro hoje” no mesmo cartão. |
| Troca concluída hoje com custo em revisão | Mantém o cartão e a indicação de revisão; não inventa lucro confirmado. |
| Espaço específico | O cálculo utiliza `SpaceContext.contextualData` para o espaço selecionado. Em QA: Matriz R$30,00, Filial R$18,00, consolidado R$48,00. Não são números da Adi Festa. |

Não existe uma configuração da empresa consultada pelo renderer como chave de ocultação do lucro. `profit.view` e as condições da sessão são as condições relevantes. Um plano em leitura ou uma meta ausente não equivale a revogar essa permissão. Guards do aplicativo continuam podendo bloquear operações conforme o contrato já existente; não foram alterados.

O Sync lê `saleFinancials` conforme `cost.view`/`profit.view` e incorpora metadados privados autorizados. A existência ou hidratação desses dados no Android não foi inspecionada. Não foi disparado Sync comercial, nem feita alteração no protocolo ou no cache.

## Comparação V225 × V226

Os testes com os commits `e83635c…` e `5957fb9…` verificam que **todas as folhas de estilo preexistentes referenciadas em index.html são idênticas**. A V226 acrescentou o CSS de venda anterior, com seletores próprios; não substituiu o CSS da Home. Os renderers, `TeamAccess`, `OperationMode` e `ExchangeEconomics` também são idênticos nesses dois commits.

Não foi encontrada uma regra nova que oculte o lucro no mobile nem uma mudança de código que o mova para relatórios ou fechamento. Essa comparação é estática; não comprova o CSS efetivamente carregado, a posição por pixels, a área visível ou o estado da sessão do aparelho original.

## Adi Festa — leitura específica

Nova leitura concluída em **03/11/2026 às 22:48:42, Brasília**:

- Empresa `adi-festa` ativa.
- Proprietário canônico, perfil da mesma empresa, role owner e membership owner ativo, com acesso a todos os espaços.
- `profit.view` explicitamente autorizado, além do acesso integral de owner.
- Nenhuma chave `performance.daily/history` gravada nesse mapa de permissões; não foi migrado para V3 nesta tarefa.
- Dez espaços ativos de titularidade canônica; seis vinculados à empresa e habilitados para vendas.
- `settings/default` existe e contém meta diária configurada. Nenhuma configuração de lucro foi alterada.
- Geração canônica do workspace: 0.
- Identidade conferida por UID canônico e vínculos, sem usar coincidência de e-mail.

Essa é uma leitura administrativa dos documentos canônicos, **não uma sessão autenticada do proprietário no Android**. Permanecem desconhecidos nesse dispositivo: UID autenticado, businessId/generation efetivos, espaço selecionado, loading/error, hidratação, erros JavaScript e recursos servidos pelo Service Worker. Não foram acessados ou alterados dados locais do usuário.

## Outras correções revalidadas

- Botão de venda anterior fora de `.pos-head`, oculto pelo CSS mobile da V226 original.
- Entrada reconciliada quando a sessão ou o UID só ficam disponíveis depois do primeiro render; não ativa o modo nem envia venda automaticamente.
- Hidratação tardia de vários espaços atualiza somente o seletor, inclusive com modal aberto.
- Carrinho, cliente selecionado, forma de pagamento, observação, motivo da venda anterior e seleções Home/Vender preservados nos testes afetados.
- Troca de espaço com carrinho continua sujeita à confirmação existente; cancelar não troca nem apaga o carrinho.
- Espaços estrangeiros, arquivados ou não autorizados continuam excluídos. Nenhuma autorização foi baseada em nome de empresa ou e-mail.

## Validação

- **209 testes aprovados, zero falhas**, em 21 arquivos, incluindo 20 cenários adicionais de visibilidade/estado do lucro.
- Os testes preservam as regressões anteriores de venda normal, venda anterior, confirmação individual, resposta perdida, IDs idempotentes, dinheiro externo, estoque e isolamento, sem enviar operações comerciais a produção.
- Gate diferencial comprova que `performance-access.js` foi alterado somente dentro de `render()`. Leitores, validação de respostas, escopo, autorização e funções de invalidação permanecem iguais.
- Lint e build aprovados: 1.101 arquivos JavaScript verificados, incluindo artefatos locais preservados. Os testes CJS adicionais foram carregados/executados pelo runner.
- Diff-check obrigatório antes do commit. O manifesto continua sem Functions, Rules, índices, migrações ou autorização de publicação.
- Testes DOM e análise de CSS **não substituem** homologação visual nem física. Nenhuma captura nova foi feita e nenhum bloqueio do navegador foi contornado.

## Verificação necessária no Android original

Sem limpar armazenamento, sair da conta, reinstalar, reenviar filas ou registrar pagamentos/vendas:

1. Em **Configurações → Conta**, conferir a empresa ativa e o perfil exibido.
2. Na seção **Nuvem → Ver detalhes técnicos**, anotar somente: Build, BusinessId atual, UID abreviado, Perfil/ativo, Cache hidratado e último erro. Não tocar em “Sincronizar agora”, comparação remota, reparação, limpeza ou exportação.
3. Em **Início**, observar o texto exato: “Lucro hoje”, “Em revisão”, “Pronto para atender”, aviso de sessão ou erro de carregamento. Rolar a página inteira e conferir se o cartão está apenas abaixo da área visível.
4. Conferir os espaços listados e qual está selecionado. Não trocar o espaço se houver venda em andamento no carrinho. No QA, a troca e o cancelamento já foram exercitados.
5. Depois de homologar o candidato em prévia, repetir os pontos com a sessão pronta e comparar Chrome Android/PWA. Confirmar toque, contraste, rolagem e ausência de overlays sobre o cartão/seletor.

Esses dados mínimos permitem diferenciar sessão errada/incompleta, frontend desatualizado, renderização simplificada, custo em revisão e problema visual. Não requerem DevTools, snippets, JSON manual ou mudança de dados comerciais.

## GO/NO-GO e publicação proposta

**GO para revisão técnica do candidato local. NO-GO para recomendar a publicação agora e para declarar o incidente resolvido.** Falta validar o candidato em navegador real e esclarecer o estado observado no Android original. Nenhuma alteração de produção deve ser executada por este relatório.

Se autorizado posteriormente, publicar somente frontend/PWA por Pages, verificando os oito arquivos públicos do manifesto, build/commit e Service Worker. Não publicar Firebase, não ativar V3 e não alterar cobrança. Fazer smoke de leitura e homologação física posterior antes de considerar o incidente encerrado ou iniciar lançamentos reais de venda anterior.

Rollback compatível de contenção preservado: `1f7e1675fa2d0551e3dcbf3ee8183fdb7e4dd2f5`, tag `rollback/v226-compatible-v225-integrated`; exige autorização e avaliação das operações existentes. Não reverter Functions/Rules, não apagar dados nem reenviar operações. A base `5957fb9…` também é compatível com o backend, mas reintroduz os defeitos de interface já reproduzidos.
