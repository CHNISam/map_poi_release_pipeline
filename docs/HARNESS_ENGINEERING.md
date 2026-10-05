# POI Data Release Harness — Engineering Design

> 状态: **Design Approved — ready for Implementation ticket**
> 目标仓库: `poi-release-pipeline`（独立仓库，服务 `map-miniprogram`）
> 服务环境: `dev-5gzz7rxdbcf5d7dc`（今日只允许 DEV），`prod-6gv6kwxe65437245` 机械阻断
> 真实数据集: `backend/data/poi-data/深圳数据.csv` (5104 rows), `佛山数据.csv` (2584 rows), `深圳公厕-原始数据.csv` (5104 raw, 用于溯源)

---

## 1. 证据索引 Evidence

### 1.1 成熟 Reference 实读证据

| Reference | 实读路径/URL | 关键发现 | 提炼的 Invariant |
|-----------|-------------|----------|------------------|
| **Frictionless Framework** (frictionless-py) | https://v4.framework.frictionlessdata.io/docs/guides/validation-guide, https://framework.frictionlessdata.io/docs/guides/validating-data.html, https://framework.frictionlessdata.io/docs/framework/schema.html | Table Schema 为核心；`validate()` + `checks` 列表 + `Validation Report` (`flatten([rowPosition, fieldPosition, code, note])`)；仅 `Baseline` 默认开启，其他 check 需显式注册；支持 `primary_key` / `foreign_key` / `missing_values` / `constraints` / `custom Check`（`yield errors.CellError.from_row(...)`）；`Resource → Package → Inquiry` 分层 | **Schema-first, Report-flat, Baseline+Custom**：显式 schema 声明 required/type/constraints/unique/pk，baseline 自动 + 业务 custom check 可插拔，report 以扁平行级错误为证据 |
| **Soda Core / Data Contracts** | https://github.com/sodadata/soda-core (2.4k stars), https://docs.soda.io/soda-documentation/soda-v3/data-contracts/data-contracts-verify, https://docs.soda.io/data-testing/git-managed-data-contracts/verify-a-contract | Data Contract 为 YAML 声明式；`soda contract verify --data-source ds.yml --contract contract.yml` 本地验证 / `--use-runner` 远程；CLI 返回 **PASS/FAIL**；50+ 内置 checks (`missing` / `duplicate` / `invalid` / `valid_values` / `schema`)；官方最佳实践：**先放 temporary/staging table 上 verify，再 promotion 到正式表**；contract 文件与产数仓库同 repo 便于版本演进 | **Staging-Verify-Promote**：新 batch 不直接进目标表，先在 staging 上完成 contract 验证，仅 PASS 才 append；contract 与数据同版本控制 |
| **Great Expectations (GX)** | https://github.com/great-expectations/great_expectations, https://docs.greatexpectations.io/docs/0.18/reference/learn/terms/checkpoint, `great_expectations/checkpoint/actions.py:1-1134`, `ExpectationSuiteValidationResult.get_max_severity_failure` | `Batch → ExpectationSuite → Validator → Checkpoint → ValidationResult → Action`；Checkpoint 是生产级抽象：**一次 run 绑定多个 Batch + 多个 Suite，产出 ValidationResults 并触发 Actions**；`CheckpointResult.success` 决定后续；`ValidationAction` 子类化实现自定义动作（通知/文档/阻断）；支持 `CRITICAL > WARNING > INFO` severity | **Batch-Checkpoint-Result-Action 边界**：Checkpoint 为可复用的生产检查点，验证后机械决定 Action（通过/阻断/通知），read-back 验证独立于 apply 信任 |
| **Dagster Asset Checks** | https://docs.dagster.io/api/dagster/asset-checks, `dagster/_core/definitions/asset_checks/asset_check_spec.py: AssetCheckSeverity`, https://github.com/dagster-io/dagster/discussions/16569 | `WARN = potential issue / ERROR = definite issue`，`severity` 不自动决定控制流；`blocking=True` 时 **ERROR 失败会机械阻断 downstream assets 的执行**，非 blocking 则仅告警；后续演进将 severity 从 definition 移至 `AssetCheckResult` 运行时决定，blocking 通过 `graph_asset` / `Op` 显式编排实现 | **Mechanical Blocking Gate**：检查结果以 severity 分级，仅 ERROR + blocking 的失败才阻断下游物化；控制流必须代码级机械执行，非人工判断 |
| **Datafold data-diff** | https://github.com/datafold/data-diff (2.9k stars, 2024-05-17 停止维护), https://github.com/datafold/data-diff/blob/master/docs/technical-explanation.md | 同库用 `OUTER JOIN` 高效 diff，跨库用 **divide-and-conquer + hashing**：按 `key-column` 分段 checksum，不等则二分细化直至定位差异行；支持 `key-column + update-column` 增量；同时支持行级 INSERT/DELETE/UPDATE 统计与物化到结果表；开源版为单机无状态，云版负责调度与历史 | **Join/Hash Diff on Stable Key**：基于 stable identity 的行级 diff，分 INSERT/UPDATE/DELETE/UNCHANGED；小数据量直接用内存 join 即可，无需复杂 bisection/hash，大数据再引入 hash 优化 |

### 1.2 当前仓库审计 Repository Audit

> 审计范围: `D:\work\map\source code\map-miniprogram` 全量读取（非猜测）

#### 语言/运行时

- `package.json:44` `engines.node >=14`, 前端微信小程序 + 云函数 `Nodejs16.13`, `knex + mysql2` 直连 `map` 库, `@cloudbase/node-sdk` 复用 `SYMBOL_CURRENT_ENV`。

#### POI Schema 真相

| 维度 | 事实 | 位置 |
|------|------|------|
| **Active 表** | `map_poi_poi` (非 legacy `map_poi`) | `cloudfunctions/map_poi/models/poi.js:3-20 poiSchema.tableName='map_poi_poi'`, `backend/data/sql/prod_new_schema.sql:152-174` |
| **Legacy 表** | `map_poi` (TCB LowCode `data-5pSkBk0XB`, `_id/type/location POINT SPATIAL KEY`) | `backend/data/database/map_poi.sql:1`, `map_poi.json:266 tableName map_poi` — 已不被新代码使用，仅历史留档 |
| **字段** | `_id varchar64 PK, category_id varchar64 NOT NULL, name varchar200 NOT NULL, address varchar500 NOT NULL, latitude decimal(10,7) NOT NULL, longitude decimal(10,7) NOT NULL, contact_name/phone, city varchar64, weight double, desc text(JSON), photo_cloud_ids json NOT NULL DEFAULT([]), is_offline/is_deleted tinyint1, created_at/updated_at bigint` | `prod_new_schema.sql:152-174` |
| **Tag 相关** | `map_poi_tag (_id tag_name type is_enabled)`, `map_poi_poi_tag_relation (_id poi_id tag_id UNIQUE(poi_id,tag_id))` | `prod_new_schema.sql:176-198`, `poi.js:22-41` |
| **Category 枚举** | `0 无障碍卫生间, 1 母婴室, 2 康复医疗, 3 康复教育, 4 辅具适配, 5 康园, 6 评估机构, 7 无障碍卫生间(含婴儿照料), 8 爱心驿站` | `common/constants.js: POI_TYPE_MAP`, `common/poiCapabilities.js:1-96 POI_CAPABILITIES` |
| **能力矩阵** | `0/1/7 支持 recentFeedback + review, 8 为爱心驿站特殊权重 3 marker, 2-6 支持预约` | `poiCapabilities.js:5-96` |
| **API 契约** | `poi.getByPoiId: select _id/address/lat/lng/name/photo_cloud_ids/category_id as type/desc + tagMap + cloudFileToUrls`； `nearbyList: ST_Distance_Sphere(POINT(lng,lat), POINT(?,?)) <= radius, where category_id in ([type,'7'] if 0/1), is_deleted=0 is_offline=0, order weight desc, distance asc, _id asc, 分页 + fallback 全局最近` | `map_poi/models/poi.js:92-226` |
| **敏感字段** | `desc` 为 JSON 存放 `station_meta{operating_hours, services[], usage_note, coordinate_accuracy, import_batch}`；`photo_cloud_ids` 兼容 `string ; 分隔 / array / array内;分隔` via `splitCloudIds` | `poi.js:267-318` |

