# RxnMiner Pi Agent + Skills + Harbor 交接说明

这份说明给接手者，目标是让别人知道最新RxnMiner在哪里、怎样跑一张图、怎样用旧轨迹和GT做post-hoc比较，以及哪些结果不能被误读。

## 1. 当前组件边界

### RxnMiner仓库

- GitHub：`git@github.com:bbkevin1016/RxnMiner.git`
- 当前服务器clone：`/uniparser2/users/hujinbo/project/benchmark/jinbo/code/RxnMiner-push-20260910`
- 当前基线：`main`，已验证清理提交`18a1fb4`
- 回退tag：`snapshot-20260910-pre-cleanup`，提交`ebac78b`
- 清理验证tag：`cleanup-validated-20260910`

RxnMiner是完整的Pi agent，而不是只有Skill文件。它包含：

```text
skills/                 SKILL.md、LESSONS.md、reaction-verify
pi-extension/index.ts   原生Pi工具、Skill读取门、结果图片附件
 tools/                 chem_mcp.py、OCSR、render和skill lint
engine/                 V2组装器、Markush和反应物推导
prompts/                task instruction、execution contract、闭卷提示
runtime/                Node 22.19.0、Pi 0.82.1、model profiles
bin/rxnminer             check、prompt、extract单图运行器
docker/                  参考镜像build/run
third_party/             R-group和渲染依赖，受许可约束
```

### ChemRxn_Benchmark仓库

Harbor、任务池、闭卷代理、sidecar生命周期、GT verifier、严格scorer和leaderboard仍属于：

```text
$J=/uniparser2/users/hujinbo/project/benchmark/jinbo
$J/code/worktrees/pi-skills-lane
```

其关键文件是`agents/pi_agent.py`、`agents/reliable_cli.py`、`scripts/run_lane.sh`、`scripts/run_matrix.py`。RxnMiner的`docker/run.sh`适合单图自包含运行；论文正式比较仍使用Benchmark仓库的Harbor lane。

## 2. 一张图的正确流程

```text
figure.png
  -> 读取SKILL.md和LESSONS.md
  -> detect / MolParser
  -> 打开overview、grid和每一个concrete audit crop
  -> generic template核对
  -> reverse_assemble或机制推导
  -> verify_smiles
  -> plan.json
  -> assemble
  -> render_reactions，检查PNG和HTML
  -> answer.json
```

Pi是唯一的化学决策者。MolParser、FHR和RDKit是确定性工具，只负责读取、验证、存储或组装，不能被当作隐藏模型。

Skill规则尤其要注意：

- 图像是结构和手性的最终来源，OCSR只是默认骨架读取；
- 图上没有楔键/虚线或R/S/E/Z时，不继承OCSR的`@`、`@@`、`/`、`\\`；
- `C=C`、`C=N`、`S=N`、`N=N`、`P=N`等潜在立体双键都要单独处理；
- reverse_assemble前核对通用模板的手性、双键位置和取代度；
- 任务明确把箭头上下材料放入`conditions`时保留原文，不把它移到`reactants`；只有图片明确画出结构或明确代号映射到画出的结构时才加condition SMILES；
- 普通文本条件不推断SMILES，不唯一的结构fail closed；
- 任何历史轨迹、GT和旧answer都不能在agent运行时挂载。

## 3. 从Git clone运行

```bash
git clone git@github.com:bbkevin1016/RxnMiner.git
cd RxnMiner
bash runtime/install.sh
python3 bin/rxnminer check
bash docker/build.sh
```

凭证只从调用shell的环境变量取得，不写入镜像和仓库：

```bash
export ANTHROPIC_BASE_URL=https://<anthropic-messages-endpoint>
export ANTHROPIC_API_KEY=<key>
export MOLPARSER_URL=http://<molparser-host>/extract-mol
```

BLSC长请求的三层超时要同时配置：

