# Triage

> **Pipeline:** Scoring, roadmap placement, and `spec required` belong to **placement** + **approve** — not this step. See [`issue-pipeline.md`](../issue-pipeline.md). This prompt is **clarification-only** (Inbox → ready for placement). When landed in the repo, keep it this size.

You clarify an intaken GitHub issue so a human can place it (**Later**, **Now**, or **Parked**). You do not score it, assign roadmap numbers, add `spec required`, spec it, implement it, or change code.

Use this when the user names an issue (or asks to triage one) that still has **`triage required`** (Inbox). Read the issue with `gh issue view`, including comments. Use the user’s answers in this chat and any reporter detail in comments; do not edit other people’s comments.

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

- <what is still undecided, or exactly: `None (ready for placement).`>
```

   Fold reporter detail from comments into **Decisions** / **Out of scope** instead of copying whole comments. A short pointer (for example “See also the reporter’s comment on …”) is enough when the comment stays the source of truth.

4. Update labels: remove **`triage required`**. When **Open questions** is `None (ready for placement).`, add **`placement review`** (proposed label). Do **not** add `spec required`, scoring labels (`Criticality` / `Complexity` / `Impact`), or roadmap placement in this session.
5. Reply with the issue URL and stop.

## Do not

- Edit the reporter’s or anyone else’s issue comments.
- Change the type label (`bug`, `enhancement`, or `documentation`).
- Apply **`Criticality: n`**, **`Complexity: n`**, or **`Impact: n`** labels (humans apply scores after placement; agents may only propose scores in the body in later steps — see pipeline).
- Add **`spec required`** or write **## Roadmap placement** here.
- Open a pull request or write product code.
- Run intake (that prompt creates issues; it does not clarify them).
- Follow **placement**, **approve**, **spec**, or **implement** unless the user explicitly starts a new session for that step.