#### Identity 事实

- **Active 表 PK** `map_poi_poi._id` 为用户侧生成（非 auto-increment），历史 `love_station_*` 手工赋值 (`import_love_stations_dev.sql:23-33`)；无 auto identity 策略代码。
- **Source CSV 无稳定 _id**：`深圳数据.csv` 仅有 `id` 在原始 `深圳公厕-原始数据.csv` (与 `image_cloud_ids` 中路径 `191496` 对应)，`佛山数据.csv` 完全无 id；需 Harness 负责 deterministic 生成。
- **去重依据** 既有 `layer/utils` 无去重逻辑；当前 `poi.js` 未做 dedup。

#### DEV / PROD 事实

| 项 | 值 | 来源 |
|----|----|------|
| **envId dev** | `dev-5gzz7rxdbcf5d7dc` | `cloudbaserc.json:2`, `scripts/env-config.json:6 resourceEnv dev`, `config/env.generated.js:7` |
| **envId prod** | `prod-6gv6kwxe65437245` | `AGENTS.md:75`, `scripts/env-config.json:13` |
| **TCB_ENV 硬编码风险** | `cloudbaserc.json:36 map_order/envVariables.TCB_ENV=prod-6gv...` 即使顶层 envId 为 dev — 已在 `harness/checks/environment.js:60-71` 作为 BLOCK 告警，`baseline.json: 进度` 登记 | `cloudbaserc.json:36,51` + `baseline.json` |
| **DB** | `map` (internal_mysql, host 172.17.0.7, DB_USER TEST) — 明文 `DB_PASSWORD` 在 `cloudbaserc.json:35` 已被 `environment.js:75-81` BLOCK | `cloudbaserc.json:31-35`, `prod_new_schema.sql:9 USE map` |
| **CloudFunction 后缀** | `dev → _v2`, `prod → ""` | `env-config.json:8,15 cloudFunctionSuffix` |
| **写路径** | `knex({client:'mysql2', host/port/user/password/database:map})` + `db('map_poi_poi')` CRUD；无事务封装示例；`import_love_stations_dev.sql` 用 `INSERT ... ON DUPLICATE KEY UPDATE` 幂等 | `cloudfunctions/map_poi/index.js:1-17`, `import_love_stations_dev.sql:6` |

#### Input Format 事实

| 数据集 | 行数 | header | 类型分布 | 关键问题 |
|--------|------|--------|----------|----------|
| `深圳数据.csv` | 5104 (+header) | `address,naem,latitude,longitude,photo_cloud_ids,type,desc,city` — `naem` 拼写错误，`city=1` 无意义常量, 1 行 `address/name` 缺失, 1 行 `photo_cloud_ids` 为 `;` 分隔云文件串 | `type: 0=4187, 7=917` (7=`babyCareRoom=1` 映射), `0->无障碍, 7->含婴儿照料` | bbox 外 90 行 (汕尾海丰 115°E 等), 同截断坐标 17 组重复, 425 行含 `地铁` 关键词 |
| `佛山数据.csv` | 2584 (+header) | `address,latitude,longitude,name,photo_cloud_ids,type,desc` — 正确 header 但 `photo_cloud_ids` 多为空 | `0=2138, 1=336, 3=56, 4=25, 2=21, 5=8` | bbox 外 19 行 (112.45°E 等), 8 行地铁相关, 多为空照片 |
| `深圳公厕-原始数据.csv` | 5104 (+header, 47 列) | `id,name,longitude,latitude,babyCareRoom,district,manageUnitName, ... picList_json, image_cloud_ids` — 最完整溯源，`id` 为稳定外部 id, `babyCareRoom` 直接映射 `type 7` | `babyCareRoom 0=4187 1=917 吻合深圳数据` | 原始即包含所有地理与运营字段，可用于校验 lat/lng swapped 等 |

#### 现有 Harness/测试能力

- 通用项目 Harness: `harness/index.js` 四档 `preflight/change/merge/release` + `checks/environment|db-catalog|function-registry|layer-contract|api-contract|protected-behaviors` (`harness/checks/` 8 个)；`manifests/baseline.json` 棘轮，`db-catalog.json` 治理，`lib/result.js: CheckResult` 三级 `BLOCK/WARN/advise`。
- 测试: `node --test backend/tests/**/*.test.js tests/unit/**/*.test.js`, `jest component`, `fast-check` property, `k6` baseline；`tests/unit/poi-transform.test.js` 对 `transformPoiData` 做边界全覆盖。
- 无 CSV ingest / 数据契约 / diff / 发布后验证 能力 — 正是本 Harness 需补齐的 gap。

---

## 2. Mature Reference Comparison

