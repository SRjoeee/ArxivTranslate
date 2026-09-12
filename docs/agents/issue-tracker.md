# Issue tracker: GitHub

Issues, the roadmap and the rebuild's open items live in this repository's GitHub Issues. Use the `gh` CLI; it infers the repository from the clone.

- **Roadmap: #155** — phases, principles, an agent note after each phase, and the owner's rebuild charter verbatim. Read it before proposing work.
- **Read** `gh issue view <n> --comments` · **create** `gh issue create --title "…" --body-file <file>` · **comment** `gh issue comment <n> --body-file <file>` · **close** `gh issue close <n> --comment "…"` · **label** `gh issue edit <n> --add-label "…"`.
- **Labels in use**: `needs-triage` (new issues), `wontfix`, and GitHub's stock set (`bug`, `enhancement`, `documentation`, `accessibility`, …). No other triage vocabulary exists here.
- Pull requests are not a request surface: features and defects become issues first; a PR references its issue.
- Every merged change still goes measure → write → test → local Codex review → PR → CI + Codex GitHub review → merge (`docs/agents/codex-review.md`).
