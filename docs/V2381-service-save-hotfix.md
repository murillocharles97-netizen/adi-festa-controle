# V238.1 — serviço salvo e oculto no espaço Táxi

Branch isolada: `codex/v238-service-save-hotfix`, base main/V238 `913c81d69a0f692c9eb43137ce98bd0888e2e690`. Preparação local, sem push ou deploy. Nenhuma operação real foi reenviada, criada, excluída ou alterada.

## Diagnóstico confirmado, somente leitura

Em 18/11/2026, a fonte oficial serve V238, SW `veconi-v238-services-consolidated-v1`. Functions ACTIVE: `commitoperationalsync-00023-mol`, `readoperationalworkspace-00004-tiw`, `getperformancepage-00004-keh`. Rules: SHA-256 `b7a53cfb1317c62c46a0d3ffa3862b2a813211666a26298a28237d840fb550df`, mesmo pacote publicado.

Localizado **um** cadastro chamado Corrida na empresa autorizada: ID `a448639b-d848-4a2a-ae9a-0f3205f65bee`, criado em 18/11/2026 às 17:55:21,608 de Brasília e atualizado pelo servidor às 17:55:23,647. Preço 0 (definido na venda), itemKind service, ativo, single_space, vínculo somente ao Táxi. serviceConfig `08183955-5485-4e5a-8bdf-89a2fd4d6329`, requiresKm true; o productFinancials correspondente existe com essa versão, modelo de custo km e modelo de preço sale. O custo privado não está no documento público. Não recriar esse serviço.

O espaço Táxi possui `sales=true`, `products=false`, `inventory=false`. `SpaceContext.productsForView` devolvia uma lista vazia antes de examinar os itens se products fosse false. Essa capacidade significa ausência de catálogo físico, mas o filtro ocultava também serviços sem estoque em espaço autorizado para vendas. O mesmo documento existente reproduz lista vazia com o código publicado e lista com um serviço após o hotfix.

Rastreamento: ProductImages.openForm → preço livre vira 0 válido → Produtos.salvar/ProductModel → DB.alterar/IndexedDB → fila existente → gateway transacional → products público + configuração versionada privada → lista local por espaço. O cadastro chegou ao servidor e está no espaço correto; o defeito comprovado está no último filtro, não em preço livre, permissão, snapshot ou rejeição desse cadastro. A fila específica do Android não é acessível pela nuvem: não se afirma que não exista outra pendência local; não é necessário extraí-la para corrigir o filtro comprovado.

O toast antigo “Produto salvo” ocorria após alteração local, antes de confirmação remota, e a tela não acompanhava eventual erro da operação. Não havia garantia de confirmação financeira/comercial nesse toast.

## Correção mínima

- `js/spaces.js`: preserva empresa, sessão, espaço autorizado e disponibilidade do item. Em espaço com vendas habilitadas, exibe serviços mesmo sem catálogo físico. Produtos físicos continuam ocultos quando products=false. Não muda capacidades nem permissões no servidor.
- `js/product-images.js`: aguarda DB.flush antes de anunciar gravação local; distingue salvando, salvo no aparelho, sincronizando, confirmado na nuvem e erro. Mensagem persistente na tela de Produtos para o último cadastro desta sessão, sem novo mecanismo de Sync. Usa somente diagnósticos existentes e leitura individual do servidor; não confirma pela ausência de fila. Confere os metadados públicos da versão salva, sessão e empresa. Uma versão anterior do mesmo documento não confirma edição nova. Sem polling, replay ou gravação por esse acompanhamento.
- `js/firebase/firestore-repository.js`: a projeção somente leitura getProductStatusFromServer inclui nome, tipo, preço, serviceConfig e atualizadoEm. Continua exigindo resposta do servidor e excluindo custos privados; permissões e SDK existentes mantidos.
- `css/product-images.css`: aviso compacto usando padrões visuais existentes.
- `js/app.js`: subtítulo genérico “Produtos, serviços, preços e custos do espaço ativo”, com variante sem custo para perfil sem autorização.
- `index.html`, `js/build-info.js`, `service-worker.js`: versões dos assets e candidata **V238.1**, cache `veconi-v2381-service-catalog-v1`. Protocolo Sync 1, payload 4 e release inteiro 238 permanecem iguais.

Aviso de confirmação acompanha o último cadastro nesta sessão; não é um monitor global de todos os produtos. Depois de reiniciar, o cadastro continua vindo da persistência/listener existentes. Falhas transitórias não viram confirmação nem acionam reenvio adicional.

## Testes

- Regressão publicada reproduzida: Táxi recém-criado, sales=true/products=false/inventory=false, serviço válido já salvo → 0 itens na V238.
- Unitários/UI/contenção: **124 aprovados**, incluindo espaços, serviço, imagens, ações de catálogo, permissões e versão/cache.
- HTTP + Firestore Emulator + Chrome em **360 e 390 px**: Ações → Novo produto → Serviço → Corrida → preço definido na venda → custo por km → somente Táxi → salvar offline → item aparece → reconectar/sincronizar → confirmação remota → sair/reabrir Produtos → reiniciar navegador → mesmo ID/um cadastro.
- Conferidos configuração privada, ausência de custo no documento público, zero movimentos de estoque, zero vendas/receitas criadas no cenário de cadastro. Documento antigo não confirma nova edição; erro permanente aparece como texto, sem HTML executável nem reenvio; troca de empresa remove aviso da sessão anterior.
- Regressão HTTP do PDV em 360/390: três corridas fictícias por ambiente, Pix/dinheiro/cartão, snapshots e totais corretos; perda de resposta reconhecida pelo recibo; reinício offline e reconexão sem duplicidade; produto físico de controle intacto.
- Suite do Emulator contra a fonte efetivamente publicada 00023-mol: **14 testes aprovados**, incluindo aliases 00022, concorrência na última unidade, idempotência, isolamento, V224 e rollback (`emulator.log`).
- Build aprovado (2.933 arquivos JS, incluindo cópias privadas dos pacotes), versão 238.1 compatível com release 238; manifesto inalterado. Evidências em `qa-artifacts/v238-service-save/`. Capturas `salvo-360/390.png` e `reaberto-360/390.png`, somente dados fictícios. Backup/artefatos privados não entram no pacote público.

## Publicação e rollback propostos

**Somente frontend, após novo GO.** Nenhuma alteração em Functions, Rules, estoque, Fiado, caixa, sync.js, assinaturas ou recuperação da 3 Lindas. A correção usará o cadastro original já confirmado; não precisa recuperação, limpeza nem cadastro substituto.

1. Reconfirmar main/revisões/Rules. Se a main mudou, integrar apenas este hotfix e repetir contenção.
2. Preservar o pacote V238 913c81d em bytes Git/Linux e seus hashes; preparar os 276 recursos do candidato com o manifesto público existente.
3. Publicar frontend pelo procedimento autorizado do repositório, acompanhando um workflow Pages. Conferir 276 hashes, metadados do workflow e SW V238.1.
4. Usuário aceita atualização/reabre o PWA e consulta Produtos no Táxi: a Corrida original deve aparecer. Não cadastrar outra, limpar armazenamento ou reenviar rejeições.
5. Rollback é exclusivamente o frontend V238 913c81d; mantém backend 00023-mol, leitores, Rules e todos os registros/filas. O filtro antigo voltaria a ocultar o serviço, sem apagar o cadastro. Não restaurar Functions anteriores nem modificar capacidades do Táxi para contornar o defeito.

**GO técnico para publicação seletiva do frontend. Não publicado nesta execução.**
