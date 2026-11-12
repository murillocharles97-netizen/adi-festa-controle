# Corte definitivo do Fiado — validação local

Data: 2026-11-12. Branch: `codex/fiado-saldo-final`.
Preserva os commits `81181ea`, `89c4f14` e `303c90d`. Nenhum deploy ou dado real alterado.

## Contrato

- A Central existente confirma o saldo com autorização do proprietário configurado, empresa e geração exatas, conferência de filas, revisão atual, transação e auditoria idempotente.
- O leitor usa o saldo de abertura e fontes com `fiadoOpeningHash` atribuído exclusivamente pelo servidor. Não consulta novamente vendas, recebimentos ou eventos arquivados.
- A exceção é o calendário parcelado expressamente preservado na abertura. Seu espaço, principal e calendário permanecem verificados; pagamentos anteriores ficam incorporados ao snapshot, sem serem descontados novamente.
- Novas vendas exigem versão financeira atual e data posterior ao corte. Filas antigas, recebimentos sem a rota verificada, ajustes antigos e cancelamentos de vendas anteriores não alteram a conta nova.
- Cancelamentos novos passam pelo contrato existente, verificam dívida restante e espaço, revertem estoque uma vez e deixam recibo idempotente. Venda já recebida continua protegida.
- Novos Fiados de outros assinantes usam o contrato de recebimento por espaço sem depender de acesso à Central extraordinária. A política privada da Central continua limitada à empresa e UID configurados; não foi ampliada.
- Os registros antigos são preservados. Nenhuma exclusão, reconstrução ou migração do histórico foi executada.

## Resultados

- `tests/emulator/fiado-receipt-route.cjs`: 15 cenários aprovados (HTTP executado separadamente).
- HTTP callable real no Functions Emulator, Auth Emulator e trigger de caixa: aprovado. Resposta perdida, recibo independente e repetição sem duplicidade.
- `tests/emulator/fiado-central-review.cjs`: 4 aprovados, incluindo outro UID/empresa e negação de escrita direta nas Rules.
- `tests/emulator/sale-cancellation.rules.test.js`: 29 aprovados.
- Prova histórica, backend, cancelamento local e fila de recebimento: 35 testes direcionados aprovados.
- Build e lint: aprovados; diff-check sem erros.

Cenários comprovados: abertura 190 → 150 auditada; recebimento 70 → saldo 80; quitação posterior; cancelamento antigo bloqueado sem efeitos; venda nova e cancelamento canônico e por sincronização; operação antiga offline; fontes antigas recebidas tardiamente fora do cálculo; duas contas por espaço; parcelas futuras preservadas; duas empresas sintéticas; concorrência e resposta perdida; caixa único por recebimento.

O arquivo legado `tests/sale-cancellation-release.test.cjs` contém gates de pacote das versões V200/V201 (incluindo versão literal 201 e comparação com a base V199). Não serve como gate deste candidato: seus asserts de release estão obsoletos. Não foram removidos nem usados para substituir os testes comportamentais acima.

## Publicação

GO técnico para preparar publicação seletiva, mediante autorização. Ainda não publicado nem homologado no Android com backend atualizado.

O preflight deve montar pacotes isolados contra as revisões ativas, incluir todos os escritores/leitores afetados e manter a confirmação de abertura desabilitada até que os caminhos protegidos estejam ativos. Preservar a política privada de UID/empresa. Não realizar abertura automática durante deploy.

Depois da primeira confirmação real, não voltar a um escritor antigo que desconheça o corte. Contenção: suspender novas confirmações e escritas afetadas, preservando os leitores, marcadores e recibos; não apagar a abertura para tentar rollback.

Limites preservados: leitura limitada e fail-closed; fila de outros aparelhos exige conferência explícita do proprietário; nenhuma permissão de Admin SDK permite ao aplicativo contornar as validações. A garantia cobre os caminhos comerciais autorizados, não alterações arbitrárias feitas fora do sistema por administradores do banco.
