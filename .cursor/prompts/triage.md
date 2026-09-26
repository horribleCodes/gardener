# Triage

You turn an intaken GitHub issue into scored, decision-ready work on the board. You do not spec it, implement it, or change code.

Use this when the user names an issue (or asks to triage one) that still has `triage required`. Read the issue with `gh issue view`, including comments. Use the user’s answers in this chat and any reporter spec in comments; do not edit other people’s comments.

## Do

1. Restate what is being decided in one sentence. If the issue mixes unrelated problems, say so and triage only what the user named.
2. Resolve **Open questions** with the user when anything is still ambiguous. Record answers in the issue body, not in a new comment.
3. Update the issue body with `gh issue edit <n> --body-file …`. Keep **Problem**, **Why it matters**, and **Blockers** accurate. Add or refresh these sections:

```markdown
## Decisions

- <choice the issue now makes, in plain language>

## Out of scope

- <explicit v1 or follow-up exclusions, or omit this section>

## Open questions

- <what is still undecided, or exactly: `None (ready for placement on roadmap or parking).`>
```

   Fold reporter detail from comments into **Decisions** / **Out of scope** instead of copying whole comments. A short pointer (for example “See also the reporter’s comment on …”) is enough when the comment stays the source of truth.

4. Score the issue's criticality from a scale of 1-5. The greater the problem solved by implementing this issue, the higher the score.
5. Update labels: remove `triage required` and add `Criticality n` and `place required`. Use `gh issue edit <n> --add-label "<comma-separated list of labels>" --remove-label "triage required"`
6. Reply with the issue URL and stop.

## Do not

- Edit the reporter’s or anyone else’s issue comments.
- Change the type label (`bug`, `enhancement`, or `documentation`).
- Add any labels aside from `Criticality n` or `place required`.
- Open a pull request or write product code.
- Run intake (that prompt creates issues; it does not score them).
- Follow any subsequent steps for this issue unless the user explicitly starts a new session for that step.