| Reference | Useful Pattern | Adopt / Adapt / Reject | Reason | 对应 Harness 映射 |
|-----------|----------------|------------------------|--------|-------------------|
| **Frictionless Framework** | Table Schema (fields/type/constraints/required/unique/pk/fk/missing_values)；Resource baseline + custom Checks；`validate() → ValidationReport.flatten()`；`infer()` 辅助推断 | **Adapt** (借设计，不直接引入 `frictionless-py`) | 项目栈为 Node 小程序，无 Python 运行时；数据量仅 5-8k，引入整套 py 生态成本 > 自研；但其 **Schema-first + Report-flat + Baseline+Custom 可插拔** 的 invariant 完全适用。Node 可选 `tableschema-js` 但维护弱，且与 `zod` 重叠。 | `contracts/poi.schema.json` (Frictionless Table Schema 兼容的 JSON) + `src/validators/schema.js` 用 `zod` 实现相同约束 + `flatten()` 风格的 `ValidationReport {row, col, code, message, severity}`；`src/validators/custom.js` 对应 custom Check（坐标规则等） |
| **Soda Core / Data Contracts** | Data Contract YAML；`schema / missing / duplicate / valid_values` 50+ checks；**temporary/staging table → verify → promotion**；contract 与产数仓库同版本；`soda contract verify -ds -c` PASS/FAIL 阻断 | **Adapt** | Soda 为 Python + 需常驻数据源连接，且对 MySQL 支持在 v4 中为实验性；不适合小程序轻量仓库。借其 **staging-verify-promote** 核心契约流与 PASS/FAIL 语义，Harness 侧用文件级 Release Candidate 替代临时表即可。 | `src/release/candidate.js` 生成 `Releases/<id>/candidate.json` (normalized data + sourceHash + validationReport) 作为 staging；在 staging 上完成全部校验后 `GATE PASS` 才 `promote` 到 `map` 库 |
| **Great Expectations** | Batch (待验批次)；ExpectationSuite (期望集合)；Checkpoint (生产级可复用检查点，`Batch×Suite → ValidationResult → Action`)；`CheckpointResult.success` + `ValidationAction` | **Adapt** | GX 为重型 Python 数据平台，依赖 `DataContext/BatchRequest` 等大量编排概念，不适合 5k 行小数据。但其 **Batch→Checkpoint→Result→Action** 的 Harness 边界与 **apply 后重新拉取实际数据的 Post-release Checkpoint** 极为关键。 | 设计两个 Checkpoint：`pre-apply-checkpoint` (canonical → report → gate) 与 `post-apply-checkpoint` (DEV read-back → compare → VERIFIED)；`src/verify/checkpoint.js` 实现相同语义，Action 为 `BLOCK` 或 `VERIFIED` |
| **Dagster Asset Checks** | `@asset_check(asset, severity=WARN|ERROR, blocking=True)`；`AssetCheckResult(success, severity, metadata)`；**blocking ERROR 机械阻断 downstream materialization** | **Adapt** | Dagster 为完整编排平台（scheduler/sensor/IO manager），引入成本极高。但其 **WARN vs BLOCKING ERROR 二分 + 机械 Gate** 为 Harness 必须的控制流 invariant。 | `src/validators/severity.js` 定义 `PASS/WARNING/BLOCK` (映射 Dagster WARN→WARNING, ERROR→BLOCK)；`src/release/gate.js` 机械执行 `blockingCount===0 && env===dev && diff.CONFLICT===0`，非 0 则 `process.exit(1)`，禁止 agent 自行判断“问题不大” |
| **Datafold data-diff** | 同库 `JOIN diff` / 跨库 `hash+bisection`；基于 `key-column(pri) + update-column` 的行级 diff；归类 `INSERT/DELETE/UPDATE/UNCHANGED` + 物化结果；统计行级差异 | **Adapt** (Reject as dependency) | OSS 已于 2024-05-17 归档停止维护；引入需处理多 DB 适配与原生依赖，且 5-8k 行无需 hash 加速。借其 **基于 stable identity 的行级 Join Diff + 六类归类** 思想，用内存 Map 实现即可。 | `src/diff/engine.js` 实现 `Map<stableId, row>` 双向 join，输出 `INSERT/UPDATE/UNCHANGED/CONFLICT/REJECTED/SUSPECTED_DUPLICATE`；`REJECTED` 来自 BLOCK 行不进入 diff，`SUSPECTED_DUPLICATE` 来自 `name+coords` 模糊去重 |

> **No Copy-Paste Large Platform**: 本项目刻意不引入 Airflow/完整 Dagster/GX/Soda/Data-diff 的基础设施，仅复用其 **invariant**。

---

## 3. Repository Fit Analysis — 成熟模式如何适配当前项目

| 层次 | 成熟方案假设的基础设施 | 当前项目实际 | 最小适配策略 |
|------|------------------------|--------------|--------------|
| **Runtime** | Python (Frictionless/Soda/GX/data-diff) / Scala | Node.js 14+, 无 Python 依赖，小程序 + knex | 全部用 Node 实现同构模式；合同用 JSON 而非 YAML（团队更熟悉 JS），校验用 `zod`/`ajv` 而非 Python 库 |
| **Storage** | Warehouse (Snowflake/BQ) + staging table | 单 MySQL `map` 库，`map_poi_poi` 单表，无 staging 库；数据量 8k 全量可载内存 | **File-based Staging**: Release Candidate 为 `releases/<releaseId>/candidate.json` + `validation.json` + `diff.json`，无需额外临时表；如未来量级增至 100k+ 再考虑临时表 |
| **Identity** | 自带 PK (id) | Source CSV 无稳定 PK（仅深圳原始有 `id`，佛山无）；需 Harness 生成 deterministic `_id` | `src/canonical/identity.js`: `shenzhen:{raw.id}` 若有，否则 `foshan:{sha256(normalize(name)+normalize(address)+round(lat,5)+round(lng,5)).slice(0,12)}`；同时保留 `source_hash = sha256(raw_row_json)` 用于幂等判断 |
| **Category 映射** | 静态 Valid Values | `poiCapabilities.js` + `constants.js` 为真相，DB 无 FK 约束 | `contracts/poi.schema.json` 中 `category_id.enum=["0","1","2","3","4","5","6","7","8"]` 与代码真相同源；contract 生成脚本 `scripts/sync-contract.js` 从 `poiCapabilities.js` 自动同步，避免双维护 |
| **Type 派生** | 无 | 深圳 `type 7 = babyCareRoom==1` 派生，`city` 冗余 | `canonical/normalize.js` 显式处理：`naem→name` 容错，`city` 丢弃，`type` 归一为 string，`photo_cloud_ids` 归一为 `string[]`，`desc` 归一为 `string` |
| **Coordinate** | 通用 `lat ∈ [-90,90]` | 业务集中粤港澳，汕尾等远距离数据实际为外部爬取噪声 | `validators/coordinates.js` 三级：① 基础合法性 `[-90,90]/[-180,180] && !=0,0` BLOCK；② `lat>lng` 疑似 swapped WARN；③ 粤 bbox `22.0-24.5,112.5-115.5` 外 WARNING，需人工确认 |
| **Env Guard** | 单一 DS 配置 | `env-config.json` 三文件 (`config/env.generated.js`, `project.config.json`, `cloudbaserc.json`) 需三处一致，且 `cloudbaserc.json` 内嵌生产 TCB_ENV | 复用既有 `harness/checks/environment.js` 设计，增加 `src/environments/guard.js` 在 apply 前机械校验 `targetEnvId===dev-5gzz... && targetDB==='map' && targetFunction has suffix _v2 && validationStatus===PASS` |
| **Write** | Bulk load / COPY | `INSERT ... ON DUPLICATE KEY UPDATE` 已有幂等模式，无事务封装 | `src/release/apply.js` 用 `knex.transaction` 包裹批量 upsert (batch 500)，`weight/lat/lng` 等字段全量覆盖，`ON DUPLICATE` 保证 idempotent；任何单行 SQL 异常则整批 rollback，避免 partial write |
| **Verification** | `COUNT(*)` / `hash` | 无 read-back 机制，仅 `import_love_stations_dev.sql` 末尾 `SELECT COUNT(*)` | `src/verify/readback.js` 重新 `SELECT _id,category_id,name,address,latitude,longitude,city,photo_cloud_ids FROM map.map_poi_poi WHERE _id IN (...)` 与 `candidate.json` 字段级对比，输出 `post-validation-report.json`，仅 `count/identity/category/coords` 全等才 `VERIFIED` |
| **Tag/Relation** | 无 | POI 涉及 `map_poi_tag` + `map_poi_poi_tag_relation UNIQUE(poi_id,tag_id)`，但 toilet 数据暂无标签 | v1 仅校验 `category_id` 与 POI 主表；tag 导入作为可选扩展 `src/canonical/tags.js`，relation 需 FK 存在性校验 |

