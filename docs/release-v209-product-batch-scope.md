# V209 — autorização canônica e pré-validação de Produtos

Base: V208 sanitizada `12f6cc44b04fc104c9c2875ea134fd0c0fec7990`. Candidato local, sem publicação.

## Causa reproduzida

As listagens desktop e mobile mostram o catálogo da empresa, mas a ação V206–V208 usava `SpaceContext.homeId()` e a lista em cache `homeSpaces()` como autorização do catálogo. Uma seleção válida podia falhar para todos os itens quando o filtro do Início apontava para outro espaço ou quando a lista local estava incompleta. A regressão executa o código publicado V208: nove produtos válidos, nove bloqueios com a mesma mensagem, zero gravações.

O contexto do Início continua na identidade de segurança para invalidar respostas antigas, mas deixa de substituir a autorização dos produtos. Não foi alterado `SpaceContext`, o filtro de vendas nem o escopo de leitura do catálogo.

## Correção

- Pré-validação somente leitura antes de habilitar a confirmação: aptos, regularização de espaço, sem permissão, confirmação anterior pendente, já inativo e consulta indisponível.
- Empresa, geração, permissão `products.edit`, vínculo ativo e identidade são obrigatórios. Produto e espaços são consultados pelo SDK autenticado, diretamente no servidor, sem aceitar cache ou escrita local pendente como confirmação.
- Owner administra produtos canônicos da empresa pelos vínculos comprovados. Seller permanece limitado aos espaços autorizados; produtos compartilhados são validados pela interseção permitida, sem consultar espaços privados ou Financeiro.
- Legacy sem vínculo, contraditório, inexistente ou não confirmável permanece bloqueado. Nada é convertido automaticamente em `all_spaces`. Vínculo legado único e autorizado pode ser usado pelo owner. As Rules atuais negam leitura de espaços inativos: esse caso permanece em regularização, sem bypass. Qualquer regularização exige decisão explícita do owner pelo fluxo existente; não faz parte da exclusão.
- Somente os aptos entram na ação explicitamente confirmada. A autorização é repetida antes de gravar; mudança de conta, permissão, espaço ou vínculo invalida a resposta antiga.
- Mantém o mesmo patch lógico e o mesmo caminho DB/Sync autorizado, sem exclusão física, alteração de estoque, imagens ou registros históricos. Após resposta perdida, a verificação continua sendo somente leitura do mesmo operationId.
- Ao terminar, a ação de confirmação é removida, não apenas escondida por CSS. O modal oferece Fechar resultados, sem spinner permanente ou sucesso falso. Seleções mistas mantêm os itens bloqueados identificados.

## Verificação real e limites

O inventário canônico foi feito somente por leitura, sem dados pessoais de clientes. Foram encontrados nove produtos QA ativos na Adi Festa, vinculados a dois espaços QA ativos e da mesma empresa; não possuem tombstone de exclusão. Os prints citados não estavam anexados à solicitação: a correspondência exata com a seleção do aparelho e o filtro/cache carregado naquele momento não foi presumida. Não houve acesso à fila ou IndexedDB do aparelho. O teste reproduz o erro antes de criar intenção/fila; não é prova de inexistência de pendências locais anteriores.

## Publicação e rollback

Frontend/PWA somente. Functions, Rules, permissões, Sync, recuperação V208, Trocas, Fiado e dados canônicos não mudam. Recursos públicos continuam na lista explícita; testes e documentos não são publicados.

Rollback compatível: V208 `12f6cc44b04fc104c9c2875ea134fd0c0fec7990`, tag local `rollback/v209-compatible-product-batch`. Reverter apenas frontend preserva tombstones, sidecars, IDs, recibos, filas e histórico. Nenhum dado é restaurado ou apagado. A V208 voltaria a apresentar a limitação de contexto, sem invalidar operações já confirmadas. Rollbacks anteriores permanecem intactos.

Antes de publicar: gate `scripts/verify-v209-release.cjs`, testes app/DOM e Emulator com dados fictícios, lint, build, diff-check e confirmação dos dois rulesets. O commit candidato fica somente local; push e publicação dependem de autorização específica.
