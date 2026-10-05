# POI Data Release Harness

> 所有 POI 数据进入地图系统之前的统一 release boundary。
> 独立仓库 `poi-release-pipeline`，只读依赖 `map-miniprogram`。

## 架构一瞥

```
Raw Dataset → Canonical → Contract/Schema Validation → Quality Checks
→ Release Candidate (staging file) → Data Diff → Blocking Gate
→ DEV Apply → DEV Read-back → Post-release Validation → Release Evidence
```

详见 `docs/HARNESS_ENGINEERING.md`。

## 今日目标（真实数据闭环）

```
真实 POI 数据 (母婴室 / 无障碍卫生间 / 地铁相关)
 → 自动审核 → DEV Release Plan → DEV Apply → DEV Read-back Verify
```

今日不发布 PROD，Gate 机械阻断 `prod-6gv6kwxe65437245`。

## 快速开始（实现后）

```bash
npm install
# 检环境
node scripts/release.js --check-env
# 审核 + 生成 plan（不写库）
node scripts/release.js review \
  --source "../map-miniprogram/backend/data/poi-data/深圳数据.csv" \
  --source "../map-miniprogram/backend/data/poi-data/佛山数据.csv" \
  --env dev --out releases/2026-09-11-dev-001
# 门控
node scripts/release.js gate --release releases/2026-09-11-dev-001
# 发布
node scripts/release.js apply --release releases/2026-09-11-dev-001 --env dev
# 回读验证
node scripts/release.js verify --release releases/2026-09-11-dev-001 --env dev
# 查看证据
cat releases/2026-09-11-dev-001/report.md
```

## 设计原则

- **先借成熟，再做最小**: 对每个自研机制，先查 Frictionless/Soda/GX/Dagster/data-diff 是否已有对应模式，能复用则复用。
- **机械 Gate**: `BLOCK` 由代码执行，agent 不得自行判断“问题不大”。
- **幂等 + 可重跑**: 同一 source 重跑 → `INSERT 0 UPDATE 0 UNCHANGED N`。
- **Read-back 为准**: `affectedRows` 不等于发布成功，以 `SELECT` 回读为 `VERIFIED`。

## 依赖决策（最小）

| 依赖 | 用途 | 状态 |
|------|------|------|
| zod | contract 校验 | 新增 |
| csv-parse | CSV 解析 | 新增 |
| commander | CLI | 新增 |
| knex/mysql2 | DEV 直连（复用云函数已有） | 复用 |
| Frictionless/Soda/GX/Dagster/data-diff | 仅借 invariant，不引入 | Adapt |

## 与 map-miniprogram 的边界

- 默认 **READ ONLY**，仅通过 `scripts/sync-contract.js` 从 `common/poiCapabilities.js` 与 `scripts/env-config.json` 同步真相。
- 不复制 POI schema，不复制凭据。

## 目录

```
contracts/   # poi.schema.json (Table Schema)
src/         # canonical/validators/diff/environments/release/verify/rollback
tests/       # fixtures + validation
releases/    # 每个 release 的 evidence（可审计）
config/      # 只读同步的环境/能力配置
docs/
  HARNESS_ENGINEERING.md  # 本次 Harness Engineering 完整证据与架构
```

## Harness Engineering 证据

- 成熟方案对比: `docs/HARNESS_ENGINEERING.md §2`
- 仓库审计: `§1.2`
- Invariant 16 条: `§4`
- Failure-matrix 17 类: `§5`
- 架构: `§6`
- 今日 DEV 路径: `§15`

下一阶段: 按 `§14 Implementation Plan` 逐阶段实现。
