# astrolens · 识别阶段 — 修订 spec + 实施计划（v2，待 sign-off）

> 本文是对 `astrolens-identification-spec.md` 的修订版，已并入 PO 的三项定调：
> ① 双语必做（可大改）；② 两段式 workflow，事实层与表现层**分两个 schema / 两个文件**，不挤在一起；③ 实现语言由 cc 定 → 纯 TS。
>
> 状态：**已基本实现（Phase 0–2，见 §8）。** 本文是设计基准；A 类识别主链路已跑通，B 类形态识别 + 名称 fallback + co-registration + eval 包未做。实现过程中 §4/§5 有几处偏离最初设计，已就地标注「← 为什么」+ ✅/❌。

---

## 0 · 一句话

把现有「LLM 一把抓识别 + 解读」改成**两段式**：

```
image
  └─ Stage 1 识别(确定性,无 LLM)──> factsheet.json   事实层:plate-solve + 查 catalog
        └─ Stage 2 reader(LLM 只 tailor)──> reading.json  表现层:解说/标注圈/海报,tailor 到 tone
              └─ editor 人工 gate ──> renderer/viewer
```

- **事实层 = 天体本身的 property**(查 catalog / 解像得来):身份、坐标、目录属性、要 detect 哪些特征、A 类精确落点、B 类占位。
- **表现层 = LLM 生成 + 人工微调**：`color_key` / `circle` / `badge` / `label` / `explanation` / `narrative` / 海报。
- 两层各自落盘、各自 schema，互不漂移。editor 只编辑表现层(外加翻 B 类的 review flag)。

---

## 1 · 命名与文件

| 层 | 文件 | zod 类型 | 由谁产出 | 由谁改 |
| --- | --- | --- | --- | --- |
| 事实层 | `factsheet.json` | `FactSheet` | Stage 1 识别模块 | 不改(immutable) |
| 表现层 | `reading.json` | `Reading`（原 `Report` 改名） | Stage 2 reader(LLM) | editor 人工微调 |

> 原 `report.json` / `Report` 全链路改名 `reading.json` / `Reading`。viewer 已有 `Reading.tsx`、reader 已有 `parseReading`/`LlmReading`，命名一致。

---

## 2 · Schema 设计

### 2.1 共用

```ts
// schema/src/i18n.ts
export const LocalizedString = z.object({ zh: z.string(), en: z.string() });
export type LocalizedString = z.infer<typeof LocalizedString>;
```

**双语规则**：两层凡 user-facing 文本一律 `{zh,en}` 同时填。顶层语言字段从「选哪种」改为 `display_language`「默认显示哪种」，内容两种都在。

### 2.2 事实层 `FactSheet`（新，`schema/src/factsheet.ts`）