---

## 4. Invariant Table — Harness 机械保证的不变量

| # | Invariant | 检查时机 | Severity | 失效后行为 | 来源 |
|---|-----------|----------|----------|------------|------|
| I-01 | Source header 必须包含 `address,name|naem,latitude,longitude` (容 `naem` typo 自动纠正但记录 WARN) | Canonicalize | BLOCK if missing after alias | Gate BLOCK | Frictionless `required` |
| I-02 | Required fields 非空: `name, address, latitude, longitude, category_id` | Contract validation | BLOCK | Gate BLOCK | Frictionless `required` + Soda `missing` |
| I-03 | `category_id ∈ {0,1,2,3,4,5,6,7,8}` | Contract | BLOCK | Gate BLOCK | Soda `valid_values` |
| I-04 | `latitude ∈ [-90,90]`, `longitude ∈ [-180,180]` | Custom check | BLOCK | Gate BLOCK | GX `expect_column_values_to_be_between` |
| I-05 | `latitude !=0 && longitude !=0` (拒绝 `0,0` null island) | Custom check | BLOCK | Gate BLOCK | Business rule |
| I-06 | Suspected lat/lng swapped: `|lat|>35` 或 `lng<90` 时尝试交换后落入粤 bbox → 标记 `SUSPECTED_SWAPPED` | Custom check | WARNING (需人工确认) | 记录 WARN, 默认 BLOCK 直至人工 `--allow-swapped` | Failure-matrix 新增 |
| I-07 | 业务地理围栏: 粤区域 `lat 20.0-25.5, lng 109.5-117.5` 外 → WARNING；`lat 22.0-24.5, lng 112.5-115.5` 核心区外但粤内 → WARNING | Custom check | WARNING | 需人工确认，`--allow-out-of-core` 才放行，默认 WARNING 不阻断但计入 evidence | Data Diff 地理 sanity |
| I-08 | `photo_cloud_ids` 每项须 `cloud://` 前缀 + 含 `cloud1-` 或 `636c-` 标识，或为空；分号分隔自动归一 | Contract | WARNING | 记录 WARN，清洗为空不阻断 | Business |
| I-09 | `_id` stable & unique: dataset 内无重复 `_id`；与 DEV 现有 `_id` 冲突时进入 `CONFLICT` | Identity + Diff | BLOCK (intra-batch dup) / CONFLICT (vs DEV) | intra BLOCK；CONFLICT 需人工 `--force-update` | Frictionless `primaryKey(unique)` |
| I-10 | Fuzzy duplicate: 同 `round(lat,4)+round(lng,4)+normalize(name)` 出现 >1 → `SUSPECTED_DUPLICATE` | Quality check | WARNING | 记录 WARN + diff 标记 | Soda `duplicate` |
| I-11 | Row count sanity: `0 < rows < 20000` 且 `rows` 与上一 release 差异 `< 300%` 无骤增骤减 | Dataset check | WARNING if 0/BLOCK if >k | WARNING/ BLOCK | GX `expect_table_row_count_to_be_between` |
| I-12 | Environment exactly `dev-5gzz7rxdbcf5d7dc`, DB=`map`, function suffix `_v2` | Gate | BLOCK | `process.exit(1)` 机械阻断，禁止 PROD 写入 | Dagster `blocking` |
| I-13 | Gate 仅当 `blockingCount===0 && conflictCount===0 && environmentOK` 才 PASS | Gate | BLOCK | 机械 BLOCK | Dagster |
| I-14 | No partial write: batch apply 必须 `transaction.commit` 原子；任意 SQL 异常 → rollback | Apply | BLOCK (runtime) | 抛异常，release 标记 `APPLY_FAILED` | Soda promotion |
| I-15 | Idempotency: 同 `source_hash` 重跑 → `INSERT=0 UPDATE=0 UNCHANGED=N` | Apply (second run) | - | 验证：二次运行 diff 必全 UNCHANGED | Harness 约束 |
| I-16 | Read-back equality: `candidate._id/category_id/lat/lng/name/address` 与 `SELECT` 结果字段级相等 (lat/lng 容 `1e-7`) | Post-verify | BLOCK | `VERIFIED=false`，需人工介入 | GX post-checkpoint |

---

## 5. Failure-Mode Matrix

| Failure Mode | 示例 (真实数据中已观测) | 检测层 | Severity | Gate 影响 | Regression Fixture |
|--------------|--------------------------|--------|----------|-----------|---------------------|
| **Header 拼写错误** | `深圳数据.csv: naem` vs `name` | Canonicalize `aliasMap={naem→name}` | WARNING (auto-corrected) + 记录 | 不阻断，但 `validation.json` 记录 alias | `tests/fixtures/header-naem.csv` 已验证自动纠正 |
| **Required 缺失** | 深圳 1 行 `address=""` | Contract | BLOCK | BLOCK | `missing-address.csv: address=""` |
| **类型外非法** | 佛山若出现 `type=9` (未在 POI_TYPE_MAP) | Contract `enum` | BLOCK | BLOCK | `invalid-category.csv: type=99` |
| **坐标缺失/非数字** | 深圳 1 行 `latitude=""` | Contract `type:number` | BLOCK | BLOCK | `missing-coords.csv` |
| **坐标 `0,0`** | 未在当前批出现，但为常见爬取默认值 | Coordinates | BLOCK | BLOCK | `zero-coords.csv: 0,0` |
| **坐标超界** | `lat=91` / `lng=181` | Coordinates | BLOCK | BLOCK | `out-of-range.csv` |
| **Lat/Lng 疑似交换** | 原始爬取中 `lat=113.80 lng=22.77` (lat 异常大) | Coordinates swapped heuristic | WARNING (BLOCK until `--allow-swapped`) | 记录 WARN，默认不进 diff | `swapped-coords.csv: 113.8,22.77` |
| **业务区域外** | 深圳 90 行至汕尾 `114.9°E`，佛山 19 行至 `112.45°E` | Geo fence | WARNING | 不阻断，但 diff 标记 `OUT_OF_CORE` 需人工 review | `out-of-bbox.csv` |
| **Dataset 内 _id 重复** | 深圳原始 `id` 重复或 Foshan hash 碰撞 | Identity | BLOCK | BLOCK | `duplicate-id.csv` |
| **Dataset 内坐标+名称模糊重复** | 深圳 17 组截断坐标重复 (如 `22.7057755,113.779828` ×2) | Dedup `name+round(lat,4)` | WARNING `SUSPECTED_DUPLICATE` | 不阻断，diff 标记 | `suspected-duplicate.csv` |
| **与 DEV 的 _id 冲突 (覆盖风险)** | 重跑相同 shenzhen id 但内容变更 | Diff `CONFLICT` | BLOCK (需 `--force-update`) | BLOCK | `conflict-with-dev.json` |
| **照片云 ID 格式错误** | `photo_cloud_ids="http://..."` 非 `cloud://` | Contract | WARNING | 不阻断，清洗 | `invalid-photo-id.csv` |
| **环境错配 (PROD)** | `cloudbaserc.json envId=prod-6gv...` | Env Guard | BLOCK | 机械 `exit 1` | `env-prod.json` |
| **Partial write (SQL 异常)** | `photo_cloud_ids` 超长 > json 列或 `latitude` 精度溢出 | Apply transaction | BLOCK (runtime) | rollback, `APPLY_FAILED` | `sql-error-injection.test.js` |
| **幂等性破坏** | 二次运行产生新 `_id` | Identity determinism | BLOCK (post-verify) | 二次 diff 必全 UNCHANGED 否则 FAIL | `idempotency.test.js` |
| **Read-back 不一致** | `INSERT` 后 `SELECT` 发现 `category_id` 被触发器篡改 | Post-verify | BLOCK | `VERIFIED=false` | `readback-mismatch.test.js` |
| **Tag FK 缺失** | `tag_id` 不在 `map_poi_tag` | Relation check | BLOCK | BLOCK | `invalid-tag-relation.csv` (v2) |

