# Codex automatic review: wait until it has finished before merging

The repository has Codex's automatic PR review on (`chatgpt-codex-connector[bot]`). It starts reviewing when a PR is opened or pushed —
**but do not assume a push always triggers it** (measured 2026-09-08: right after a usage-limit recovery, two PRs sat twenty minutes after new commits with neither 👀
nor a new review; an explicit `@codex review` comment is what got it moving). So while waiting, **check by the rules below that the review's commit is the current
HEAD**; looking only at "is there a review" takes the previous round's old conclusion for this round's; if it did not follow, call it explicitly once more.
**Rebuild-period merge gate** (owner, 2026-09-12; ADR-0001 §7): a PR into `rebuild/v1` merges once the local adversarial review passed with its findings addressed, CI is green and Codex left a terminal signal here — no further confirmation. `main` stays owner-only. **Opening a PR does not always start a review** (2026-09-12: #172 and #173 sat 30 minutes without 👀). End every PR body with a line `@codex review`, above the attribution line — the mention is what reliably starts the round. **A comment `@codex review` on the PR also triggers it by hand** — a PR that hit the usage limit and was not reviewed at the time gets its review this way,
**and a PR already merged takes the same trick** (measured 2026-09-06: a batch of PRs merged unreviewed, #58 among them, were all reviewed afterwards this way):
it first leaves a 👀 reaction (`eyes`) on the PR meaning **review in progress**, and at the end leaves one of three terminal signals. **Do not merge before the terminal signal**:

Query rules (the first three from holes Codex pointed out on #29, the last two from what 2026-09-06's measurements ran into):

- **Accept this one account only**: `.user.login == "chatgpt-codex-connector[bot]"`, no substring matching like `test("codex")` — on a public repository any account whose login contains "codex" could leave a 👍 and make the PR look reviewed.
- **Accept only signals aimed at the current HEAD**: a review carries `commit_id`; take only those equal to `git rev-parse HEAD`; for inline comments look at **`original_commit_id`** — a comment's `commit_id` is re-anchored by later commits (measured on #30: a second-round comment left on `5c8a7bd` had its `commit_id` become the new HEAD after the third push, its line moving from 168 to 180; filtering by `commit_id` would take the previous round's old comment for this round's new suggestion). Reactions, summary comments and usage-limit notices have no commit field and can only be filtered by time: **before** the push (or `gh pr create` / `@codex review`) record the UTC time `PRE` with `date -u` (the same zone as GitHub's `created_at`; the commit time `%cI` will not do), and whatever has `created_at >= PRE` belongs to this round. Use the moment before the action rather than "when the client saw the new HEAD": Codex may have put its 👀 on before we polled to the new HEAD. The previous round's old comments stay in the API forever; unfiltered, a freshly pushed commit is "reviewed" at once.
- **Do not "find the 👀 first, then a 👍 after it"** (2026-09-06, measured): **one account leaves one reaction per issue**; Codex finishes by **replacing** the 👀 with a 👍, not by adding one beside it. So the form "take this round's 👀 time as ROUND, then look for a 👍 after ROUND" has ROUND turn empty the moment it finishes, and the 👍 is never counted — PR #61 was reviewed, yet the script kept reporting "waiting". Filter the reactions by `created_at >= PRE` directly; no ROUND is needed.
- **"No suggestions" is a 👍 + one summary comment**: the body reads `Codex Review: Didn't find any major issues.` and carries `**Reviewed commit:** <sha>` — **use it to check that the review was of the current HEAD**; it is the only commit evidence on the no-suggestions path (the 👍 reaction itself has no commit field). Querying `pulls/{n}/reviews` alone misses it: with no suggestions that endpoint is empty.
- **Pagination**: add `--paginate` to both list endpoints, or only the first page of reactions / comments shows once there is more than one.
- **A 👍 can appear alone, without a summary comment** (measured 2026-09-06/07 on #84's second round and #85): both times only a `+1` reaction, no `Codex Review` summary in `issues/{n}/comments`, and `pulls/{n}/reviews` and the inline comments empty too. Then the 👍 can only be attributed to a HEAD by time: `created_at >= PRE` (PRE recorded before the push). Query **all four** endpoints before concluding "no suggestions" — on #80 only two were queried and "not reviewed" was misreported.
- **When a merged PR is reviewed afterwards with `@codex review`, the summary's `Reviewed commit` is the merge commit** (measured 2026-09-06 on #80): not the branch HEAD, nor the last feature commit. Compare against `gh pr view <N> --json mergeCommit --jq .mergeCommit.oid`.

```sh
set -e                                               # stop when the push fails; do not poll forever with a stale SHA
BOT='chatgpt-codex-connector[bot]'; HEAD=$(git rev-parse HEAD)
PRE=$(date -u +%Y-%m-%dT%H:%M:%SZ); git push         # record the UTC time before the action (for a new PR, before gh pr create)
until [ "$(gh pr view <N> --json headRefOid --jq .headRefOid)" = "$HEAD" ]; do sleep 5; done
# Reactions: this round can have only one (eyes = reviewing / +1 = done, no suggestions). No second filter through ROUND, see the previous section
gh api --paginate "repos/{owner}/{repo}/issues/<N>/reactions" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$PRE\") | .content"
# The summary comment: the only commit-bearing evidence on the no-suggestions path; check that Reviewed commit is $HEAD
gh api --paginate "repos/{owner}/{repo}/issues/<N>/comments" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$PRE\") | select(.body | test(\"Codex Review\")) | .body"
# Review + inline comments (present only with suggestions; accept only those aimed at the current HEAD)
gh api --paginate "repos/{owner}/{repo}/pulls/<N>/reviews"  --jq ".[] | select(.user.login == \"$BOT\") | select(.commit_id == \"$HEAD\") | .state"
gh api --paginate "repos/{owner}/{repo}/pulls/<N>/comments" --jq ".[] | select(.user.login == \"$BOT\") | select(.original_commit_id == \"$HEAD\") | \"\(.path):\(.line // .original_line) \(.body)\""
# The usage-limit notice
gh api --paginate "repos/{owner}/{repo}/issues/<N>/comments" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$PRE\") | select(.body | test(\"usage limits\")) | .body"
```

| Signal (all filtered by `created_at >= PRE`) | Meaning |
|---|---|
| 👀 reaction | the round started, reviewing, keep waiting |
| 👍 reaction (the 👀 replaced; usually with a `Codex Review: Didn't find any major issues` summary comment, sometimes the 👍 alone, see above) | reviewed, no suggestions; with a summary check HEAD by `Reviewed commit`, without one attribute the round by the PRE time |
| a review (`COMMENTED`) aimed at the current HEAD + inline comments | suggestions |
| "You have reached your Codex usage limits" | not reviewed this time |

Only a 👀, or nothing at all = still reviewing (or not yet its turn), keep waiting; the terminal signal usually comes within minutes. Pushing a new commit starts a new round.
**How long to wait**: no 👀 at all 30 minutes after the push means Codex did not pick this round up (measured on #29: after five rounds the sixth never came); tell the user and let the user decide whether to merge, do not wait forever.

## Rules for handling comments

- **Verify one by one, adopt nothing wholesale**: confirm with a fixture, measured data or by reading the code, then decide. The historical hit rate is about 30–50%,
  but the hits are often real regressions (on #26, for instance, it caught the early `return` I introduced when removing the anchoring wrapper).
- It reviews **the commit the PR was opened at**: refactored parts are often out of date; compare with the current branch before judging.
- After the adopted changes are pushed it reviews another round; back to the waiting above.
- For what was not adopted, write one sentence in the PR on why (data or reason); do not ignore it silently.

## One complete flow

```
gh pr create …                     # or git push to an existing PR
# wait for CI + Codex's terminal signal aimed at the current HEAD (queries above)
gh pr checks <N>
# comments → verify one by one → fix → push → back to waiting (HEAD changed, old signals void)
# 👍, or verified and handled + CI green → ask the user to confirm → gh pr merge <N> --merge --delete-branch
```

The merge method is fixed as merge (no squash); ask the user once before every merge.

## Stacked PRs (B based on A's branch)

**Change the downstream base first, then merge the upstream and delete its branch** (measured 2026-09-07 on #87 / #88): when `gh pr merge A --delete-branch` deletes A's branch,
GitHub **closes** B, whose base it was, outright rather than retargeting it to main; a closed PR's base cannot be changed (`Cannot change the base branch of a closed pull request`),
and the branch has to be pushed back temporarily (`git push origin <sha>:refs/heads/<branch>`), `gh pr reopen B`, `gh pr edit B --base main`, then delete the branch. The right order:

```
gh pr edit B --base main            # retarget the downstream to main first (its diff temporarily includes A's changes; merging A restores it)
gh pr merge A --merge --delete-branch
# B's CI reruns against the new base; once green merge B, retargeting C's base to main first the same way
```

Every round of fixes on the upstream PR is `git merge`d into the downstream branch and pushed (the downstream HEAD changed, so Codex reviews another round; it reviews the downstream's diff against its base, and the upstream's changes are not reviewed twice).
Once the usage limit (`You have reached your Codex usage limits`) recovers, comment `@codex review` on the PR to get the last round reviewed.