```bash
export PI_MODEL_FORWARDER_IDLE_TIMEOUT=300   # 300 s 空闲切断已证明不是挂起原因,是保险
export PI_HTTP_IDLE_TIMEOUT_MS=300000     # pi 默认值;这是唯一的客户端卡死保险,不要拉到小时级
export PI_RETRY_MAX_RETRIES=3               # pi 0.82.1 只认 retry.maxRetries / baseDelayMs / provider.maxRetryDelayMs,没有 timeoutMs
```

然后：

```bash
bash docker/run.sh /path/to/figure.png out/case --timeout 3600
```

输出目录应包含：

```text
answer.json       最终assembled V2
plan.json         模型中间计划
review.html       详细HTML review
review.png        assembled candidate PNG
prompt.txt        模型实际收到的prompt
pi.log            Pi日志
run.json          provider、model、耗时、hash、tool调用统计
pi-agent-dir/     原始Pi session JSONL
```

`--closed-book HOSTS`只会追加提示词中的网络政策。真正的闭卷代理和allow-list隔离由Benchmark Harbor提供；不要把单机`docker/run.sh`的网络状态误称为Harbor闭卷。

## 4. 模型档案

`runtime/models.example.json`有两个profile：

- `anthropic`：默认`Claude-Opus-5`，Anthropic Messages API，`forceAdaptiveThinking=false`；
- `openai-compat`：默认`gpt-5.6-sol`，OpenAI Chat Completions兼容接口，`contextWindow=1000000`，`maxTokens=32000`。

`contextWindow`是Pi客户端发送和截断用的模型元数据，不会扩大服务端实际能力。服务端不支持1M时，不能靠配置伪造容量。

BLSC的`forceAdaptiveThinking=true`历史上曾把请求路由到不返回thinking/cache的后端，导致模型不读Skill而循环bash。RxnMiner profile已经固定为false。即使如此，BLSC还可能对大图请求长时间不吐SSE内容；三层timeout和真实的provider响应日志要分开记录。

正常Anthropic流应是：

```text
message_start
-> content_block_start/delta
-> message_delta(stop_reason)
-> message_stop
```

`stream ended before message_stop`不是max-token证明；它表示Pi没有收到最终结束事件。`usage=0`且`stopReason=error/Request timed out`表示该请求没有产生可用模型内容。

## 5. Harbor正式跑法

正式论文lane使用Benchmark worktree，不直接把GT带进RxnMiner：

```bash
cd $J/code/worktrees/pi-skills-lane
export TASKS_DIR=$J/data/tasks-final86-pr19
export RUNS_DIR=$J/work/experiments/<run-name>/runs
export FIG=chem-gt3__106
export LANE_AGENT=agents.pi_agent:PiAgent
export LANE_MODEL=Claude-Opus-5
export LANE_PROVIDER=blsc
export LANE_TOOL_PROFILE=molparser
export LANE_SKILLS=reaction-extract
export LANE_NETWORK=model-only
export CHEMRXN_RELEASE_VERSION=0.1.1
export CHEMRXN_TOOL_PI_IMAGE=chemrxn-agent-cli:pi-0.1.6-molparser
export CHEMRXN_PROXY_IMAGE=chemrxn-agent-base:0.1.1-molparser
export CHEMRXN_CLI_TIMEOUT_SECONDS=3600
export PI_MODEL_FORWARDER_IDLE_TIMEOUT=300   # 300 s 空闲切断已证明不是挂起原因,是保险
export PI_HTTP_IDLE_TIMEOUT_MS=300000     # pi 默认值;这是唯一的客户端卡死保险,不要拉到小时级
export PI_RETRY_MAX_RETRIES=3               # pi 0.82.1 只认 retry.maxRetries / baseDelayMs / provider.maxRetryDelayMs,没有 timeoutMs

bash scripts/run_lane.sh
```

批量入口是`scripts/run_matrix.py`，默认dry-run；付费运行必须明确使用`--execute`、`CONFIRM_PAID_RUN=YES`、`--costs-json`和`--max-cost-usd`。长任务放服务器tmux。跑前检查没有别人的`chemrxn-pi-*`容器，也不要按前缀强删共享daemon上的容器。

