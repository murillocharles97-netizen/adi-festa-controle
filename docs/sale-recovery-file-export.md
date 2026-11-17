# Extração local dos originais — candidata V236.2

Base publicada: `fe70f0882239036f9c73a8de0103cb044334a77d`. Branch isolada `codex/recovery-file-export`. Nenhum push ou deploy nesta etapa.

## Caminho encontrado

O diagnóstico geral é redigido e não contém os envelopes completos. A auditoria de vendas somente locais também não substitui a fila original. A exportação privada existente é específica de recebimentos. O leitor `DB.businessCache.recoverySources()` já consulta, somente por leitura, IndexedDB, namespaces anteriores, revisão atual em memória e cópias legadas da mesma empresa, usuário e geração. Ele é reutilizado sem mudar armazenamento, migração ou sincronização.

O transporte reaproveita `SaleRecoveryClient.envelope()`: copia o pacote original inteiro, incluindo writes/before/metadados, e os snapshots locais relacionados. Não reconstrói produtos, preços, pagamentos ou estoques a partir de diagnósticos. Só inclui cadastros retidos relacionados às vendas selecionadas. Cópias divergentes de uma venda não são escolhidas arbitrariamente; ficam bloqueadas para revisão, sem impedir exportar outras vendas independentes.

## Uso após publicação autorizada

1. No aparelho original, **mantenha a sessão da funcionária que registrou as vendas**. Não saia da conta nem limpe dados. A sessão do proprietário não acessa a fila particular da funcionária, mesmo na mesma empresa.
2. Abra **Sincronização → Ver detalhes → Exportar arquivo de recuperação**. Também há uma ação secundária no banner de revisão. Não depende de Complementar dados, consulta remota ou conexão.
3. Selecione apenas as vendas de 16/11 às 17h02 e 17/11 às 11h39, confira os IDs e autorize a exportação. Toque em **Preparar arquivo**.
4. Copie e guarde o código exibido; marque que o guardou e toque em **Salvar arquivo**. Confira Downloads. Entregue o JSON apenas ao suporte autorizado e o código separadamente.

Operações esperadas: `f133be0f-a79c-4637-85bb-2c9309359535` / venda `26945d55-ee16-406f-b8bf-72c1f36601a5`; `20276356-f0ee-4510-8105-1e81d05af7b9` / venda `7345fdcd-a474-43f8-94b9-517c84079edc`. Alterações de produtos em manual_review não são tratadas como essas vendas. Se os IDs não aparecerem, não há extração confirmada; não produzir envelopes substitutos.

## Proteção e validação

Arquivo criptografado com AES-GCM-128 e nonce aleatório. O código aleatório de 128 bits só fica no diálogo em memória; não entra no arquivo, no armazenamento persistente ou em logs. O contêiner público contém apenas formato, versão, IV, ciphertext e hash. Dentro dele há empresa/autor/geração, IDs exatos, `originalJson`, SHA-256 do original e SHA-256 canônico do payload. Um hash permite verificar integridade, mas não substitui autorização financeira ou comprovação de execução.

Exige seleção, consentimento e confirmação de que o código foi guardado. Revalida sessão e acesso antes de preparar e salvar. Impede exportação de espaços não autorizados e de campos de credenciais. Não há chamadas Firebase, upload, replay, importação automática ou marcação de operação resolvida. O arquivo não concede permissão de recuperação.

O script offline `scripts/validate-sale-recovery-file.cjs` descriptografa, confere hashes/identidade/duplicatas e reutiliza `validateOriginal` do servidor. O código é recebido pela variável privada `VECONI_RECOVERY_FILE_KEY`; não passá-lo como argumento ou registrar a variável. O relatório contém apenas IDs/hashes. O script não inicializa Firebase e não escreve dados. Preservar o arquivo cifrado recebido sem alterá-lo.

## Recuperação individual posterior

Após receber arquivo e código: validar os dois originais; conferir se o payload é executável pelo mecanismo já existente; consultar novamente vendas, recibos, processedOperations, movimentos, registros financeiros e possíveis vendas substitutas. Comparar deltas preservados com estoque atual e operações posteriores, sem restaurar valores antigos de estoque. Reavaliar em transação antes de executar.

O intake publicado exige o autor original autenticado; um proprietário não pode enviar o envelope de outro UID usando esse endpoint. Qualquer alternativa administrativa de ingresso das evidências deverá ter autorização específica, preservar actorUid/IDs/hashes e auditar o responsável, sem simular a sessão da funcionária. Este commit não cria esse ingresso nem altera essa proteção.

Preparar uma prévia por venda, incluindo dependências de cadastro, recebimento já realizado, IDs, efeitos esperados e bloqueios. Só depois de autorização específica usar o executor de recuperação existente, com transação/idempotência, leitura dos marcadores e rejeição se qualquer efeito já existir. Não reenviar à fila normal nem criar uma venda substituta. A exportação não significa GO para recuperação comercial.

## Testes e pacote

- 127 testes direcionados aprovados: exportação, integridade, autorização, seletividade, perdas de acesso/sessão, falhas locais, envelopes e decisões existentes, versão, cache e contenção pública. A extração ignora deliberadamente o getter de diagnósticos de Sync, cujo adaptador pode importar uma fila legada; utiliza somente o leitor local com transações readonly.
- Chrome 390/1366 px, controlado pelo Service Worker, offline, com IndexedDB real de QA: namespace atual vazio, originais no namespace anterior, download efetivo, descriptografia e validador do servidor aprovados para os dois IDs usando exclusivamente dados sintéticos. Uma terceira venda não selecionada ficou fora do arquivo.
- Mesmos registros IndexedDB antes/depois; zero chamadas de backend ou efeitos comerciais. Sessão de outro usuário não encontra os originais. Android físico ainda depende de homologação após GO.
- Build público validado: 273 recursos; scripts, testes, relatórios e arquivos privados ficam fora da allowlist.

Arquivos de frontend: `js/sale-recovery-client.js`, `js/sale-recovery-ui.js`, botão/imports em `js/firebase/firebase-ui.js`, CSS escopado e metadados PWA (`index.html`, `js/build-info.js`, `service-worker.js`). Sem Functions, Rules ou alterações no motor Sync. SW preparado `veconi-v2362-recovery-file-export-v1`.

GO técnico para publicação seletiva do frontend, aguardando autorização. Rollback: reverter apenas este commit sobre a main vigente com versão de cache superior, preservando backend, arquivos já exportados, IndexedDB e filas. Não excluir originais após exportar.