> 迭代机制: 每发现新 failure → `tests/fixtures/<mode>.csv` + `tests/validation/<mode>.test.js` 先证明 Harness 无法捕获 → 增加 validator → 回归测试 → 重跑真实 dataset。

---

## 6. Proposed Harness — 真实实现边界

```
Raw Dataset (CSV/XLS/JSON, utf-8-sig, 支持 naem 容错)
  ↓  canonical/normalize.js + identity.js  (header alias, type→string, city丢弃, photo归一, lat/lng parse, stable _id, source_hash, batch_hash)
Canonical Dataset (JSON array + manifest {batchHash, rowCount, generatedAt})
  ↓  contracts/poi.schema.json (zod) + validators/schema.js
Data Contract / Schema Validation  →  ValidationReport {row,pos,code,message,severity=BLOCK}
  ↓  validators/coordinates.js + validators/business.js + validators/dedup.js
Quality Checks (custom)  → 追加 WARNING/BLOCK，产出 qualityReport
  ↓  release/candidate.js  (合并 canonical + validation + quality → candidate.json + sourceHash)
Staging / Release Candidate  (文件级 staging, 位置 releases/<releaseId>/candidate.json, 可审计)
  ↓  diff/engine.js  (load DEV snapshot via knex SELECT _id,category_id,lat,lng,name,address → Map join)
Data Diff  →  diff.json {INSERT:[], UPDATE:[{before,after,changedFields}], UNCHANGED:[], CONFLICT:[], REJECTED:[], SUSPECTED_DUPLICATE:[]}
  ↓  release/gate.js  (mechanical: env guard + blockingCount==0 + conflictCount==0 + WARN ack?)
Blocking Gate  →  PASS → 允许 apply；BLOCK → exit 1 + gate.json {reason, blockingChecks, env}
  ↓  release/apply.js  (knex.transaction, batch 500, INSERT ... ON DUPLICATE KEY UPDATE, 全量字段覆写, 收集 affectedRows)
DEV Apply  (真实写入 dev-5gzz7rxdbcf5d7dc / map.map_poi_poi)
  ↓  verify/readback.js  (SELECT back by _id IN (...), 字段级 compare, 容差 1e-7)
Post-release Validation  →  postReport {VERIFIED true/false, mismatches[]}
  ↓  verify/evidence.js
Release Evidence  (releases/<releaseId>/evidence.json + report.md 含 sourceHash, diff stats, gate decision, verification, 可追溯)
  ↓  (可选) rollback/undo.js  (基于 candidate before 镜像生成 DELETE/UPDATE 回滚 SQL, 仅 DEV)
```

**阶段产出物**:

| 阶段 | 产出文件 | 作用 |
|------|----------|------|
| Canonical | `releases/<id>/canonical.json` | 归一后真相，含 `_id,source_hash` |
| Validation | `releases/<id>/validation.json` | Flatten report (如 Frictionless) |
| Quality | `releases/<id>/quality.json` | Business checks |
| Candidate | `releases/<id>/candidate.json` | Staging 快照 (canonical + reports + batchHash) |
| Diff | `releases/<id>/diff.json` | 行级对比 |
| Gate | `releases/<id>/gate.json` | PASS/BLOCK 决策证据 |
| Apply | `releases/<id>/apply.json` | affectedRows, transaction id, timing |
| Verify | `releases/<id>/post-verify.json` | VERIFIED 证明 |
| Evidence | `releases/<id>/evidence.json` + `report.md` | 对外发布证据，一键可审计 |

**Severity 映射**:

- `PASS` — 正常
- `WARNING` — 记录于 validation/quality report，Gate 默认不阻断，但 `evidence` 中高亮需人工 review；`--strict` 模式可将特定 WARNING 升级为 BLOCK
- `BLOCK` — 机械阻断 Gate，禁止进入 apply；agent 不得自行绕过

---

## 7. Minimal Dependency Decision

| Library / Pattern | 决策 | 理由 | 成本 | 替代方案 |
|-------------------|------|------|------|----------|
| **zod** (JSON schema) | **Adopt 直接引入** | 轻量 (<50KB), 零原生依赖, 与小程序 `validate.js` 风格一致, 可精确表达 `latitude number .min(-90).max(90)` 等；比 `tableschema-js` 更活跃且类型安全 | `npm i zod` | `ajv` 也可，选 zod 因已有团队熟悉 |
| **csv-parse** (sync) | **Adopt** | 纯 JS, 支持 `utf-8-sig BOM`, `columns:true, relax_column_count, trim`，处理 `naem` 容错无需重写 | `npm i csv-parse` | 手写 split 易错 (引号、分号照片列) |
| **knex / mysql2** | **Reuse 已有** | `cloudfunctions/map_poi` 已依赖，无新增；Harness 复用 `knex` 直连 `map` 库 | 0 新依赖 | `tcb-sdk` 查询也可，但 knex 更易做事务 |
| **commander / yargs** | **Adopt (tiny)** | CLI `poi release --source ... --env dev --dry-run` 需参数解析 | `npm i commander` | 手写 `process.argv` 也可，commander 更可维护 |
| **frictionless-py / tableschema-js** | **Reject dependency, Adapt pattern** | Py 需额外运行时，js 版维护弱；核心价值为 schema 思想，可用 zod 完全覆盖 | 节省 30MB+ 依赖 | 自研 `contracts/poi.schema.json` + `validators/schema.js` |
| **soda-core** | **Reject, Adapt staging→verify→promote** | Py + 实验性 MySQL + 需 DS 配置 + Soda Cloud 绑定，过度设计 | 节省 Python 环境 | 文件级 staging 替代临时表 |
| **great_expectations** | **Reject, Adapt Batch→Checkpoint→Result→Action** | 重型平台，Batch/Validator/DataContext 过多概念，不适合 5k 行 | 节省 200MB | 两阶段 checkpoint 自研 |
| **dagster** | **Reject, Adapt WARN/BLOCK + blocking gate** | 完整编排平台，需 daemon/UI，团队无运维能力 | 节省 infra | `gate.js` 10 行机械实现 |
| **data-diff (OSS)** | **Reject, Adapt join-diff + identity** | 已归档，无维护；hash+bisection 对 5k 行过度；有更好的内存 Map 方案 | 节省原生编译 | `diff/engine.js` 内存 Map |
| **fast-check** | **Reuse 已有** | 已在 `map-miniprogram` 用于 property 测试，可复用验证坐标边界等 | 0 新依赖 | - |

