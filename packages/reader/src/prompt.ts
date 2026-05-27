export interface PromptOptions {
  imagePath: string; // absolute path; the model is told to read this file
  width: number;
  height: number;
  hint?: string;
  lang: 'zh' | 'en';
}

const COLOR_KEYS_ZH = `
color_key 必须是下列 9 个之一:
- hot:    明亮恒星 / 沃尔夫-拉叶星 / OB 星等电离源
- star:   一般恒星或星团
- front:  电离锋面
- shock:  激波(超新星遗迹)
- shell:  气泡壳层
- cavity: 中央空腔
- pillar: 柱状结构 / 正在蒸发的气体
- dark:   暗云 / 尘埃带
- bg:     未受扰动的背景 / 分子云`;

const COLOR_KEYS_EN = `
color_key must be exactly one of these 9 values:
- hot:    bright stars / Wolf-Rayet / OB ionizing sources
- star:   generic star or cluster
- front:  ionization front
- shock:  shock wave (supernova remnant)
- shell:  bubble shell
- cavity: central cavity
- pillar: pillar / evaporating gas
- dark:   dark cloud / dust band
- bg:     untouched background / molecular cloud`;

const SHAPE = `{
  "language": "zh" | "en",
  "object": {
    "name": string,                // 主标识 / primary identifier
    "aliases"?: string[],
    "type": string,                // e.g. "WR bubble", "Dark nebula"
    "stage"?: 1-7,                 // stellar lifecycle stage, only if confident
    "distance_ly"?: number,
    "size_arcmin"?: number,
    "constellation"?: string
  },
  "narrative": string,             // overall intro paragraph
  "features": [
    {
      "id": string,                // stable id like "f1", "f2"
      "label": string,             // short name
      "color_key": <one of the 9 keys above>,
      "circle": { "cx": number, "cy": number, "r": number },  // pixel coords
      "badge": { "num": string },  // "1", "2", ...
      "explanation": string,       // 2-3 sentences, plain language
      "physics"?: string,          // mechanism / formation
      "interesting"?: string       // trivia, cross-references
    }
  ],
  "extra_facts"?: string[]
}`;

function buildZh(opts: PromptOptions): string {
  const hintLine = opts.hint ? `用户提示:这张图是 ${opts.hint}。\n` : '';
  return `你是一位天文科普作者,正在为一张深空摄影作品写一份结构化的"读图报告"。

请先读取这张图片文件:${opts.imagePath}
图像尺寸:${opts.width} x ${opts.height} 像素(circle 坐标以像素为单位,原点在左上角)。
${hintLine}
仔细看图,然后只输出一个严格符合下方结构的 JSON 文档:
${SHAPE}
${COLOR_KEYS_ZH}

stage 是恒星/星云生命周期阶段(1-7),只有在你有把握时才填,否则省略。

要求:
1. 只输出 JSON,前后不要有任何说明文字,也不要用 markdown 围栏(\`\`\`)。
2. 所有文字使用中文。
3. 给出 3-6 个 feature。每个 explanation 写 2-3 句话,读者是有好奇心的天文爱好者。
4. circle 位置尽力而为即可,用户之后会在编辑器里微调,不需要精确。
5. 每个 feature 必须有唯一的 id(如 "f1")和 badge.num(如 "1")。
6. 如果你无法识别这是什么天体,在 narrative 里诚实说明,features 可以是空数组。`;
}

function buildEn(opts: PromptOptions): string {
  const hintLine = opts.hint ? `The user says this image is ${opts.hint}.\n` : '';
  return `You are an astronomy science writer producing a structured reading report for a deep-sky image.

First read this image file: ${opts.imagePath}
Image size: ${opts.width} x ${opts.height} pixels (circle coordinates are in pixels, origin at top-left).
${hintLine}
Look carefully, then output ONLY a single JSON document strictly matching this shape:
${SHAPE}
${COLOR_KEYS_EN}

stage is the stellar/nebula lifecycle stage (1-7); only include it when you are confident.

Requirements:
1. Output ONLY JSON. No preamble, no trailing prose, no markdown fences (\`\`\`).
2. All text in English.
3. Provide 3-6 features. Each explanation should be 2-3 sentences for a curious non-astronomer.
4. circle positions are best-effort; the user will fine-tune them later.
5. Every feature must have a unique id (e.g. "f1") and a badge.num (e.g. "1").
6. If you cannot identify the object, say so honestly in narrative; features may be an empty array.`;
}

export function buildReaderPrompt(opts: PromptOptions): string {
  return opts.lang === 'en' ? buildEn(opts) : buildZh(opts);
}
