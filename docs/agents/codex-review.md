# Codex 自动审查：合并前必须等它说完

仓库开了 Codex 的 PR 自动审查（`chatgpt-codex-connector[bot]`）。它在 PR 开出或被 push 后开始审，
结束时留下三种信号之一，**看到信号之前不要合并**：

| 信号 | 含义 | 怎么查 |
|---|---|---|
| PR 上一个 👍 反应 | 审完了，没有建议 | `gh api repos/{owner}/{repo}/issues/<N>/reactions --jq '.[] \| select(.user.login \| test("codex")) \| .content'` 得到 `+1` |
| 一条 review（`COMMENTED`）+ 若干行内评论 | 有建议 | `gh api repos/{owner}/{repo}/pulls/<N>/comments --jq '.[] \| select(.user.login \| test("codex")) \| "\(.path):\(.line // .original_line) \(.body)"'` |
| 一条 issue comment "You have reached your Codex usage limits" | 这次没审 | `gh pr view <N> --json comments` |

三种都没有 = 还在审（或还没轮到），继续等；通常几分钟内出结果。

## 处理评论的规矩

- **逐条核实，不照单全收**：用 fixture、实测数据或读代码确认，再决定采纳。历史命中率约 30–50%，
  但命中的往往是真回归（例如 #26 上它抓到了我删锚定包装时引入的 `return` 提前退出）。
- 它审的是**提 PR 时那个提交**：重构过的部分常已过时，先对照当前分支再判断。
- 采纳的改动 push 后它会再审一轮，回到上面的等待。
- 没采纳的，在 PR 里写一句为什么（数据或理由），别静默忽略。

## 一次完整流程

```
gh pr create …                     # 或 git push 到已有 PR
# 等 CI + Codex 三种信号之一
gh pr checks <N>
gh api repos/{owner}/{repo}/issues/<N>/reactions …     # 👍 ？
gh api repos/{owner}/{repo}/pulls/<N>/comments …       # 行内评论？
# 有评论 → 逐条核实 → 修 → push → 回到等待
# 👍 或核实处理完 + CI 绿 → 请用户确认 → gh pr merge <N> --merge --delete-branch
```

合并方式固定为 merge（不 squash），每次合并前问一句用户。