## 6. 旧轨迹和GT如何使用

### 只读来源

```text
$J/work/analysis/runs/                         16 lane x 86图的持久轨迹
$J/work/analysis/README.md                     旧跑批口径和目录地图
$J/work/analysis/leaderboard.md                正确打分器重打榜
$J/data/collab-copies-20260909/               协作者硬副本，禁止改源数据
$J/data/tasks-final86-pr19/<task>/tests/gt.json 冻结GT，只供verifier/post-hoc scorer
```

配GT时必须读取`result.json["task_name"]`，不能按Harbor目录前缀猜任务。不要相信旧`reward.json`，要用同一个严格scorer重打。

### post-hoc评分

```bash
export J=/uniparser2/users/hujinbo/project/benchmark/jinbo
cd "$J/code/worktrees/pi-skills-lane"
PY=/uniparser2/users/hujinbo/project/chemreaction-dev/.venv_frameworks/bin/python
$PY - <<'PY'
import json, os, sys
from pathlib import Path
sys.path.insert(0, "framework")
import score_reaction_strict as SS
trial = Path("<trial-dir>")
result = json.loads((trial / "result.json").read_text())
task = "chem-" + result["task_name"].split("/")[-1]
pred = json.loads((trial / "artifacts" / "answer.json").read_text())
gt = json.loads((Path(os.environ["J"]) / "data/tasks-final86-pr19" / task / "tests/gt.json").read_text())
r = SS.score_both(pred, gt)
print(r["reward_strict"], r["reward_ns_diag"], r["product_recall"], r["reaction_accuracy"])
PY
```

这是GT-blind原则：

1. 先保存原始answer和session；
2. 再由verifier读取GT；
3. 严格iso、nostereo、product recall、reaction accuracy分别记录；
4. 人工修订写sidecar，不覆盖原始agent答案；
5. 任何分数和GT差异都不能回灌下一次agent prompt。

## 7. 当前已知实证

- RxnMiner清理前后clone验证通过：162_1为1.0；gt3__106连接性不计手性为1.0。
- gt3__106严格手性存在模型随机性：旧版多次运行中同一个手性中心可能写反；该case不能因为一次1.0就宣称手性问题已根治。
- 最新Benchmark clean canary已经验证Skill读取、全crop覆盖、逐分子verify、assemble、render PNG和文件hash审计。
- 当前真正难点不是case目录是否以hash命名，而是图片复杂度、模型把楔键翻译为`@/@@`的可靠性以及BLSC provider稳定性。

## 8. 修改位置速查

|目标|修改位置|验证|
|-|-|-|
|通用化学规则|`skills/reaction-extract/LESSONS.md`|skill lint + canary|
|读图工作流|`skills/reaction-extract/SKILL.md`|skill lint + canary|
|执行契约|`prompts/execution_contract.txt`|prompt hash + canary|
|工具结果、crop、render|`tools/chem_mcp.py`|offline MCP smoke|
|Pi工具门和image block|`pi-extension/index.ts`|Pi启动 + canary|
|V2/Markush|`engine/`|unit tests + canary|
|模型、context、timeout|`runtime/models.example.json`、`bin/rxnminer`|`bin/rxnminer check`|
|Harbor适配|Benchmark的`agents/pi_agent.py`、`agents/reliable_cli.py`|Harbor canary|

改Skill后优先用`skills_source=mount`做零重建canary，定稿后再建不可变镜像。不要把GT或figure-specific结论写进Skill；Skill lint和post-hoc泄漏扫描必须同时通过。

## 9. 发布和回退

- 发布前确认`third_party`三个组件的再分发许可；当前仓库尚未选择通用LICENSE。
- 清理版回退到`ebac78b`或服务器archive tar，不删除历史目录。
- 每次发布记录Git commit、镜像digest、Pi版本、payload manifest、prompt hash和测试结果。
- benchmark正式集成前，对`origin/main`做完整三方diff，不能直接覆盖其Harbor/visualization改动。