```ts
export const SolveStatus = z.enum(['solved', 'user_provided', 'failed']);
export const FeatureClass = z.enum(['A', 'A+', 'B-anchor', 'B-visual']);

export const FactObject = z.object({
  id: z.string(),
  role: z.enum(['primary', 'secondary', 'context']),
  names: z.array(z.string()),
  category: ObjectCategory,                            // 广义类别,选哪套 feature 适用,见 §3
  type: LocalizedString.extend({ otype: z.string() }), // SIMBAD otype + 双语科普名
  coord: z.object({
    ra_deg: z.number(),
    dec_deg: z.number(),
    pixel: z.tuple([z.number(), z.number()]).nullable(),
  }),
  size_arcmin: z.tuple([z.number(), z.number()]).optional(), // [major, minor]
  distance: z.object({ value: z.number(), unit: z.string(), source: z.string() }).optional(),
  catalog_ids: z.record(z.string(), z.string()).default({}), // { messier:'M42', ngc:'NGC 1976' }
  confidence: z.number().min(0).max(1),
  features: z.array(
    z.object({
      id: z.string(),
      name: LocalizedString,
      feature_type: FeatureType,          // 受控词表(闭合 enum),见 §3,取代旧的自由字符串 taxonomy_key
      class: FeatureClass,                // 本实例实际定位级别(可能 ≠ taxonomy 默认级别)
      source: z.string(),                 // 'SIMBAD' | 'taxonomy' | 'BRC' | ...
      localization: z.object({
        method: z.enum(['world_to_pixel', 'anchor', 'none']),
        pixel: z.tuple([z.number(), z.number()]).nullable().default(null),
        anchor_ref: z.string().optional(),
        direction: z.string().optional(),
        confidence: z.number().min(0).max(1),
      }),
      needs_human_review: z.boolean(),
    }),
  ),
});

export const FactSheet = z.object({
  version: z.literal('1.0'),
  image: z.object({
    src: z.string(),
    width: z.number(),
    height: z.number(),
    hash: z.string(),                     // 缓存键
    band: z.enum(['broadband', 'narrowband', 'unknown']).default('unknown'),
    starless: z.boolean().default(false),
  }),
  solve: z.object({
    status: SolveStatus,
    ra_deg: z.number().optional(),
    dec_deg: z.number().optional(),
    radius_deg: z.number().optional(),
    pixscale_arcsec: z.number().optional(),
    orientation_deg: z.number().optional(),
    nova_job_id: z.string().optional(),
    frame: z.enum(['display', 'co-registered', 'none']), // WCS 对应哪张图的像素网格
    co_registration: z
      .object({ method: z.string(), rms_px: z.number().optional(), confidence: z.number().optional() })
      .optional(),
  }),
  objects: z.array(FactObject),
  warnings: z.array(z.string()).default([]),
  provenance: z.object({
    queries: z.array(z.string()),
    solver: z.string(),                   // 'nova.astrometry.net'
    timestamp: z.string().datetime(),
  }),
});
export type FactSheet = z.infer<typeof FactSheet>;
```

### 2.3 表现层 `Reading`（原 `Report` 演进，`schema/src/reading.ts`）

相对现有 schema 的改动：① `Report`→`Reading`；② 所有文本字段 `string`→`LocalizedString`；③ `language`→`display_language`；④ 新增 `source_factsheet` 链接 + 每个 feature 的 `fact_ref` + `needs_human_review`。`color_key` / `circle` / `badge` 等渲染必需字段**全部保留不动**。

```ts
export const Feature = z.object({
  id: z.string(),
  fact_ref: z.object({ object_id: z.string(), feature_id: z.string() }).nullable().default(null), // null=纯人工新增
  label: LocalizedString,                 // 默认来自 FactObject.feature.name,可人工改
  color_key: ColorKey,                    // 现有 9 键调色板,保留
  circle: Circle,                         // 来自 localization.pixel,可人工拖
  badge: Badge,
  explanation: LocalizedString,
  physics: LocalizedString.optional(),
  interesting: LocalizedString.optional(),
  needs_human_review: z.boolean().default(false), // B 类沿用,人工确认后清掉
});

export const Reading = z.object({
  version: z.literal('2.0'),
  source_factsheet: z.object({ hash: z.string() }), // 指回事实层
  image: z.object({ src: z.string(), width: z.number(), height: z.number() }),
  display_language: z.enum(['zh', 'en']).default('zh'),
  tone: z.string().optional(),            // tailoring 的 tone/audience
  object: z.object({                      // 海报用的少量摘要,denormalized 自 factsheet
    name: z.string(),
    type: LocalizedString,
    distance_ly: z.number().optional(),
    size_arcmin: z.number().optional(),
    constellation: z.string().optional(),
    stage: z.number().min(1).max(7).optional(),
  }),
  narrative: LocalizedString,
  features: z.array(Feature),
  extra_facts: z.array(LocalizedString).default([]),
  created_at: z.string().datetime(),
  edited_at: z.string().datetime().optional(),
  generator: z.object({
    tool: z.literal('astrolens'),
    tool_version: z.string(),
    llm: z.string(),
  }),
});
export type Reading = z.infer<typeof Reading>;
```

### 2.4 接缝（Stage 1 → Stage 2 怎么对接）

reader 拿到 `FactSheet`，对每个 **A / A+** 类 feature：

1. `localization.pixel` + `size_arcmin` → 算 `circle{cx,cy,r}`。
2. `feature_type` → `FEATURE_TAXONOMY[ft].default_color_key`（§3，确定性，不让 LLM 乱挑；reader/人工可覆盖）。
3. `name` → `label`（双语，可被 LLM 润色 / 人工改）。
4. LLM 按 `tone` 生成 `explanation` / `physics` / `interesting`（双语），**只能基于事实层，不得新增身份**。