**最终新增依赖** (最小化):

```json
{
  "dependencies": { "zod": "^3.23", "csv-parse": "^5.5", "commander": "^12.1" },
  "devDependencies": { "knex": "^3.1", "mysql2": "^3.9" } // 复用云函数已有，pipeline 侧声明为 dev
}
```

---

## 8. Staging 决策

- **形式**: 文件级 staging (`releases/<releaseId>/candidate.json`) + 内存 diff，无需 MySQL 临时表
- **理由**: 数据量 5-8k，全量 JSON <5MB，内存可完全容纳；避免 `CREATE TEMPORARY TABLE` 权限与清理问题；`candidate.json` 即为可审计的 release 证据，天然支持 `git diff` 回溯。未来若单次 >50k 或需跨团队 SQL 协同，再升级为 `map_poi_staging` 表。
- **内容**: `candidate = {releaseId, batchHash, sourceFiles[{path, sha256, rows}], canonicalRows[{_id, name, address, lat, lng, category_id, city, photo_cloud_ids, desc, source_hash}], validationReport, qualityReport, createdAt}`

---

## 9. Data Diff 设计

- **输入**: `candidate.canonicalRows` vs `DEV snapshot = SELECT _id, category_id, name, address, latitude, longitude, city, photo_cloud_ids, is_deleted, is_offline FROM map.map_poi_poi WHERE _id IN (candidate ids) OR (lat BETWEEN 22.0 AND 25.0 AND lng BETWEEN 112.5 AND 115.5) 全量扫描做 suspected-dup`
- **Key**: `stable _id` (主键 join)
- **归类**:
  - `INSERT`: `_id` 不在 DEV → 新插入
  - `UPDATE`: `_id` 在 DEV 且 `changedFields ≠ []` (比较 `category_id,name,address,lat,lng,city,photo_cloud_ids` 字段级差异，`lat/lng` 容差 `1e-7`)
  - `UNCHANGED`: `_id` 在 DEV 且全字段相等 → 幂等命中
  - `CONFLICT`: `_id` 在 DEV 但 `category_id` 等关键字段语义冲突且未加 `--force-update` (Harness 标记需人工确认)
  - `REJECTED`: 因 BLOCK validation 未进入 diff 的行 (统计展示)
  - `SUSPECTED_DUPLICATE`: `Map<name|round(lat,3)|round(lng,3) → [rows]>` 大小>1 的组 (WARNING，不阻断但高亮)
- **实现**: 纯 JS `Map` 双向遍历，O(N)，无需 hash/bisection；输出 `diff.json` 含每类数量 + 详情列表 (前 20 条抽样 + 完整 JSON)

---

## 10. DEV Release Gate — 机械执行

```js
// src/release/gate.js 伪代码
function gate({candidate, diff, env}) {
  assert(env.resourceEnv === 'dev-5gzz7rxdbcf5d7dc', 'ENV_MISMATCH BLOCK');
  assert(env.dbName === 'map', 'DB_MISMATCH BLOCK');
  assert(candidate.validationReport.blockingCount === 0, `BLOCKING_CHECKS=${n} BLOCK`);
  assert(candidate.qualityReport.blockingCount === 0, `QUALITY_BLOCK=${n} BLOCK`);
  assert(diff.CONFLICT.length === 0 || opts.forceUpdate, `CONFLICT=${n} BLOCK`);
  assert(diff.REJECTED.length === 0 || opts.allowRejected === false, 'REJECTED not allowed BLOCK');
  // WARNING 数量仅记录，不默认 BLOCK，但 evidence 中高亮
  return {pass:true, reason:'GATE_PASS'};
  // 任何 assert 失败 → {pass:false, reason, gate:'BLOCK'} + process.exit(1)
}
```

- **不得** 由 agent 看到错误后自行判断“问题应该不大，继续发布” — 必须由代码返回 `BLOCK`。

---

## 11. DEV Apply — 原子 + 幂等

- **事务**: `await knex.transaction(async trx => { for (batch of chunk(canonical, 500)) await trx('map_poi_poi').insert(batch.map(toDbRow)).onConflict('_id').merge(['name','address','latitude','longitude','category_id','city','photo_cloud_ids','desc','updated_at']) })`
- **`toDbRow`**: `{_id, category_id, name, address, latitude, longitude, city, photo_cloud_ids: JSON.stringify(...), desc: JSON.stringify(station_meta?) || '', weight:0, is_offline:0, is_deleted:0, created_at: now, updated_at: now}`
- **幂等**: `ON DUPLICATE KEY UPDATE` + `stable _id` → 二次执行 `INSERT 0 UPDATE 0 UNCHANGED N`
- **Partial write 防护**: 事务内任何单行失败 → `rollback` → `apply.json.status=APPLY_FAILED`，不产生中间态

---

## 12. Post-release Validation — Read-back Checkpoint

1. `SELECT` 回读: `SELECT _id, category_id, name, address, latitude, longitude FROM map.map_poi_poi WHERE _id IN (:candidateIds)`
2. 逐行 compare: `expected(canonical)` vs `actual(DB)`，`lat/lng` 容差 `1e-7`，`photo_cloud_ids` JSON 语义相等
3. 统计: `expectedCount === actualCount === candidateCount`, `mismatchedFields[]`, `missingInDB[]`, `extraInDB[]`
4. **产出**: `post-verify.json {verified: true/false, expectedCount, actualCount, mismatchCount, mismatches: [...]}`；仅 `verified===true` 才标记 `VERIFIED`
5. 可选 **Product-path Verification**: 调用 `map_poi.getByPoiId` / `nearbyList` 对抽样 3 条验证接口可读性

---

## 13. Repository Plan — `poi-release-pipeline` 文件职责

