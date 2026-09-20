// 4.0re design pass — a typographic, layered restyle of every surface.
//
// AUTHORING NOTE: bundle source, not a Node module — see panel.js.
//
// WHAT WAS WRONG
// --------------
// Rendering the real panel and looking at it (tools/preview.mjs) made the problem
// obvious in a way no assertion had: the panel was a WHITE CARD ON A WHITE PAGE with no
// elevation, every label sat between 10px and 11.5px so nothing had hierarchy, the
// primary action was a pale tinted pill that read as a disabled link, the usage bars
// were default-looking rectangles, and there was no depth anywhere. It was not ugly
// because of a bug; it was ugly because it had no design language.
//
// THE LANGUAGE THIS FILE ESTABLISHES
// ----------------------------------
// Editorial minimalism, in the shape the best modern developer tools use it:
//
//   * ONE warm-neutral surface ramp (canvas -> card -> raised), so a panel can sit ON a
//     page instead of blending into it. Warm grey rather than blue-grey: the host app's
//     own tints are bluish, and borrowing them made the panel look like a different app.
//   * ONE accent, at a single hue, used for exactly three things: the primary action,
//     selection, and "there is something to do". Everything else is neutral.
//   * A TYPE SCALE, not a set of sizes. 10.5 / 11.5 / 12.5 / 15 / 26, with tracking that
//     tightens as size grows and a tabular face for every number that can change.
//   * ELEVATION AS A SYSTEM. Three named shadows (raise / hover / overlay), each a stack
//     of two low-alpha layers rather than one dark blur. This is what makes the panel
//     read as a physical surface.
//   * BORDERS DO THE WORK. Hairlines are computed from the ink colour with `color-mix`,
//     so a border is always the right weight for the surface under it.
//
// WHY IT IS DATA
//   Same reason as polish.js: `DESIGN.length` is a provable count, `test/ui-design.mjs`
//   asserts every record reached the rendered sheet, and the next reader gets the intent
//   instead of a magic number. Records here deliberately SUPERSEDE the earlier polish
//   records for the same properties --- this block is inserted after it.

/**
 * Groups, for the per-group tally a reviewer reads.
 */
const DESIGN_GROUPS = Object.freeze([
  ['token', '设计令牌：色阶 / 强调色 / 语义色'],
  ['type', '字体与排版阶梯'],
  ['space', '间距节奏与密度'],
  ['depth', '层次与投影'],
  ['frame', '面板外框 / 标题栏 / 页脚'],
  ['hero', '首屏结论区'],
  ['stat', '统计格'],
  ['sec', '小节与小节头'],
  ['btn', '按钮与交互态'],
  ['card', 'skill 卡片与列表'],
  ['meta', '标签 / 徽章 / 进度条 / 分段控件'],
  ['time', '时间线'],
  ['toast', '状态条'],
  ['sheet', '安装面板与表单'],
  ['a11y', '可见性 / 动效 / 触摸'],
])

const D = (id, group, at, props, why, extra = {}) => ({ id, group, at, props, why, ...extra })

