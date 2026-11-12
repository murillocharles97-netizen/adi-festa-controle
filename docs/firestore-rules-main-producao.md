# Firestore Rules: main e produção

Conferência somente leitura em 12/11/2026. Projeto adi-festa-controle, banco (default).

| Origem | Referência | SHA-256 dos bytes |
| --- | --- | --- |
| Git | main em bc8ad098185e643d20775f45a5e9678e06001aa8, arquivo firestore.rules | 15e517d843038a8742ba68adbded839a109d4c07d18ee8595ab30cf55ddd87b2 |
| Firebase | release cloud.firestore, ruleset b28c9850-3af2-4df2-a835-8eea496393d9 | fc6308693b6bdbdd827fd413e1b4bae98980acda6366a84ee7dff4a18f76e4e9 |

O diff da main para a versão ativa tem 153 adições e 99 remoções de linhas. Entre as diferenças estão a política de leitura operacional para permissões V3, a leitura de projeções antigas do portal e proteções para operações de estoque, trocas e corte financeiro. As duas versões exigem vínculo de espaço para leitura de produtos por funcionários e restringem custos. Há também diferenças nas condições de escrita de produtos e variações.

A correção de disponibilidade usa o fluxo autenticado de edição de produto e a mesma consulta de catálogo existente. Somente o proprietário pode iniciar a revisão pela interface. A seleção vale para os espaços indicados e é conferida na sessão atual. Registros que ainda carregam custo no próprio documento, origem divergente ou vínculo parcial ficam fora dessa revisão. Os custos já separados em productFinancials continuam sujeitos às permissões existentes.

Este pacote é de frontend. Para qualquer futura publicação de Rules, obtenha novamente a fonte pelo release ativo do banco, compare-a com a base registrada e teste o diff autorizado em Emulator. O arquivo firestore.rules da main, sozinho, não reproduz a versão em produção.
