@AGENTS.md

## Claude Code

- As regras comuns estão no `AGENTS.md` acima e valem igualmente para Claude e Codex, inclusive as de release. Este arquivo só acrescenta o que é específico do Claude Code e não muda responsabilidades nem permissões.
- Para tarefas grandes e independentes, abra uma sessão própria com worktree, seguindo "Desenvolvimento em paralelo".
- Para mudanças de interface, use a skill `frontend-design` quando estiver instalada e reutilize os tokens de tema existentes.
- Use os subagentes em `.claude/agents/` conforme a seção "Especialistas por tarefa" de `AGENTS.md`. Delegue uma pergunta por perfil e coordene a escrita pelo worktree da tarefa.
