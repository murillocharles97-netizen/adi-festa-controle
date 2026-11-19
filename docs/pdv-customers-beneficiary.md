# PDV: cliente por espaço e atendido separado do pagador

Base publicada: 828b02d (V238.2). Branch isolada codex/pdv-payer-beneficiary. Sem acesso ao armazenamento do Android, alteração de dados reais ou deploy. A corrida real em andamento não foi acessada nem alterada.

## Etapa A — hotfix independente

Causa reproduzida no Chrome com o código publicado: carrinho mobile z-index 72, modal genérico 60; o seletor utilizava o repositório geral de clientes em vez de SpaceContext.customersForView.

Correção: camada 80 somente nos formulários de cliente do checkout, mesmo filtro de vínculos de Clientes, exclusão de empresa diferente/inativos, pesquisa/recentes restritos e fechamento seguro ao trocar sessão/contexto. Selecionar ou cancelar mantém itens, valores e tentativa. Revalidação da seleção antes de concluir. Desktop usa o mesmo filtro. Não mostrar o saldo global como saldo de um espaço no seletor ou na prévia.

Não foi criado outro fluxo de vínculo: Novo cliente reutiliza o cadastro único e a confirmação explícita existente por WhatsApp. O servidor continua validando permissões e vínculo; não há criação automática nem transferência de dívida.

Testes: regressão visual reproduzida na base e corrigida em 360/390/1366 px, pesquisa, seleção/cancelamento, vazio, espaços, empresa, saldo agregado oculto e proteção do carrinho durante mudança de espaço. 16 testes de cadastro/vínculo/preferências locais aprovados. Somente frontend; sem Rules, Functions ou migração.

## Etapa B

Em validação: atendido como texto opcional sem ID financeiro; clienteId permanece exclusivamente pagador. Auditar e provar recebimentos por espaço antes de liberar cenário compartilhado.
