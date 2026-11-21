# Auditoria independente VECONI Visual 1B + 1C

**NO-GO para integração agora.** A candidata preserva os fluxos financeiros exercitados da V241 e as regressões de contraste reproduzidas foram corrigidas. Ainda falta fechar a revisão dos assistentes não cobertos e preparar a atualização do PWA. A auditoria foi feita em `codex/veconi-visual-audit`, sobre `5ecab82`. A referência remota `main` era `350d2b8`. Nenhum merge, push, deploy, acesso a dados reais ou operação financeira real.

## Auditoria do código

O diff de código inclui o CSS e o JS do tema, a apresentação do Início, as referências de carregamento, a lista de arquivos públicos e de cache, e os scripts de homologação. Functions, Rules, checkout, cobrança, recebimentos, sincronização, permissões e esquemas permanecem idênticos à V241. `aggregate()` e `model()` permanecem intactos. A curva, a escala e a diferença até a meta são cálculos de apresentação. A UI do gráfico vazio consulta a permissão de navegação já existente.

As guardas da V241 para configuração de custo imutável, operação sem prova offline, reenvio e deduplicação permanecem no código. O teste isolado deixou uma resposta se perder após a gravação e resolveu a operação pelo comprovante com o mesmo ID. O Fiado não gerou entrada imediata. O financeiro respeitou a ativação, o recebimento parcial e o espaço. A estimativa do combustível continuou sem despesa de caixa.

## CSS e correções

- O bloco gerado tem 1.745 regras, cerca de 209 KB no texto normalizado. O arquivo final tem cerca de 313 KB bruto e 36 KB em gzip local. O navegador analisou o CSS em todas as rotas, mas apenas cerca de 15% do texto correspondeu a regras usadas durante a navegação Contas/Cartões no escuro. A medição é por cenário, não uma indicação de CSS morto.
- A classe no `html` delimita a ponte por tema e grupo de rotas e inclui modais fora de `#app`. Ela acrescenta especificidade e todas as regras dos quatro grupos compartilham o mesmo escopo. Seletores genéricos podem afetar modais de outra área aberta no mesmo contexto. Em CRM e Configurações, a classe é removida, embora a barra e a navegação continuem temáticas. O gerador exclui o carrossel bancário pela classe. Preserve essa exceção.
- O gerador reproduziu o mesmo bloco no Chrome local. A aproximação por matiz não identifica intenção nem conhece o fundo efetivo. Reagrupar por media query muda a ordem original da cascata, fallbacks podem continuar vinculados a cores legadas e a saída herdava 41 usos de `!important`. Revisar o resultado a cada mudança no legado. Migrar componentes para tokens semânticos por área antes de ampliar a ponte. Fixar a versão do navegador no processo de geração ajuda na reprodutibilidade.
- Corrigi o contraste do botão de meta no Início (1,37:1 no escuro antes da correção), do recibo e suas ações (3,27:1), do perfil, do rótulo de imagem do produto e dos estados em Contas, Cartões e Faturas. O recibo voltou a usar token positivo e o estado pendente ficou distinto do vencido. Foram necessários dois overrides localizados para declarações legadas de Cartões com `!important`. A geometria 1B foi preservada.
- Corrigi a escolha de tema em sessão quando o armazenamento está indisponível e limitei a transição da troca de tema a `prefers-reduced-motion: no-preference`. O gráfico vazio agora diz “Nenhuma venda neste período”, pois o modelo do Início não prova confirmação remota por venda.
- Ajustei o roteiro 1C para carregar o módulo de valores que faltava e exigir comprovante no teste mobile ou o botão de concluir visível no passo de pagamento desktop. A captura anterior marcava “Tentar novamente” como sucesso. Corrigi também o limiar de tamanho para aplicar 3:1 somente a texto grande.

Em 20 trocas sintéticas entre Contas e Cartões, o Chrome registrou 56 → 77 ms de recálculo de estilo a 390 px e 49 → 73 ms a 1440 px, acumulados. Layout variou de 41 → 43 ms e 38 → 41 ms. São medições únicas em desktop, com a candidata em escuro e a base sem esse tema. O resultado confirma custo adicional nesse cenário, mas não mede FPS, consumo no Android ou tempo de carregamento em rede real.

## Evidências e limites

