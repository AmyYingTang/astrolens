// The seed-atlas target pool — the backlog of objects worth annotating, shown on
// the tool's home so you can see at a glance what's covered and what isn't.
//
// IMPORTANT: this is static CONFIG, not data. Nothing here is written to
// atlas.json; the UI left-joins this list against the real entries (by
// normalized identity), so an un-annotated target simply shows 0. A target only
// enters atlas.json when you actually annotate and save it.
//
// `match` holds every identity string the identification pipeline might produce
// for the object (catalogue designations + common names), so the join lands
// regardless of which designation comes back. Add freely — matching is
// whitespace/case-insensitive.
//
// Not exhaustive: seed the frequent headline targets, then add lazily when a
// real image of an uncovered object shows up.

export type Hemisphere = 'north' | 'south' | 'equatorial';

export interface SeedTarget {
  /** Stable internal key (not the atlas identity). */
  key: string;
  name_en: string;
  name_zh: string;
  /** Identity strings to match against atlas entries (primary_id + aliases). */
  match: string[];
  hemisphere: Hemisphere;
  /** Object type, so you know what morphology to expect. */
  kind_en: string;
  kind_zh: string;
  /** Suggested feature types (keys from featureTypes.ts). */
  features: string[];
  /** One line: what's worth outlining / what's special about it. */
  note_en: string;
  note_zh: string;
}

