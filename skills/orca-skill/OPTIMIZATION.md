# orca-skill 两层编排上下文成本优化方案

> 版本 v1.0｜2026-08-26｜数据源：youpai_usage_logs_v1.2.xlsx（2026-08-22 ~ 08-25，4115 条）
> 范围：仅优化 skill 第二层（controller/worker 编排）；第一层（开卡到 `CARD_STARTED` 即停）不动。

## 1. 问题结论

**controller 与 worker 都存在巨量重复灌入，但根源不是脚本"发送了什么"，而是 CLI agent 固有的"全量历史重发"被单会话长流程编排放大。**

### 1.1 数据总览（按角色，4 天）

| 角色 | 模型 | 调用 | 单次≥100k | 累计输入 tok | 费¥ | 输入占比 |
|---|---|---|---|---|---|---|
| controller(complex) | deepseek-v4-pro | 793 | 434 | **1.89 亿** | 19.23 | 43.7% |
| worker(codex) | gpt-5.6-sol | 877 | 361 | 1.37 亿 | 23.64 | 31.7% |
| worker(claude) | claude-sonnet-5 | 957 | 4* | 5158 万 | 9.74 | 11.9% |
| worker(grok,已弃用) | grok-4.6 | 546 | 125 | 3726 万 | 15.24 | 8.6% |
| worker(kimi) | kimi-k2.7-code | 66 | 43 | 1246 万 | 7.58 | 2.9% |
| controller(simple) | deepseek-v4-flash | 75 | 0 | 527 万 | 0.71 | 1.2% |

*claude 日志口径 prompt_tokens 只计未命中部分，实际重发量在 cache 字段，成本已被缓存摊薄。

### 1.2 关键量化特征

- **单调爬升**：controller 峰值会话 143 调/65 分钟，prompt 轨迹 `212k→283k`，91% 单调递增；kimi 会话 98% 单调增——纯工具调用轮也全量重发历史
- **巨量调用 967 条，completion 中位数仅 297**：灌十几万 token 只为回一个工具调用决策
- **缓存是唯一救星**：deepseek 按量命中 47.7%、gpt 41.5%、kimi 48.8%；**grok 0%**（已从 tiers.json 移除，正确）
- **auto compaction 自救后被快速灌回**：controller 轨迹 `283k→24k→39k→42k`，回落即失忆重建

## 2. 根因链（6 条，按放大倍数排序）

| # | 根因 | 位置 |
|---|---|---|
| R1 | controller 单会话跑完全流程，第 4 步大输出（issue 全文、锚点 PRD、pytest 全输出、全量 diff 对账、红线十条）全部滞留上下文 | 模板第 4 步 |
| R2 | review 每轮重复 `gh issue view` 拉全文 + 重读锚点文档（每次 ~15-20k） | 模板 4.1 |
| R3 | auto compaction 失忆 → controller 重读重建（+40k），且首个请求全量 cache miss 毁掉缓存前缀 → 恶性循环 | CLI 行为 × 模板 |
| R4 | DEV_FAKE → `--force` 重建 worker → 新 worker 从零重新探索代码库 | 异常处置路径 |
| R5 | 轮询模式双重成本：① `nudge_commit` 每岳60s注入一条；② 更大的头——controller 等待期被高频唤醒（峰值 2.2 调/分钟 ≈ 2400 万 tok/卡），每次唤醒全量重发 | poll-dev-local.sh 主循环 × CLI 等待机制 |
| R0 | 底层事实：CLI agent 每次请求重发全部历史（无法关闭，只能控制会话长度与输出体积） | 外部依赖 |

## 3. 设计原则

3. **状态外置为唯一事实源**：git 分支 + 开发日志锚点（已有）+ `/tmp/{{CARD}}/` 状态目录（新增，目录名即 worktree 名——start-card.sh 以 card 名建 worktree，二者恒等，无需新增模板变量）+ handle 文件（已有）。controller 会话变成无状态、可随时压缩/重建的执行器
2. **对话流只留结论行，大内容进文件**：对账表、红线结论、测试输出详情都落 `/tmp`，对话里只留"通过/未通过 + 一句话"
3. **不依赖 compaction 做正确性**：compaction 何时触发、压成什么样都不可控；方案只需保证"压完之后靠文件满血复活"。输出越瘦 → compaction 越少 → 缓存前缀存活越久 → 直接省钱
4. **架构不变**：两层设计保持；任何时刻每 worktree 只有一个 controller 会话（Phase 3 的轮间接力是"换人"不是"加人"）
5. **最小变更、分阶段验证**：先模板，再脚本，最后才动会话生命周期

## 4. 分阶段实施

### Phase 1：模板改造（只改 `templates/controller-prompt.tpl.md`）

**1a. 新增第 0 步——恢复例程**（compaction/任何失忆的逃生门）：