| Validação | Resultado |
|---|---|
| `tests/*.test.js` e `tests/*.test.cjs` em main e candidata corrigida | 2.393 em cada, 2.235 passaram, 157 falharam, 1 ignorado. Comparação pelos 157 nomes distintos: zero novas, zero removidas. |
| Serviços e Rules no Firestore Emulator em ambas | 29 aprovados, 3 opcionais ignorados. Mais 25 testes de Rules financeiras aprovados e suíte de automação aprovada em ambas. |
| Chrome + Emulator, venda de serviço | 3 corridas por largura em 360 e 390 px na base e na candidata com seus estilos. Pix, dinheiro, cartão, reinício offline, configuração desconhecida bloqueada e resposta perdida. Três vendas e três entradas, com os mesmos totais fictícios e sem duplicação ou movimento de estoque. |
| Matriz de tela | 50 combinações de Início, Vender, Clientes, Produtos e Financeiro, nos dois temas, em 360, 390, 768, 1024 e 1440 px. Capturas de carrinho e pagamento, cadastro de cliente/produto e despesa. Reteste de 20 combinações de Início/Vender após a correção dos contrastes. |
| Telas profundas | Perfil e edição do cliente, histórico e edição do produto, Contas, Fluxo, Cartões, detalhe e pagamento de fatura em claro/escuro a 390 e 1440 px. Os estados de fatura escuros retestados a 390 px ficaram sem contraste abaixo do limite usado na varredura. |
| PWA em loopback | Build público com 279 arquivos, 56 testes de contenção aprovados, Service Worker real instalado, CSS/JS novos em cache e tema preservado em reload offline. Tab, foco visível e Enter no alternador. Alvo medido no mobile: 40 × 44 px. Zero animações de Início com movimento reduzido no cenário medido. |

**Falhas antigas.** Clientes tem rolagem horizontal em 768 e 1024 px, inclusive na main, com subtítulos de KPI cortados. Alguns textos claros herdados do Financeiro ficam próximos ou abaixo de 4,5:1. A base apresenta esse problema nos mesmos fluxos. O scanner de contraste é aproximado e não comprova conformidade em gradientes, transparências, foco encoberto ou todos os estados de sobreposição.

**Limites de fixture.** Houve timeouts intermitentes na montagem de scripts auxiliares do shell. Uma execução da matriz terminou as 50 combinações. As rotas profundas foram exercitadas com simulações de dados do financeiro. A venda no Chrome + Emulator usou adaptador local de sessão e fila. Nenhum teste valida maquininha, pagamento real ou acesso autenticado ao ambiente de produção.

**Ensaios adicionais.** A importação de produtos com catálogo indisponível manteve a confirmação desabilitada em ambos os temas. O erro no escuro tinha contraste de 2,10:1. Apliquei o token de erro e o reteste deixou de sinalizar contraste baixo. A tentativa de abrir recebimento foi barrada pela identidade sintética da fixture nos dois temas. Esse ensaio não alcançou a autorização da conta nem o formulário.

**Pendências de interface.** Validar importação CSV de clientes e prévia de planilha com catálogo disponível, confirmações destrutivas e formulários de recebimento com estados negado, pendente e em revisão, incluindo toda a ordem de foco. O Emulator e a suíte unitária cobrem regras e efeitos dos fluxos financeiros, mas a cobertura visual desses estados é parcial. Validar portabilidade e latência em um Android real, usando ambiente isolado. Nenhuma alteração foi feita para mascarar a rolagem preexistente.

Evidências locais em `qa-artifacts/audit`: `matrix/report.json`, `base-matrix/report.json`, `final-core/report.json`, `deep-final/report.json`, `finance-final/report.json`, capturas, resultados comparativos por nome, logs do Emulator e scripts auxiliares. O app do cliente e o repositório de publicação não foram usados nos ensaios.

## Publicação e rollback

1. Fechar as pendências de interface e aprovar a candidata final. Atualizar a numeração da próxima versão, o namespace do cache, a resposta `GET_VERSION` e as URLs dos recursos alterados. Testar a migração com V241 previamente instalada, atualização e retorno offline, preservando IndexedDB, fila e preferência.
2. Após autorização de publicação, conferir que a main não divergiu e publicar somente o pacote público pelo workflow do Pages. O diff visual não precisa de Functions ou Rules. Confirmar o SHA servido no domínio e testar as rotas principais e a atualização do Service Worker.
3. Se houver degradação, reverter os commits visuais por novo commit na main e publicar um novo cache coerente que retorne a interface V241. Preservar o backend da V241 e todos os dados locais e remotos. Verificar SHA, versão e a recuperação da UI em um cliente já instalado.
