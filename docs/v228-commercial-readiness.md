# V228 pronta para publicação seletiva

Base da preparação d3dafbd257a7f904befbf3b56c3bff9a7e9a5dff, na branch codex/v228-commercial-readiness.

A autorização e a sessão representam Todos os espaços por spaceAccess=all e allowedSpaceIds=[]. O frontend consulta os espaços empresariais ativos e seleciona um deles para vender. As Rules anteriores aceitavam a leitura por ID, mas não autorizavam a lista porque canAccessSpace depende do ID curinga do documento. O resultado era permission-denied e uma lista vazia no primeiro acesso.

firestore.v228.rules parte das Rules publicadas da V227 e acrescenta cinco linhas somente ao bloco de leitura de financialSpaces. Um membro ativo com Todos os espaços pode listar metadados de espaços da própria empresa ativa. Espaços específicos seguem usando os IDs autorizados. As regras de histórico, cobrança, escrita, calendário e subcoleções financeiras permanecem idênticas à V227. firestore.v227.rules continua como referência imutável.

A configuração seletiva é firebase.v228.json. Antes da publicação, comparar as Rules efetivamente publicadas com a base V227, cujo SHA-256 normalizado é b947c26a89dc0a59b2aa24b5deec14c33fbb98cef66c5e833a56c708d7a533bc.

A validação usou somente contas e dados sintéticos. As Functions foram executadas localmente com Auth e Firestore Emulator. As rotas preservadas usaram os pacotes das revisões publicadas e os dois serviços alterados da V228 usaram os arquivos candidatos. As evidências ficam em C:/Users/Murillo/.codex/visualizations/2026/11/09/v228-implementation-qa.

- Quatro jornadas passaram, combinando Todos os espaços ou espaço específico com uma ou múltiplas unidades. Cada jornada verificou convite, aceite, primeiro login, venda Pix, recibo, baixa única, criação posterior de espaço, novo login e nova venda.
- O espaço criado depois do convite apareceu em Todos os espaços. O vendedor específico continuou limitado ao espaço liberado.
- As Rules negaram histórico, cobrança, contas financeiras, outra empresa, escrita administrativa, acesso anônimo e acesso após desativação.
- Os testes afetados do calendário V227 passaram também contra as Rules candidatas.
- Crediário e reconhecimento do Pix foram testados no Emulator com registros sintéticos. A réplica histórica completa de 37 contas depende de fixtures externas e ficou fora desta rodada.
- Chrome desktop e móvel emulado passaram na primeira ativação silenciosa, atualização real, recarga recusada e falha de persistência. O IndexedDB manteve a fila após a recarga aceita e após fechar e abrir outro processo do Chrome com o mesmo perfil.

A sequência futura, após autorização e preflight imediato, é publicar exclusivamente as Rules de firebase.v228.json e confirmar seu conteúdo. Em seguida atualizar seletivamente completeBusinessOnboarding e createTeamInvite, validar as revisões e publicar o frontend com Service Worker veconi-v228-commercial-v1. As demais Functions e os índices ficam fora do manifesto.

O frontend já corresponde ao candidato d3dafbd. Nesta rodada, as novas alterações são o patch de Rules, sua configuração seletiva, os testes e este roteiro.

A homologação do PWA instalado depende de um Android físico disponível após a publicação. Usar exclusivamente uma empresa e contas de QA com Pro simulado.

1. Em perfil novo do Chrome Android, abrir a VECONI, instalar o PWA e conferir o primeiro acesso sem aviso de atualização.
2. Convidar e autenticar vendedores sem histórico, um com espaço específico e outro com Todos os espaços.
3. Criar outro espaço pelo proprietário e conferir sua presença somente no perfil Todos os espaços.
4. Fazer uma venda Pix sintética e conferir recibo e baixa única. Fechar e reabrir o PWA e fazer novo login com o vendedor.
5. Com a versão anterior instalada e uma operação sintética pendente, apresentar a atualização. Recusar a recarga e conferir preservação da sessão e da fila.
6. Aceitar a atualização com o formulário salvo. Conferir a versão 228 e a integridade da fila sem registrar a operação novamente.
7. Confirmar que histórico restrito e cobrança continuam negados ao vendedor.

A falha de persistência foi exercitada no laboratório com DB.flush rejeitado. Nessas condições, a aplicação apresentou orientação e preservou a página sem recarga.

Após uma publicação autorizada, avaliar o recurso afetado e as operações pendentes antes de qualquer contenção. Preservar membros, política provisionada, convites, auditoria e registros financeiros. Retornar às Rules anteriores restabelece o bloqueio de lista em Todos os espaços. Nenhuma reversão deve restaurar Rules permissivas de histórico ou apagar dados.

GO técnico para publicação seletiva condicionado ao preflight. A homologação física do Android permanece como verificação pós-publicação antes da abertura comercial ampla.