export const SEED_TARGETS: readonly SeedTarget[] = [
  // ── Southern / equatorial emission nebulae ──────────────────────────────
  {
    key: 'ngc3372', name_en: 'Carina Nebula', name_zh: '船底座星云',
    match: ['NGC 3372', 'Carina Nebula', 'Caldwell 92', 'RCW 53'],
    hemisphere: 'south', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['pillar', 'bright_rim', 'silhouette', 'region'],
    note_en: 'The richest single field: Mystic Mountain pillar, the dark Keyhole silhouette, sculpted ionization fronts everywhere.',
    note_zh: '内容最丰富的一片:神秘山象鼻、锁孔暗形剪影、四处被雕蚀的电离锋面。',
  },
  {
    key: 'm16', name_en: 'Eagle Nebula', name_zh: '鹰状星云',
    match: ['M 16', 'M16', 'NGC 6611', 'Eagle Nebula', 'Messier 16'],
    hemisphere: 'south', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['pillar', 'bright_rim'],
    note_en: 'The Pillars of Creation — the canonical pillar target. Also the "Spire" off to the side.',
    note_zh: '创生之柱 —— 象鼻的标杆目标。旁边还有一根「尖塔」。',
  },
  {
    key: 'm8', name_en: 'Lagoon Nebula', name_zh: '礁湖星云',
    match: ['M 8', 'M8', 'NGC 6523', 'Lagoon Nebula', 'Messier 8'],
    hemisphere: 'south', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['bright_rim', 'region', 'globule'],
    note_en: 'The Hourglass is a tiny bright high-excitation core — worth a region callout. Dark Bok globules scattered across it.',
    note_zh: '沙漏是极小的高激发亮核 —— 值得单独圈一个区域。全图散布着暗的 Bok 球。',
  },
  {
    key: 'm20', name_en: 'Trifid Nebula', name_zh: '三叶星云',
    match: ['M 20', 'M20', 'NGC 6514', 'Trifid Nebula', 'Messier 20'],
    hemisphere: 'south', kind_en: 'Emission + reflection', kind_zh: '发射 + 反射星云',
    features: ['dust_lane', 'region'],
    note_en: 'The three-way dust lanes that split it are the whole point. Blue reflection lobe to the north is a separate region.',
    note_zh: '把它切成三瓣的尘埃暗带就是主角。北边那片蓝色反射区可单独圈。',
  },
  {
    key: 'ngc2237', name_en: 'Rosette Nebula', name_zh: '玫瑰星云',
    match: ['NGC 2237', 'NGC 2244', 'Rosette Nebula', 'Caldwell 49'],
    hemisphere: 'equatorial', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['pillar', 'globule', 'bright_rim'],
    note_en: 'Elephant-trunk pillars and dark globules ring the central cavity cleared by the cluster.',
    note_zh: '象鼻与暗球环绕着中心被星团吹空的腔;边缘一圈电离锋面。',
  },
  {
    key: 'ngc2264', name_en: 'Cone Nebula', name_zh: '锥状星云',
    match: ['NGC 2264', 'Cone Nebula', 'Christmas Tree Cluster'],
    hemisphere: 'equatorial', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['pillar', 'bright_rim'],
    note_en: 'One dominant cone-shaped pillar — an unusually clean single-feature target.',
    note_zh: '一根压倒性的锥形象鼻 —— 少见的「单特征」干净目标。',
  },
  {
    key: 'ngc6334', name_en: "Cat's Paw Nebula", name_zh: '猫掌星云',
    match: ['NGC 6334', "Cat's Paw Nebula", 'Bear Claw Nebula'],
    hemisphere: 'south', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['bright_rim', 'region'],
    note_en: 'The "toe beans" are separate bright emission lobes — each one a region.',
    note_zh: '几个「肉垫」是彼此分开的亮发射团 —— 每个圈成一个区域。',
  },
  {
    key: 'ngc6357', name_en: 'War and Peace Nebula', name_zh: '战争与和平星云',
    match: ['NGC 6357', 'War and Peace Nebula', 'Lobster Nebula'],
    hemisphere: 'south', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['bright_rim', 'region'],
    note_en: 'Bubble-like cavities carved by the Pismis 24 cluster; strong rims on the cavity walls.',
    note_zh: 'Pismis 24 星团吹出的泡状空腔;腔壁上的锋面很显著。',
  },
  {
    key: 'ngc3576', name_en: 'Statue of Liberty Nebula', name_zh: '自由女神星云',
    match: ['NGC 3576', 'Statue of Liberty Nebula', 'RCW 57'],
    hemisphere: 'south', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['pillar', 'filament'],
    note_en: 'The curled "arm" filaments give it its name. Old CV confused this with the Pencil — exactly what the atlas fixes.',
    note_zh: '卷曲的「手臂」丝状结构是它得名的原因。旧 CV 会把它和铅笔星云搞混 —— 正是 atlas 要救的场景。',
  },
  {
    key: 'ic4628', name_en: 'Prawn Nebula', name_zh: '对虾星云',
    match: ['IC 4628', 'Prawn Nebula', 'Gum 56'],
    hemisphere: 'south', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['bright_rim', 'globule'],
    note_en: 'Large faint HII with bright-rimmed clumps along the edges.',
    note_zh: '大而暗的 HII 区,边缘一串带亮缘的团块。',
  },
  {
    key: 'ic2944', name_en: 'Running Chicken Nebula', name_zh: '奔鸡星云',
    match: ['IC 2944', 'Running Chicken Nebula', 'Lambda Centauri Nebula'],
    hemisphere: 'south', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['globule', 'silhouette'],
    note_en: "Thackeray's Globules — small dark blobs silhouetted against the glow. The signature globule target.",
    note_zh: 'Thackeray 暗球 —— 逆光剪影的小暗块。暗球类的招牌目标。',
  },
  {
    key: 'ngc2070', name_en: 'Tarantula Nebula', name_zh: '蜘蛛星云',
    match: ['NGC 2070', 'Tarantula Nebula', '30 Doradus', 'Caldwell 103'],
    hemisphere: 'south', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['filament', 'region'],
    note_en: 'In the LMC. Filamentary "legs" radiating from the R136 super-cluster core.',
    note_zh: '位于大麦哲伦云。从 R136 超星团核心辐射出的丝状「腿」。',
  },

  // ── Dark nebulae ────────────────────────────────────────────────────────
  {
    key: 'b33', name_en: 'Horsehead Nebula', name_zh: '马头星云',
    match: ['Barnard 33', 'B 33', 'Horsehead Nebula', 'IC 434'],
    hemisphere: 'equatorial', kind_en: 'Dark nebula', kind_zh: '暗星云',
    features: ['silhouette', 'bright_rim'],
    note_en: 'The definitive silhouette. The IC 434 ridge behind it is a clean bright rim.',
    note_zh: '剪影的教科书。它背后 IC 434 的那道脊就是干净的电离亮缘。',
  },
  {
    key: 'coalsack', name_en: 'Coalsack Nebula', name_zh: '煤袋星云',
    match: ['Coalsack Nebula', 'Caldwell 99', 'Coalsack'],
    hemisphere: 'south', kind_en: 'Dark nebula', kind_zh: '暗星云',
    features: ['silhouette'],
    note_en: 'Huge naked-eye dark patch against the Milky Way — outline the lobes, not the whole blob.',
    note_zh: '银河上肉眼可见的巨大暗斑 —— 圈它的几个瓣,别整块圈。',
  },
  {
    key: 'pipe', name_en: 'Pipe Nebula', name_zh: '烟斗星云',
    match: ['Pipe Nebula', 'Barnard 59', 'B 59', 'LDN 1773'],
    hemisphere: 'south', kind_en: 'Dark nebula', kind_zh: '暗星云',
    features: ['silhouette'],
    note_en: 'Bowl and stem read as two separate silhouettes.',
    note_zh: '斗和杆可以当两条独立的剪影来标。',
  },
  {
    key: 'darkdoodad', name_en: 'Dark Doodad Nebula', name_zh: '暗黑涂鸦星云',
    match: ['Dark Doodad', 'Dark Doodad Nebula', 'TGU H1868', 'Sandqvist 149'],
    hemisphere: 'south', kind_en: 'Dark nebula', kind_zh: '暗星云',
    features: ['silhouette', 'filament'],
    note_en: 'A long thin dark filament — better drawn as a polyline than an area.',
    note_zh: '细长的暗丝 —— 用折线画比圈面积更贴切。',
  },

  // ── Supernova remnants ──────────────────────────────────────────────────
  {
    key: 'ngc2736', name_en: 'Pencil Nebula', name_zh: '铅笔星云',
    match: ['NGC 2736', 'Pencil Nebula', 'Herschel\'s Ray'],
    hemisphere: 'south', kind_en: 'Supernova remnant', kind_zh: '超新星遗迹',
    features: ['filament'],
    note_en: 'A shock front seen edge-on — one bright straight filament. Part of the Vela SNR.',
    note_zh: '侧看的激波锋面 —— 一条明亮笔直的丝。属于船帆座遗迹的一部分。',
  },
  {
    key: 'vela', name_en: 'Vela Supernova Remnant', name_zh: '船帆座超新星遗迹',
    match: ['Vela SNR', 'Vela Supernova Remnant', 'Gum 16'],
    hemisphere: 'south', kind_en: 'Supernova remnant', kind_zh: '超新星遗迹',
    features: ['filament'],
    note_en: 'Huge wide-field web of filaments — pick the few strongest strands, not all of them.',
    note_zh: '巨大的宽场丝网 —— 挑最强的几条画,别全画。',
  },

  // ── Planetary nebulae / shells (south) ──────────────────────────────────
  {
    key: 'ngc7293', name_en: 'Helix Nebula', name_zh: '螺旋星云',
    match: ['NGC 7293', 'Helix Nebula', 'Caldwell 63'],
    hemisphere: 'south', kind_en: 'Planetary nebula', kind_zh: '行星状星云',
    features: ['shell', 'region'],
    note_en: 'Two nested rings plus a faint outer halo. The radial "spokes"/cometary knots are a region callout.',
    note_zh: '两层嵌套的环 + 外围暗晕。放射状「辐条」/彗状结可作为区域标注。',
  },
  {
    key: 'homunculus', name_en: 'Homunculus Nebula (Eta Carinae)', name_zh: '侏儒星云(海山二)',
    match: ['Homunculus Nebula', 'Eta Carinae', 'eta Car', 'Homunculus'],
    hemisphere: 'south', kind_en: 'Ejecta nebula', kind_zh: '抛射星云',
    features: ['shell'],
    note_en: 'Tiny bipolar lobes from the 1840s eruption — inside Carina, needs a long focal length.',
    note_zh: '1840 年代大爆发抛出的双极小叶 —— 在船底座星云内部,要长焦才拍得到。',
  },

  // ── Galaxies (south) ────────────────────────────────────────────────────
  {
    key: 'ngc5128', name_en: 'Centaurus A', name_zh: '半人马座 A',
    match: ['NGC 5128', 'Centaurus A', 'Cen A', 'Caldwell 77'],
    hemisphere: 'south', kind_en: 'Galaxy (peculiar)', kind_zh: '星系(特殊)',
    features: ['dust_lane'],
    note_en: 'The single most dramatic dust lane in the sky, from a past merger.',
    note_zh: '全天最戏剧化的尘埃带,来自一次并合。',
  },
  {
    key: 'm83', name_en: 'Southern Pinwheel', name_zh: '南风车星系',
    match: ['M 83', 'M83', 'NGC 5236', 'Southern Pinwheel', 'Messier 83'],
    hemisphere: 'south', kind_en: 'Galaxy (barred spiral)', kind_zh: '星系(棒旋)',
    features: ['spiral_arm', 'region'],
    note_en: 'Well-defined arms plus pink HII knots strung along them.',
    note_zh: '旋臂界限清楚,臂上串着粉色的 HII 结。',
  },
  {
    key: 'm104', name_en: 'Sombrero Galaxy', name_zh: '草帽星系',
    match: ['M 104', 'M104', 'NGC 4594', 'Sombrero Galaxy', 'Messier 104'],
    hemisphere: 'equatorial', kind_en: 'Galaxy (edge-on)', kind_zh: '星系(侧向)',
    features: ['dust_lane'],
    note_en: 'One knife-sharp dust lane cutting the bulge — a very clean single feature.',
    note_zh: '一条刀锋般的尘埃带横切核球 —— 非常干净的单一特征。',
  },
  {
    key: 'antennae', name_en: 'Antennae Galaxies', name_zh: '触须星系',
    match: ['NGC 4038', 'NGC 4039', 'Antennae Galaxies', 'Caldwell 60'],
    hemisphere: 'equatorial', kind_en: 'Galaxy (merger)', kind_zh: '星系(并合)',
    features: ['tidal_tail'],
    note_en: 'The two long tidal tails need deep data — the "antennae" the name refers to.',
    note_zh: '两条长潮汐尾需要深曝光才出来 —— 正是「触须」的由来。',
  },

  // ── Northern emission nebulae ───────────────────────────────────────────
  {
    key: 'ngc7000', name_en: 'North America & Pelican', name_zh: '北美洲 + 鹈鹕星云',
    match: ['NGC 7000', 'IC 5070', 'North America Nebula', 'Pelican Nebula', 'Caldwell 20'],
    hemisphere: 'north', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['bright_rim', 'dust_lane'],
    note_en: 'The "Gulf of Mexico" coastline is one long bright rim; the dark lane between the two nebulae is the wall.',
    note_zh: '「墨西哥湾」海岸线就是一条长亮缘;两片星云之间的暗带是那堵墙。',
  },
  {
    key: 'ic1396', name_en: "Elephant's Trunk Nebula", name_zh: '象鼻星云',
    match: ['IC 1396', "Elephant's Trunk Nebula", 'IC 1396A'],
    hemisphere: 'north', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['pillar', 'bright_rim'],
    note_en: 'The trunk is a textbook bright-rimmed globule with a long tail.',
    note_zh: '那根「象鼻」是教科书式的带亮缘球状体 + 长尾。',
  },
  {
    key: 'ic1805', name_en: 'Heart & Soul Nebulae', name_zh: '心脏 + 灵魂星云',
    match: ['IC 1805', 'IC 1848', 'Heart Nebula', 'Soul Nebula'],
    hemisphere: 'north', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['pillar', 'bright_rim', 'globule'],
    note_en: 'Wide pair; the small pillars near the Heart\'s core ("Fish Head" area) are the interesting bits.',
    note_zh: '一对宽场目标;心脏核心附近(鱼头一带)的小象鼻是精华。',
  },
  {
    key: 'ngc1499', name_en: 'California Nebula', name_zh: '加州星云',
    match: ['NGC 1499', 'California Nebula'],
    hemisphere: 'north', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['bright_rim'],
    note_en: 'Long ridge ionized from one side by Xi Persei — mostly one big rim.',
    note_zh: '被英仙座 ξ 从一侧电离的长脊 —— 基本就是一道大亮缘。',
  },
  {
    key: 'ic405', name_en: 'Flaming Star & Tadpoles', name_zh: '火焰星 + 蝌蚪星云',
    match: ['IC 405', 'IC 410', 'Flaming Star Nebula', 'Tadpoles'],
    hemisphere: 'north', kind_en: 'Emission + reflection', kind_zh: '发射 + 反射星云',
    features: ['bright_rim', 'globule'],
    note_en: 'The two "tadpoles" in IC 410 are cometary globules with tails pointing away from the cluster.',
    note_zh: 'IC 410 里那两只「蝌蚪」是彗状球,尾巴背对星团。',
  },
  {
    key: 'ngc7380', name_en: 'Wizard Nebula', name_zh: '巫师星云',
    match: ['NGC 7380', 'Wizard Nebula', 'Sh2-142'],
    hemisphere: 'north', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['pillar', 'bright_rim'],
    note_en: 'Sculpted ridges and small pillars around the central cluster.',
    note_zh: '中心星团周围被雕出的脊和小象鼻。',
  },
  {
    key: 'sh2-155', name_en: 'Cave Nebula', name_zh: '洞穴星云',
    match: ['Sh2-155', 'Cave Nebula', 'Caldwell 9'],
    hemisphere: 'north', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['bright_rim'],
    note_en: 'The "cave" is a curved bright rim on a dark cloud edge.',
    note_zh: '那个「洞」其实是暗云边缘一道弧形亮缘。',
  },
  {
    key: 'ic5146', name_en: 'Cocoon Nebula', name_zh: '茧状星云',
    match: ['IC 5146', 'Cocoon Nebula', 'Caldwell 19'],
    hemisphere: 'north', kind_en: 'Emission + reflection', kind_zh: '发射 + 反射星云',
    features: ['dust_lane', 'region'],
    note_en: 'The long dark trail (B168) leading into the cocoon is as much the subject as the nebula.',
    note_zh: '通向茧的那条长暗带(B168)和星云本身一样是主角。',
  },
  {
    key: 'm42', name_en: 'Orion Nebula', name_zh: '猎户座大星云',
    match: ['M 42', 'M42', 'NGC 1976', 'Orion Nebula', 'Messier 42'],
    hemisphere: 'equatorial', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['bright_rim', 'region', 'dust_lane'],
    note_en: 'Visible from both hemispheres, so high-value. Trapezium cavity, the bright bar rim, and the dark "fish mouth" lane.',
    note_zh: '南北半球都能看,价值高。四边形空腔、明亮的 bar 锋面、以及「鱼嘴」暗带。',
  },

  // ── Shells / bubbles (north) ────────────────────────────────────────────
  {
    key: 'ngc6888', name_en: 'Crescent Nebula', name_zh: '新月星云',
    match: ['NGC 6888', 'Crescent Nebula', 'Caldwell 27'],
    hemisphere: 'north', kind_en: 'Wolf–Rayet bubble', kind_zh: '沃夫–瑞叶星风泡',
    features: ['shell'],
    note_en: 'A wind-blown shell around a WR star — the shell IS the object.',
    note_zh: 'WR 星吹出的壳 —— 这个壳就是天体本身。',
  },
  {
    key: 'ngc7635', name_en: 'Bubble Nebula', name_zh: '气泡星云',
    match: ['NGC 7635', 'Bubble Nebula', 'Caldwell 11'],
    hemisphere: 'north', kind_en: 'Emission nebula (HII)', kind_zh: '发射星云 (HII)',
    features: ['shell', 'bright_rim'],
    note_en: 'An almost perfectly round bubble offset inside a bigger cloud.',
    note_zh: '一个近乎完美的圆泡,偏心地嵌在更大的云里。',
  },

  // ── Supernova remnants (north) ──────────────────────────────────────────
  {
    key: 'veil', name_en: 'Veil Nebula', name_zh: '面纱星云',
    match: ['NGC 6960', 'NGC 6992', 'NGC 6995', 'Veil Nebula', 'Cygnus Loop', 'Caldwell 33', 'Caldwell 34'],
    hemisphere: 'north', kind_en: 'Supernova remnant', kind_zh: '超新星遗迹',
    features: ['filament'],
    note_en: 'The filament showcase — Western (Witch\'s Broom) and Eastern arcs plus Pickering\'s Triangle.',
    note_zh: '丝状结构的橱窗 —— 西侧(女巫扫帚)、东侧弧,还有 Pickering 三角。',
  },
  {
    key: 'm1', name_en: 'Crab Nebula', name_zh: '蟹状星云',
    match: ['M 1', 'M1', 'NGC 1952', 'Crab Nebula', 'Messier 1'],
    hemisphere: 'north', kind_en: 'Supernova remnant', kind_zh: '超新星遗迹',
    features: ['filament'],
    note_en: 'Small; the filamentary cage over the synchrotron interior needs a long focal length.',
    note_zh: '很小;包在同步辐射内体外的丝状「笼子」要长焦才分得出。',
  },
  {
    key: 'simeis147', name_en: 'Spaghetti Nebula', name_zh: '意大利面星云',
    match: ['Simeis 147', 'Sh2-240', 'Spaghetti Nebula'],
    hemisphere: 'north', kind_en: 'Supernova remnant', kind_zh: '超新星遗迹',
    features: ['filament'],
    note_en: 'Extremely faint tangle of filaments over a huge field — narrowband only.',
    note_zh: '极暗、极大的一团乱丝 —— 基本只有窄带拍得到。',
  },

  // ── Planetary nebulae (north) ───────────────────────────────────────────
  {
    key: 'm27', name_en: 'Dumbbell Nebula', name_zh: '哑铃星云',
    match: ['M 27', 'M27', 'NGC 6853', 'Dumbbell Nebula', 'Messier 27'],
    hemisphere: 'north', kind_en: 'Planetary nebula', kind_zh: '行星状星云',
    features: ['shell', 'region'],
    note_en: 'Bright bipolar lobes (the "apple core") plus a fainter round outer shell.',
    note_zh: '明亮的双极叶(「苹果核」)外面还有一层更暗的圆壳。',
  },
  {
    key: 'm57', name_en: 'Ring Nebula', name_zh: '环状星云',
    match: ['M 57', 'M57', 'NGC 6720', 'Ring Nebula', 'Messier 57'],
    hemisphere: 'north', kind_en: 'Planetary nebula', kind_zh: '行星状星云',
    features: ['shell'],
    note_en: 'The archetypal ring; deep data shows faint outer loops beyond it.',
    note_zh: '环状的原型;深曝光能拍到环外更暗的外圈。',
  },
  {
    key: 'ngc6543', name_en: "Cat's Eye Nebula", name_zh: '猫眼星云',
    match: ['NGC 6543', "Cat's Eye Nebula", 'Caldwell 6'],
    hemisphere: 'north', kind_en: 'Planetary nebula', kind_zh: '行星状星云',
    features: ['shell', 'region'],
    note_en: 'Tiny bright core with concentric shells, sitting in a large faint halo.',
    note_zh: '极小的亮核带同心壳层,外面套着一圈巨大的暗晕。',
  },
  {
    key: 'm97', name_en: 'Owl Nebula', name_zh: '猫头鹰星云',
    match: ['M 97', 'M97', 'NGC 3587', 'Owl Nebula', 'Messier 97'],
    hemisphere: 'north', kind_en: 'Planetary nebula', kind_zh: '行星状星云',
    features: ['shell', 'region'],
    note_en: 'The two dark "eyes" are cavities in the shell — a region callout each.',
    note_zh: '两只暗「眼睛」是壳里的空腔 —— 各圈一个区域。',
  },

  // ── Galaxies (north) ────────────────────────────────────────────────────
  {
    key: 'm31', name_en: 'Andromeda Galaxy', name_zh: '仙女座星系',
    match: ['M 31', 'M31', 'NGC 224', 'Andromeda Galaxy', 'Messier 31'],
    hemisphere: 'north', kind_en: 'Galaxy (spiral)', kind_zh: '星系(旋涡)',
    features: ['dust_lane', 'region'],
    note_en: 'Near edge-on, so the arms read as sweeping dust lanes. NGC 206 star cloud is a nice region.',
    note_zh: '接近侧向,所以旋臂主要表现为大幅尘埃暗带。NGC 206 星云可作区域标注。',
  },
  {
    key: 'm51', name_en: 'Whirlpool Galaxy', name_zh: '涡状星系',
    match: ['M 51', 'M51', 'NGC 5194', 'Whirlpool Galaxy', 'Messier 51'],
    hemisphere: 'north', kind_en: 'Galaxy (interacting)', kind_zh: '星系(相互作用)',
    features: ['spiral_arm', 'tidal_tail'],
    note_en: 'Textbook grand-design arms plus the bridge/tail to the companion NGC 5195.',
    note_zh: '教科书式的宏象旋臂,加上连向伴星系 NGC 5195 的桥/尾。',
  },
  {
    key: 'm81', name_en: 'Bode\'s & Cigar Galaxies', name_zh: '波德 + 雪茄星系',
    match: ['M 81', 'M81', 'M 82', 'M82', 'NGC 3031', 'NGC 3034', 'Bode\'s Galaxy', 'Cigar Galaxy'],
    hemisphere: 'north', kind_en: 'Galaxy pair', kind_zh: '星系对',
    features: ['spiral_arm', 'filament', 'region'],
    note_en: 'M81 for arms; M82 for the red Hα outflow blasting perpendicular out of the disc.',
    note_zh: 'M81 标旋臂;M82 标那股垂直于盘面喷出的红色 Hα 外流。',
  },
  {
    key: 'm101', name_en: 'Pinwheel Galaxy', name_zh: '风车星系',
    match: ['M 101', 'M101', 'NGC 5457', 'Pinwheel Galaxy', 'Messier 101'],
    hemisphere: 'north', kind_en: 'Galaxy (face-on spiral)', kind_zh: '星系(正向旋涡)',
    features: ['spiral_arm', 'region'],
    note_en: 'Face-on and asymmetric — arms are easy to trace, with big HII complexes on them.',
    note_zh: '正对我们且不对称 —— 旋臂好描,臂上有很大的 HII 复合体。',
  },
  {
    key: 'ngc891', name_en: 'NGC 891', name_zh: 'NGC 891',
    match: ['NGC 891', 'Caldwell 23'],
    hemisphere: 'north', kind_en: 'Galaxy (edge-on)', kind_zh: '星系(侧向)',
    features: ['dust_lane'],
    note_en: 'Perfectly edge-on with a razor dust lane — the classic edge-on demo.',
    note_zh: '完美侧向 + 刀刃般的尘埃带 —— 侧向星系的经典演示。',
  },
  {
    key: 'leotriplet', name_en: 'Leo Triplet', name_zh: '狮子座三重星系',
    match: ['M 66', 'M66', 'M 65', 'M65', 'NGC 3628', 'Leo Triplet'],
    hemisphere: 'north', kind_en: 'Galaxy group', kind_zh: '星系群',
    features: ['tidal_tail', 'dust_lane'],
    note_en: "NGC 3628's faint tidal tail is the prize; its dust lane is prominent too.",
    note_zh: 'NGC 3628 那条暗弱的潮汐尾是彩头;它的尘埃带也很显眼。',
  },
] as const;