```
poi-release-pipeline/
  README.md                         # 快速开始, CLI 用法, 决策摘要
  docs/
    HARNESS_ENGINEERING.md          # 本文件 (架构与审计完整证据)
    RUNBOOK.md                      # 今日 DEV 发布执行手册
  contracts/
    poi.schema.json                 # Frictionless Table Schema 兼容 + zod 导出
    validation-rules.md             # 规则枚举与 severity
  config/
    env.config.js                   # 从 map-miniprogram/scripts/env-config.json 只读同步, 不复制凭据
    poi-capabilities.sync.js        # 从 common/poiCapabilities.js 只读同步 category 枚举
  src/
    canonical/
      normalize.js                  # header alias, type归一, photo归一, city清洗, lat/lng parse
      identity.js                   # stable _id 生成 + source_hash
      index.js                      # 入口: rawRows → canonicalRows + manifest
    validators/
      schema.js                     # zod contract 校验 → ValidationReport
      coordinates.js                # 地理规则 (0,0, 范围, 交换, bbox)
      business.js                   # 分类/照片/文本 业务规则
      dedup.js                      # intra-batch duplicate + suspected
      severity.js                   # PASS/WARNING/BLOCK 枚举与聚合
      index.js                      # 组合所有 validators → unified report
    diff/
      engine.js                     # Map join diff → INSERT/UPDATE/...
      snapshot.js                   # knex 拉取 DEV snapshot
    environments/
      guard.js                      # 机械校验 envId/DB/suffix
      load.js                       # 从 map-miniprogram/config/env.generated.js 读取真相
    release/
      candidate.js                  # 生成 Release Candidate artifact
      gate.js                       # 机械 Gate
      apply.js                      # 事务性 apply
      plan.js                       # human-readable release plan md 生成
    verify/
      readback.js                   # DEV read-back + compare
      checkpoint.js                 # pre/post Checkpoint 抽象
      evidence.js                   # 汇总 evidence.json + report.md
    rollback/
      undo.js                       # 基于 apply 前镜像生成回滚 SQL (仅 DEV)
  tests/
    fixtures/
      header-naem.csv, missing-address.csv, zero-coords.csv, ...  # 覆盖 Failure-matrix 每行
    validation/
      schema.test.js, coordinates.test.js, dedup.test.js, gate.test.js, diff.test.js
    failure_injection/
      swapped-coords.test.js        # 证明 Harness 原来无法捕获, 后新增 check 可捕获
  releases/
    .gitkeep
    2026-09-11-shenzhen-foshan-dev-001/   # 示例 release-id 目录, 真实 release 时生成
      canonical.json
      validation.json
      diff.json
      gate.json
      apply.json
      post-verify.json
      evidence.json
      report.md
  scripts/
    sync-contract.js                # 从 map-miniprogram 同步 category 枚举到 poi.schema.json
    release.js                      # CLI 入口: node scripts/release.js --source ... --env dev
  package.json
  .gitignore                        # 忽略 releases/*/candidate.json 凭据? 不忽略证据, 仅忽略 .env
```

**与 `map-miniprogram` 的只读边界**:

| 读取项 | 来源 | 同步方式 | 原因 |
|--------|------|----------|------|
| `category_id` 枚举 | `common/constants.js: POI_TYPE_MAP` + `common/poiCapabilities.js` | `scripts/sync-contract.js` 读取并写入 `contracts/poi.schema.json`，CI 校验一致性 | 单一事实源，不双维护 |
| `envId / DB` | `scripts/env-config.json` + `config/env.generated.js` | `src/environments/load.js` 运行时 `require('../../../map-miniprogram/scripts/env-config.json')` 绝对路径读取，不复制 | 环境真相必须实时 |
| `map_poi_poi` DDL | `backend/data/sql/prod_new_schema.sql` | `docs` 引用，不复制；`contracts` 中字段名/类型与 DDL 保持一致，`sync-contract` 含 DDL 校验 | 避免两份 schema 分裂 |
| `cloudfunctions/map_poi/models/poi.js` 查询逻辑 | 读取 `nearbyList` 过滤条件 | 仅文档引用，verify 时用相同 `is_deleted/is_offline` 语义 | 保证可读性 |
| 真实数据集 | `backend/data/poi-data/*.csv` | 通过 CLI `--source` 参数传入绝对路径，不复制进 pipeline 仓库 | 数据与代码分离 |

> 除上述只读外，**不得** 修改 `map-miniprogram` 任何业务代码。若发现必须新增接口（如 `bulk upsert` API），则在本仓库 `docs/HARNESS_ENGINEERING.md#Integration-Note` 登记最小集成点，征得确认后再改。

---

## 14. Implementation Plan — 最小清晰实现 (分 4 批次, 预计 2-3 天)

### Phase 0: 工程基座 (0.5 天)

- [ ] `npm init` + `zod/csv-parse/commander/knex/mysql2` 依赖
- [ ] `.gitignore` (`node_modules`, `.env`, `!releases/**` 保留证据)
- [ ] `contracts/poi.schema.json` 初版 (字段来自 `prod_new_schema.sql:152-174`)
- [ ] `src/environments/{load,guard}.js` (复用 `harness/checks/environment.js` 逻辑)
- [ ] `tests/fixtures` 骨架 + `node --test` 可跑

### Phase 1: Canonical + Validation (1 天)

- [ ] `src/canonical/normalize.js` (header alias `naem→name`, `city` 清洗, `photo_cloud_ids` `split(';')` 归一, `type→String`)
- [ ] `src/canonical/identity.js` (`stableId` + `sourceHash`)
- [ ] `src/validators/schema.js` (zod: required, enum, number range, string maxLength)
- [ ] `src/validators/coordinates.js` (0,0, swapped, bbox)
- [ ] `src/validators/dedup.js` (intra-batch dup)
- [ ] `tests/validation/*` 覆盖 Failure-matrix 前 10 行，每行 `fixture → expect BLOCK/WARNING`
- [ ] 验收: `深圳数据.csv` + `佛山数据.csv` 可产 `validation.json` 且 `blockingCount` 精确

### Phase 2: Diff + Gate + Apply (1 天)

- [ ] `src/diff/snapshot.js` (knex 拉取 DEV 全量或按 bbox)
- [ ] `src/diff/engine.js` (INSERT/UPDATE/UNCHANGED/CONFLICT/REJECTED/SUSPECTED)
- [ ] `src/release/candidate.js` + `plan.js`
- [ ] `src/release/gate.js` (机械校验 env/blocking/conflict)
- [ ] `src/release/apply.js` (transaction + ON DUPLICATE)
- [ ] `tests/validation/gate.test.js` (PROD 环境必 BLOCK), `diff.test.js` (幂等 UNCHANGED)
- [ ] 验收: 对 `深圳` 子集 (100 行) dry-run diff 正确，Gate BLOCK 时 apply 绝不执行

### Phase 3: Verify + Evidence + Runbook (0.5 天)

