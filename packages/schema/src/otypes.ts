/**
 * Human-readable glosses for SIMBAD `otype` codes (and the synthetic ones our
 * VizieR client uses). The raw codes (`s*r`, `MoC`, `bC*`) are opaque to anyone
 * who isn't a SIMBAD regular, so the UI shows the gloss alongside the code.
 *
 * Not exhaustive — covers the categories the identify stage surfaces. Source of
 * truth for the full list is SIMBAD's object-type dictionary.
 */

export interface OtypeLabel {
  zh: string;
  en: string;
}

const OTYPE_LABELS: Record<string, OtypeLabel> = {
  // Nebulae & interstellar gas
  HII: { zh: '电离氢区(发射星云)', en: 'H II region (emission nebula)' },
  EmO: { zh: '发射天体', en: 'Emission object' },
  GNe: { zh: '银河星云', en: 'Galactic nebula' },
  RNe: { zh: '反射星云', en: 'Reflection nebula' },
  DNe: { zh: '暗星云', en: 'Dark nebula' },
  MoC: { zh: '分子云', en: 'Molecular cloud' },
  Cld: { zh: '星际云', en: 'Cloud' },
  glb: { zh: '球状体(博克球)', en: 'Globule (Bok globule)' },
  ISM: { zh: '星际介质', en: 'Interstellar matter' },
  HVC: { zh: '高速云', en: 'High-velocity cloud' },
  PN: { zh: '行星状星云', en: 'Planetary nebula' },
  SNR: { zh: '超新星遗迹', en: 'Supernova remnant' },
  bub: { zh: '气泡 / 星风泡', en: 'Bubble' },
  sh: { zh: '星际壳层', en: 'Interstellar shell' },

  // Clusters & associations
  GlC: { zh: '球状星团', en: 'Globular cluster' },
  OpC: { zh: '疏散星团', en: 'Open cluster' },
  'Cl*': { zh: '星团', en: 'Star cluster' },
  'As*': { zh: '星协', en: 'Stellar association' },
  MGr: { zh: '移动星群', en: 'Moving group' },

  // Galaxies & systems of galaxies
  G: { zh: '星系', en: 'Galaxy' },
  GiG: { zh: '星系群中星系', en: 'Galaxy in a group' },
  GiC: { zh: '星系团中星系', en: 'Galaxy in a cluster' },
  GiP: { zh: '星系对中星系', en: 'Galaxy in a pair' },
  IG: { zh: '相互作用星系', en: 'Interacting galaxy' },
  AGN: { zh: '活动星系核', en: 'Active galactic nucleus' },
  Sy1: { zh: '赛弗特 1 型星系', en: 'Seyfert 1 galaxy' },
  Sy2: { zh: '赛弗特 2 型星系', en: 'Seyfert 2 galaxy' },
  SBG: { zh: '星暴星系', en: 'Starburst galaxy' },
  EmG: { zh: '发射线星系', en: 'Emission-line galaxy' },
  H2G: { zh: 'HII 星系', en: 'H II galaxy' },
  rG: { zh: '射电星系', en: 'Radio galaxy' },
  LSB: { zh: '低面亮度星系', en: 'Low-surface-brightness galaxy' },
  GrG: { zh: '星系群', en: 'Group of galaxies' },
  ClG: { zh: '星系团', en: 'Cluster of galaxies' },

  // Stars — generic & evolved
  '*': { zh: '恒星', en: 'Star' },
  Star: { zh: '恒星', en: 'Star' },
  'V*': { zh: '变星', en: 'Variable star' },
  'PM*': { zh: '高自行星', en: 'High-proper-motion star' },
  'Pe*': { zh: '特殊星', en: 'Peculiar star' },
  'HB*': { zh: '水平分支星', en: 'Horizontal-branch star' },
  'RG*': { zh: '红巨星', en: 'Red giant' },
  'AGB*': { zh: '渐近巨星支星', en: 'AGB star' },
  'pA*': { zh: '后渐近巨星支星', en: 'Post-AGB star' },
  'WD*': { zh: '白矮星', en: 'White dwarf' },
  WD: { zh: '白矮星', en: 'White dwarf' },

  // Stars — supergiants & hot/massive
  's*r': { zh: '红超巨星', en: 'Red supergiant' },
  's*b': { zh: '蓝超巨星', en: 'Blue supergiant' },
  's*y': { zh: '黄超巨星', en: 'Yellow supergiant' },
  'sg*': { zh: '超巨星', en: 'Supergiant' },
  'WR*': { zh: '沃尔夫–拉叶星', en: 'Wolf–Rayet star' },
  'C*': { zh: '碳星', en: 'Carbon star' },
  'S*': { zh: 'S 型星', en: 'S star' },
  'bC*': { zh: '仙王座 β 型变星(蓝色脉动)', en: 'Beta Cephei variable' },
  'Be*': { zh: '发射线 B 型星', en: 'Be star' },
  'Em*': { zh: '发射线星', en: 'Emission-line star' },
  'BS*': { zh: '蓝离散星', en: 'Blue straggler' },

  // Stars — multiple & young
  '**': { zh: '双星 / 聚星', en: 'Double or multiple star' },
  'EB*': { zh: '食双星', en: 'Eclipsing binary' },
  'SB*': { zh: '分光双星', en: 'Spectroscopic binary' },
  'Y*O': { zh: 'young 恒星天体', en: 'Young stellar object' },
  'TT*': { zh: '金牛 T 型星', en: 'T Tauri star' },
  HH: { zh: 'Herbig–Haro 天体(喷流)', en: 'Herbig–Haro object' },
};

/**
 * Human-readable label for an otype code, or null if unknown. A trailing `?`
 * (SIMBAD "candidate") falls back to the base type.
 */
export function otypeLabel(code: string | undefined | null): OtypeLabel | null {
  if (!code) return null;
  const c = code.trim();
  if (OTYPE_LABELS[c]) return OTYPE_LABELS[c]!;
  if (c.endsWith('?')) {
    const base = OTYPE_LABELS[c.slice(0, -1).trim()];
    if (base) return { zh: `${base.zh}(候选)`, en: `${base.en} (cand.)` };
  }
  return null;
}
