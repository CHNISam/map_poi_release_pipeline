# RUNBOOK — 今日 DEV Release 执行手册

> 前置: `docs/HARNESS_ENGINEERING.md` 已批准

## 一次性准备

```bash
cd D:\work\map\tools\poi-release-pipeline
npm install
npm run sync:contract   # 校验 category enum 与 map-miniprogram 一致
node scripts/release.js check-env
```

预期: `guard.pass === true`, `envId=dev-5gzz7rxdbcf5d7dc`.

## 步骤 1: REVIEW (dry-run)

```bash
node scripts/release.js review \
  --source "D:\work\map\source code\map-miniprogram\backend\data\poi-data\深圳数据.csv" \
  --source "D:\work\map\source code\map-miniprogram\backend\data\poi-data\佛山数据.csv" \
  --env dev --out releases/2026-09-11-dev-001
```

产物: `releases/2026-09-11-dev-001/{canonical,validation,quality,diff,plan.md}`
人工: 打开 `plan.md` 检查 WARNING (90+19 区域外, 17 重复组, 1 missing)。

## 步骤 2: GATE

```bash
node scripts/release.js gate --release releases/2026-09-11-dev-001
# 若 WARNING 为预期区域外: 加 --allow-out-of-core
node scripts/release.js gate --release releases/2026-09-11-dev-001 --allow-out-of-core
```

要求: `gate.json.pass===true` 否则禁止下一步。

## 步骤 3: APPLY

```bash
node scripts/release.js apply --release releases/2026-09-11-dev-001 --env dev
```

内部: `knex.transaction` 批 500 `ON DUPLICATE KEY UPDATE`. 任何 `env!=dev` 机械 `exit 1`.

## 步骤 4: VERIFY

```bash
node scripts/release.js verify --release releases/2026-09-11-dev-001 --env dev
cat releases/2026-09-11-dev-001/post-verify.json
```

要求: `verified===true` 才 `VERIFIED`.

## 步骤 5: IDEMPOTENCY

重跑 review → diff 必须 `INSERT 0 UPDATE 0 UNCHANGED N`.

## 禁止

- `--env prod` 任何变体 → gate 立即 `BLOCK`.
- agent 自行判断“问题不大” → 代码机械 `exit 1` 已阻断.

## 证据交付

`releases/2026-09-11-dev-001/report.md` 汇总所有产出，可直接提交老板.
