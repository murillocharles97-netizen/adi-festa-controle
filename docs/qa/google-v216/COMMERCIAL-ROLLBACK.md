# V216 — rollback compatível da abertura Google

Procedimento preparado, **não executado**. Base comercial V215 preservada. Não há release commit/tag nesta preparação; o snapshot privado lista hashes e diff para revisão.

## Durante o piloto atual

Não aplicar a política comercial proposta. A implantação restrita permanece em `C:/Users/Murillo/Documents/VECONI-V216-Restricted-Lab`, com suas fontes, configuração e evidências privadas preservadas. O piloto atual tem validade até 06/11/2026 07:28:54 (São Paulo); isso não altera sessões de senha existentes. Qualquer renovação exige decisão explícita.

## Depois de uma futura abertura comercial

1. Pausar novos cadastros no documento privado: alterar **somente** `modes.signup=false`. Conservar schema 2, `enabled=true`, `modes.signin=true`, projeto, rollout, origens, native probe, bindings, recibos, reservas, intenções e Auth.
2. No frontend compatível manter `GOOGLE_SERVER_POLICY_READY=true` e usar `GOOGLE_NEW_REGISTRATIONS_READY=false`: some o botão de cadastro Google, permanece Continuar com Google. O servidor continua sendo a autoridade. Provas de cadastro preparadas anteriormente passam a ser recusadas, sem conceder novo token.
3. Manter as duas Functions no piso compatível schema 2, inclusive login posterior a onboarding explícito e proteção de contas de senha. O código piloto v1 anterior não é rollback após existirem usuários comerciais Google.
4. Manter o provedor Google nativo **desativado** e unicidade de email ativa. Não restaurar linking, providerToLink, funções antigas de Auth nem permissões ampliadas.
5. Validar login de senha QA, login Google de UID já registrado e ausência de novo cadastro. Não alterar/revogar usuários reais ou apagar identidade, empresa, membership, recibos ou provas.

Em incidente crítico de integridade, pode ser necessário bloquear novas concessões Google por política `enabled=false`, explicando que novos logins Google ficarão indisponíveis. Isso não apaga ou invalida identidades/recibos e não interfere no login por senha. Não automatizar essa interrupção como resposta a uma falha comum de rede.

Cobertura: regressão frontend com signup bloqueado/signin disponível, Emulator com cadastro pausado/janela expirada/signin no mesmo UID, conta com empresa preservada e transição do binding do piloto sem migração. Nenhuma execução de rollback na produção foi realizada.
