# Codex 自动审查：合并前必须等它说完

仓库开了 Codex 的 PR 自动审查（`chatgpt-codex-connector[bot]`）。它在 PR 开出或被 push 后开始审——
**但不能假定 push 一定会触发**（2026-09-08 实测：刚从限额恢复那阵，两个 PR 推完新提交后二十分钟既没有 👀
也没有新 review，显式评论 `@codex review` 才动）。所以等待时**要按下面的规矩核对 review 的 commit 是不是当前
HEAD**，只看"有没有 review"会把上一轮的旧结论当成本轮的；确认没跟上就显式再叫一次，
**Opening a PR does not always start a review** (2026-09-12: #172 and #173 sat 30 minutes without 👀). End every PR body with a line `@codex review`, above the attribution line — the mention is what reliably starts the round. **也可以在 PR 上评论 `@codex review` 手动触发**——撞过限额、当时没审成的 PR 靠这个补审，
**已经合并的 PR 同样吃这一招**（2026-09-06 实测 #58 等一批合并时没被审过的 PR，都能这样补回来）：
先在 PR 上打一个 👀 反应（`eyes`）表示**审查中**，结束时留下三种终态信号之一。**看到终态信号之前不要合并**：

查询规矩（前三条来自 Codex 在 #29 上指出的漏洞，后两条是 2026-09-06 实测踩到的）：

- **只认这一个账号**：`.user.login == "chatgpt-codex-connector[bot]"`，不要用 `test("codex")` 之类的子串匹配——公开仓库里任何 login 含 "codex" 的账号点个 👍 就能让 PR 看起来审完了。
- **只认针对当前 HEAD 的信号**：review 带 `commit_id`，只取等于 `git rev-parse HEAD` 的；行内评论要看 **`original_commit_id`**——评论的 `commit_id` 会随后续提交重新锚定（实测 #30：第二轮留在 `5c8a7bd` 的评论，第三轮 push 后 `commit_id` 变成了新 HEAD、行号从 168 挪到 180，按 `commit_id` 过滤会把上一轮的旧评论当成本轮的新建议）。反应、摘要评论与限额提示没有 commit 字段，只能按时间过滤：在 push（或 `gh pr create` / `@codex review`）**之前**用 `date -u` 记下 UTC 时间 `PRE`（和 GitHub 的 `created_at` 同时区；不能用提交时间 `%cI`），`created_at >= PRE` 的就是这一轮的。用动作之前的时刻而不是"客户端看到新 HEAD 的时刻"：Codex 可能在我们轮询到新 HEAD 之前就已经打上 👀。上一轮的旧评论会一直留在接口里，不过滤的话新提交一 push 就"审完了"。
- **不要"先找 👀 再找它之后的 👍"**（2026-09-06 实测踩到）：**同一账号在一个 issue 上只留一个反应**，Codex 收尾时是把 👀 **换成** 👍，不是在它旁边加一个。所以「取本轮 👀 的时刻当 ROUND，再找 ROUND 之后的 👍」这种写法，在它审完的那一刻 ROUND 恰好变成空，👍 永远数不到——PR #61 明明已经审完，脚本却一直报"等待中"。直接用 `created_at >= PRE` 过滤反应即可，不需要 ROUND。
- **"没有建议"是 👍 + 一条摘要评论**：正文形如 `Codex Review: Didn't find any major issues.`，并带 `**Reviewed commit:** <sha>`——**用它核对审的是不是当前 HEAD**，这是无建议那条路径上唯一的 commit 凭据（👍 反应本身没有 commit 字段）。只查 `pulls/{n}/reviews` 会漏掉它：无建议时那个接口是空的。
- **翻页**：两个列表接口都加 `--paginate`，否则超过一页的反应 / 评论只看得到第一页。
- **👍 可以单独出现、不带摘要评论**（2026-09-06/07 实测 #84 第二轮与 #85）：两次都只有 `+1` 反应，`issues/{n}/comments` 里没有 `Codex Review` 摘要，`pulls/{n}/reviews` 与行内评论也是空的。这时把 👍 归到哪个 HEAD 只能靠时间：`created_at >= PRE`（PRE 是 push 之前记的时刻）。四个端点**都查**再下"无建议"的结论——#80 时只查了两个就误报"没审过"。
- **已合并的 PR 用 `@codex review` 补审时，摘要里的 `Reviewed commit` 是 merge commit**（2026-09-06 实测 #80）：不是分支 HEAD，也不是最后一个功能提交。核对时拿 `gh pr view <N> --json mergeCommit --jq .mergeCommit.oid` 比。

```sh
set -e                                               # push 失败就停，别带着旧 SHA 轮询到天荒地老
BOT='chatgpt-codex-connector[bot]'; HEAD=$(git rev-parse HEAD)
PRE=$(date -u +%Y-%m-%dT%H:%M:%SZ); git push         # 动作之前记 UTC 时刻（新开 PR 放在 gh pr create 前）
until [ "$(gh pr view <N> --json headRefOid --jq .headRefOid)" = "$HEAD" ]; do sleep 5; done
# 反应：本轮只可能有一个（eyes 审查中 / +1 审完无建议）。不要经由 ROUND 二次过滤，见上一节
gh api --paginate "repos/{owner}/{repo}/issues/<N>/reactions" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$PRE\") | .content"
# 摘要评论：无建议那条路径上唯一带 commit 的凭据，核对 Reviewed commit 是不是 $HEAD
gh api --paginate "repos/{owner}/{repo}/issues/<N>/comments" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$PRE\") | select(.body | test(\"Codex Review\")) | .body"
# review + 行内评论（有建议时才有；只认针对当前 HEAD 的）
gh api --paginate "repos/{owner}/{repo}/pulls/<N>/reviews"  --jq ".[] | select(.user.login == \"$BOT\") | select(.commit_id == \"$HEAD\") | .state"
gh api --paginate "repos/{owner}/{repo}/pulls/<N>/comments" --jq ".[] | select(.user.login == \"$BOT\") | select(.original_commit_id == \"$HEAD\") | \"\(.path):\(.line // .original_line) \(.body)\""
# 限额提示
gh api --paginate "repos/{owner}/{repo}/issues/<N>/comments" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$PRE\") | select(.body | test(\"usage limits\")) | .body"
```

| 信号（都按 `created_at >= PRE` 过滤） | 含义 |
|---|---|
| 👀 反应 | 本轮开始，正在审，继续等 |
| 👍 反应（👀 被换掉；多数时候还带一条 `Codex Review: Didn't find any major issues` 摘要评论，也可能只有 👍，见上） | 审完了，没有建议；有摘要就用 `Reviewed commit` 核对 HEAD，没有就按 PRE 时间归轮 |
| 针对当前 HEAD 的 review（`COMMENTED`）+ 行内评论 | 有建议 |
| "You have reached your Codex usage limits" | 这次没审 |

只有 👀 或什么都没有 = 还在审（或还没轮到），继续等；通常几分钟内出终态。push 新提交会重新开始一轮。
**等多久**：push 后 30 分钟连 👀 都没有，视为 Codex 这轮没接（实测 #29 审了五轮后第六轮再没来），把这一点告诉用户、由用户决定是否合并，不要无限等。

## 处理评论的规矩

- **逐条核实，不照单全收**：用 fixture、实测数据或读代码确认，再决定采纳。历史命中率约 30–50%，
  但命中的往往是真回归（例如 #26 上它抓到了我删锚定包装时引入的 `return` 提前退出）。
- 它审的是**提 PR 时那个提交**：重构过的部分常已过时，先对照当前分支再判断。
- 采纳的改动 push 后它会再审一轮，回到上面的等待。
- 没采纳的，在 PR 里写一句为什么（数据或理由），别静默忽略。

## 一次完整流程

```
gh pr create …                     # 或 git push 到已有 PR
# 等 CI + Codex 针对当前 HEAD 的终态信号（查询见上）
gh pr checks <N>
# 有评论 → 逐条核实 → 修 → push → 回到等待（HEAD 变了，旧信号作废）
# 👍 或核实处理完 + CI 绿 → 请用户确认 → gh pr merge <N> --merge --delete-branch
```

合并方式固定为 merge（不 squash），每次合并前问一句用户。

## 叠着的 PR（B 以 A 的分支为 base）

**先改下游的 base，再合并上游并删分支**（2026-09-07 实测 #87 / #88 踩到）：`gh pr merge A --delete-branch` 删掉 A 的分支时，
GitHub 会把以它为 base 的 B **直接关掉**，不会转到 main；关掉的 PR 改不了 base（`Cannot change the base branch of a closed pull request`），
得把分支临时推回去（`git push origin <sha>:refs/heads/<branch>`）、`gh pr reopen B`、`gh pr edit B --base main`、再删分支。正确顺序：

```
gh pr edit B --base main            # 先把下游转到 main（此时 diff 会暂时包含 A 的改动，合掉 A 就恢复）
gh pr merge A --merge --delete-branch
# B 的 CI 会按新 base 重跑；绿了再合 B，同样先把 C 的 base 改到 main
```

上游 PR 每轮修复要 `git merge` 进下游分支再 push（下游 HEAD 变了，Codex 会重新审一轮；它审的是下游对 base 的 diff，上游的改动不重复审）。
限额（`You have reached your Codex usage limits`）恢复后在 PR 上评论 `@codex review` 补审最后一轮。
