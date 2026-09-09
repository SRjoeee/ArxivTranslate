# Codex automatic review: wait for completion before merging

This repository enables automatic PR reviews by Codex (`chatgpt-codex-connector[bot]`). Review starts when a PR is opened or pushed to.
**You can also trigger it manually with a PR comment containing `@codex review`** to retry a review that could not run because of usage limits.
**This also works for already-merged PRs** (verified on 2026-09-06 for #58 and several other PRs merged without a review):
Codex first adds an 👀 reaction (`eyes`) to indicate **review in progress**, then leaves one of three terminal signals. **Do not merge before a terminal signal appears**:

Query rules (the first three arose from flaws Codex identified in #29; the next two from observations on 2026-09-06):

- **Accept only this account**: `.user.login == "chatgpt-codex-connector[bot]"`. Do not use substring matching such as `test("codex")`: in a public repository, any account with "codex" in its login could add 👍 and make the PR appear reviewed.
- **Accept only signals for the current HEAD**: reviews carry `commit_id`; accept only values equal to `git rev-parse HEAD`. For inline comments, inspect **`original_commit_id`**: a comment’s `commit_id` is re-anchored by later commits (observed in #30: a round-two comment on `5c8a7bd` changed to the new HEAD after the third push, and its line moved from 168 to 180; filtering by `commit_id` would treat the old comment as new feedback). Reactions, summary comments, and usage-limit notices have no commit field, so filter by time: use `date -u` to record UTC time `PRE` **before** pushing (or `gh pr create` / `@codex review`), in the same timezone as GitHub’s `created_at`; do not use commit time `%cI`. Signals with `created_at >= PRE` belong to this round. Record the time before the action, not when the client first sees the new HEAD: Codex may add 👀 before our polling sees it. Old comments remain in the API; without filtering, a new push immediately appears "reviewed".
- **Do not first find 👀 and then search for a later 👍** (observed on 2026-09-06): **the same account leaves only one reaction on an issue**; Codex **replaces** 👀 with 👍 when it finishes, rather than adding another reaction beside it. Code that sets ROUND to this round’s 👀 timestamp and searches for 👍 after ROUND loses ROUND exactly when the review completes, so it never counts 👍. PR #61 had finished review while the script kept reporting "waiting". Filter reactions directly by `created_at >= PRE`; ROUND is unnecessary.
- **"No findings" is 👍 plus a summary comment** whose body resembles `Codex Review: Didn't find any major issues.` and includes `**Reviewed commit:** <sha>`. **Use this to verify that the current HEAD was reviewed**; it is the only commit evidence on the no-findings path (👍 has no commit field). Checking only `pulls/{n}/reviews` misses this: that endpoint is empty when there are no findings.
- **Paginate**: add `--paginate` to both list endpoints; otherwise only the first page of reactions / comments is visible.
- **👍 can appear alone, without a summary comment** (observed on 2026-09-06/07 in round two of #84 and in #85): both had only a `+1` reaction, no `Codex Review` summary in `issues/{n}/comments`, and empty `pulls/{n}/reviews` and inline-comment responses. In that case, attributing 👍 to a HEAD relies solely on time: `created_at >= PRE` (recorded before the push). Check **all four endpoints** before concluding "no findings"; checking only two led to an incorrect "not reviewed" report for #80.
- **For a merged PR reviewed retroactively with `@codex review`, the summary’s `Reviewed commit` is the merge commit** (observed in #80 on 2026-09-06), not the branch HEAD or last feature commit. Compare it with `gh pr view <N> --json mergeCommit --jq .mergeCommit.oid`.

```sh
set -e                                               # Stop if push fails; do not poll indefinitely with an old SHA
BOT='chatgpt-codex-connector[bot]'; HEAD=$(git rev-parse HEAD)
PRE=$(date -u +%Y-%m-%dT%H:%M:%SZ); git push         # Record UTC before the action (before gh pr create for a new PR)
until [ "$(gh pr view <N> --json headRefOid --jq .headRefOid)" = "$HEAD" ]; do sleep 5; done
# Reactions: at most one this round (eyes = reviewing / +1 = done, no findings). Do not filter again through ROUND; see above
gh api --paginate "repos/{owner}/{repo}/issues/<N>/reactions" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$PRE\") | .content"
# Summary comment: the only commit-bearing evidence on the no-findings path; compare Reviewed commit with $HEAD
gh api --paginate "repos/{owner}/{repo}/issues/<N>/comments" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$PRE\") | select(.body | test(\"Codex Review\")) | .body"
# Review + inline comments (only when there are findings; accept only those for the current HEAD)
gh api --paginate "repos/{owner}/{repo}/pulls/<N>/reviews"  --jq ".[] | select(.user.login == \"$BOT\") | select(.commit_id == \"$HEAD\") | .state"
gh api --paginate "repos/{owner}/{repo}/pulls/<N>/comments" --jq ".[] | select(.user.login == \"$BOT\") | select(.original_commit_id == \"$HEAD\") | \"\(.path):\(.line // .original_line) \(.body)\""
# Usage-limit notice
gh api --paginate "repos/{owner}/{repo}/issues/<N>/comments" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$PRE\") | select(.body | test(\"usage limits\")) | .body"
```

| Signal (all filtered by `created_at >= PRE`) | Meaning |
|---|---|
| 👀 reaction | This round has started; review is in progress; keep waiting |
| 👍 reaction (replaces 👀; usually accompanied by a `Codex Review: Didn't find any major issues` summary, but may appear alone; see above) | Review complete, no findings; verify HEAD using `Reviewed commit` if a summary exists, otherwise assign the round by PRE time |
| Review (`COMMENTED`) + inline comments for the current HEAD | Findings available |
| "You have reached your Codex usage limits" | This review did not run |

Only 👀, or no signal at all, means review is still running (or queued); keep waiting. A terminal signal usually appears within minutes. Pushing a new commit starts a new round.
**How long to wait**: if even 👀 is absent 30 minutes after a push, treat the round as not picked up by Codex (observed in #29: five rounds ran, but the sixth never started). Tell the user and let them decide whether to merge; do not wait indefinitely.

## Handling comments

- **Verify each finding; do not accept everything**: check fixtures, measured results, or code before deciding. Historically about 30–50% of findings were valid,
  but valid findings often exposed real regressions (for example, #26 caught an early `return` introduced when I removed an anchoring wrapper).
- It reviews **the commit submitted with the PR**: refactored areas may already have changed, so compare against the current branch first.
- Pushing accepted fixes triggers another review; return to the waiting procedure above.
- For findings not accepted, leave a short explanation in the PR with evidence or reasoning; do not silently ignore them.

## Complete workflow

```
gh pr create …                     # Or git push to an existing PR
# Wait for CI + a terminal Codex signal for the current HEAD (queries above)
gh pr checks <N>
# Findings → verify individually → fix → push → wait again (HEAD changed, old signals are invalid)
# 👍 or all findings verified and handled + green CI → ask user to confirm → gh pr merge <N> --merge --delete-branch
```

Always use a merge commit (not squash), and ask the user before each merge.

## Stacked PRs (B uses A’s branch as its base)

**Change the downstream base before merging upstream and deleting its branch** (observed on 2026-09-07 in #87 / #88): when `gh pr merge A --delete-branch` deletes A’s branch,
GitHub **closes B outright** if B uses that branch as its base; it does not retarget B to main. A closed PR cannot change its base (`Cannot change the base branch of a closed pull request`).
Recovery requires temporarily pushing the branch back (`git push origin <sha>:refs/heads/<branch>`), running `gh pr reopen B` and `gh pr edit B --base main`, then deleting the branch again. Correct order:

```
gh pr edit B --base main            # Retarget downstream first (the diff temporarily includes A’s changes until A merges)
gh pr merge A --merge --delete-branch
# B’s CI reruns against the new base; merge B when green, first retargeting C to main in the same way
```

After each upstream fix, `git merge` it into the downstream branch and push (the downstream HEAD changes, so Codex reviews again; it reviews the downstream diff against its base without repeating upstream changes).
After usage limits (`You have reached your Codex usage limits`) reset, comment `@codex review` on the PR to rerun the final review round.
