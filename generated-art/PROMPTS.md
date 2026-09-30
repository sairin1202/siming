# 角色与分享图生成记录

以下素材均使用 Codex 内置 ImageGen 生成。网站引用的最终素材位于 `prototype/public/characters/` 和 `prototype/public/og.jpg`，本目录保留素材与生成记录。背景和分享图已转换为 JPG，角色立绘保留透明 PNG；以下提示词保留生成时的原始要求。

## 天使五态立绘

文件：`yes-angel-five-state-sheet-transparent.png`

```text
Use case: stylized-concept
Asset type: game/UI character state sheet for a website/game prototype
Primary request: Create one cohesive character state sheet featuring an original “Yes” angel character in a neo-Tarot × polished anime cel-shaded visual style.
Scene/backdrop: No scene or backdrop. Output a genuinely transparent background with a clean alpha channel around every silhouette and translucent wing edge.
Subject: One androgynous young adult angel character with elegant slender proportions, an ivory and pale-gold modern short cloak, a geometric floating halo, translucent glass-like wings, and a warm but decisive demeanor. This must be the same exact character in every pose: identical face, hair, costume design, halo design, wing design, body proportions, palette, and rendering treatment.
Style/medium: Premium 2D game concept art; neo-Tarot graphic elegance fused with polished anime cel shading; crisp controlled contours, refined shape language, tasteful pale-gold detailing, subtle glass refraction in the wings, production-ready UI asset.
Composition/framing: A single wide landscape state sheet containing exactly five separate full-body poses arranged left-to-right in this order: 1) idle — neutral open stance; 2) speaking — leaning forward slightly with one hand extended persuasively; 3) listening — attentive gaze turned inward; 4) victory — confident, restrained celebration; 5) defeat — composed, accepting posture. Every figure must be fully visible from halo to feet, at a consistent scale and baseline, with generous transparent spacing between poses. No pose may touch or overlap another pose.
Lighting/mood: Luminous warm-gold rim light; serene, elegant, warm, assured, and decisive.
Color palette: Ivory, pale gold, soft warm-white, restrained amber highlights, subtly iridescent transparent wings.
Materials/textures: Smooth tailored cloth, delicate metallic gold accents, translucent glass-like wings with crisp alpha-preserved edges.
Text: None.
Constraints: Exactly five poses and no extra figures. Genuine transparent RGBA background, not white, gray, checkerboard, gradient, or painted transparency. Preserve translucency in the glass-like wings while keeping the overall canvas alpha transparent. All body parts, halos, wings, hands, and feet fully visible. No cropped anatomy. No overlapping poses. No labels, captions, text, letters, numbers, symbols, pose dividers, borders, cards, frames, scenery, props, logos, signatures, or watermarks. No religious realism or photorealism. No extra characters, animals, or decorative entities.
```

## 恶魔五态立绘

最终采用文件：`no-devil-neo-tarot-five-state-sheet.png`

```text
Use case: stylized-concept
Asset type: game/UI character state sheet for a website/game prototype
Primary request: Create one cohesive transparent-background character state sheet featuring an original “No” devil character in a neo-Tarot × polished anime cel-shaded style.
Scene/backdrop: No scene or backdrop; genuinely transparent canvas with a preserved alpha channel.
Subject: One androgynous young-adult character with elegant slender proportions, small obsidian horns, and a perceptive, restrained demeanor rather than an evil demeanor. Costume is identical in every pose: a sharply tailored long coat in black and deep wine red with restrained antique-gold accents, shaped so the coat and cloak form a subtle wing-like silhouette.
Style/medium: Premium 2D game concept art; neo-Tarot visual elegance blended with polished anime cel shading; crisp clean silhouette, controlled linework, refined fabric folds, consistent facial design, costume construction, proportions, palette, and rendering across all five poses.
Composition/framing: One wide character state sheet containing exactly five separate full-body poses arranged left-to-right with generous transparent spacing. Every figure is fully visible from horn tips to footwear, with comfortable clear margin around all extremities. No poses overlap. Same exact character, costume, face, hairstyle, horns, body proportions, scale, and rendering in every pose. Pose 1 idle: closed analytical stance. Pose 2 speaking: slight forward angle with a precise questioning hand gesture. Pose 3 listening: cool attentive inward gaze. Pose 4 victory: confident but restrained triumph. Pose 5 defeat: composed, accepting posture.
Lighting/mood: Deep wine-red rim light with subtle dark-gold highlights; elegant, cool, perceptive, poised, restrained.
Color palette: Black, deep wine red, obsidian, and sparing antique gold.
Constraints: Output must have a genuinely transparent background/alpha. Exactly five full-body depictions of the same single character state, no additional people or creatures. All body parts, coat tails, cloak edges, horns, hands, and footwear fully visible. Keep generous spacing and no overlap.
Avoid: labels, captions, text, letters, symbols, borders, frames, cards, scenery, ground shadows that imply a background, logos, signatures, watermark, horror, gore, grotesque features, monstrous anatomy, overt aggression, exaggerated evil expression, extra limbs, cropped anatomy, inconsistent costumes, inconsistent proportions, or extra characters.
```

`no-devil-neo-tarot-five-state-sheet-v2.png` 是一次背景清理实验，生成器将棋盘格烘焙进了 RGB 图像，因此它仅作为被拒绝的迭代存档，网站没有引用它。

## 社交分享图

文件：`angel-devil-og-social-preview.jpg`

```text
Use case: ads-marketing / stylized-concept
Asset type: Open Graph social preview card, wide 1.91:1 landscape.
Primary request: Create one cohesive premium branded social preview for an original “Angel & Devil” decision game. Show an original ivory-and-pale-gold angel on the left and an original black-and-wine-red devil on the right, both poised, elegant, non-aggressive, and facing inward across a luminous decision card at the exact visual center. The two characters should frame rather than overpower the copy.
Scene/backdrop: Deep indigo-black atmospheric background with subtle arcane geometry, faint star-dust, and a restrained ceremonial frame motif; keep the background clean and uncluttered. The luminous decision card forms the central axis and emits a soft warm-gold glow.
Style/medium: Premium neo-Tarot × polished anime cel-shaded illustration, editorial key art, crisp silhouettes, sophisticated linework, subtle foil-like gold accents, luxurious production finish, refined restrained drama.
Composition/framing: Wide 1.91:1 landscape. Symmetrical, balanced left-versus-right composition with the angel on the left and devil on the right, both shown approximately waist-up and turned inward. Reserve a calm, high-contrast central title zone over or just in front of the luminous decision card. Preserve generous safe margins suitable for Open Graph cropping.
Lighting/mood: Warm-gold rim light on the angel; wine-red rim light on the devil; soft central glow blending the two sides. Mysterious, intelligent, inviting, emotionally poised—not combative.
Color palette: Deep indigo-black, ivory, pale gold, black, wine red, with restrained luminous highlights.
Typography and exact visible text: Render exactly “ANGEL & DEVIL” once as a large centered high-contrast serif title, and “让两个声音，把犹豫说清楚。” once beneath it in clean Chinese typography.
Constraints: No other words, logos, marks, signatures, watermarks, credentials, private data, weapons, horror, gore, religious realism, clutter, duplicated characters, or duplicated cards.
```