```
【第 0 步 状态检查（任何动作前先执行）】
  mkdir -p /tmp/{{CARD}}
  cat /tmp/{{CARD}}/card-state.md 2>/dev/null
  - 有「当前步骤」→ 从该步骤继续，禁止重做已完成步骤
  - 无 → 首次执行，从第 1 步开始
  worker handle 以 card-state.md 记录为准；失效时重跑 ensure-worker.sh 复查（其内部 handle 文件已迁入 /tmp/{{CARD}}/，旧卡自动回退 /tmp/orca-worker-{{CARD}}.handle）
```

**1b. 每步收尾落盘**（第 1~7 步末尾统一追加，目录已在第 0 步建好）：

```bash
cat > /tmp/{{CARD}}/card-state.md <<EOF
card={{CARD}} issue=#{{ISSUE}}
当前步骤=<N>
worker=<handle|-> baseline_ahead=<n> round=<n>
PR=<号|无>
EOF
```

**1c. 对账基准一次性外置**：第 4 步首次执行时，把 issue 验收项 + 红线十条提取为清单 `/tmp/{{CARD}}/acceptance.md`；**第 5 步起只 cat 该清单，禁止重新 `gh issue view` 拉全文**

**1d. 大输出瘦身**：
- **当前策略：本地三闸从 controller/worker 流程移除**；代码质量由 draft PR 触发的 GitHub PR CI 统一检测。`run-checks.sh` 仅保留为可选手动工具，不再作为流程硬闸。
- 对账表、红线逐条结论写入 `/tmp/{{CARD}}/review-r<N>.md`，对话内只输出一行总结论（例：「对账 12/14 通过，缺 2 项，意见已写文件」）
- diff 先 `--stat`，再按验收项定点 `git diff origin/main...HEAD -- <file>`，禁止整段读全量 diff

### Phase 2'：等待机制事件化（取代原 Phase 2a，收益最大项）

**问题重算**：轮询模式的成本不只 nudge——controller 峰值会话 143 调/65 分钟 ≈ 2.2 调/分钟，与 60s 轮询周期强吻合。等待期 ~100 调 × 全量历史 240k ≈ **2400 万 token/卡**，占该会话累计输入四成以上。等待机制本身（而非 nudge）才是 poll 模式的核心成本。

**核心认知**：CLI agent 没有定时器，但**终端 idle = 零 API 调用**，被注入消息 = 唤醒一次。故改为事件驱动：controller 派发完就结束回合"下班"，被消息叫醒后再继续。

**① 通知（worker→controller，快路径，秒级）**：`send-dev-task.sh` / `send-review.sh` 话术末尾追加硬要求：

```bash
# push 成功后必须执行（controller.handle 由 start-card.sh 写入）：
orca terminal send --terminal "$(cat /tmp/{{CARD}}/controller.handle)" \
  --text "DEV_SIGNAL {{CARD}} round=N head=$(git rev-parse --short HEAD)" --enter
```

**② 看门狗（bash 后台进程，零 LLM 成本，慢路径 + 兜底）**：新增 `scripts/wait-dev-watchdog.sh`，由 send 脚本顺手 `nohup` 启动（不占 controller 回合）：
- 每 5 分钟检查：`ahead > baseline` → 代发 DEV_SIGNAL（防 worker 忘发）→ 退出
- worker handle 消失 → 发 WORKER_DEAD → 退出；超时 → 发 TIMEOUT → 退出
- nudge 职责收编：窗口期最多 2 次、间隔 ≥15 分钟
- 代发 5 分钟后 `orca terminal read --screen` 校验 controller 真醒了，没醒重发一次，仍失败放弃（防注入风暴）
- `MAX_WAIT` 自杀 + PID 文件（`/tmp/{{CARD}}/watchdog.pid`），收尾 `rm -rf /tmp/{{CARD}}` 时 kill

**③ 验证（controller 醒后，硬判据不变）**：**通知只是门铃，不是完成证明**——被 DEV_SIGNAL 唤醒后第一件事：
```bash
bash poll-dev-local.sh --worker <handle> --issue N --card C [--round N] <baseline> --once
```
`--once` 模式现成（ahead + real_changes 双判据 → DEV_DONE / DEV_FAKE），主循环职责移交看门狗。DEV_FAKE → 异常处置照旧（不信 worker 自报是本 skill 立身之本）。

**配套改动**：
- `start-card.sh`：写入 `/tmp/{{CARD}}/controller.handle`
- 模板第 3/5 步："阻塞等待"改为"派发后结束回合，被 DEV_SIGNAL 唤醒后先跑 `--once` 验证"；红线同步改
- `poll-dev-local.sh`：主循环保留（向后兼容），推荐用法变 `--once`

**预期**：controller 单卡会话从 ~143 调降到 ~15-25 调（纯编排决策），累计输入 5758 万 → 1000 万以内，比 Phase 1 收益还大一个量级，两者正交可叠加。

**被排除的变体**：git `post-commit` hook 代发通知（硬信号不依赖 worker 自觉），但 orca worktree 共享主 repo hooks，per-worktree 需 `extensions.worktreeConfig`，且影响所有卡的 commit 路径，复杂度不划算。双通道已把忘发概率压到可接受。

