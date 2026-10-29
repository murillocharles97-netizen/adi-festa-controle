# V212 — Coleta integrada das duas ocorrências monetárias

Base: V210 sanitizada `1ebb6e1`. V211 (arredondamento) permanece fora deste pacote. O escopo real das duas ocorrências fica exclusivamente na variável privada de runtime `SALE_MONETARY_ANALYSIS_SCOPE_V1`, nunca no GitHub ou no pacote público. Configuração ausente ou inválida não habilita coleta.

## Contrato

O owner autenticado vê o aviso em Início, Histórico e Sincronização. Só o clique em **Enviar para análise** permite ler os envelopes. **Agora não** não lê nem envia os originais. A lista de ocorrências é privada, fornecida pelo servidor e limitada à empresa, ao owner canônico e aos dois IDs do incidente; nenhum ID real entra no frontend público.

A leitura usa transações IndexedDB somente leitura e acesso nativo aos namespaces legados V208 do mesmo UID/empresa/geração. Não usa getters que migram o armazenamento, não faz flush, não muda a fila, não reconhece vendas como sincronizadas e não chama decisões comerciais. Campos protegidos e divergências entre cópias bloqueiam o envio, sem normalizar os originais. SHA-256 do envelope canônico preservado e checksum diagnóstico são conferidos.

As Functions existentes `submitSaleRecovery` e `listSaleRecoveryReviews` recebem o modo `monetary_analysis_v1`. Os contratos antigos continuam disponíveis. O modo novo grava, atomicamente, somente:

- `businesses/{businessId}/saleRecoveryReviews/{saleId}/monetaryAnalysis/original`: envelope privado imutável;
- `.../monetaryAnalysis/receipt`: análise, consentimento, identidade, hashes e timestamp;
- `businesses/{businessId}/saleRecoveryOperations/{operationId}`: bloqueio persistente `analysis_only`, sem efeitos comerciais.

Não cria o documento pai de revisão comercial. O caminho antigo de recuperação não aceita `invalid-argument` e não pode executar esses pacotes. A leitura direta dos originais/recibos/fences pelo SDK é negada pelas Rules já publicadas, inclusive ao owner. A consulta autenticada devolve análise minimizada, nunca o payload. Repetição exata retorna o mesmo recibo; conflito não sobrescreve evidência. O app confirma cada recebimento por uma segunda consulta autenticada.

## Análise e retenção

O servidor calcula os valores informados e a regra monetária vigente, diferenças em centavos, subtotais brutos e descontos registrados. Consulta vendas, recibos e efeitos associados sem modificar dados. Sinaliza possíveis duplicatas por itens/variações/quantidades, independentemente do operador; buscas limitadas não comprovam ausência de duplicatas. A confirmação comercial informada ao suporte permanece identificada como relato humano, não como atestado autenticado do owner.

Os originais ficam privados enquanto o incidente estiver aberto. Há revisão de retenção em 90 dias, sem TTL ou exclusão automática. Após encerramento, a destinação da evidência exige decisão explícita; o bloqueio de replay não deve ser removido. Não publicar payloads, logs pessoais ou URLs com evidências.

## Testes e publicação

Testes app/DOM, armazenamento V208, sessão/espaço/geração, consentimento, rede, repetição, recibos; Emulator de Auth/Firestore com owner/seller, isolamento, hashes, zero efeitos comerciais, compatibilidade V205/V208, Rules vigentes e rollback; navegador QA isolado com dados fictícios. A fixture não integra o pacote público.

Ordem: somente as duas Functions, conferir fontes/revisões e demais 90 Functions/Rules intactas; depois frontend/PWA. Verificar build, worker, recursos permitidos e contenção V199. Não ativar Rules restritivas, modificar permissões, coletar automaticamente originais reais nem recuperar vendas durante o deploy.

Rollback compatível: pausar nova coleta no servidor (`INTAKE_ENABLED=false`) e ocultar o aviso (`monetaryAnalysisIntakePaused=true`), mantendo consulta, evidências, recibos e fences. Nenhum dado é restaurado ou apagado; as proteções V202–V210 permanecem.

## Próxima ação comercial

Depois do envio real, conferir os dois recibos, calcular diferenças com os originais efetivamente recebidos e apresentar plano individual. Não ajustar valores/hashes ou cobrar novamente. Este release não executa a recuperação.
