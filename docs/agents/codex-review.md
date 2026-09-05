# Codex 自动审查：合并前必须等它说完

仓库开了 Codex 的 PR 自动审查（`chatgpt-codex-connector[bot]`）。它在 PR 开出或被 push 后开始审：
先在 PR 上打一个 👀 反应（`eyes`）表示**审查中**，结束时留下三种终态信号之一。**看到终态信号之前不要合并**：

三条查询规矩（Codex 在 #29 上指出的三个漏洞）：

- **只认这一个账号**：`.user.login == "chatgpt-codex-connector[bot]"`，不要用 `test("codex")` 之类的子串匹配——公开仓库里任何 login 含 "codex" 的账号点个 👍 就能让 PR 看起来审完了。
- **只认针对当前 HEAD 的信号**：行内评论与 review 都带 `commit_id`，只取等于 `git rev-parse HEAD` 的。反应和限额提示没有 commit 字段，要靠**本轮标记**：Codex 开始新一轮时会打一个 👀（并清掉上一轮的反应）。在 push（或 `gh pr create`）**之前**用 `date -u` 记下 UTC 时间 `PRE`（和 GitHub 的 `created_at` 同时区；不能用提交时间 `%cI`），`created_at >= PRE` 的 👀 就是本轮标记；**只有该 👀 之后（含同一秒）出现的 👍 / 限额提示**才算这一轮的。用 push 前的时刻而不是"客户端看到新 HEAD 的时刻"：Codex 可能在我们轮询到新 HEAD 之前就已打上 👀，用后者会把唯一的标记丢掉。上一轮在 push 期间刚好收尾留下的 👍 早于新的 👀，被排除。上一轮的旧评论会一直留在接口里，不过滤的话新提交一 push 就"审完了"。
- **翻页**：两个列表接口都加 `--paginate`，否则超过一页的反应 / 评论只看得到第一页。

```sh
set -e                                               # push 失败就停，别带着旧 SHA 轮询到天荒地老
BOT='chatgpt-codex-connector[bot]'; HEAD=$(git rev-parse HEAD)
PRE=$(date -u +%Y-%m-%dT%H:%M:%SZ); git push         # push 前记 UTC 时刻（新开 PR 则放在 gh pr create 前）
until [ "$(gh pr view <N> --json headRefOid --jq .headRefOid)" = "$HEAD" ]; do sleep 5; done
# 本轮标记：PRE 之后的 👀；之后的 +1 才是本轮的"审完无建议"
ROUND=$(gh api --paginate "repos/{owner}/{repo}/issues/<N>/reactions" \
  --jq "[.[] | select(.user.login == \"$BOT\") | select(.content == \"eyes\") | select(.created_at >= \"$PRE\") | .created_at] | max // empty")
# 与标记同一秒的也算（created_at 只到秒；标记本身是 eyes，不会被 +1 的谓词误计）
[ -n "$ROUND" ] && gh api --paginate "repos/{owner}/{repo}/issues/<N>/reactions" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.content == \"+1\") | select(.created_at >= \"$ROUND\") | .content"
# review + 行内评论（只认针对当前 HEAD 的）
gh api --paginate "repos/{owner}/{repo}/pulls/<N>/reviews"  --jq ".[] | select(.user.login == \"$BOT\") | select(.commit_id == \"$HEAD\") | .state"
gh api --paginate "repos/{owner}/{repo}/pulls/<N>/comments" --jq ".[] | select(.user.login == \"$BOT\") | select(.commit_id == \"$HEAD\") | \"\(.path):\(.line // .original_line) \(.body)\""
# 限额提示（同样只认本轮 👀 之后的）
[ -n "$ROUND" ] && gh api --paginate "repos/{owner}/{repo}/issues/<N>/comments" \
  --jq ".[] | select(.user.login == \"$BOT\") | select(.created_at >= \"$ROUND\") | select(.body | test(\"usage limits\")) | .body"
```

| 信号 | 含义 |
|---|---|
| push 之后的 👀 反应 | 本轮开始，正在审，继续等 |
| 本轮 👀 之后的 👍 反应 | 审完了，没有建议 |
| 针对当前 HEAD 的 review（`COMMENTED`）+ 行内评论 | 有建议 |
| 本轮 👀 之后的 "You have reached your Codex usage limits" | 这次没审 |

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