### Phase 2b：worker handle 迁入状态目录（随 Phase 2' 同批实施，一致性配套）

**`scripts/ensure-worker.sh`**：handle/seq 文件迁入 `/tmp/{{CARD}}/worker.handle`、`/tmp/{{CARD}}/worker.seq`；读取时兼容旧路径 `/tmp/orca-worker-<card>.handle` 回退（在跑的卡不中断）。

**定位说明**：此项无 token 收益，不属性能优化，不适用"视数据决定"。它是 Phase 2' 目录约定的配套：① 不迁移则收尾 `rm -rf /tmp/{{CARD}}/` 清不掉旧路径 handle/seq，残留；② 状态分裂两处，排查需看两个位置。改动仅两行路径 + 回退读，随 2' 一起上。

### Phase 3：轮间接力（条件触发，新增 `scripts/handover-controller.sh`）

**不是 controller 再起 controller 常驻，而是每轮 review 换一个新 controller 会话接班**：

1. 第 5 步 round≥2 前，controller 调 `handover-controller.sh --card <c> --issue <n>`
2. 脚本在同一 worktree `orca terminal create`（命令从 tiers.json 取），注入短恢复指令（内容即第 0 步 + `/tmp/{{CARD}}/` 状态目录）
3. 屏幕校验通过（复用 start-card 的 4 次重试逻辑）后才 close 老终端；校验失败不关老终端、汇报人工
4. 新会话按状态文件从第 5 步继续；状态本就全外置，天然幂等

**启用条件**：Phase 1+2'+2b 上线后跑 2 张 complex 卡，controller 单会话峰值仍 >120k 才上（唯一"视数据"的阶段）。

## 5. 明确排除项

| 排除 | 原因 |
|---|---|
| controller 自触发 `/compact` | TUI 用户侧命令，agent 无法对自己发起（不是工具调用） |
| controller 常驻派生子 controller | 违反单会话原则，注入面翻倍，无收益 |
| 换 grok | 已弃用 ✓（0% 缓存，长会话模式最亏） |
| worker 侧大改 | worker 成本大头是读代码库的固有开销，review 轮已只收增量意见文件；DEV_FAKE 防护已有 |

## 6. 验证方案

开 2 张同档 complex 卡（优化前/后各一），对比 youpai 后台同窗口 usage log：

| 指标 | 基线 | 目标 |
|---|---|---|
| A. controller 单次调用 prompt p95 | ~283k | ≤100k |
| B. controller 峰值会话累计输入 | 5758 万 | 降 50%+ |
| C. deepseek-v4-pro 缓存命中率 | 47.7% | ≥65% |
| D. 巨量调用占比（967/3314） | 29% | 显著下降 |
| E. 功能不回退 | — | 仍走到 PR CI 绿；review 轮数不增；DEV_FAKE 仍可拦截 |

## 7. 风险与兜底

| 风险 | 兜底 |
|---|---|
| /tmp 状态文件丢失（重启） | 从 git log + 开发日志锚点 + handle 文件残留可重建；handle 文件本就在 /tmp，一致性不变 |
| worker 忘发通知（弱模型幻觉） | 看门狗 ahead 检测代发，慢 ≤5 分钟，不丢事件 |
| 注入假阳性（send 成功但没渲染） | 短消息假阳性率远低于长模板；看门狗屏幕校验 + 一次重发；仍失败放弃等超时 |
| controller.handle 文件丢失 | start-card.sh 写入（它已有 CTRL_HANDLE）；标题反查不可靠（CLI 会覆盖标题），以文件为准 |
| 看门狗泄漏 | MAX_WAIT 自杀 + PID 文件 + 收尾 kill |
| 目录未建（新会话/异常路径） | 第 0 步先 `mkdir -p /tmp/{{CARD}}`，写入永在 mkdir 之后 |
| 旧路径兼容（Phase 2b 迁移期） | handle 读取先查新路径再回退旧路径；未迁移的在跑卡继续用旧路径跑完 |
| 卡片收尾残留 | 第 7 步合并确认后 `rm -rf /tmp/{{CARD}}/` 整目录清理（worker handle/seq 已随 2b 迁入，旧路径残留另行手动清） |
| tail 截断漏中间错误详情 | 判定看退出码；需定位时 controller 定点重看该文件，属可控权衡 |
| 模板加长 ~2-3k | 一次性首注入成本，可忽略 |
| Phase 3 注入脆弱（start-card 已有教训） | 屏幕校验 4 次重试 + 失败不关老终端 + 状态文件幂等 |
| 多卡并行 | 状态文件按 card 命名隔离，无冲突 |

## 8. 预期效果

| 场景 | 现状 | Phase 1+2 | +Phase 3 |
|---|---|---|---|
| compaction 后重建成本 | 40k+（重读 issue/PRD/重对账） | ~5k（cat 两个文件） | ~5k |
| controller 单会话峰值 | 212~283k | 80~120k | 每轮 ≤60k |
| 缓存前缀存活 | 频繁被 compaction 毁 | compaction 次数减少 | 会话短命天然稳定 |