- [ ] `src/verify/readback.js` + `checkpoint.js` + `evidence.js`
- [ ] `src/rollback/undo.js` (生成反向 SQL)
- [ ] `scripts/release.js` CLI (`--source --env dev --dry-run --force-update --allow-swapped`)
- [ ] `docs/RUNBOOK.md` 今日执行手册
- [ ] 端到端演练: `CSV → canonical → validation → candidate → diff → gate → apply → readback → VERIFIED` 对 10 行抽样

> 每阶段结束执行 `node --test` 全绿 + `npm run harness` (复用 map-miniprogram harness 思想) 全 PASS。

---

## 15. Today's DEV Path — 真实数据集进入 DEV 的明确执行路径

```
① PREFLIGHT  (在 poi-release-pipeline 仓库)

  $ node scripts/release.js --check-env
  → 读取 map-miniprogram/scripts/env-config.json
  → 断言 cloudbaserc.json envId=dev-5gzz7rxdbcf5d7dc, config/env.generated.js 一致
  → 输出 env guard PASS

② REVIEW (dry-run, 不写库)

  $ node scripts/release.js review \
      --source "D:\work\map\source code\map-miniprogram\backend\data\poi-data\深圳数据.csv" \
      --source "D:\work\map\source code\map-miniprogram\backend\data\poi-data\佛山数据.csv" \
      --env dev --out releases/2026-09-11-dev-001

  内部:
    raw(深圳 5104 + 佛山 2584 = 7688) → canonical(7688, 生成 stable _id)
    → validation: 预计 BLOCK 1-2 行 (missing address/lat), WARNING 90+19 区域外 + 17 重复 + photo 格式
    → candidate.json (batchHash=sha256(canonical))
    → diff: 拉 DEV snapshot (SELECT ... WHERE is_deleted=0) → diff.json
      预计 INSERT ~7600, UPDATE 0, UNCHANGED 取决于 DEV 已有 love_station_11 等 11 行无交集, CONFLICT 0

  产出: releases/2026-09-11-dev-001/{canonical,validation,quality,diff,plan.md}
  人工: 审阅 plan.md + validation.json 的 WARNING 行，确认区域外是否放行 (--allow-out-of-core)

③ GATE

  $ node scripts/release.js gate --release releases/2026-09-11-dev-001 [--allow-out-of-core]
  → gate.js 机械校验: env=dev, blockingCount==0 (若之前 BLOCK 已人工修复), conflict==0
  → 输出 gate.json {pass:true, reason:"GATE_PASS", blocking:0, warning:109, timestamp}

  若 FAIL → 修复 source CSV (或加 flag) → 重跑 ②

④ APPLY (真实写 dev-5gzz7rxdbcf5d7dc / map.map_poi_poi)

  $ node scripts/release.js apply --release releases/2026-09-11-dev-001 --env dev

  内部: knex.transaction → batch 500 ON DUPLICATE → apply.json {affectedRows, inserted, updated, duration}
  机械 guard: 若 gate.json != PASS → 拒绝执行 process.exit(1)

⑤ READ-BACK VERIFY

  $ node scripts/release.js verify --release releases/2026-09-11-dev-001 --env dev

  内部: SELECT back WHERE _id IN (candidate ids) → compare → post-verify.json
  产出: {verified: true/false, expected:7687, actual:7687, mismatches:[]}
  仅 verified===true 标记 releases/evidence.json {status:"VERIFIED"}

⑥ PRODUCT-PATH (可选轻量)

  对抽样 3 个 _id 调用 map_poi.getByPoiId / nearbyList (long,lat 半径 500m) 验证可读
  记录于 evidence.json.productPathChecks

⑦ EVIDENCE

  releases/2026-09-11-dev-001/report.md 包含:
    - sourceFiles sha256, batchHash, rowCounts
    - validation  BLOCK/WARNING 统计 + 前 20 行明细
    - diff  INSERT/UPDATE/UNCHANGED/CONFLICT/SUSPECTED 统计
    - gate 决策 (PASS, env, timestamp)
    - apply  rows affected, transaction id
    - verify  VERIFIED + mismatch 详情
  可直接作为发布证据提交老板审计

⑧ IDEMPOTENCY CHECK (重跑验证)

  $ node scripts/release.js review ... --out releases/2026-09-11-dev-001-rerun
  $ node scripts/release.js diff --release ...-rerun
  → 预期 diff: INSERT 0, UPDATE 0, UNCHANGED 7687

> 全程禁止 PROD: 任何 `--env prod` 或 `envId=prod-6gv...` → gate 立即 BLOCK + `DO NOT APPLY PROD` 日志。
```

**今日不发布 PROD**, 但 Harness 从第一天即通过 `env guard` 与 `gate` 支持 `DEV→PROD` 未来路径 (仅需 `--env prod` 前新增人工审批 token，与 `harness/checks/production-gate.js` 同模式)。

---

## 16. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `photo_cloud_ids` 已指向生产 COS `636c-cloud1-0g34...`，DEV 读取是否越权 | Gate 仅校验 DB 写入，不校验存储；验证时 `cloudFileToUrls` 可在 DEV env 下解析同一 COS，存储与环境解耦，已在 `prod_new_schema` 确认 |
| 佛山数据无 `id` 导致二次导入 `_id` 不稳定 | `identity.js` 用 `hash(name+address+lat5+lng5)` deterministic，文档明确该策略并写入 evidence batchHash，未来 source 变更会产生 UPDATE 而非 INSERT |
| `city=1` 冗余字段混淆 | `normalize.js` 丢弃 `city` 输入，统一以 `address` 解析城市或留空，不依赖该列 |
| `naem` typo 未来修复后双 header | `aliasMap` 同时支持 `name` 与 `naem`，优先 `name`，冲突时记录 WARNING |
| 数据量未来膨胀至 50k+，文件 staging 不适用 | `candidate.json` 按 `releaseId` 分片，diff 改为流式 cursor；保留升级为 `map_poi_staging` 的扩展点 |

---

## 17. 下一步 — 进入 Implementation Ticket

本 Harness Engineering 阶段已收敛:

- [x] 成熟方案实读证据 (5 篇)
- [x] 仓库审计 (POI schema, env, identity, 写路径, 测试能力)
- [x] 成熟方案对比表 (Adopt/Adapt/Reject)
- [x] Repository Fit 适配表
- [x] Invariant 16 条
- [x] Failure-matrix 17 类
- [x] Harness 架构 (8 阶段边界 + 产出物)
- [x] 依赖决策 (新增 3 轻量依赖)
- [x] 仓库结构与文件职责
- [x] 最小实现计划 (4 阶段)
- [x] 今日 DEV 完整执行路径 (8 步, 可直接执行)

下一 ticket **POI Release Harness Implementation** 可直接按 §14 依次实现，无需再次设计讨论。

---

*Author: Harness Engineering — 2026-09-11*
*Source-of-truth: `map-miniprogram` commit baseline (develop 领先 13 提交, env dev-5gzz7rxdbcf5d7dc)*
*References: Frictionless Table Schema v1, Soda Core 4.x Data Contracts, Great Expectations 1.x Checkpoint, Dagster 1.8 Asset Checks, Datafold data-diff Technical Explanation*
