export interface Preset {
  id: string;
  group: 'audience' | 'focus';
  labelZh: string;
  labelEn: string;
  /** Instruction appended to the prompt, in the report's content language. */
  textZh: string;
  textEn: string;
}

/** Quick-pick style presets, mirroring the prompt doc's "advanced usage". */
export const PRESETS: Preset[] = [
  {
    id: 'kids',
    group: 'audience',
    labelZh: '儿童',
    labelEn: 'Kids',
    textZh: '目标读者是 8-12 岁的孩子,用生动的语言、比喻和故事。',
    textEn: 'Target audience is 8-12 year olds; use vivid language, metaphors and stories.',
  },
  {
    id: 'expert',
    group: 'audience',
    labelZh: '资深爱好者',
    labelEn: 'Experienced',
    textZh: '目标读者是有几年经验的天文观测者,可以使用专业术语,但仍要解释机制。',
    textEn:
      'Target audience is observers with several years of experience; technical terms are OK but still explain the mechanisms.',
  },
  {
    id: 'humor',
    group: 'audience',
    labelZh: '轻松幽默',
    labelEn: 'Playful',
    textZh: '用轻松、幽默的语气,可以适当加入流行文化的梗。',
    textEn: 'Use a light, humorous tone; some pop-culture references are welcome.',
  },
  {
    id: 'art',
    group: 'focus',
    labelZh: '艺术摄影',
    labelEn: 'Artistic',
    textZh: '侧重这张图的艺术与摄影解读,而不仅仅是科学。',
    textEn: 'Focus on the artistic / photographic reading of the image, not just the science.',
  },
  {
    id: 'history',
    group: 'focus',
    labelZh: '观测史',
    labelEn: 'History',
    textZh: '侧重这个天体的观测史——谁发现的、怎么发现的。',
    textEn: 'Focus on the observational history of the object — who discovered it and how.',
  },
  {
    id: 'culture',
    group: 'focus',
    labelZh: '跨文化',
    labelEn: 'Cultures',
    textZh: '用不同文化的古代天文视角来解读这张图。',
    textEn: 'Read the image through the lens of ancient astronomy from different cultures.',
  },
];
