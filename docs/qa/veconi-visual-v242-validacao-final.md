# VECONI Visual 1C — parecer final V242

Candidata local em `codex/veconi-visual-audit`. Inclui toda a branch visual até `5ecab82` e as correções aprovadas `3ab3c99` e `0bdf1bd`. A main remota conferida está em `350d2b8` (V241).

## Resultados

- **Importação** — Chrome a 390 e 1440 px nos dois temas, com o componente, o modelo e o worker XLSX reais e catálogo fictício em loopback. Arquivo inválido e contexto de outra empresa foram recusados. A prévia separou uma alteração válida de uma linha inválida e fez zero gravações. O duplo clique enviou uma única solicitação. A interface distinguiu fila pendente, erro e conclusão. CSV de clientes passou pela prévia e confirmou o saldo fictício de −R$ 10 no adaptador, só após confirmação.
- **Confirmações destrutivas** — venda com motivo, checkbox e tratamento externo obrigatórios. Voltar pelo teclado encerrou sem enviar. A confirmação válida emitiu uma solicitação, com comprovante e indicação de conferência contábil. A confirmação genérica de exclusão diferenciou cancelar e excluir. As ações foram interceptadas por adaptadores fictícios.
- **Recebimentos e pagamentos** — o formulário real barrou zero e distinguiu falha, conflito em revisão, pendência local e confirmação remota simulada. O recibo preservado exibiu conferência sem botão de reenviar e distinguiu prova insuficiente e recibo confirmado. O simulador exibiu confirmação pendente, erro e pagamento aprovado com finalização ainda em andamento. Nenhuma maquininha ou servidor de produção foi chamado.
- **Conflitos CSS** — as superfícies escuras expuseram texto legado pouco legível na linha inválida da planilha, no toast de recebimento (1,07:1) e no aviso de resultado incerto da maquininha (2,35:1). As correções usam tokens de texto, erro e alerta com escopo específico. O ícone de erro voltou a usar o token negativo. A ponte gerada e a identidade geométrica permanecem intactas. O Histórico continua usando a superfície legada fora do escopo 1C.
- **Atualização real do PWA em loopback** — instalou o Service Worker de `350d2b8` em perfil dedicado. O fluxo real de atualização gravou a fila e recarregou sob a V242. A versão e o cache `veconi-v242-visual-1c-v1` foram confirmados por `GET_VERSION`. O teste comparou o SHA-256 dos cinco recursos alterados no cache, verificou as referências `v=242`, carregou ambos os scripts do Início e a folha visual. Fechou e reiniciou o Chrome no mesmo perfil sem rede. Dois documentos e dois envelopes, um pendente e um em erro, permaneceram íntegros no armazenamento real do app. A preferência escura permaneceu aplicada. O cache antigo continuou armazenado, fora do fallback do worker ativo.
- **Regressão** — main e candidata: 2.393 testes em cada, 2.235 aprovados, 157 falhas e 1 ignorado em ambas. Os mesmos 157 nomes falharam. Um teste de navegação por teclado falhou intermitentemente na primeira rodada, passou isolado e na repetição completa. O teste da versão agora registra explicitamente que os imports do Sync da V242 continuam em V241. Contenção pública: 56/56. Identidade de versão: 5/5. Pacote público: 279 arquivos.

O diff entre V241 e V242 preserva checkout, Fiado, integração da maquininha, Sync, Functions e Firestore Rules. A cobertura anterior de serviços, estoque e automação no Emulator segue documentada na auditoria 1C.

## Riscos residuais

A ponte ainda acrescenta 1.745 regras e pode conflitar com CSS legado em estados futuros. A rolagem horizontal de Clientes em 768 e 1024 px já existia na main. O Chrome em loopback comprova persistência e compatibilidade da atualização no cenário com um perfil, após aceitar e recarregar. Não comprova atualização simultânea de todas as abas, autenticação em produção, comportamento de todos os dispositivos Android ou contraste de todos os estados. Os fluxos com efeitos usaram adaptadores. O teste não comprova uma transação real de maquininha ou importação em produção.

## Publicação e rollback

**GO técnico para publicação da candidata local após autorização.** Conferir a main antes de integrar. Publicar só o frontend V242 pelo GitHub Pages. Validar o commit servido no domínio, a versão e o cache do controlador, e testar atualização da V241 e reabertura offline de uma instalação piloto. Manter os dispositivos com formulários abertos no fluxo normal de confirmação do PWA.

Se o piloto encontrar regressão crítica, publicar a interface da V241 por novo commit com identidade de cache nova e coerente com o build de rollback. Preservar dados locais, preferência, fila, backend e Rules. Confirmar no piloto a troca do controlador, a abertura offline e os envelopes preservados. Nenhuma ação de publicação foi executada nesta etapa.

## Reproduzir

Em um checkout com Chrome e `puppeteer-core` disponíveis:

```powershell
node scripts/audit-veconi-visual-pwa-v242.cjs
node scripts/audit-veconi-visual-states-v242.cjs
node --test tests/*.test.js tests/*.test.cjs
npm run test:public-containment
```

As capturas, medições e logs locais estão em `qa-artifacts/audit`, fora do pacote público. A execução final das telas está em `v242-release`.