**B-anchor / B-visual**：进表现层时 `needs_human_review=true`、`circle` 用占位（anchor 的方向中心或图心），等 editor 人工放圈。

> **实现现状注（2026-06）**：上面是 feature 粒度的接缝设计。实际 reader 走的是**对象级**——`buildReading` 直接 map `factsheet.objects`（不是 `object.features[]`），`color_key` 来自 `categoryColorKey(category)`（而非 `featureColorKey(feature_type)`），`label` 来自对象的友好名（专名 → M/NGC/IC → 恒星 designation → 类型词）。原因见 §4 step 5：当前每个目录对象 = 一个圈，`features[]` 恒空。等做 B 类（方案 B 变体）时，这条 feature 粒度接缝才会真正启用。

---

## 3 · 特征 taxonomy（`feature_type` enum + 注册表）

> 取代原先的自由字符串 `taxonomy_key`。**source of truth = Notion**[可识别特征清单 + B 类提准方法](https://app.notion.com/p/386040fe94c881baa377ff1a2f473697)（Part 3 按星体类型的特征表）；代码这边镜像成一张注册表，enum 由其 key 派生，避免漂移。
> ⚠ 下表是**候选池**，级别判断需 Amy 逐类核对（Notion 页 Part 1 注：分级是工程判断，最终她拍板）；MVP 先吃满 A/A⁺，B 类占位。
>
> **实现现状注（2026-06）**：这张注册表已建（`schema/src/taxonomy.ts`），但当前**对象级**路径未用它——A 类对象的颜色走 `categoryColorKey(category)`、类型词走 `objectTypeLabel(otype)`（见 §4 step 5）。`FEATURE_TAXONOMY`/`feature_type`/`featureColorKey` 是**留给 B 类**的：方案 B 变体下，B 类条目用 `feature_type` 定颜色/分级、用 `parent_object_id` 记宿主。届时这张表才正式上线。

### 3.1 两个 enum

```ts
// 广义星体类别(决定哪套 feature 适用)
export const ObjectCategory = z.enum([
  'emission_nebula',     // 发射星云 / HII 区
  'planetary_nebula',    // 行星状星云
  'supernova_remnant',   // 超新星遗迹
  'reflection_nebula',   // 反射星云
  'dark_nebula',         // 暗星云 / 分子云
  'galaxy',              // 星系
  'globular_cluster',    // 球状星团
  'open_cluster',        // 疏散星团
  'star',                // 恒星 / 特殊星
  'comet',               // 彗星
]);

// 特征受控词表 —— enum 由注册表 §3.2 的 key 派生
export const FeatureType = z.enum([ /* §3.2 第一列全部 key */ ]);
```

### 3.2 `FEATURE_TAXONOMY` 注册表（每个 key 携带元数据）

`Record<FeatureType, { zh, en, default_class, default_color_key, catalogs[], applies_to: ObjectCategory[] }>`。下游确定性映射:`feature_type → default_color_key`(现有 9 键调色板,reader/人工可覆盖);`default_class` 是 taxonomy 缺省,实例真实 `class` 视有无目录命中而定。

| feature_type | zh / en | 默认 class | color_key | 目录 / 方法 |
| --- | --- | --- | --- | --- |
| `excitation_star` | 激发星 / Exciting star | A | `hot` | SIMBAD `O*` |
| `wr_star` | WR 星 / Wolf–Rayet star | A | `hot` | WR cat / SIMBAD `WR*` |
| `central_star` | 中心星(白矮星) / Central star | A | `hot` | SIMBAD |
| `illuminating_star` | 照亮星 / Illuminating star | A | `hot` | SIMBAD |
| `named_star` | 命名恒星 / Named star | A | `hot` | SIMBAD · HD/HIP/BSC |
| `carbon_star` | 碳星 / Carbon star | A | `star` | SIMBAD `C*` |
| `multiple_star` | 双星/聚星 / Multiple star | A | `star` | WDS |
| `member_star` | 著名成员星 / Notable member star | A | `hot` | SIMBAD |
| `supernova` | 超新星(暂现) / Supernova | A(时效) | `hot` | 当时 SN 坐标 |
| `embedded_cluster` | 嵌入星团 / Embedded cluster | A | `star` | OpC / SIMBAD `Cl*` |
| `cluster_core` | 星团核/核心聚度 / Cluster core | A | `star` | 中心坐标 |
| `galaxy_nucleus` | 星系核 / Galactic nucleus | A | `star` | 星系中心坐标 |
| `hh_jet` | HH 喷流 / Herbig–Haro jet | A | `shock` | SIMBAD `HH` |
| `ionization_front` | 电离锋面/bright rim / Ionization front | B-anchor | `front` | 锚激发星 / BRC 目录 |
| `ionization_layering` | 电离分层 / Ionization stratification | B-visual | `front` | 颜色区域(软线索) |
| `pillar` | 柱状/象鼻 / Pillar | B-visual | `pillar` | CV + 锚激发星 |
| `cometary_globule` | 彗状球状体 / Cometary globule | B-anchor | `pillar` | CG 目录 / 锚定 |
| `bok_globule` | Bok 球状体 / Bok globule | A⁺ | `dark` | Barnard / LDN / CB |
| `dark_cloud` | 命名暗云 / Dark cloud | A⁺ | `dark` | Barnard/LDN/CB/Sandqvist |
| `dust_lane` | 尘埃带/暗带 / Dust lane | A⁺ | `dark` | Barnard / LDN |
| `silhouette_shape` | 剪影形状(如马头) / Silhouette shape | B-visual | `dark` | 形态(负对比) |
| `pn_shell` | 行星状外壳/halo / PN shell | A⁺ | `shell` | 命名范围 / 形态 |
| `bubble_shell` | 气泡壳/星风壳 / Wind-blown shell | B-visual | `shell` | 形态 / 锚定 |
| `central_cavity` | 中央空腔/星风腔 / Central cavity | B-visual | `cavity` | 形态 |
| `ansae_flier` | ansae/FLIER / Ansae · FLIER | B-visual | `shock` | 形态(小) |
| `snr_filament` | 遗迹丝状 / SNR filament | B-visual | `shock` | CV(Frangi) |
| `emission_color_region` | OIII/Hα 结构区 / Emission color region | B-visual | `front` | 颜色区域(软线索) |
| `spiral_arm` | 旋臂 / Spiral arm | B-anchor | `bg` | CV 对数螺旋 / 锚核 |
| `galaxy_dust_lane` | 星系尘埃带 / Galaxy dust lane | B-visual | `dark` | 形态 |
| `hii_knot` | 内部 HII 区/恒星形成结 / HII knot | A⁺ | `front` | NGC + 坐标 |
| `companion_galaxy` | 伴星系 / Companion galaxy | A | `star` | NGC / IC |
| `tidal_tail` | 潮汐尾 / Tidal tail | B-anchor | `bg` | 锚连线方向 |
| `reflection_structure` | 蓝色/条纹结构 / Reflection structure | B-visual | `bg` | 形态 |
| `stellar_population` | 红巨星/蓝 HB 颜色 / Stellar population | B-visual | `star` | 颜色区域(软线索) |
| `comet_coma` | 核/coma / Coma | A(时效) | `hot` | JPL Horizons |
| `comet_tail` | 离子/尘埃尾 / Comet tail | B-anchor | `bg` | 锚核按方向 |

> 注:`object identity / 整体范围`(星云/星系/星团本身)不入 `features[]`,它就是 `FactObject` 本体(身份+ `category` + `catalog_ids`)。
> 注:`color_key` 只有 9 键、是表现层概念;结构类特征(spiral_arm/tidal_tail/reflection_structure)无天然对应,先给 best-fit 默认,reader/人工可覆盖。
> 注:落地为 `identify`(或 `schema`)里一个 `FEATURE_TAXONOMY` 常量 + 测试;`FeatureType` = `z.enum(keys)`;同时导出 `featureColorKey(ft)` 供 reader 映射。

---

## 4 · Pipeline（Stage 1 识别模块）

新 package `@astrolens/identify`（纯 TS，后台 service / job，不入前端）：

> **实现现状注（2026-06 更新）**：下列步骤已落地，但 3/4/5 与最初设计有出入——做的过程中按真实数据调整了，每条偏离后附一句「← 为什么」。状态：✅ 已做 / ❌ 未做。

0. **缓存检查（前置）** ✅：按 image hash 查缓存，命中则直接返回 factsheet，短路 1–6。
1. **Plate-solve（nova.astrometry.net REST）→ WCS** ✅。异步 `submit → poll → results`；nova 慢(30s–几分钟) → 后台 job + 轮询，不阻塞。
2. **视场几何** ✅：WCS → center RA/Dec、radius、pixscale、orientation。
3. **查目录（多源并行 + 合并去重）** ✅ — 较原设计扩写：
   - **SIMBAD TAP** 三条 region query 合并：① 有角尺寸的扩展天体（按 size 排序）② 亮星（V<阈值）③ **激发星（otype `WR*`，不设星等上限）**。
     - ← *为什么单独查激发星*：气泡/HII 区的中心激发星（如 SH2-308 的 WR 星 HD 50896）是关键天体，但它是点源（无 `galdim` → 被①漏）、又常比亮星阈值暗（V≈6.9 > 6 → 被②漏），所以必须按 otype 专门捞、且不卡星等。
   - **VizieR ASU**（原文档写"必要时补"，实测必须常备）：六个命名星云目录（Sharpless / RCW / vdB / Cederblad / Barnard / LDN）。
     - ← *为什么 VizieR 升为一等公民*：SIMBAD `basic` 表**不带弥散星云的角直径**——Sh2-308 的所有别名在 SIMBAD 里都解析到中心 WR 星、`galdim` 为空，星云本体查不出尺寸；命名星云的 extent 只能来自 VizieR 专门目录。用 ASU 服务是因为它替我们算好 J2000（`_RAJ2000`）并服务端做 cone search，省去自行 precess 老历元。
   - **合并去重 `composite`**：多源候选按 **ObjectCategory 同类**去重。
     - ← *为什么去重、为什么按类别*：同一星云常被多目录收录（Sh2-308≡RCW11）、近距双星会重（α Sco A/B），不去重会画两个圈；按**完整 category**（而非粗略"星云"一档）去重，才不会把同位置但不同性质的暗云 `MoC` 和发射星云 `HII` 错并。同组留 prestige 最高/更亮者为代表（故 α Sco A 胜过暗弱的 B——否则 B 会因 V=5.2 过不了显著度阈值而让 Antares 整个消失）。
4. **标注门 gate + 选择 select** ✅ — 较原设计多几条规则：
   - **门**：必须有可见光学对应物（drop radio / X 射线 / IR-only）；外加**边缘覆盖率剔除**——中心在画面外、绝大部分落到框外的大目标直接丢。
     - ← *为什么加覆盖率剔除*：中心刚好在画面外的大天体会画出一个绝大部分在图外的巨圈，没意义；但中心在框内、比视场还大的合法主角豁免。
   - **选择**：按 category 分别设**配额**（maxStars / Clusters / Nebulae / Galaxies），组内按显著度/亮度排序后各取前 N；**激发星（WR）无视星等一律保留**。
     - ← *为什么用分类配额而非单一 top-N*：单一显著度 top-N 会让大星云把亮星、星团全挤光；分类配额保证每类的"主体 + 主要结构"都留得下，得到一组均衡的标注。
5. **A 类落点 + 组装** ✅（对象级）/ **B 类形态识别 ❌（未做）**：
   - 现状：**每个 catalogued 对象 = 一个顶层 `FactObject` = 一个圈**（`world_to_pixel` 落点）；`FactObject.features[]` 暂时恒为空。
     - ← *为什么是对象级、而非原设计的"DSO 本体 + 内嵌 features[]"*：宽场 MVP 下，中心星/嵌入星团这类在画面里本就是独立可见的点，做成并列的顶层对象比物理嵌套更直观，也让 Stage 1 保持简单确定。原 §2.4/§3 的 feature 粒度 A/B 分流因此**当前未走**（`FEATURE_TAXONOMY`/`feature_type` 已建好但旁路，留给 B 类）。
   - **B 类挂载方案（已定：方案 B 变体）**：B 类形态特征（电离锋面 / 壳层 / 柱状 / 球状体…）也做成**顶层条目**，但带 `parent_object_id` 指回宿主对象，并复用 `feature_type`/taxonomy（颜色、分级走词表）。Facts 面板里单列一节，各自 `needs_human_review`。
     - ← *为什么这样挂*：B 类是"不确定"的形态推断层，不该跟 A 类确定的目录事实混在一张清单里；但它又**有根源、有归属**（只有发射星云周围才有电离锋面这类结构），所以用 `parent_object_id` + taxonomy 记住"属于谁、是什么类型"，而不强行物理嵌套——既不大改现有扁平结构，又没浪费 taxonomy。
6. **组装 `FactSheet`** + 缓存(按 image hash) ✅。

**复用而非重写**：现有 [reader/src/simbad.ts](packages/reader/src/simbad.ts) 是**按名查**(sim-id + ASCII)，新模块要**按区域查**(TAP/ADQL)。查询不同、`ofetch`/超时/绝不抛错/`pc→ly` 换算等模式可复用。识别模块建好后，reader 里的 by-name 富集要么并入 identify，要么留作 fallback。

---

## 5 · 关键规则 / Fallback

- **标注门**：catalogued 项必须有可见光学对应物才保留。
- **A/B 定位**：`A`/`A+`→精确 pixel；`B-anchor`→`anchor_ref`+`direction`，无 bbox；`B-visual`→`method=none`+`needs_human_review`。
- **每个 object/feature 带 `confidence` + `source`**。
- **Plate-solve 失败**：
  1. 有 `star_bearing_image` → 用它解，`frame='co-registered'`（见 §6）。**❌ 未实现（Phase 3）。**
  2. 否则有 `target_name` → 按名查目录，`solve.status='user_provided'`、`frame='none'`、无 pixel、全部 `needs_human_review`。**❌ 未实现**：现状是 solve 失败即返回空 factsheet + 一条 warning（identify.ts 里明写 "name-only catalog resolution is not yet implemented"），并不按名兜底。
  3. 都没有 → `status='failed'`、`objects=[]`、加 warning。**绝不编造身份。** ✅
- **无目录匹配**：`objects=[]` + warning。 ✅

---

## 6 · Co-registration（双图共配准）— 显式处理

WCS 只对喂 nova 的那张图的像素网格成立。展示图若是抽星/裁切/旋转过的成片，坐标投不准。处理策略分阶段：

- **MVP（Phase 1）**：**约束「解像的图 = 展示图」**，`frame='display'`，WCS 1:1 通用，绕开配准。解不出就走 §5 fallback，A 类落点降级 `needs_human_review`。
- **Phase 3**：支持 `star_bearing_image`，做 A→B 几何对齐(affine/homography)，`frame='co-registered'`，记 `co_registration.rms_px`/`confidence`；对齐不可靠则降级人工。

---

## 6.5 · UI / 触发集成（job + 轮询 + factsheet 查看）

> 识别是 headless 后台模块,但**从现有 studio UI 触发,不另起 UI**。算力在 editor server,触发在 Home 创建流。现状:Home 创建 → `POST /api/projects`([server.ts:112](packages/editor/src/server.ts))**阻塞**调 `generateReport`。

**触发流 — `POST /api/projects` 改 job + 轮询**(nova 解像 30s–几分钟,不能阻塞):

```
POST /api/projects              上传图(+可选 target_name / star_bearing_image)
  → 建项目目录, 起后台 job, 立即返回 { slug, jobId }
GET  /api/projects/:slug/job    → { state, stage, warnings }   ← Home 轮询
     state: queued | running | done | failed
     stage: solving | querying | gating | reading   (映射 pipeline 阶段, 可显示 "Plate-solving…")
job 完成 → factsheet.json + reading.json 落盘 → Home 跳 Editor
```

job 状态持久化成项目目录里的 `job.json`(本地单用户,重启可恢复)。

**factsheet 查看 — 不用手开 json:**

- 新 `GET /api/projects/:slug/factsheet` → 返回 factsheet.json。
- **Editor 加一个只读「Facts / 事实」面板**:展示 `solve`(status / ra-dec / pixscale / frame)、`objects` 表(role / names / type zh-en / confidence / distance / catalog_ids)、`features`(name zh-en / feature_type / class / confidence / source / needs_human_review / localization)、`warnings`、`provenance`。**只读**——编辑只发生在 reading 层;Facts 是它接地的依据,正好服务 human-in-the-loop 审核。
- **Home 项目卡**显示摘要 chip:solve 状态 / object 数 / needs_review 数 / 有无 warning。一眼知道这次识别成没成、要不要人工介入。

---

## 7 · 改动范围（blast radius，已接地）

| package | 改动 | 量级 |
| --- | --- | --- |
| **identify**（新增） | nova 客户端 + 目录 TAP 客户端 + taxonomy + factsheet 组装 + 缓存 | 净新增最大 |
| **schema** | 拆 `factsheet.ts` + `reading.ts` + `i18n.ts`；`Report`→`Reading`；全面双语；版本 2.0 | 中大 |
| **reader** | 改为消费 `FactSheet`；prompt 重写(只 tailor + 双语输出、停止自找身份)；simbad 重构/迁移 | 中 |
| **editor** | 双语输入(每字段 zh/en)；B 类 review gate；读 `reading.json`；**`POST /api/projects` 改 job+轮询**；新增 `GET .../job`、`GET .../factsheet`；Home 加 job 状态卡、Editor 加只读 Facts 面板(见 §6.5) | 中→中大 |
| **renderer** | 按 `display_language` 渲染双语；`Report`→`Reading` | 中 |
| **viewer** | 双语显示(`Reading.tsx` 已在)；`Report`→`Reading` | 中 |
| **cli** | 编排两段 + nova 轮询 + image-hash 缓存；`report.json`→`reading.json` | 中 |
| **identify-eval**（新增） | standalone package：跑 `identify` → factsheet，对 golden set 算 scorecard + overlay 图；含 CV 星点检测/绘图/统计等 eval-only deps | 新增（leaf，见 §9.5） |

`report.json` 字面量出现在 cli(read/render/edit)与 editor server；`Report` 类型遍布 reader/renderer/cli/schema/viewer/editor —— 改名是机械但面广的一刀。

---

## 8 · 分阶段交付

- **Phase 0 — 锁接缝 ✅ 已完成**：`i18n.ts`(`LocalizedString`)+ `factsheet.ts` + `taxonomy.ts`(`FEATURE_TAXONOMY` 36 条 + `FeatureType`/`ObjectCategory`)+ `reading.ts`(`Report`→`Reading`、全字段双语、bump **2.0**);`ColorKey` 移入 `colorKeys.ts` 断循环依赖;`report.json`→`reading.json` 全链路改名;`factsheet.example.json` fixture;新增测试钉住 enum↔registry 一致性 + 双语。reader 用 **stop-gap**:仍出单语,组装时镜像进 `{zh,en}`,Phase 1 reader 消费 factsheet 时改真双语。全 monorepo tsc/test/lint/client-bundles 全绿。
- **Phase 1 — MVP / A 类跑通 🟡 核心已落地**：`@astrolens/identify`(TAN `world_to_pixel`、otype→taxonomy gate、significance 排序、`assembleFactSheet`、注入式 nova/SIMBAD client)+ 离线测试(WCS round-trip / gate / A 类落点 / fallback);reader 改成 `generateReading(factsheet)`(LLM 只 tailor 双语,不再找身份);`astrolens identify`(只出 factsheet)与 `astrolens read`(全流程)命令;editor `POST /api/projects` 改 identify→reader(**仍阻塞,job+轮询见下 §6.5 待做**)。全 tsc/test/lint/bundle 绿。**未在本环境验证**:nova/SIMBAD HTTP(需 key+网络)、nova orientation/parity→WCS 约定(待 identify-eval star self-check)、LLM tailoring 质量。剩余:`POST /api/projects` 的 job+轮询(§6.5)、Editor Facts 面板、`identify-eval`(§9.5)。
- **Phase 1d — job+轮询 + Facts 查看 ✅ 已完成**：`POST /api/projects` 改后台 job(`job.json` 持久化)+ `GET .../job`、`GET .../factsheet`;Home 轮询 + stage 文案 + 项目卡 solve/needs_review chip;Editor 只读 **Facts 面板**(toolbar 切换)。全 tsc/test/eslint/client-bundle/client-typecheck 绿。
- **Phase 2 — 人机闸门 + 渲染双语 ✅ 基本完成**：editor 双语 ✅ + renderer/viewer 双语 ✅(0c);Facts 面板 ✅(1d);**B 类 review gate ✅**(feature card 上 `confirmFeature` 清除 `needs_human_review`)。**剩**:`identify-eval` golden set + scorecard(档 2,需真实 nova 数据)。
- **Phase 3 — 以后**：starless 的 co-registration、click-to-anchor 灌 `user_anchors`、B 类提准；`identify-eval` 出 instrumentation 指标喂论文 Results。

---

## 9 · 已定的实现决策（可否决）

- 语言：**纯 TS**，直连 SIMBAD/VizieR TAP（ADQL over HTTP，复用 `ofetch`），不挂 Python sidecar。
- 落盘：事实层与表现层**两个文件**（`factsheet.json` + `reading.json`）。
- 双语：`LocalizedString={zh,en}`，两种始终都填，viewer 用 `display_language` 选默认。
- 版本：`Reading` bump 到 `2.0`，`FactSheet` 从 `1.0` 起。

---

## 9.5 · 验证与评测（Validation）

> **落地为 standalone package `@astrolens/identify-eval`**(leaf,依赖 `identify` + `schema`;eval-only deps 隔离,不进 cli)——本节是「程序」,不只是方法。输入:image corpus + `answer_key.yaml`(golden set);输出:`scorecard.json`(指标)+ overlay 图(visual diff)。
> 关键前提:识别阶段**基本是确定性的**(plate-solve + 查目录,无 LLM 随机性)→ 该像普通软件那样可量化、可回归、可自动化地验证。按「不用手工标注 → 一次性标注 → 安全性」分三档。
>
> ⚠ 区分两件事:① **tests**(record-replay fixtures + 单元)住在 `identify` 包,`pnpm test` 跑;② **eval harness**(下面这个 program,出 scorecard + 论文指标)= `@astrolens/identify-eval`。

**档 1 · 自带 ground truth,零手工标注(先做)**
- **星点自证(落点精度金标准)**:星点检测质心 vs `world_to_pixel(目录坐标)` 预测像素 → 距离分布 = A 类落点误差(px/arcsec),全自动、端到端。
- **FITS 头自证**:原始校准帧多带 WCS;nova WCS 对比头 WCS → center/pixscale/旋转误差,可批量跑图库。
- **nova 残差 + annotation**:残差当置信度;`objects_in_field` 当第二意见跟我方选择 diff。
- **跨目录一致性**:SIMBAD vs VizieR/NED 坐标一致即互证。

**档 2 · golden set + answer key → 自动 scorecard**
- 10–30 张覆盖每个 `ObjectCategory` + 难例,写 `answer_key.yaml`(target / 期望 primary / 关键 A 类特征 RA/Dec);harness `identify → factsheet` diff answer key 出 scorecard;手工只建一次。
- 顺手产 visual diff 物料(factsheet 像素叠原图 + 叠 nova annotation)。

**档 3 · 负例 / fallback(验证「绝不编造」)**
- 抽星图/噪声/非天文图 → 必须 `failed`/`user_provided`,绝不编造 objects;错 target_name → 能否发现矛盾;标注门负例 → X-ray/深源被 drop。

**工程落地 · record-replay**
- 可注入 solve/catalog client;金标集真实响应录成 fixture 回放 → 确定性回归、CI 不锤外部服务。纯单元:WCS 往返、taxonomy 映射、gate/rank/AB 分流(mock 响应)。

**指标(→ 论文 Results)**:plate-solve 成功率 · A 类落点中位/p90 误差(arcsec & px) · primary 召回率 · 目录命中数分布 · `needs_human_review` 比例 · 误身份率(应 ≈ 0)。

## 10 · 不在本模块范围

- LLM 解读 / tailoring 的具体 prompt 工程（属 Stage 2，消费本模块输出）。
- B 类提准的高级方法（几何先验 / 确定性检测 / 共识）—— 本期只到 anchor + visual 占位。
- click-to-anchor UI（Phase 3）。