const DESIGN = Object.freeze([
  /* ============================ 1. tokens ============================ */
  D('color-canvas', 'token', '{root}', { '--sr-canvas': '#f7f7f8' },
    'the page the panel sits on: a warm near-white, so a white panel can be seen against it'),
  D('color-card', 'token', '{root}', { '--sr-card': '#ffffff' },
    'the panel surface itself, one deliberate step above the canvas'),
  D('color-raised', 'token', '{root}', { '--sr-raised': '#fbfbfc' },
    'cards and inputs: the smallest step, enough to separate without becoming a box'),
  D('color-sunken', 'token', '{root}', { '--sr-sunken': '#f2f2f4' },
    'tracks, wells and code: the only place that goes BELOW the surface'),
  D('color-fill', 'token', '{root}', { '--sr-fill': 'rgba(17,17,19,.045)' },
    'hover fills are neutral ink, not a grey with its own hue'),
  D('color-fill2', 'token', '{root}', { '--sr-fill2': 'rgba(17,17,19,.028)' },
    'the faintest wash, for large quiet areas'),
  D('color-line', 'token', '{root}', { '--sr-line': 'color-mix(in srgb, #111113 11%, transparent)' },
    'hairline derived from the ink colour, so it is the right weight on every surface'),
  D('color-line2', 'token', '{root}', { '--sr-line2': 'color-mix(in srgb, #111113 20%, transparent)' },
    'the stronger hairline, for hover edges and control borders'),
  D('color-ink', 'token', '{root}', { '--sr-fg': '#14151a' },
    'near-black with a trace of blue: pure #000 on white is harsher than it needs to be'),
  D('color-ink2', 'token', '{root}', { '--sr-fg2': '#5a5f6b' },
    'secondary text, readable at 11.5px rather than merely present'),
  D('color-ink3', 'token', '{root}', { '--sr-fg3': '#666c78' },
    'tertiary text clears AA (4.5:1) on the RAISED step too, not only on white: it is used for metadata inside cards, which is where it is actually read'),
  D('color-accent', 'token', '{root}', { '--sr-accent': '#4f46e5' },
    'indigo: distinct from the host\'s link blue, and the only saturated colour in the panel'),
  D('color-accent-ink', 'token', '{root}', { '--sr-accent-ink': '#ffffff' },
    'the ink that sits ON the accent, named so it is never guessed'),
  D('color-accent-weak', 'token', '{root}', { '--sr-accent-weak': 'color-mix(in srgb, var(--sr-accent) 11%, transparent)' },
    'tinted fills follow the accent automatically instead of being a second hardcoded rgba'),
  D('color-accent-line', 'token', '{root}', { '--sr-accent-line': 'color-mix(in srgb, var(--sr-accent) 34%, transparent)' },
    'the accent as a border weight, for selected and pending states'),
  D('color-danger', 'token', '{root}', { '--sr-danger': '#dc2626' },
    'a red that belongs to this palette rather than the host\'s error token'),
  D('color-danger-weak', 'token', '{root}', { '--sr-danger-weak': 'color-mix(in srgb, var(--sr-danger) 10%, transparent)' },
    'destructive fills, kept quiet: delete is available, not urgent'),
  D('color-ok', 'token', '{root}', { '--sr-ok': '#15803d' },
    'green dark enough to read as text at 10.5px on white (contrast, not taste)'),
  D('color-ok-weak', 'token', '{root}', { '--sr-ok-weak': 'color-mix(in srgb, var(--sr-ok) 10%, transparent)' },
    'success fills, same construction as the others'),
  D('color-warn', 'token', '{root}', { '--sr-warn': '#b45309' },
    'amber: the "no skill this turn" signal is informational and must not look like an error'),
  D('color-warn-weak', 'token', '{root}', { '--sr-warn-weak': 'color-mix(in srgb, var(--sr-warn) 11%, transparent)' },
    'its weak companion, for the chip the plugin exists to show'),
  D('color-scrim', 'token', '{root}', { '--sr-scrim': 'rgba(19,20,26,.34)' },
    'the modal scrim: dark enough to isolate, light enough to keep context'),

  /* ============================ 2. type ============================ */
  D('type-stack', 'type', '{root}', {
    '--sr-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    '--sr-mono': 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  }, 'named stacks: the fallback chain is a design decision (CJK faces matter here)'),
  D('type-body', 'type', '{root}', { fontFamily: 'var(--sr-sans)', fontSize: 12, lineHeight: 1.5 },
    'body text at 12px/1.5: one step up from the old 10px, and it is what makes the panel readable'),
  D('type-ratio', 'type', '{root}', {
    '--sr-t-xs': '10.5px',
    '--sr-t-sm': '11.5px',
    '--sr-t-md': '12.5px',
    '--sr-t-lg': '15px',
    '--sr-t-xl': '26px',
  }, 'five sizes, named: a scale makes "which size?" answerable instead of arbitrary'),
  D('type-track-tight', 'type', '{root}', { '--sr-track-tight': '-.014em' },
    'large text needs negative tracking; the default spacing looks loose above 14px'),
  D('type-track-normal', 'type', '{root}', { '--sr-track-normal': '0' },
    'named so the middle of the range is explicit rather than implied'),
  D('type-track-loose', 'type', '{root}', { '--sr-track-loose': '.055em' },
    'uppercase micro-labels need positive tracking to stay legible'),
  D('type-num', 'type', '{root}', { '--sr-num': 'tabular-nums' },
    'every number in this panel is live; proportional digits make them jitter while polling'),
  D('type-smoothing', 'type', '{root}', { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
    'at 11px the default subpixel rendering looks bolder than the host UI beside it'),

  /* ============================ 3. spacing ============================ */
  D('space-unit', 'space', '{root}', { '--sr-u': '4px' },
    'the 4px unit, named so every gap below is a multiple of it'),
  D('space-half', 'space', '{root}', { '--sr-u-half': '2px' },
    'the half step, for the few places 4px is too much (inside a pill, under a label)'),
  D('space-body-pad', 'space', '.sr-body', { paddingInline: 'calc(var(--sr-u) * 1)' },
    'a hair of inset so card shadows are not clipped by the panel edge'),
  D('space-sec-pad', 'space', '.sr-sec-b', { padding: 'calc(var(--sr-u) * 2.5) calc(var(--sr-u) * 4) calc(var(--sr-u) * 4)' },
    'sections get real padding: the old 6px/14px rhythm made every list look cramped'),
  D('space-grid-gap', 'space', '.sr-grid', { gap: 'calc(var(--sr-u) * 2.5)' },
    'cards need visible gutters, or the grid reads as a table'),
  D('space-hero-pad', 'space', '.sr-hero', { padding: 'calc(var(--sr-u) * 4) calc(var(--sr-u) * 4) calc(var(--sr-u) * 4) calc(var(--sr-u) * 4.5)' },
    'the hero is the first thing read and earns the most air'),
  D('space-head-pad', 'space', '.sr-head', { padding: 'calc(var(--sr-u) * 3) calc(var(--sr-u) * 4)' },
    'the header sets the panel\'s horizontal rhythm; everything else aligns to it'),
  D('space-foot-pad', 'space', '.sr-foot', { padding: 'calc(var(--sr-u) * 2.5) calc(var(--sr-u) * 4)' },
    'matches the header so the panel has one left edge top and bottom'),
  D('space-stats-pad', 'space', '.sr-stats', { padding: 'calc(var(--sr-u) * 1) calc(var(--sr-u) * 4) calc(var(--sr-u) * 3)' },
    'the stat row belongs to the hero above it more than to the sections below'),
  D('space-stats-gap', 'space', '.sr-stats', { gap: 'calc(var(--sr-u) * 2)' },
    'the gap must be visible, or four cells read as one striped block'),
  D('space-card-pad', 'space', '.sr-skill', { padding: 'calc(var(--sr-u) * 3) calc(var(--sr-u) * 3) calc(var(--sr-u) * 3) calc(var(--sr-u) * 3.5)' },
    'cards get 12px of padding: the difference between "dense" and "cramped"'),
  D('space-sheet-pad', 'space', '.sr-sheet-body', { padding: 'calc(var(--sr-u) * 5)' },
    'the modal is where a form lives; generous padding is what makes it look considered'),

  /* ============================ 4. depth ============================ */
  D('depth-raise', 'depth', '{root}', { '--sr-e1': '0 1px 1px rgba(19,20,26,.04), 0 2px 4px -2px rgba(19,20,26,.06)' },
    'elevation 1 is a STACK of two low-alpha layers; one dark blur reads as dirt, not depth'),
  D('depth-hover', 'depth', '{root}', { '--sr-e2': '0 2px 4px -1px rgba(19,20,26,.06), 0 8px 16px -8px rgba(19,20,26,.14)' },
    'elevation 2 is directional: it grows downward, the way a lifted object casts'),
  D('depth-overlay', 'depth', '{root}', { '--sr-e3': '0 4px 8px -2px rgba(19,20,26,.08), 0 24px 48px -16px rgba(19,20,26,.24)' },
    'elevation 3 is for the modal, which floats above everything and must say so'),
  D('depth-ring', 'depth', '{root}', { '--sr-ring': '0 0 0 1px color-mix(in srgb, #111113 7%, transparent)' },
    'a 1px ring as a shadow: it follows the border radius exactly, which a border cannot do on a hover state'),
  D('depth-accent-glow', 'depth', '{root}', { '--sr-glow': '0 1px 2px color-mix(in srgb, var(--sr-accent) 34%, transparent)' },
    'the accent button casts a coloured shadow; a neutral one makes a primary action look flat'),

  /* ============================ 5. frame ============================ */
  D('frame-radius', 'frame', '.sr-root', { borderRadius: 16 },
    '16px: large surfaces need a larger radius or they look like boxes with rounded corners'),
  D('frame-border', 'frame', '.sr-root', { borderColor: 'color-mix(in srgb, #111113 8%, transparent)' },
    'the frame hairline is lighter than a card border: the shadow does the separating'),
  D('frame-elevation', 'frame', '.sr-root', { boxShadow: 'var(--sr-ring), var(--sr-e1)' },
    'ring plus elevation: this is what puts the panel ON the page instead of in it'),
  D('frame-bg', 'frame', '.sr-root', { background: 'var(--sr-card)' },
    'explicit, because Canvas is a real value now and a transparent panel would show it'),
  D('frame-scroll-pad', 'frame', '.sr-root', { scrollPaddingTop: 'var(--sr-head-h)' },
    'so scrolling to a section does not park its heading under the sticky header'),
  D('frame-head-bg', 'frame', '.sr-head', { background: 'color-mix(in srgb, var(--sr-card) 86%, transparent)' },
    'a translucent header over a blur: the modern alternative to an opaque band'),
  D('frame-head-blur', 'frame', '.sr-head', { WebkitBackdropFilter: 'saturate(1.6) blur(10px)', backdropFilter: 'saturate(1.6) blur(10px)' },
    'saturate + blur keeps content behind the header legible as texture, not as text'),
  D('frame-head-border', 'frame', '.sr-head', { borderBottomColor: 'color-mix(in srgb, #111113 7%, transparent)' },
    'a lighter rule under a translucent band, to avoid a hard line across the panel'),
  D('frame-foot-bg', 'frame', '.sr-foot', { background: 'color-mix(in srgb, var(--sr-card) 90%, transparent)' },
    'the footer carries numbers, so it gets slightly more opacity than the header'),
  D('frame-foot-blur', 'frame', '.sr-foot', { WebkitBackdropFilter: 'saturate(1.6) blur(10px)', backdropFilter: 'saturate(1.6) blur(10px)' },
    'same treatment as the header; the two sticky bands must match'),
  D('frame-title-size', 'frame', '.sr-title', { fontSize: 13, fontWeight: 600, letterSpacing: '-.01em' },
    'the panel title is a heading and was set at 12.5px like a label'),
  D('frame-status-size', 'frame', '.sr-status', { fontSize: 10.5, letterSpacing: '.005em' },
    'the freshness readout is metadata and should be quiet but not microscopic'),
  D('frame-foot-size', 'frame', '.sr-foot', { fontSize: 10.5 },
    'one step up: 10px in a footer was unreadable at a glance'),
  D('frame-fade-t', 'frame', '.sr-fade--t', { height: 14, background: 'linear-gradient(var(--sr-card), color-mix(in srgb, var(--sr-card) 0%, transparent))' },
    'a taller fade that resolves to true transparency, so it works over the blurred header'),
  D('frame-fade-b', 'frame', '.sr-fade--b', { height: 14, background: 'linear-gradient(color-mix(in srgb, var(--sr-card) 0%, transparent), var(--sr-card))' },
    'and the matching bottom fade'),

  /* ============================ 6. hero ============================ */
  D('hero-surface', 'hero', '.sr-hero', { background: 'var(--sr-raised)' },
    'the conclusion gets its own surface: it is the answer the panel exists to give'),
  D('hero-border', 'hero', '.sr-hero', { borderColor: 'color-mix(in srgb, #111113 8%, transparent)' },
    'a lighter edge, because the fill already separates it'),
  D('hero-radius', 'hero', '.sr-hero', { borderRadius: 14 },
    'one step inside the frame radius, so corners nest concentrically'),
  D('hero-rail', 'hero', '.sr-hero:before', { width: 3, background: 'linear-gradient(var(--sr-accent), color-mix(in srgb, var(--sr-accent) 45%, transparent))' },
    'the accent rail graduates to transparent: a flat 3px bar reads as a rendering artifact'),
  D('hero-rail-inset', 'hero', '.sr-hero:before', { left: 0, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
    'clipped to the card radius so the rail never leaves the corner'),
  D('hero-meta-size', 'hero', '.sr-hero-meta', { fontSize: 10.5, letterSpacing: '.01em', color: 'var(--sr-fg3)' },
    'the timestamp line under the headline is metadata and should look like it'),
  D('hero-empty-size', 'hero', '.sr-hero-empty', { fontSize: 13, lineHeight: 1.45, color: 'var(--sr-fg2)' },
    'a sentence the user must actually read, not a 12px whisper'),
  D('hero-line-gap', 'hero', '.sr-hero-line', { gap: 'calc(var(--sr-u) * 1.5)' },
    'the skill chips wrap on a narrow panel and need consistent gutters'),

  /* ============================ 7. stats ============================ */
  D('stat-bg', 'stat', '.sr-stat', { background: 'var(--sr-card)' },
    'stat cells are cards, not filled rectangles: the raised fill made them look disabled'),
  D('stat-border', 'stat', '.sr-stat', { borderColor: 'color-mix(in srgb, #111113 9%, transparent)' },
    'a visible hairline, since the fill is now the same as the panel'),
  D('stat-radius', 'stat', '.sr-stat', { borderRadius: 12 },
    'smaller blocks take smaller radii; matching the hero would look inflated'),
  D('stat-pad', 'stat', '.sr-stat', { padding: 'calc(var(--sr-u) * 2.5) calc(var(--sr-u) * 3)' },
    'each cell needs room for a 26px number and a label beside it'),
  D('stat-shadow', 'stat', '.sr-stat', { boxShadow: 'var(--sr-e1)' },
    'the same elevation as a card, because that is what it is'),
  D('stat-hover', 'stat', '.sr-stat:hover', { boxShadow: 'var(--sr-e2)', transform: 'translateY(-1px)' },
    'the lift is what tells the user these are real cells rather than a progress bar'),
  D('stat-value-size', 'stat', '.sr-stat-v', { fontSize: 26, fontWeight: 650, letterSpacing: '-.03em', lineHeight: 1 },
    'a big tabular number: this is the single largest visual change, and the one that creates hierarchy'),
  D('stat-value-num', 'stat', '.sr-stat-v', { fontVariantNumeric: 'tabular-nums' },
    'so a counter going 9 -> 10 does not shift the cell'),
  D('stat-label-size', 'stat', '.sr-stat-l', { fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 550 },
    'micro-labels in caps are what make a big number read as a metric'),

  /* ============================ 8. sections ============================ */
  D('sec-rule', 'sec', '.sr-sec', { borderTopColor: 'color-mix(in srgb, #111113 7%, transparent)' },
    'section rules are the quietest line in the panel: structure, not content'),
  D('sec-head-pad', 'sec', '.sr-sec-h', { padding: 'calc(var(--sr-u) * 3) calc(var(--sr-u) * 4)' },
    'the header is a click target and needs a real row height'),
  D('sec-head-size', 'sec', '.sr-sec-h', { fontSize: 10.5, fontWeight: 700, letterSpacing: 'var(--sr-track-loose)' },
    'bold caps at 10.5px: the standard treatment for a section label that is not a heading'),
  D('sec-head-color', 'sec', '.sr-sec-h', { color: 'var(--sr-fg2)' },
    'ink2 rather than ink3: a section header is structure, and ink3 is for metadata'),
  D('sec-head-bg', 'sec', '.sr-sec-head', { background: 'color-mix(in srgb, var(--sr-card) 86%, transparent)' },
    'translucent, matching the main header it docks under'),
  D('sec-head-blur', 'sec', '.sr-sec-head', { WebkitBackdropFilter: 'blur(10px)', backdropFilter: 'blur(10px)' },
    'so a sticky section header never shows text sliding beneath it'),
  D('sec-hover-accent', 'sec', '.sr-sec-h:hover', { color: 'var(--sr-fg)', boxShadow: 'inset 2px 0 0 var(--sr-accent)' },
    'the inset accent bar marks WHICH section is hovered, and matches the hero rail language'),
  D('sec-pill-size', 'sec', '.sr-pill', { fontSize: 10, fontWeight: 600, minWidth: 22, lineHeight: '17px' },
    'a count chip is a number first: semibold and tabular, with a floor on the width'),
  D('sec-pill-bg', 'sec', '.sr-pill', { background: 'var(--sr-sunken)', color: 'var(--sr-fg2)' },
    'sunken rather than filled, so it reads as a counter attached to the label'),
  D('sec-caret-color', 'sec', '.sr-sec-caret', { color: 'var(--sr-fg3)' },
    'the caret is an affordance, not content'),
  D('sec-caret-size', 'sec', '.sr-sec-caret .sr-ic', { width: 11, height: 11 },
    'a smaller chevron than the body icons keeps it from competing with the label'),
  D('sec-actions-gap', 'sec', '.sr-sec-actions', { gap: 'calc(var(--sr-u) * 1.25)' },
    'the header action buttons need visible separation or they read as one control'),

  /* ============================ 9. buttons ============================ */
  D('btn-radius', 'btn', '.sr-btn', { borderRadius: 9 },
    '9px: pills are for chips. Buttons in a dense tool panel are rectangles with soft corners'),
  D('btn-height', 'btn', '.sr-btn', { lineHeight: '26px', paddingInline: 'calc(var(--sr-u) * 3)' },
    '26px tall: below that a button is not a comfortable click target'),
  D('btn-size', 'btn', '.sr-btn', { fontSize: 11.5, fontWeight: 550, letterSpacing: '.005em' },
    'one step up and slightly heavier than body: this is the fix for "buttons look like links"'),
  D('btn-border', 'btn', '.sr-btn', { borderColor: 'color-mix(in srgb, #111113 13%, transparent)' },
    'a control border must be visible against the raised fill it sits on'),
  D('btn-bg', 'btn', '.sr-btn', { background: 'var(--sr-card)' },
    'buttons are surfaces: transparent buttons on a card are indistinguishable from text'),
  D('btn-shadow', 'btn', '.sr-btn', { boxShadow: 'var(--sr-e1)' },
    'the same raise as every other interactive block'),
  D('btn-hover', 'btn', '.sr-btn:hover:not(:disabled)', { background: 'var(--sr-raised)', borderColor: 'var(--sr-line2)', boxShadow: 'var(--sr-e2)' },
    'hover raises elevation rather than only tinting'),
  D('btn-active', 'btn', '.sr-btn:active:not(:disabled)', { transform: 'translateY(1px)', boxShadow: 'none' },
    'pressing removes the elevation: the button lands on the page'),
  D('btn-disabled', 'btn', '.sr-btn:disabled', { opacity: 0.5, boxShadow: 'none' },
    'a disabled button has no elevation, because it cannot be pressed'),
  D('btn-primary-bg', 'btn', '.sr-btn--primary', { background: 'var(--sr-accent)', color: 'var(--sr-accent-ink)' },
    'the primary action is SOLID. A tinted pill read as a disabled link, which was the single worst thing on the card'),
  D('btn-primary-border', 'btn', '.sr-btn--primary', { borderColor: 'transparent' },
    'a solid button needs no border'),
  D('btn-primary-shadow', 'btn', '.sr-btn--primary', { boxShadow: 'var(--sr-glow)' },
    'and it casts a coloured shadow, so it sits above the surface it is on'),
  D('btn-primary-hover', 'btn', '.sr-btn--primary:hover:not(:disabled)', { background: 'color-mix(in srgb, var(--sr-accent) 88%, #000)', boxShadow: '0 2px 6px color-mix(in srgb, var(--sr-accent) 42%, transparent)' },
    'darker, not lighter: on a solid fill the hover must go down in value'),
  D('btn-primary-weight', 'btn', '.sr-btn--primary', { fontWeight: 600 },
    'the primary label is the strongest text in its row'),
  D('btn-danger-bg', 'btn', '.sr-btn--danger', { background: 'var(--sr-card)', color: 'var(--sr-danger)', borderColor: 'color-mix(in srgb, var(--sr-danger) 26%, transparent)' },
    'destructive is available, not alarming: its colour is in the ink and edge, not the fill'),
  D('btn-danger-hover', 'btn', '.sr-btn--danger:hover:not(:disabled)', { background: 'var(--sr-danger-weak)', borderColor: 'var(--sr-danger)' },
    'hover commits to the colour, which is the moment before a second click deletes'),
  D('btn-armed', 'btn', '.sr-btn--armed', { background: 'var(--sr-danger)', color: '#fff', borderColor: 'transparent', fontWeight: 600 },
    'an armed destructive button is SOLID: the second click must be unmistakable'),
  D('btn-icon-size', 'btn', '.sr-btn--icon', { width: 28, height: 28, borderRadius: 8 },
    '28px: a 24px icon button is under the comfortable target for a mouse-dense panel'),
  D('btn-sm-height', 'btn', '.sr-btn--sm', { lineHeight: '22px', fontSize: 10.5, paddingInline: 'calc(var(--sr-u) * 2.25)', borderRadius: 7 },
    'the small variant steps down in all four dimensions together, not only in font size'),
  D('btn-block-height', 'btn', '.sr-btn--block', { lineHeight: '32px', fontSize: 12, borderRadius: 10 },
    'the sheet\'s primary action is a full-width row and should look like one'),
  D('btn-accent-soft', 'btn', '.sr-btn--accent', { background: 'var(--sr-accent-weak)', color: 'var(--sr-accent)', borderColor: 'var(--sr-accent-line)' },
    'the conditional update button: tinted, because it is offered, not demanded'),
  D('btn-accent-soft-hover', 'btn', '.sr-btn--accent:hover:not(:disabled)', { background: 'var(--sr-accent)', color: 'var(--sr-accent-ink)', borderColor: 'transparent' },
    'and it commits to solid on hover, so the offer is obvious at the moment of intent'),

  /* ============================ 10. cards ============================ */
  D('card-radius', 'card', '.sr-skill', { borderRadius: 14 },
    'one step inside the panel radius: concentric corners are what make nesting look deliberate'),
  D('card-bg', 'card', '.sr-skill', { background: 'var(--sr-card)' },
    'cards are surfaces now, not a fill step'),
  D('card-border', 'card', '.sr-skill', { borderColor: 'color-mix(in srgb, #111113 9%, transparent)' },
    'a visible edge, since the fill matches the panel'),
  D('card-shadow', 'card', '.sr-skill', { boxShadow: 'var(--sr-e1)' },
    'the same elevation as a stat cell and a button: one system, three components'),
  D('card-hover', 'card', '.sr-skill:hover', { background: 'var(--sr-card)', borderColor: 'var(--sr-line2)', boxShadow: 'var(--sr-e2)', transform: 'translateY(-1px)' },
    'hover raises rather than tints, which is what makes a grid feel alive'),
  D('card-avatar-size', 'card', '.sr-avatar', { width: 30, height: 30, borderRadius: 9, fontSize: 13, fontWeight: 650 },
    'a 30px tile with a 13px initial: the old 26px tile made every card look like a table row'),
  D('card-avatar-ring', 'card', '.sr-avatar', { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.28), var(--sr-e1)' },
    'an inner ring plus the raise, so a saturated tile does not look printed on the card'),
  D('card-name-size', 'card', '.sr-skill-name', { fontSize: 12, fontWeight: 600, letterSpacing: 'var(--sr-track-tight)' },
    '12px semibold: the card title must outrank its own body text, and at 11.5/500 it did not'),
  D('card-slug-size', 'card', '.sr-skill-slug', { fontSize: 10.5, letterSpacing: '.02em' },
    'the slug is an identifier: mono, letterspaced, and clearly secondary'),
  D('card-blurb-size', 'card', '.sr-blurb', { fontSize: 11.5, lineHeight: 1.5, color: 'var(--sr-fg2)' },
    'body text on a card gets a readable size and leading; two clamped lines must not look squeezed'),
  D('card-blurb-lead', 'card', '.sr-blurb', { marginTop: 'var(--sr-u-half)' },
    'a half-step of separation from the title, so the card has internal rhythm'),
  D('card-main-gap', 'card', '.sr-skill-main', { gap: 'calc(var(--sr-u) * .75)' },
    'the vertical rhythm inside a card: title, slug, blurb'),
  D('card-actions-opacity', 'card', '.sr-row-actions .sr-btn', { opacity: 0.72 },
    'the row is quieter at rest so the card reads as content first'),
  D('card-actions-hover-opacity', 'card', '.sr-row-actions:hover .sr-btn', { opacity: 1 },
    'and fully present the moment the user is on the card'),
  D('card-actions-icon-bg', 'card', '.sr-row-actions .sr-btn--icon', { background: 'transparent', borderColor: 'transparent', boxShadow: 'none' },
    'icon actions drop the frame: four bordered buttons on one card is a toolbar, not a card'),
  D('card-actions-icon-hover', 'card', '.sr-row-actions .sr-btn--icon:hover:not(:disabled)', { background: 'var(--sr-fill)', color: 'var(--sr-fg)' },
    'the hover still gives them a hit area, which is why they can afford to be frameless'),

  /* ============================ 11. meta ============================ */
  D('tag-size', 'meta', '.sr-tag', { fontSize: 10, fontWeight: 550, lineHeight: '17px', letterSpacing: '.01em' },
    'tags are micro-labels: slightly heavier and letterspaced so they read at 10px'),
  D('tag-bg', 'meta', '.sr-tag', { background: 'var(--sr-sunken)', borderColor: 'transparent', color: 'var(--sr-fg2)' },
    'sunken, not outlined: a row of outlined chips looks like a form'),
  D('tag-used', 'meta', '.sr-tag--used', { background: 'var(--sr-accent-weak)', color: 'var(--sr-accent)', fontWeight: 600 },
    'the one tag that carries good news gets the accent, and semibold with it'),
  D('badge-size', 'meta', '.sr-badge', { fontSize: 10.5, fontWeight: 550, lineHeight: '20px', paddingInline: 'calc(var(--sr-u) * 2.25)' },
    'badges sit in the hero and must be legible at a glance'),
  D('badge-user', 'meta', '.sr-badge--user', { background: 'var(--sr-accent-weak)', color: 'var(--sr-accent)' },
    'the "you did this" badge is tinted with the accent rather than grey'),
  D('badge-none', 'meta', '.sr-badge--none', { background: 'var(--sr-warn-weak)', color: 'var(--sr-warn)', fontWeight: 600 },
    'the plugin\'s core signal: amber, semibold, and never the error colour'),
  D('share-track', 'meta', '.sr-share-track', { height: 8, borderRadius: 999, background: 'var(--sr-sunken)', boxShadow: 'none' },
    'a sunken well rather than a bordered bar: the track is a container, not a control'),
  D('share-fill', 'meta', '.sr-share-fill', { background: 'linear-gradient(90deg, color-mix(in srgb, var(--sr-accent) 55%, transparent), var(--sr-accent))', opacity: 1, borderRadius: 999 },
    'a gradient fill at full opacity: the old 75%-opacity flat bar looked like a loading state'),
  D('share-name-size', 'meta', '.sr-share-name', { fontSize: 11.5, fontWeight: 550, letterSpacing: 'var(--sr-track-tight)' },
    'share names are skill slugs and should match the card titles'),
  D('share-n-size', 'meta', '.sr-share-n', { fontSize: 11, fontWeight: 550, color: 'var(--sr-fg2)' },
    'the count beside a bar needs to be readable as a number, not as a footnote'),
  D('share-row-pad', 'meta', '.sr-share', { padding: 'calc(var(--sr-u) * 1.75) 0' },
    'rows need a step more air now that the bar is thicker'),
  D('seg-track', 'meta', '.sr-seg', { background: 'var(--sr-sunken)', borderColor: 'transparent', borderRadius: 10, padding: 3 },
    'the segmented control is a well with a thumb in it'),
  D('seg-thumb', 'meta', '.sr-seg-ind', { borderRadius: 8, background: 'var(--sr-card)', boxShadow: 'var(--sr-e1)' },
    'the thumb is a raised card: that is what makes the selection readable as a position'),
  D('seg-btn-size', 'meta', '.sr-seg button', { fontSize: 10.5, lineHeight: '20px', fontWeight: 550, borderRadius: 8 },
    'segments step down in every dimension together, like the small button'),

  /* ============================ 12. timeline ============================ */
  D('time-rail', 'time', '.sr-time-rail:before', { width: 2, background: 'color-mix(in srgb, #111113 8%, transparent)' },
    'a 2px spine at 8%: a timeline rail is the quietest structure in the panel'),
  D('time-dot', 'time', '.sr-turn:before', { width: 9, height: 9, borderWidth: 2, borderColor: 'var(--sr-line2)', background: 'var(--sr-card)' },
    'a 9px dot with a 2px ring: at 7px it read as a speck beside the timestamps'),
  D('time-dot-hot', 'time', '.sr-turn--hot:before', { borderColor: 'var(--sr-accent)', background: 'var(--sr-accent)', boxShadow: '0 0 0 3px var(--sr-card)' },
    'a turn that used a skill is filled and ringed, so the timeline is scannable without reading'),
  D('time-row-pad', 'time', '.sr-turn-h', { padding: 'calc(var(--sr-u) * 1.5) calc(var(--sr-u) * 2)', borderRadius: 9 },
    'rows are click targets and now have a shape and real padding'),
  D('time-row-hover', 'time', '.sr-turn-h:hover', { background: 'var(--sr-fill2)', boxShadow: 'inset 2px 0 0 var(--sr-accent)' },
    'the same inset-accent hover as a section header, so the panel has one interaction language'),
  D('time-age-size', 'time', '.sr-age', { fontSize: 10, fontWeight: 550, lineHeight: '18px' },
    'outcome chips are the second thing the eye should find on a row'),
  D('time-title-size', 'time', '.sr-turn-title', { fontSize: 11.5, color: 'var(--sr-fg)' },
    'the session title is CONTENT and was set in ink2 like metadata'),
  D('time-call-name', 'time', '.sr-call-name', { fontSize: 11.5, fontWeight: 550 },
    'the skill name in a call row is the content; the count is the annotation'),

  /* ============================ 13. toasts ============================ */
  D('toast-radius', 'toast', '.sr-toast', { borderRadius: 12, fontSize: 11.5, padding: 'calc(var(--sr-u) * 2.5) calc(var(--sr-u) * 3)' },
    'matching the card radius, and a font size and padding to match the rest of the panel'),
  D('toast-shadow', 'toast', '.sr-toast', { boxShadow: 'var(--sr-e3)' },
    'toasts float above the panel and use the overlay elevation'),
  D('toast-border', 'toast', '.sr-toast', { borderColor: 'color-mix(in srgb, #111113 8%, transparent)' },
    'the shadow separates it; the border only defines the edge'),
  D('toast-ok', 'toast', '.sr-toast--ok', { borderLeft: '3px solid var(--sr-ok)', color: 'var(--sr-fg)' },
    'a 3px coloured edge types the message without an icon, and the TEXT stays legible ink'),
  D('toast-error', 'toast', '.sr-toast--error', { borderLeft: '3px solid var(--sr-danger)', color: 'var(--sr-fg)' },
    'same for errors: colouring the whole message red made it harder to read than the failure warranted'),
  D('toast-pending', 'toast', '.sr-toast--pending', { borderLeft: '3px solid var(--sr-line2)' },
    'pending is neutral: nothing is wrong yet'),
  D('toast-msg-size', 'toast', '.sr-toast-msg', { fontSize: 11.5, fontWeight: 550 },
    'the message is the payload'),
  D('toast-hint-size', 'toast', '.sr-toast-hint', { fontSize: 10.5, lineHeight: 1.5 },
    'hints contain paths and wrap to two or three lines'),

  /* ============================ 14. sheet ============================ */
  D('sheet-radius', 'sheet', '.sr-sheet', { borderRadius: 20 },
    'the largest surface in the plugin takes the largest radius, or it looks like a dialog from 2012'),
  D('sheet-shadow', 'sheet', '.sr-sheet', { boxShadow: 'var(--sr-e3)' },
    'the overlay elevation, on the one thing that genuinely overlays'),
  D('sheet-border', 'sheet', '.sr-sheet', { borderColor: 'color-mix(in srgb, #111113 8%, transparent)' },
    'a hairline, because the shadow already does the separating'),
  D('sheet-scrim', 'sheet', '.sr-backdrop', { background: 'var(--sr-scrim)' },
    'the scrim keeps the page as context rather than hiding it'),
  D('sheet-head-pad', 'sheet', '.sr-sheet-head', { padding: 'calc(var(--sr-u) * 4) calc(var(--sr-u) * 5)' },
    'the header sets the modal rhythm, and 20px is the matching inset'),
  D('sheet-title-size', 'sheet', '.sr-sheet-title', { fontSize: 14, fontWeight: 650, letterSpacing: 'var(--sr-track-tight)' },
    'a modal title is a title: it was 12.5px, the same as a card name'),
  D('sheet-sub-size', 'sheet', '.sr-sheet-sub', { fontSize: 10.5, lineHeight: 1.5, color: 'var(--sr-fg3)' },
    'the root path under the title is metadata, and it wraps, so it needs leading'),
  D('sheet-tabs-pad', 'sheet', '.sr-tabs', { padding: 'calc(var(--sr-u) * 2) calc(var(--sr-u) * 5) 0' },
    'the tabs align with the header inset, so the modal has one left edge'),
  D('sheet-tab-size', 'sheet', '.sr-tab', { fontSize: 11.5, fontWeight: 550, lineHeight: '30px', borderRadius: 8 },
    'tabs are the modal\'s navigation and need to look like a control row'),
  D('sheet-tab-underline', 'sheet', '.sr-tab[aria-selected="true"]::after', { height: 2, left: 'calc(var(--sr-u) * 2.5)', right: 'calc(var(--sr-u) * 2.5)' },
    'an inset underline reads as part of the tab rather than as a border on the track'),
  D('sheet-label-size', 'sheet', '.sr-label', { fontSize: 11, fontWeight: 600, letterSpacing: '.01em' },
    'form labels at 10.5px were the smallest text in the plugin, in the one place a mistake is costly'),
  D('sheet-input-size', 'sheet', '.sr-input, .sr-textarea', { fontSize: 12, lineHeight: '22px', padding: 'calc(var(--sr-u) * 2.25) calc(var(--sr-u) * 3)', borderRadius: 10 },
    'inputs at 12px with real padding: this is the field a user types a URL into'),
  D('sheet-input-bg', 'sheet', '.sr-input, .sr-textarea', { background: 'var(--sr-raised)', borderColor: 'color-mix(in srgb, #111113 13%, transparent)' },
    'a field must look like a field: the raised step plus a control-weight border'),
  D('sheet-input-focus', 'sheet', '.sr-input:focus, .sr-textarea:focus', { borderColor: 'var(--sr-accent)', boxShadow: '0 0 0 3px var(--sr-accent-weak)', background: 'var(--sr-card)' },
    'a 3px tinted ring plus the accent border: the strongest focus signal in the plugin, where it matters most'),
  D('sheet-note-pad', 'sheet', '.sr-note', { padding: 'calc(var(--sr-u) * 2.5) calc(var(--sr-u) * 3)', borderRadius: 10, borderLeftWidth: 3 },
    'notes are typed by a left rule and need padding to look deliberate'),
  D('sheet-drop-dash', 'sheet', '.sr-drop', { borderWidth: 2, borderStyle: 'dashed', borderRadius: 14, background: 'var(--sr-raised)' },
    'a 2px dashed target at the card radius: a drop zone should look like a place'),
  D('sheet-drop-over', 'sheet', '.sr-drop--over', { borderColor: 'var(--sr-accent)', background: 'var(--sr-accent-weak)', boxShadow: '0 0 0 3px var(--sr-accent-weak)' },
    'drag-over gets a tinted fill AND a ring, because it is a state the user must not miss'),
  D('sheet-preview', 'sheet', '.sr-preview', { borderRadius: 12, background: 'var(--sr-raised)', borderColor: 'color-mix(in srgb, #111113 9%, transparent)' },
    'the preview block groups what is about to be installed and is styled as a card'),
  D('sheet-foot-bg', 'sheet', '.sr-sheet-foot', { background: 'var(--sr-raised)', padding: 'calc(var(--sr-u) * 3.5) calc(var(--sr-u) * 5)' },
    'the action row is separated by a fill step and matches the header inset'),
  D('sheet-hist-size', 'sheet', '.sr-hist-row', { fontSize: 10.5, fontWeight: 500 },
    'the history is a log: small, but not the smallest text in the modal'),

  /* ============================ 15. a11y ============================ */
  D('a11y-focus', 'a11y', '{all}:focus-visible', { outline: '2px solid var(--sr-accent)', outlineOffset: 2, borderRadius: 8 },
    'one focus ring for every control, at the control radius, so it hugs the shape'),
  D('a11y-motion-curve', 'a11y', '{root}', { '--sr-ease': 'cubic-bezier(.2,.8,.2,1)', '--sr-speed': '.15s' },
    'one easing curve and one duration: consistent motion is what makes an interface feel made'),
  D('a11y-tap', 'a11y', '{all}.sr-btn, {all}.sr-chip, {all}.sr-tab, {all}.sr-turn-h, {all}.sr-sec-h', { touchAction: 'manipulation' },
    'removes the 300ms tap delay in the embedded webview'),
  D('a11y-contrast-num', 'a11y', '{all}.sr-stat-v, {all}.sr-stat-l, {all}.sr-share-n, {all}.sr-age', { fontVariantNumeric: 'tabular-nums' },
    'every metric in the panel is live and must not reflow while polling'),
  D('a11y-select', 'a11y', '{all}::selection', { background: 'var(--sr-accent-weak)', color: 'var(--sr-fg)' },
    'selection is part of the palette rather than the OS default blue'),
  D('a11y-scroll-thin', 'a11y', '.sr-root', { scrollbarWidth: 'thin', scrollbarColor: 'var(--sr-line2) transparent' },
    'a thin scrollbar keeps the panel from looking like a page'),
  D('a11y-hover-none', 'a11y', '.sr-root', { WebkitTapHighlightColor: 'transparent' },
    'removes the grey flash the webview paints on tap'),
  D('a11y-link', 'a11y', '{all}a', { color: 'var(--sr-accent)', textUnderlineOffset: 2, textDecorationThickness: 'from-font' },
    'skill bodies contain links; they should match the accent and underline cleanly'),
  D('a11y-wrap', 'a11y', '{all}.sr-toast-hint, {all}.sr-sheet-sub, {all}.sr-note-hint', { overflowWrap: 'anywhere' },
    'paths and URLs have no break opportunity and would otherwise overflow the modal'),
  D('a11y-reduced', 'a11y', '{all}', { transitionProperty: 'background, color, border-color, box-shadow, opacity, transform' },
    'naming the animated properties keeps a stray `transition:all` from animating layout'),
  D('a11y-line-height', 'a11y', '{all}.sr-note-body, {all}.sr-guide-text, {all}.sr-preview-desc', { lineHeight: 1.55 },
    'explanatory prose gets reading leading; labels get tight leading'),

  /* ============================ 16. remaining surfaces ============================ */
  D('guide-radius', 'sec', '.sr-guide', { borderRadius: 14, borderStyle: 'dashed', borderWidth: 1.5, background: 'var(--sr-raised)' },
    'the cold-start block is an invitation, so a dashed edge reads as "space for you"'),
  D('guide-pad', 'sec', '.sr-guide', { padding: 'calc(var(--sr-u) * 5)', margin: 'calc(var(--sr-u) * 4)' },
    'the one block that replaces three placeholders deserves real air'),
  D('guide-title', 'sec', '.sr-guide-title', { fontSize: 13, fontWeight: 650, letterSpacing: 'var(--sr-track-tight)' },
    'it is a heading, not a caption'),
  D('guide-text', 'sec', '.sr-guide-text', { fontSize: 11.5, color: 'var(--sr-fg2)' },
    'the explanation is body copy'),
  D('guide-icon', 'sec', '.sr-guide .sr-ic', { color: 'var(--sr-accent)', width: 18, height: 18 },
    'one accent mark makes the block feel like a starting point rather than an error'),
  D('empty-pad', 'sec', '.sr-empty', { padding: 'calc(var(--sr-u) * 3) 0', fontSize: 11.5 },
    'an empty state occupies a block; a single 11px line makes the panel look truncated'),
  D('hint-size', 'sec', '.sr-hint', { fontSize: 10.5, lineHeight: 1.55 },
    'hints wrap in the narrow strip expansion and need leading'),
  D('skeleton-radius', 'sec', '.sr-skel--card', { height: 62, borderRadius: 14 },
    'the placeholder must match the card it stands in for, or the panel jumps when data lands'),
  D('skeleton-color', 'sec', '.sr-skel', { background: 'linear-gradient(90deg, var(--sr-sunken) 0%, var(--sr-fill) 50%, var(--sr-sunken) 100%)' },
    'a shimmer built from the surface ramp rather than an arbitrary grey'),
  D('kbd-radius', 'sec', '.sr-kbd', { borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 550, background: 'var(--sr-sunken)', borderColor: 'color-mix(in srgb, #111113 12%, transparent)' },
    'a key cap is a physical object: sunken, bordered, and its border-bottom does the thickness'),
  D('kbd-color', 'sec', '.sr-kbd', { color: 'var(--sr-fg2)' },
    'key caps are legible, unlike the 9.5px ink3 they used to be'),
  D('filter-bg', 'sec', '.sr-filter input', { background: 'var(--sr-raised)', borderColor: 'color-mix(in srgb, #111113 12%, transparent)', borderRadius: 10, fontSize: 12, lineHeight: '28px' },
    'the filter is a field and matches the sheet inputs'),
  D('filter-focus', 'sec', '.sr-filter input:focus', { borderColor: 'var(--sr-accent)', background: 'var(--sr-card)', boxShadow: '0 0 0 3px var(--sr-accent-weak)' },
    'one focus treatment across every field in the plugin'),
  D('chip-radius', 'sec', '.sr-chip', { borderRadius: 8, lineHeight: '22px', fontSize: 10.5, fontWeight: 550, paddingInline: 'calc(var(--sr-u) * 2.5)' },
    'chips are filters, not pills: a chip row of rounded pills reads as decoration'),
  D('chip-bg', 'sec', '.sr-chip', { background: 'var(--sr-card)', borderColor: 'color-mix(in srgb, #111113 12%, transparent)' },
    'an unselected chip is a small control and needs a surface'),
  D('chip-on', 'sec', '.sr-chip--on', { background: 'var(--sr-accent)', color: 'var(--sr-accent-ink)', borderColor: 'transparent', fontWeight: 600 },
    'the selected filter is SOLID: a tinted chip among outlined chips is too easy to miss'),
  D('chip-hover', 'sec', '.sr-chip:hover', { background: 'var(--sr-raised)', borderColor: 'var(--sr-line2)' },
    'hover steps the fill up, leaving the accent for selection only'),
  D('count-size', 'sec', '.sr-count', { fontSize: 10.5, fontWeight: 550 },
    'the result tally is a readout and should look like one'),
  D('status-dot-glow', 'frame', '.sr-status-dot', { boxShadow: '0 0 0 3px var(--sr-ok-weak)' },
    'a live connection indicator with a halo: a bare 6px dot reads as dirt on the screen'),
  D('foot-dot', 'frame', '.sr-foot .sr-status-dot', { width: 7, height: 7 },
    'the footer status dots are the smallest signal and get a step up'),
  D('foot-gap', 'frame', '.sr-foot', { columnGap: 'calc(var(--sr-u) * 3)', rowGap: 'calc(var(--sr-u) * 1.5)' },
    'the footer wraps on a narrow panel and needs gutters in both directions'),
  D('foot-mono-size', 'frame', '.sr-foot-mono', { fontSize: 10.5 },
    'the write path is shown for copying and must be readable'),
  D('share-weight', 'meta', '.sr-share-n', { fontVariantNumeric: 'tabular-nums' },
    'per-skill counts change while polling'),
  D('turn-pad', 'time', '.sr-turn', { padding: 'calc(var(--sr-u) * 1.75) 0' },
    'turns need more separation now that the row has a hover fill'),
  D('turn-caret', 'time', '.sr-turn-caret', { color: 'var(--sr-fg3)' },
    'the caret is an affordance, not content'),
  D('call-n-size', 'time', '.sr-call-n', { fontSize: 11, fontWeight: 550, color: 'var(--sr-fg2)' },
    'call counts line up down the column and should read as numbers'),
  D('toast-rail-gap', 'toast', '.sr-rail', { gap: 'calc(var(--sr-u) * 2.5)' },
    'toasts are separate messages, not list rows'),
  D('toast-enter', 'toast', '.sr-toast', { animation: 'sr-toast-in .18s cubic-bezier(.2,.8,.2,1)' },
    'a slightly longer entry with the shared curve makes the rail feel responsive'),
  D('toast-close', 'toast', '.sr-toast .sr-btn--icon', { alignSelf: 'flex-start', color: 'var(--sr-fg3)' },
    'the dismiss button aligns with the first line rather than the block centre'),
  D('hist-pad', 'sheet', '.sr-hist-row', { padding: 'calc(var(--sr-u) * .75) 0' },
    'history rows are dense; a three-quarter step keeps them scannable without padding them out'),
  D('hist-icon', 'sheet', '.sr-hist-row .sr-ic', { opacity: 1 },
    'the outcome icon carries the row status and should not be dimmed'),
  D('preview-name-size', 'sheet', '.sr-preview-name', { fontSize: 12.5, fontWeight: 600 },
    'the name about to be installed is the most important text in the preview'),
  D('preview-desc-size', 'sheet', '.sr-preview-desc', { fontSize: 11.5, color: 'var(--sr-fg2)' },
    'the description is body copy'),
  D('preview-meta-size', 'sheet', '.sr-preview-meta', { fontSize: 10.5 },
    'the file count and size are metadata'),
  D('label-opt', 'sheet', '.sr-label .sr-opt', { fontSize: 10.5, letterSpacing: 0, fontWeight: 450 },
    'the optional marker must not inherit the label weight it sits beside'),
  D('counter-size', 'sheet', '.sr-counter', { fontSize: 10.5, fontWeight: 550 },
    'the character counter is checked against a limit and should be readable'),
  D('check-size', 'sheet', '.sr-check', { fontSize: 11.5, lineHeight: 1.5 },
    'the overwrite confirmation is a sentence next to a checkbox'),
  D('panel-title-weight', 'frame', '.sr-title', { textWrap: 'balance' },
    'a long panel title wraps evenly instead of leaving one word on the second line'),

  /* ============================ 17. the card is three rows, not two columns ======== */
  // The card used to put the name and six actions in ONE flex row. The name lost: it
  // wrapped to two lines and then ellipsised ("h3-prompt-writi…"). These records make the
  // card a column — name row, text, actions — so the name has the full card width.
  D('card-column', 'card', '.sr-skill', { flexDirection: 'column', alignItems: 'stretch', gap: 'calc(var(--sr-u) * 2.5)' },
    'the card is a COLUMN of three rows; one row holding six buttons leaves no width for the name'),
  D('card-head', 'card', '.sr-skill-head', { display: 'flex', alignItems: 'center', gap: 'calc(var(--sr-u) * 2.5)', minWidth: 0 },
    'name row: avatar, the name block, then the tags'),
  D('card-headtext', 'card', '.sr-skill-headtext', { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'calc(var(--sr-u) * .5)' },
    'the name block takes whatever width the tags do not need'),
  D('card-tags', 'card', '.sr-skill-tags', { flex: 'none', display: 'flex', alignItems: 'center', gap: 'calc(var(--sr-u) * 1.25)', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '55%' },
    'tags sit at the end of the name row and wrap rather than squeeze the name'),
  // THE fix for the truncation. A skill name must not be cut off, so it wraps; and
  // `overflow-wrap:anywhere` matters because a slug is one unbroken token —
  // `paper-collage-explainer-generator` has no space to wrap at and would overflow instead.
  D('card-name-wrap', 'card', '.sr-skill-name', { overflow: 'visible', textOverflow: 'clip', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35, maxWidth: '100%' },
    'the name shows IN FULL and wraps: cutting off the one identifier a user needs is worse than a taller card'),
  D('card-slug-wrap', 'card', '.sr-skill-slug', { overflow: 'visible', textOverflow: 'clip', whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%' },
    'and the slug under it, for the same reason'),
  D('card-main-full', 'card', '.sr-skill-main', { flex: '0 0 auto', minWidth: 0 },
    'the text block no longer shares a row with the actions, so it must not stretch'),
  D('card-actions-row', 'card', '.sr-card-foot .sr-row-actions', { width: '100%', justifyContent: 'flex-start', flexWrap: 'wrap', rowGap: 'calc(var(--sr-u) * 1.5)' },
    'the actions own the last row and start at the card edge, which is what makes it read as a footer'),
  D('card-foot-row', 'card', '.sr-card-foot', { alignItems: 'stretch' },
    'the action column spans the card now that it is a row of its own'),

  /* ============================ 19. the plugin's own version controls ============== */
  // `display:contents` so the wrapper adds NO box: the two buttons must sit in the header's
  // existing tool row exactly as if they were its own children, or the header's spacing
  // changes the moment they appear.
  D('release-wrap', 'frame', '.sr-release', { display: 'contents' },
    'the version-controls wrapper must not introduce a box into the header tool row'),
  D('release-wrap-strip', 'frame', '.sr-release--strip', { display: 'contents' },
    'same in the strip row, so its two buttons keep the row\'s own gap'),
  // The dot is the only sign that a check FOUND something without hovering: a version
  // number in a tooltip is not discoverable.
  D('release-dot', 'btn', '.sr-release-dot', { position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 999, background: 'var(--sr-accent)', boxShadow: '0 0 0 1.5px var(--sr-card)' },
    'a 6px accent dot on the check button, ringed in the card colour so it reads on any surface'),
  D('release-note', 'frame', '.sr-release-note', { fontSize: 10.5, fontWeight: 600, letterSpacing: '.02em', color: 'var(--sr-accent)', whiteSpace: 'nowrap' },
    'the header has room to SAY "可更新 4.1.0" instead of making the user hover to find out'),
  D('release-note-ok', 'frame', '.sr-release-note--ok', { color: 'var(--sr-ok)' },
    '"已是最新" is good news and wears the success colour, not the accent'),

  /* ============================ 20. enable / disable + catalogue groups ============ */
  D('group-head', 'card', '.sr-group-head', { display: 'flex', alignItems: 'center', gap: 'calc(var(--sr-u) * 2)', padding: 'calc(var(--sr-u) * 2.5) 0 calc(var(--sr-u) * 1.5)' },
    'a group header is a row: label, count, and the sentence that explains the state'),
  D('group-gap', 'card', '.sr-group', { marginTop: 'calc(var(--sr-u) * 2)' },
    'the two groups are separate lists and need air between them'),
  D('group-title', 'card', '.sr-group-title', { fontSize: 11, fontWeight: 700, letterSpacing: 'var(--sr-track-loose)', textTransform: 'uppercase', color: 'var(--sr-fg2)' },
    'the group heading is the one thing that tells the user what the model can load'),
  D('group-note', 'card', '.sr-group-note', { fontSize: 10.5, color: 'var(--sr-fg3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    'the note explains the state and may truncate on a narrow panel'),
  D('off-card', 'card', '.sr-skill--off', { background: 'var(--sr-raised)', borderStyle: 'dashed', boxShadow: 'none' },
    'a parked card is DASHED and flat: the same object in a different state, not a deleted one'),
  D('off-card-hover', 'card', '.sr-skill--off:hover', { borderStyle: 'dashed', borderColor: 'var(--sr-line2)', boxShadow: 'var(--sr-e1)' },
    'hover still lifts it — a parked skill is editable, so it must look interactive'),
  D('off-avatar', 'card', '.sr-skill--off .sr-avatar', { filter: 'grayscale(1)', opacity: 0.75 },
    'the avatar keeps its letter but loses its colour, so the group reads as inactive at a glance'),
  D('off-tag', 'card', '.sr-tag--off', { background: 'var(--sr-warn-weak)', color: 'var(--sr-warn)', borderColor: 'transparent', fontWeight: 600 },
    'the 已停用 tag is the card state and belongs in the title row'),

  /* the switch ---------------------------------------------------------------- */
  D('toggle-gap', 'btn', '.sr-btn--toggle', { gap: 'calc(var(--sr-u) * 1.5)', paddingInline: 'calc(var(--sr-u) * 2)', fontWeight: 550, height: 22, boxSizing: 'border-box', alignItems: 'center' },
    'the switch is a fixed 22px control: a shrink-to-fit flex item would otherwise be sized by its line box and render as a 14px sliver'),
  D('switch-track', 'btn', '.sr-switch', { flex: 'none', width: 22, height: 12, borderRadius: 999, background: 'var(--sr-line2)', position: 'relative', transition: 'background var(--sr-ease) var(--sr-speed)' },
    'a 22x12 track: small enough for a card row, unambiguous as a switch'),
  D('switch-knob', 'btn', '.sr-switch-knob', { position: 'absolute', top: 2, left: 2, width: 8, height: 8, borderRadius: 999, background: 'var(--sr-card)', boxShadow: '0 1px 2px rgba(0,0,0,.35)', transition: 'transform var(--sr-ease) var(--sr-speed)' },
    'the knob is a raised dot; its travel is what makes the state legible without reading the label'),
  D('switch-on', 'btn', '.sr-btn--on .sr-switch', { background: 'var(--sr-ok)' },
    'ON is green while the label says 停用 — the colour describes the STATE, not the action'),
  D('switch-on-knob', 'btn', '.sr-btn--on .sr-switch-knob', { transform: 'translateX(10px)' },
    'the knob slides the track minus its own width, so ON and OFF are mirror images'),
  D('switch-hover', 'btn', '.sr-btn--toggle:hover:not(:disabled) .sr-switch', { background: 'var(--sr-accent)' },
    'hovering a switch previews that it will act, without changing the state colour'),
  D('switch-off-label', 'btn', '.sr-btn--toggle:not(.sr-btn--on)', { color: 'var(--sr-warn)' },
    'the 启用 label is amber: this card is out of service, and that is the thing to notice'),

  /* the compact counters, on the strip's own bar line ------------------------- */
  D('statline', 'stat', '.sr-strip-stats', { display: 'inline-flex', alignItems: 'center', flexWrap: 'nowrap', gap: 'calc(var(--sr-u) * 1.25)', flex: 'none', marginLeft: 'auto' },
    'the counter row rides ON the bar line, pushed to the right by its auto margin'),
  D('statline-rule', 'stat', '.sr-strip-stats + .sr-strip-n', { marginLeft: 'calc(var(--sr-u) * 1)' },
    'the turn count sits just after the counters, so the two read as one group'),
  D('statcard-inline', 'stat', '.sr-statcard--inline', { display: 'inline-flex', flexDirection: 'row-reverse', alignItems: 'baseline', gap: 'calc(var(--sr-u) * 1.25)', padding: 'calc(var(--sr-u) * .75) calc(var(--sr-u) * 2)', borderRadius: 8, background: 'var(--sr-sunken)', border: '1px solid transparent' },
    'one counter as a chip: label and value on one line, so four of them fit the bar'),
  D('statcard-inline-num', 'stat', '.sr-statcard--inline .sr-stat-v', { fontSize: 15, fontWeight: 700, letterSpacing: 'var(--sr-track-tight)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
    '15px is the largest that still fits four chips across the strip'),
  D('statcard-inline-label', 'stat', '.sr-statcard--inline .sr-stat-l', { fontSize: 10.5, letterSpacing: '.03em', textTransform: 'uppercase', fontWeight: 550, color: 'var(--sr-fg3)' },
    'the same micro-caps treatment as the full-size cards, so the two read as one system'),
  // The bar is one 18px line; a chip with card padding would set the bar's height and
  // visibly thicken it when the strip expands.
  D('statcard-bar', 'stat', '.sr-statcard--bar', { padding: 'calc(var(--sr-u) * .25) calc(var(--sr-u) * 1.5)', borderRadius: 6, gap: 'calc(var(--sr-u))' },
    'the bar variant is smaller again, so four chips fit an 18px line without thickening it'),
  D('statcard-bar-num', 'stat', '.sr-statcard--bar .sr-stat-v', { fontSize: 12.5, fontWeight: 700 },
    'the number steps down with the chip and stays the largest thing in it'),
  D('statcard-bar-label', 'stat', '.sr-statcard--bar .sr-stat-l', { fontSize: 10, letterSpacing: '.02em' },
    'and the label follows, keeping the pair readable at bar scale'),

  /* the claim row: its own row, at the card width ----------------------------- */
  D('cardfoot', 'card', '.sr-card-foot', { flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'calc(var(--sr-u) * 1.5)', minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' },
    'the card action column: buttons right-aligned, any revealed row BELOW them at full width'),
  D('claim-row', 'card', '.sr-claim-row', { alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 'calc(var(--sr-u) * 1.5)', width: '100%', marginTop: 'calc(var(--sr-u) * .5)', paddingTop: 'calc(var(--sr-u) * 2)', borderTop: '1px solid var(--sr-line)' },
    'the revealed claim field spans the CARD, which is why it is no longer a child of the button row'),
  D('claim-inner', 'card', '.sr-claim-row .sr-claim', { padding: 0, background: 'none', borderRadius: 0, borderTop: 0, marginTop: 0 },
    'one frame, not two: the row owns the rule and the padding'),
  D('claim-help', 'card', '.sr-claim-row .sr-help', { textAlign: 'left' },
    'the helper line sits under the field it describes'),
  D('portal-host', 'a11y', '.sr-portal-host', { position: 'static', display: 'contents' },
    'the portal host adds no box of its own: the sheet is positioned against the viewport'),
])

/**
 * Generate the CSS block.
 *
 * Evaluated separately from polish.js so the two blocks stay independently auditable:
 * this one deliberately supersedes the earlier pass, and the test asserts that ordering
 * rather than assuming it.
 */
const UNITLESS_KEYS = new Set([
  'fontWeight', 'lineHeight', 'opacity', 'zIndex', 'flexGrow', 'flexShrink', 'order',
  'WebkitLineClamp', 'fontSizeAdjust', 'aspectRatio', 'tabSize', 'columnCount',
  'borderTopRightRadius', 'borderBottomRightRadius', 'borderTopLeftRadius', 'borderBottomLeftRadius',
])

/**
 * Expand a `{all}` selector into one rooted descendant selector per surface.
 *
 * Rooted MEMBER BY MEMBER, and a class selector gets no `*`: `{all}.sr-btn` must become
 * `root .sr-btn`, because `root *.sr-btn` matches a descendant of the button and the rule
 * silently does nothing. See polish.js for the full note.
 */
function descendantSelector(list, roots) {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .flatMap((part) => {
      const all = part.includes('{all}')
      const bare = part.replace(/\{all\}/gu, '')
      const tail = all ? (bare.startsWith('.') ? bare : `*${bare}`) : bare
      return roots.map((root) => `${root} ${tail}`)
    })
    .join(',')
}

function designRuleFor(record, roots) {
  const camel = (key) => key.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)
  const value = (key, v) => (typeof v === 'number' && v < 100 && !UNITLESS_KEYS.has(key) ? `${v}px` : String(v))
  const decls = Object.entries(record.props)
    .map(([key, raw]) => `${camel(key)}:${value(key, raw)}`)
    .join(';')
  const at = record.at
  if (at.includes('{all}')) return `${descendantSelector(at, roots)}{${decls}}`
  if (at.includes('{root}')) return `${roots.map((root) => root + at.replace('{root}', '')).join(',')}{${decls}}`
  if (roots.some((root) => at.startsWith(root))) return `${at}{${decls}}`
  if (!at.includes('.sr-')) throw new Error(`design rule "${record.id}" would apply OUTSIDE the plugin surfaces: ${at}`)
  return `${descendantSelector(at, roots)}{${decls}}`
}

function designCSS(roots) {
  if (!Array.isArray(roots) || roots.length === 0) return ''
  return [
    '/* ---- 4.0re design pass (generated from DESIGN in src/client/design.js) ---- */',
    ...DESIGN.map((record) => designRuleFor(record, roots)),
  ].join('\n')
}

/**
 * The dark palette.
 *
 * Emitted TWICE, against two different signals, because the application does not
 * necessarily follow the operating system: a user who picks Dark in the app gets it from
 * a class or attribute on the document, and a plugin that only listened to
 * `prefers-color-scheme` would stay light inside a dark application. Both are cheap, so
 * covering both is the only defensible choice.
 */
function designDarkCSS(roots) {
  const overrides = {
    '--sr-canvas': '#0b0c0e',
    '--sr-card': '#141519',
    '--sr-raised': '#1a1b20',
    '--sr-sunken': '#0f1013',
    '--sr-fill': 'rgba(255,255,255,.055)',
    '--sr-fill2': 'rgba(255,255,255,.032)',
    '--sr-line': 'color-mix(in srgb, #ffffff 11%, transparent)',
    '--sr-line2': 'color-mix(in srgb, #ffffff 20%, transparent)',
    '--sr-fg': '#e9eaee',
    '--sr-fg2': '#a6abb6',
    '--sr-fg3': '#868c99',
    '--sr-accent': '#7c74f2',
    '--sr-accent-ink': '#0b0c0e',
    '--sr-accent-weak': 'color-mix(in srgb, var(--sr-accent) 18%, transparent)',
    '--sr-accent-line': 'color-mix(in srgb, var(--sr-accent) 42%, transparent)',
    '--sr-danger': '#f4736a',
    '--sr-danger-weak': 'color-mix(in srgb, var(--sr-danger) 16%, transparent)',
    '--sr-ok': '#4ade80',
    '--sr-ok-weak': 'color-mix(in srgb, var(--sr-ok) 16%, transparent)',
    '--sr-warn': '#e0a44a',
    '--sr-warn-weak': 'color-mix(in srgb, var(--sr-warn) 18%, transparent)',
    '--sr-scrim': 'rgba(4,5,7,.62)',
    '--sr-e1': '0 1px 1px rgba(0,0,0,.34), 0 2px 4px -2px rgba(0,0,0,.4)',
    '--sr-e2': '0 2px 4px -1px rgba(0,0,0,.4), 0 8px 16px -8px rgba(0,0,0,.55)',
    '--sr-e3': '0 4px 8px -2px rgba(0,0,0,.45), 0 24px 48px -16px rgba(0,0,0,.7)',
    '--sr-ring': '0 0 0 1px rgba(255,255,255,.07)',
    '--sr-glow': '0 1px 2px color-mix(in srgb, var(--sr-accent) 45%, transparent)',
  }
  const decls = Object.entries(overrides).map(([key, value]) => `${key}:${value}`).join(';')
  const block = `${roots.join(',')}{${decls}}`
  // `[data-theme="dark"]` / `.dark` on any ancestor, plus the OS preference.
  const explicit = ['.dark', '[data-theme="dark"]', '[data-dsw-theme="dark"]']
    .map((sel) => `${sel} :is(${roots.join(',')})`)
    .join(',')
  return `@media (prefers-color-scheme: dark){\n${block}\n}\n${explicit}{${decls}}`
}

/** Counts per group, for the tally a reviewer reads. */
function designCounts() {
  const out = {}
  for (const record of DESIGN) out[record.group] = (out[record.group] ?? 0) + 1
  return out
}

module.exports = { DESIGN, DESIGN_GROUPS, designCSS, designDarkCSS, designCounts, designRuleFor }
