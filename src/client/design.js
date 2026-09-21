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
  //
  // NEUTRAL TOOL PALETTE, at the owner's request: "去掉老旧粗糙感，改成现代、精致、紧凑的工具面板风格".
  //
  // It replaces Vapor Chrome (a periwinkle-aqua Y2K system) and Bondi Blue before it. Both were built to
  // separate surfaces by TEMPERATURE; this one deliberately does not. The brief names exact values — a
  // low-saturation grey canvas, white surfaces, near-black neutral ink and ONE blue — and a tinted canvas is
  // what made the panel read as decorative rather than as a tool. Neutral surfaces plus a single accent is the
  // convention every current tool UI shares, and it is what "现代" means here in practice.
  //
  // Contrast is still SOLVED rather than assumed. Every ink below is checked against the surface it actually
  // sits on, because the failure mode of a neutral palette is a grey that looks tasteful on white and fails on
  // the sunken step.
  D('color-canvas', 'token', '{root}', { '--sr-canvas': '#f5f5f7' },
    'the low-saturation grey the brief names: it separates from a white card by LIGHTNESS alone, which is what keeps the surface neutral'),
  D('color-card', 'token', '{root}', { '--sr-card': '#ffffff' },
    'the panel surface itself: the one true white in the system, so white always means "content"'),
  D('color-raised', 'token', '{root}', { '--sr-raised': '#fafafa' },
    'raised fills a hair above the card, for a row that needs to sit ON white without a border doing the work'),
  D('color-sunken', 'token', '{root}', { '--sr-sunken': '#ececee' },
    'tracks, wells and code blocks: the only step BELOW the canvas, and it is the surface the tertiary ink is solved against — which is why it is a shade deeper than the first draft, so a 6px track is visible against the canvas while small print on it still clears AA'),
  D('color-fill', 'token', '{root}', { '--sr-fill': 'rgba(29,29,31,.05)' },
    'hover fills are the INK at low alpha, so every wash belongs to the text colour instead of to a hue of its own'),
  D('color-fill2', 'token', '{root}', { '--sr-fill2': 'rgba(29,29,31,.028)' },
    'the faintest wash, for large quiet areas — zebra rows and disabled surfaces'),
  D('color-line', 'token', '{root}', { '--sr-line': '#e5e7eb' },
    'THE hairline, in the value the brief names. A flat neutral rather than a mix of the ink, so it stays 1px-pale on every surface instead of darkening over the sunken step'),
  D('color-line2', 'token', '{root}', { '--sr-line2': '#d1d5db' },
    'the stronger hairline, for a hover edge and a control border that has to be seen'),
  D('color-ink', 'token', '{root}', { '--sr-ink-base': '#1d1d1f' },
    'the ink the fills derive from: the primary text colour, so every wash tints toward the text'),
  D('color-fg', 'token', '{root}', { '--sr-fg': '#1d1d1f' },
    'primary text. 15.4:1 on white — NOT pure black, which the brief forbids and which reads as a default rather than a choice'),
  D('color-ink2', 'token', '{root}', { '--sr-fg2': '#4b5563' },
    'secondary text: 7.6:1 on white and 6.6:1 on the sunken step, so it is AA everywhere rather than only where it was checked'),
  D('color-ink3', 'token', '{root}', { '--sr-fg3': '#646973' },
    'tertiary text. The brief names #6b7280 for the secondary grey, and it FAILS as text on this palette: it measures 4.25:1 on the sunken step, under AA. That is not a matter of taste — solving for the background that would make it pass gives a NEGATIVE luminance, i.e. no light surface can satisfy it, so the ink is what has to move. #646973 is the nearest step that clears AA on every surface this panel puts small print on (sunken 4.84, white 5.51) while staying visibly lighter than the secondary ink above it'),
  D('color-accent', 'token', '{root}', { '--sr-accent': '#2563eb' },
    'the single accent the brief allows, for primary actions and selected state and nothing else. 5.2:1 as text on white AND 5.2:1 for white on top of it, so one value serves both directions'),
  D('color-accent-ink', 'token', '{root}', { '--sr-accent-ink': '#ffffff' },
    'the ink that sits ON the accent; white clears AA on this blue, which is why one accent value is enough'),
  D('color-accent-weak', 'token', '{root}', { '--sr-accent-weak': 'color-mix(in srgb, var(--sr-accent) 10%, transparent)' },
    'tinted fills follow the accent automatically instead of being a second hardcoded rgba'),
  D('color-accent-line', 'token', '{root}', { '--sr-accent-line': 'color-mix(in srgb, var(--sr-accent) 32%, transparent)' },
    'the accent as a border weight, for selected and pending states'),
  D('color-display', 'token', '{root}', { '--sr-display': '#2563eb' },
    'the accent again, under the name the graphics already use for it. Kept as an alias rather than duplicated so a large fill and a button cannot drift apart'),
  D('color-danger', 'token', '{root}', { '--sr-danger': '#c81e1e' },
    'a plain red rather than the old rose-red, and one step darker than the brief\'s #dc2626: that value measures 4.24:1 on the sunken step, under AA, and this panel puts destructive text on it. #c81e1e clears AA on every surface (sunken 5.04, white 5.74) while still reading as a signal red'),
  D('color-danger-weak', 'token', '{root}', { '--sr-danger-weak': 'color-mix(in srgb, var(--sr-danger) 9%, transparent)' },
    'destructive fills, kept quiet: delete is available, not urgent'),
  D('color-ok', 'token', '{root}', { '--sr-ok': '#0e7c5a' },
    'a standard green, one step darker than the brief\'s #059669 for the same reason as the danger: 3.31:1 on the sunken step is not readable, and success text appears in the rail and on cards. #0e7c5a clears AA on all four surfaces'),
  D('color-ok-weak', 'token', '{root}', { '--sr-ok-weak': 'color-mix(in srgb, var(--sr-ok) 9%, transparent)' },
    'success fills, same construction as the others'),
  D('color-warn', 'token', '{root}', { '--sr-warn': '#92400e' },
    'amber-darkened. The brief\'s #d97706 is 2.80:1 on the sunken step, and this is the plugin\'s CORE signal — the amber chip that says no skill was used this turn — so it has to be readable, not merely warm. #92400e is the deepest step of the same amber family and clears AA everywhere'),
  D('color-warn-weak', 'token', '{root}', { '--sr-warn-weak': 'color-mix(in srgb, var(--sr-warn) 10%, transparent)' },
    'its weak companion, for the chip the plugin exists to show. As a FILL it stays light: the raw hue is what a tinted background wants, and only the text-bearing token had to move'),
  D('color-scrim', 'token', '{root}', { '--sr-scrim': 'rgba(17,17,19,.32)' },
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
  //
  // FLATTENED, at the owner's request: "去除浓重的黑阴影". The old scale stacked two low-alpha layers per step and
  // justified it as depth; on a neutral canvas the stacking is what reads as 老旧粗糙感, because two overlapping
  // blurs produce a visible dark halo rather than a gradient.
  //
  // One shallow layer per step now. Elevation is carried by the SURFACES — canvas grey, card white, hairline
  // border — and shadow only lifts an element that genuinely floats. This is the same principle the dark palette
  // already had to follow, for the same reason.
  D('depth-raise', 'depth', '{root}', { '--sr-e1': '0 1px 2px rgba(17,17,19,.05)' },
    'elevation 1: one shallow layer. The border and the surface step do the rest of the work'),
  D('depth-hover', 'depth', '{root}', { '--sr-e2': '0 2px 4px -1px rgba(17,17,19,.07)' },
    'elevation 2: still one layer, a little lower and a little wider'),
  D('depth-overlay', 'depth', '{root}', { '--sr-e3': '0 8px 24px -8px rgba(17,17,19,.16)' },
    'elevation 3 is for the modal, which floats above everything and has to say so — the one place a real shadow earns its keep'),
  D('depth-ring', 'depth', '{root}', { '--sr-ring': '0 0 0 1px rgba(17,17,19,.06)' },
    'a 1px ring as a shadow: it follows the border radius exactly, which a border cannot do on a hover state'),
  D('depth-accent-glow', 'depth', '{root}', { '--sr-glow': 'none' },
    'the accent button casts NO shadow. A coloured glow under a primary action is the single clearest tell of an older interface, and the flat fill is what makes the one accent colour read as deliberate'),

  /* ============================ 5. frame ============================ */
  D('frame-radius', 'frame', '.sr-root', { borderRadius: 8 },
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
  D('frame-title-size', 'frame', '.sr-title', { fontSize: 14, fontWeight: 600, letterSpacing: '-.01em' },
    'the panel title is a heading and was set at 12.5px like a label'),
  D('frame-status-size', 'frame', '.sr-status', { fontSize: 12, letterSpacing: '.005em' },
    'the freshness readout is metadata and should be quiet but not microscopic'),
  D('frame-foot-size', 'frame', '.sr-foot', { fontSize: 11 },
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
  D('hero-radius', 'hero', '.sr-hero', { borderRadius: 8 },
    'one step inside the frame radius, so corners nest concentrically'),
  D('hero-rail', 'hero', '.sr-hero:before', { width: 3, background: 'var(--sr-accent)' },
    'a FLAT accent rail. The gradient was added because a flat 3px bar "reads as a rendering artifact" — what actually read that way was a bar with no radius sitting in a square corner, which is fixed below by matching the card corner instead of fading the colour out'),
  D('hero-rail-inset', 'hero', '.sr-hero:before', { left: 0, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
    'clipped to the card radius so the rail never leaves the corner'),
  D('hero-meta-size', 'hero', '.sr-hero-meta', { fontSize: 12, letterSpacing: '.01em', color: 'var(--sr-fg3)' },
    'the timestamp line under the headline is metadata and should look like it'),
  D('hero-empty-size', 'hero', '.sr-hero-empty', { fontSize: 12, lineHeight: 1.45, color: 'var(--sr-fg2)' },
    'a sentence the user must actually read, not a 12px whisper'),
  D('hero-line-gap', 'hero', '.sr-hero-line', { gap: 'calc(var(--sr-u) * 1.5)' },
    'the skill chips wrap on a narrow panel and need consistent gutters'),

  /* ============================ 7. stats ============================ */
  D('stat-bg', 'stat', '.sr-stat', { background: 'var(--sr-card)' },
    'stat cells are cards, not filled rectangles: the raised fill made them look disabled'),
  D('stat-border', 'stat', '.sr-stat', { borderColor: 'color-mix(in srgb, #111113 9%, transparent)' },
    'a visible hairline, since the fill is now the same as the panel'),
  D('stat-radius', 'stat', '.sr-stat', { borderRadius: 8 },
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
  D('stat-label-size', 'stat', '.sr-stat-l', { fontSize: 12, letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 550 },
    'micro-labels in caps are what make a big number read as a metric'),

  /* ============================ 8. sections ============================ */
  D('sec-rule', 'sec', '.sr-sec', { borderTopColor: 'color-mix(in srgb, #111113 7%, transparent)' },
    'section rules are the quietest line in the panel: structure, not content'),
  D('sec-head-pad', 'sec', '.sr-sec-h', { padding: 'calc(var(--sr-u) * 3) calc(var(--sr-u) * 4)' },
    'the header is a click target and needs a real row height'),
  D('sec-head-size', 'sec', '.sr-sec-h', { fontSize: 12, fontWeight: 700, letterSpacing: 'var(--sr-track-loose)' },
    'bold caps at 10.5px: the standard treatment for a section label that is not a heading'),
  D('sec-head-color', 'sec', '.sr-sec-h', { color: 'var(--sr-fg2)' },
    'ink2 rather than ink3: a section header is structure, and ink3 is for metadata'),
  D('sec-head-bg', 'sec', '.sr-sec-head', { background: 'color-mix(in srgb, var(--sr-card) 86%, transparent)' },
    'translucent, matching the main header it docks under'),
  D('sec-head-blur', 'sec', '.sr-sec-head', { WebkitBackdropFilter: 'blur(10px)', backdropFilter: 'blur(10px)' },
    'so a sticky section header never shows text sliding beneath it'),
  D('sec-hover-accent', 'sec', '.sr-sec-h:hover', { color: 'var(--sr-fg)', boxShadow: 'inset 2px 0 0 var(--sr-accent)' },
    'the inset accent bar marks WHICH section is hovered, and matches the hero rail language'),
  D('sec-pill-size', 'sec', '.sr-pill', { fontSize: 11, fontWeight: 600, minWidth: 22, lineHeight: '17px', borderRadius: 8 },
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
  D('btn-radius', 'btn', '.sr-btn', { borderRadius: 8 },
    '9px: pills are for chips. Buttons in a dense tool panel are rectangles with soft corners'),
  D('btn-height', 'btn', '.sr-btn', { lineHeight: '26px', paddingInline: 'calc(var(--sr-u) * 3)' },
    '26px tall: below that a button is not a comfortable click target'),
  D('btn-size', 'btn', '.sr-btn', { fontSize: 12, fontWeight: 550, letterSpacing: '.005em' },
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
  D('btn-sm-height', 'btn', '.sr-btn--sm', { lineHeight: '22px', fontSize: 12, paddingInline: 'calc(var(--sr-u) * 2.25)', borderRadius: 8 },
    'the small variant steps down in all four dimensions together, not only in font size'),
  D('btn-block-height', 'btn', '.sr-btn--block', { lineHeight: '32px', fontSize: 12, borderRadius: 8 },
    'the sheet\'s primary action is a full-width row and should look like one'),
  D('btn-accent-soft', 'btn', '.sr-btn--accent', { background: 'var(--sr-accent-weak)', color: 'var(--sr-accent)', borderColor: 'var(--sr-accent-line)' },
    'the conditional update button: tinted, because it is offered, not demanded'),
  D('btn-accent-soft-hover', 'btn', '.sr-btn--accent:hover:not(:disabled)', { background: 'var(--sr-accent)', color: 'var(--sr-accent-ink)', borderColor: 'transparent' },
    'and it commits to solid on hover, so the offer is obvious at the moment of intent'),

  /* ============================ 10. cards ============================ */
  D('card-radius', 'card', '.sr-skill', { borderRadius: 8 },
    'one step inside the panel radius: concentric corners are what make nesting look deliberate'),
  D('card-bg', 'card', '.sr-skill', { background: 'var(--sr-card)' },
    'cards are surfaces now, not a fill step'),
  D('card-border', 'card', '.sr-skill', { borderColor: 'color-mix(in srgb, #111113 9%, transparent)' },
    'a visible edge, since the fill matches the panel'),
  D('card-shadow', 'card', '.sr-skill', { boxShadow: 'var(--sr-e1)' },
    'the same elevation as a stat cell and a button: one system, three components'),
  D('card-hover', 'card', '.sr-skill:hover', { background: 'var(--sr-card)', borderColor: 'var(--sr-line2)', boxShadow: 'var(--sr-e2)', transform: 'translateY(-1px)' },
    'hover raises rather than tints, which is what makes a grid feel alive'),
  D('card-avatar-size', 'card', '.sr-avatar', { width: 30, height: 30, borderRadius: 8, fontSize: 12, fontWeight: 650 },
    'a 30px tile with a 13px initial: the old 26px tile made every card look like a table row'),
  D('card-avatar-ring', 'card', '.sr-avatar', { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.28), var(--sr-e1)' },
    'an inner ring plus the raise, so a saturated tile does not look printed on the card'),
  D('card-name-size', 'card', '.sr-skill-name', { fontSize: 14, fontWeight: 600, letterSpacing: 'var(--sr-track-tight)' },
    '12px semibold: the card title must outrank its own body text, and at 11.5/500 it did not'),
  D('card-slug-size', 'card', '.sr-skill-slug', { fontSize: 12, letterSpacing: '.02em' },
    'the slug is an identifier: mono, letterspaced, and clearly secondary'),
  D('card-blurb-size', 'card', '.sr-blurb', { fontSize: 13, lineHeight: 1.5, color: 'var(--sr-fg2)' },
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
  D('tag-size', 'meta', '.sr-tag', { fontSize: 11, fontWeight: 550, lineHeight: '17px', letterSpacing: '.01em', borderRadius: 6 },
    'tags are micro-labels: slightly heavier and letterspaced so they read at 10px. Radius 6 rather than 8, because a 17px-tall chip at 8 is already half-round and reads as a pill again'),
  D('tag-bg', 'meta', '.sr-tag', { background: 'var(--sr-sunken)', borderColor: 'transparent', color: 'var(--sr-fg2)' },
    'sunken, not outlined: a row of outlined chips looks like a form'),
  D('tag-used', 'meta', '.sr-tag--used', { background: 'var(--sr-accent-weak)', color: 'var(--sr-accent)', fontWeight: 600 },
    'the one tag that carries good news gets the accent, and semibold with it'),
  D('badge-size', 'meta', '.sr-badge', { fontSize: 11, fontWeight: 550, lineHeight: '20px', paddingInline: 'calc(var(--sr-u) * 2.25)', borderRadius: 6 },
    'badges sit in the hero and must be legible at a glance. Radius 6, the micro-label step'),
  D('badge-user', 'meta', '.sr-badge--user', { background: 'var(--sr-accent-weak)', color: 'var(--sr-accent)' },
    'the "you did this" badge is tinted with the accent rather than grey'),
  D('badge-none', 'meta', '.sr-badge--none', { background: 'var(--sr-warn-weak)', color: 'var(--sr-warn)', fontWeight: 600 },
    'the plugin\'s core signal: amber, semibold, and never the error colour'),
  D('share-track', 'meta', '.sr-share-track', { height: 8, borderRadius: 999, background: 'var(--sr-sunken)', boxShadow: 'none' },
    'a sunken well rather than a bordered bar: the track is a container, not a control'),
  D('share-fill', 'meta', '.sr-share-fill', { background: 'var(--sr-accent)', opacity: 1, borderRadius: 999 },
    'a FLAT accent fill. The gradient ran from 55% accent to full and was kept because a flat 75%-opacity bar read as a loading state — but the fix for that is opacity, not a gradient, and a two-stop ramp on a 6px bar is invisible detail that reads as a film-era UI'),
  D('share-name-size', 'meta', '.sr-share-name', { fontSize: 12, fontWeight: 550, letterSpacing: 'var(--sr-track-tight)' },
    'share names are skill slugs and should match the card titles'),
  D('share-n-size', 'meta', '.sr-share-n', { fontSize: 12, fontWeight: 550, color: 'var(--sr-fg2)' },
    'the count beside a bar needs to be readable as a number, not as a footnote'),
  D('share-row-pad', 'meta', '.sr-share', { padding: 'calc(var(--sr-u) * 1.75) 0' },
    'rows need a step more air now that the bar is thicker'),
  D('seg-track', 'meta', '.sr-seg', { background: 'var(--sr-sunken)', borderColor: 'transparent', borderRadius: 8, padding: 3 },
    'the segmented control is a well with a thumb in it'),
  D('seg-thumb', 'meta', '.sr-seg-ind', { borderRadius: 8, background: 'var(--sr-card)', boxShadow: 'var(--sr-e1)' },
    'the thumb is a raised card: that is what makes the selection readable as a position'),
  D('seg-btn-size', 'meta', '.sr-seg button', { fontSize: 13, lineHeight: '20px', fontWeight: 550, borderRadius: 8 },
    'segments step down in every dimension together, like the small button'),

  /* ============================ 12. timeline ============================ */
  D('time-rail', 'time', '.sr-time-rail:before', { width: 2, background: 'color-mix(in srgb, #111113 8%, transparent)' },
    'a 2px spine at 8%: a timeline rail is the quietest structure in the panel'),
  D('time-dot', 'time', '.sr-turn:before', { width: 9, height: 9, borderWidth: 1, borderColor: 'var(--sr-line2)', background: 'var(--sr-card)' },
    'a 9px dot with a 1px ring. It was 2px, which the brief removes: a thick ring on a 9px dot is a blob, and the hairline the rest of the sheet uses reads as precision at the same size'),
  D('time-dot-hot', 'time', '.sr-turn--hot:before', { borderColor: 'var(--sr-accent)', background: 'var(--sr-accent)', boxShadow: '0 0 0 3px var(--sr-card)' },
    'a turn that used a skill is filled and ringed, so the timeline is scannable without reading'),
  D('time-row-pad', 'time', '.sr-turn-h', { padding: 'calc(var(--sr-u) * 1.5) calc(var(--sr-u) * 2)', borderRadius: 8 },
    'rows are click targets and now have a shape and real padding'),
  D('time-row-hover', 'time', '.sr-turn-h:hover', { background: 'var(--sr-fill2)', boxShadow: 'inset 2px 0 0 var(--sr-accent)' },
    'the same inset-accent hover as a section header, so the panel has one interaction language'),
  D('time-age-size', 'time', '.sr-age', { fontSize: 11, fontWeight: 550, lineHeight: '18px' },
    'outcome chips are the second thing the eye should find on a row'),
  D('time-title-size', 'time', '.sr-turn-title', { fontSize: 12, color: 'var(--sr-fg)' },
    'the session title is CONTENT and was set in ink2 like metadata'),
  D('time-call-name', 'time', '.sr-call-name', { fontSize: 11, fontWeight: 550 },
    'the skill name in a call row is the content; the count is the annotation'),

  /* ============================ 13. toasts ============================ */
  D('toast-radius', 'toast', '.sr-toast', { borderRadius: 8, fontSize: 12, padding: 'calc(var(--sr-u) * 2.5) calc(var(--sr-u) * 3)' },
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
  D('toast-msg-size', 'toast', '.sr-toast-msg', { fontSize: 12, fontWeight: 550 },
    'the message is the payload'),
  D('toast-hint-size', 'toast', '.sr-toast-hint', { fontSize: 12, lineHeight: 1.5 },
    'hints contain paths and wrap to two or three lines'),

  /* ============================ 14. sheet ============================ */
  D('sheet-radius', 'sheet', '.sr-sheet', { borderRadius: 8 },
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
  D('sheet-sub-size', 'sheet', '.sr-sheet-sub', { fontSize: 12, lineHeight: 1.5, color: 'var(--sr-fg3)' },
    'the root path under the title is metadata, and it wraps, so it needs leading'),
  D('sheet-tabs-pad', 'sheet', '.sr-tabs', { padding: 'calc(var(--sr-u) * 2) calc(var(--sr-u) * 5) 0' },
    'the tabs align with the header inset, so the modal has one left edge'),
  D('sheet-tab-size', 'sheet', '.sr-tab', { fontSize: 13, fontWeight: 550, lineHeight: '30px', borderRadius: 8 },
    'tabs are the modal\'s navigation and need to look like a control row'),
  D('sheet-tab-underline', 'sheet', '.sr-tab[aria-selected="true"]::after', { height: 2, left: 'calc(var(--sr-u) * 2.5)', right: 'calc(var(--sr-u) * 2.5)' },
    'an inset underline reads as part of the tab rather than as a border on the track'),
  D('sheet-label-size', 'sheet', '.sr-label', { fontSize: 12, fontWeight: 600, letterSpacing: '.01em' },
    'form labels at 10.5px were the smallest text in the plugin, in the one place a mistake is costly'),
  D('sheet-input-size', 'sheet', '.sr-input, .sr-textarea', { fontSize: 13, lineHeight: '22px', padding: 'calc(var(--sr-u) * 2.25) calc(var(--sr-u) * 3)', borderRadius: 8 },
    'inputs at 12px with real padding: this is the field a user types a URL into'),
  D('sheet-input-bg', 'sheet', '.sr-input, .sr-textarea', { background: 'var(--sr-raised)', borderColor: 'color-mix(in srgb, #111113 13%, transparent)' },
    'a field must look like a field: the raised step plus a control-weight border'),
  D('sheet-input-focus', 'sheet', '.sr-input:focus, .sr-textarea:focus', { borderColor: 'var(--sr-accent)', boxShadow: '0 0 0 3px var(--sr-accent-weak)', background: 'var(--sr-card)' },
    'a 3px tinted ring plus the accent border: the strongest focus signal in the plugin, where it matters most'),
  D('sheet-note-pad', 'sheet', '.sr-note', { padding: 'calc(var(--sr-u) * 2.5) calc(var(--sr-u) * 3)', borderRadius: 8, borderLeftWidth: 3 },
    'notes are typed by a left rule and need padding to look deliberate'),
  D('sheet-drop-dash', 'sheet', '.sr-drop', { borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, background: 'var(--sr-raised)' },
    'a 1px dashed target at the one radius: the brief removes thick borders, and a dashed hairline still reads as a place rather than as a surface'),
  D('sheet-drop-over', 'sheet', '.sr-drop--over', { borderColor: 'var(--sr-accent)', background: 'var(--sr-accent-weak)', boxShadow: '0 0 0 3px var(--sr-accent-weak)' },
    'drag-over gets a tinted fill AND a ring, because it is a state the user must not miss'),
  D('sheet-preview', 'sheet', '.sr-preview', { borderRadius: 8, background: 'var(--sr-raised)', borderColor: 'color-mix(in srgb, #111113 9%, transparent)' },
    'the preview block groups what is about to be installed and is styled as a card'),
  D('sheet-foot-bg', 'sheet', '.sr-sheet-foot', { background: 'var(--sr-raised)', padding: 'calc(var(--sr-u) * 3.5) calc(var(--sr-u) * 5)' },
    'the action row is separated by a fill step and matches the header inset'),
  D('sheet-hist-size', 'sheet', '.sr-hist-row', { fontSize: 12, fontWeight: 500 },
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
  D('guide-radius', 'sec', '.sr-guide', { borderRadius: 8, borderStyle: 'dashed', borderWidth: 1.5, background: 'var(--sr-raised)' },
    'the cold-start block is an invitation, so a dashed edge reads as "space for you"'),
  D('guide-pad', 'sec', '.sr-guide', { padding: 'calc(var(--sr-u) * 5)', margin: 'calc(var(--sr-u) * 4)' },
    'the one block that replaces three placeholders deserves real air'),
  D('guide-title', 'sec', '.sr-guide-title', { fontSize: 13, fontWeight: 650, letterSpacing: 'var(--sr-track-tight)' },
    'it is a heading, not a caption'),
  D('guide-text', 'sec', '.sr-guide-text', { fontSize: 13, color: 'var(--sr-fg2)' },
    'the explanation is body copy'),
  D('guide-icon', 'sec', '.sr-guide .sr-ic', { color: 'var(--sr-accent)', width: 18, height: 18 },
    'one accent mark makes the block feel like a starting point rather than an error'),
  D('empty-pad', 'sec', '.sr-empty', { padding: 'calc(var(--sr-u) * 3) 0', fontSize: 11 },
    'an empty state occupies a block; a single 11px line makes the panel look truncated'),
  D('hint-size', 'sec', '.sr-hint', { fontSize: 11, lineHeight: 1.55 },
    'hints wrap in the narrow strip expansion and need leading'),
  D('skeleton-radius', 'sec', '.sr-skel--card', { height: 62, borderRadius: 8 },
    'the placeholder must match the card it stands in for, or the panel jumps when data lands'),
  D('skeleton-color', 'sec', '.sr-skel', { background: 'linear-gradient(90deg, var(--sr-sunken) 0%, var(--sr-fill) 50%, var(--sr-sunken) 100%)' },
    'a shimmer built from the surface ramp rather than an arbitrary grey'),
  D('kbd-radius', 'sec', '.sr-kbd', { borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 550, background: 'var(--sr-sunken)', borderColor: 'color-mix(in srgb, #111113 12%, transparent)' },
    'a key cap is a physical object: sunken, bordered, and its border-bottom does the thickness'),
  D('kbd-color', 'sec', '.sr-kbd', { color: 'var(--sr-fg2)' },
    'key caps are legible, unlike the 9.5px ink3 they used to be'),
  D('filter-bg', 'sec', '.sr-filter input', { background: 'var(--sr-raised)', borderColor: 'color-mix(in srgb, #111113 12%, transparent)', borderRadius: 8, fontSize: 12, lineHeight: '28px' },
    'the filter is a field and matches the sheet inputs'),
  D('filter-focus', 'sec', '.sr-filter input:focus', { borderColor: 'var(--sr-accent)', background: 'var(--sr-card)', boxShadow: '0 0 0 3px var(--sr-accent-weak)' },
    'one focus treatment across every field in the plugin'),
  D('chip-radius', 'sec', '.sr-chip', { borderRadius: 8, lineHeight: '22px', fontSize: 12, fontWeight: 550, paddingInline: 'calc(var(--sr-u) * 2.5)' },
    'chips are filters, not pills: a chip row of rounded pills reads as decoration'),
  D('chip-bg', 'sec', '.sr-chip', { background: 'var(--sr-card)', borderColor: 'color-mix(in srgb, #111113 12%, transparent)' },
    'an unselected chip is a small control and needs a surface'),
  D('chip-on', 'sec', '.sr-chip--on', { background: 'var(--sr-accent)', color: 'var(--sr-accent-ink)', borderColor: 'transparent', fontWeight: 600 },
    'the selected filter is SOLID: a tinted chip among outlined chips is too easy to miss'),
  D('chip-hover', 'sec', '.sr-chip:hover', { background: 'var(--sr-raised)', borderColor: 'var(--sr-line2)' },
    'hover steps the fill up, leaving the accent for selection only'),
  D('count-size', 'sec', '.sr-count', { fontSize: 11, fontWeight: 550 },
    'the result tally is a readout and should look like one'),
  D('status-dot-glow', 'frame', '.sr-status-dot', { boxShadow: '0 0 0 3px var(--sr-ok-weak)' },
    'a live connection indicator with a halo: a bare 6px dot reads as dirt on the screen'),
  D('foot-dot', 'frame', '.sr-foot .sr-status-dot', { width: 7, height: 7 },
    'the footer status dots are the smallest signal and get a step up'),
  D('foot-gap', 'frame', '.sr-foot', { columnGap: 'calc(var(--sr-u) * 3)', rowGap: 'calc(var(--sr-u) * 1.5)' },
    'the footer wraps on a narrow panel and needs gutters in both directions'),
  D('foot-mono-size', 'frame', '.sr-foot-mono', { fontSize: 11 },
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
  D('preview-name-size', 'sheet', '.sr-preview-name', { fontSize: 13, fontWeight: 600 },
    'the name about to be installed is the most important text in the preview'),
  D('preview-desc-size', 'sheet', '.sr-preview-desc', { fontSize: 13, color: 'var(--sr-fg2)' },
    'the description is body copy'),
  D('preview-meta-size', 'sheet', '.sr-preview-meta', { fontSize: 13 },
    'the file count and size are metadata'),
  D('label-opt', 'sheet', '.sr-label .sr-opt', { fontSize: 12, letterSpacing: 0, fontWeight: 450 },
    'the optional marker must not inherit the label weight it sits beside'),
  D('counter-size', 'sheet', '.sr-counter', { fontSize: 11, fontWeight: 550 },
    'the character counter is checked against a limit and should be readable'),
  D('check-size', 'sheet', '.sr-check', { fontSize: 12, lineHeight: 1.5 },
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
  D('card-tags', 'card', '.sr-skill-tags', { flex: 'none', display: 'flex', alignItems: 'center', gap: 'calc(var(--sr-u) * 1.25)', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '55%', alignSelf: 'center' },
    'tags sit at the end of the name row and wrap rather than squeeze the name'),
  // MEASURED, and it does not follow from the CSS: the tag row came out 38px wide by 200px
  // TALL, dragging `.sr-skill-head` to 200px and turning each tag pill into a 160px blob with
  // 198px of leading. Only one rule names that element, it sets no height, and its parent is
  // `align-items:center` — yet Chrome stretched it, and it kept stretching even with
  // `max-height` on the row and `align-self` on both the row and the pills.
  //
  // So the fix is not an explanation, it is a structure that cannot do it: a FIXED height on
  // the row, `flex-start` alignment so nothing is asked to fill a column, and the pills sized
  // from their own line box. A tag row is one or two lines of small print; there is no reason
  // for it to be able to grow at all.
  D('card-tags-clamp', 'card', '.sr-skill-tags', {
    alignSelf: 'flex-start',
    height: 20,
    maxHeight: 20,
    overflow: 'hidden',
    flexWrap: 'nowrap',
  }, 'a fixed 20px tag row: one line of tags, and structurally unable to stretch'),
  D('card-tag-pill', 'card', '.sr-tag', {
    alignSelf: 'center',
    height: 19,
    maxHeight: 19,
    lineHeight: '17px',
    whiteSpace: 'nowrap',
  }, 'and pills sized from their own line box rather than from the row'),
  // THE fix for the truncation. A skill name must not be cut off, so it wraps; and
  // `overflow-wrap:anywhere` matters because a slug is one unbroken token —
  // `paper-collage-explainer-generator` has no space to wrap at and would overflow instead.
  D('card-name-wrap', 'card', '.sr-skill-name', { overflow: 'visible', textOverflow: 'clip', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35, maxWidth: '100%' },
    'the name shows IN FULL and wraps: cutting off the one identifier a user needs is worse than a taller card'),
  D('card-slug-wrap', 'card', '.sr-skill-slug', { overflow: 'visible', textOverflow: 'clip', whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%' },
    'and the slug under it, for the same reason'),
  D('card-main-full', 'card', '.sr-skill-main', { flex: '0 0 auto', minWidth: 0 },
    'the text block no longer shares a row with the actions, so it must not stretch'),
  D('card-actions-row', 'card', '.sr-card-foot .sr-row-actions', { width: '100%', justifyContent: 'center', flexWrap: 'wrap', rowGap: 'calc(var(--sr-u) * 1.5)', columnGap: 'calc(var(--sr-u) * 1.5)' },
    'the actions own the last row and are CENTRED in it, at the owner\'s request: with the switch gone the row is 引用 plus three or four icons, and left-aligned it read as a stranded fragment under a full-width blurb'),
  /* ---- the card footer: calls | actions | source, on ONE line ----
   *
   * "来源说明...希望显示在右下角和引用这一列对齐" and "卡片左下角显示调用次数". Both were rows of their own above
   * the actions, which put the provenance in the middle of the card and the count nowhere.
   *
   * `auto 1fr auto` rather than three equal columns: the side columns are sized by their content, and the middle
   * takes the rest — so the ACTIONS end up centred in the CARD, not merely in whatever space the side columns
   * leave over. With equal columns a long source label would push the buttons off centre.
   */
  D('r-card-foot-row', 'card', '.sr-card-foot-row', {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'center',
    columnGap: 'calc(var(--sr-u) * 2)',
    width: '100%',
    marginTop: 'auto',
  }, 'the card footer is one line of three columns: call count, actions, source'),
  // The row keeps `flex-start` as its base rule and is centred only INSIDE the footer.
  //
  // The base rule is asserted by the polish gate and describes the generic row; the footer is the one place that
  // wants centring, and giving it an extra class is how this project has resolved cascade-order questions
  // before — a later-emitted same-specificity record would silently lose.
  //
  // The middle column, and the rule is not decoration: `min-width:0` is what lets it shrink below its content's
  // intrinsic width so a long source label beside it cannot force the row to overflow the card.
  D('r-card-actions', 'card', '.sr-card-actions', { minWidth: 0, display: 'flex', justifyContent: 'center' },
    'the actions column takes the middle of the footer and yields width rather than overflowing'),
  // `flex-wrap:nowrap` and a lifted `width:100%` are both load-bearing.
  //
  // A card is ~290px and this line carries a count, four buttons and a source label. With the base rule's
  // `width:100%` the row demanded the full column and then wrapped; with `flex-wrap:wrap` it broke onto a second
  // and third line and the three columns stopped being a line at all. MEASURED in the preview before and after.
  D('r-card-foot-actions', 'card', '.sr-card-foot-row .sr-row-actions', { justifyContent: 'center', flexWrap: 'nowrap', width: 'auto', minWidth: 0 },
    'inside the footer the action row is centred, never wraps, and takes only the width it needs'),
  D('r-card-calls', 'card', '.sr-card-calls', {
    fontVariantNumeric: 'tabular-nums',
    fontSize: 12,
    color: 'var(--sr-fg3)',
    whiteSpace: 'nowrap',
  }, 'the call count sits in the card\'s bottom-left, small and quiet'),
  D('r-card-src', 'card', '.sr-card-src', { display: 'flex', justifyContent: 'flex-end', minWidth: 0, overflow: 'hidden', flex: '1 1 auto' },
    'and the source is hard against the right edge, level with the action row, giving way when the line is tight'),
  // The source label gives way rather than pushing the row apart: it is the one item here that can be shortened
  // without losing meaning, and its full text is in the element's `title`.
  D('r-card-src-clip', 'card', '.sr-card-src .sr-src', { minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
    'the source label ellipsises instead of wrapping the footer onto a second line'),
  // The on/off switch in the card's head row, pushed to the far edge.
  //
  // `margin-left:auto` rather than `justify-content:space-between` on the head: the head also holds the avatar
  // and the text column, and space-between would spread all three apart instead of only sending the last one to
  // the corner. `align-self:flex-start` keeps it level with the NAME rather than centred against a name that
  // has wrapped to two lines — "和名字对齐" is the request, and centring is what it did before.
  D('r-toggle-head', 'card', '.sr-toggle-head', { marginLeft: 'auto', alignSelf: 'flex-start', flex: 'none' },
    'the switch sits in the name row, hard against the card\'s right edge, level with the title'),
  // Five labelled buttons do not fit a ~290px card at the base size, and a wrapped button row
  // is what made the card look like a toolbar. The compact size is the fix.
  D('card-actions-compact', 'card', '.sr-card-foot .sr-btn', { fontSize: 12, paddingInline: 'calc(var(--sr-u) * 2.25)' },
    'inside a card the buttons step down one size so the row fits on one or two lines, not four'),
  D('card-actions-icon', 'card', '.sr-card-foot .sr-btn--icon', { width: 26, height: 26 },
    'and the icon buttons match that step, so the row has one height'),
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
  D('release-note', 'frame', '.sr-release-note', { fontSize: 12, fontWeight: 600, letterSpacing: '.02em', color: 'var(--sr-accent)', whiteSpace: 'nowrap' },
    'the header has room to SAY "可更新 4.1.0" instead of making the user hover to find out'),
  D('release-note-ok', 'frame', '.sr-release-note--ok', { color: 'var(--sr-ok)' },
    '"已是最新" is good news and wears the success colour, not the accent'),

  /* ============================ 20. frosted glass, and a readable card scale ======== */
  //
  // The user's report was simply "界面很丑陋", and measurement agreed: content text sat at
  // 10–11.5px against a host body of 14px, so the panel read as a shrunk screenshot. These
  // records raise the content floor and give the surface a frosted, floating character.
  //
  // CONSTRAINT, and it is a hard one: NONE of this may be applied to `.sr-strip-shell`,
  // `.sr-root`, `.sr-rail` or `.sr-portal-host`. `backdrop-filter` — like transform, filter and
  // contain — makes an element a CONTAINING BLOCK for fixed-position descendants, and
  // `.sr-backdrop` is `position:fixed; inset:0` inside that subtree, so a blurred shell would
  // re-break the centred install dialog (the bug 4.0.2 just fixed). `.sr-head` / `.sr-foot` /
  // `.sr-sec-head` are safe: they are inside the panel, not ancestors of the backdrop.
  D('frost-head', 'frame', '.sr-head', {
    background: 'color-mix(in srgb, var(--sr-card) 62%, transparent)',
    backdropFilter: 'saturate(1.7) blur(14px)',
    WebkitBackdropFilter: 'saturate(1.7) blur(14px)',
    borderBottomColor: 'color-mix(in srgb, var(--sr-line) 60%, transparent)',
  }, 'the header floats over the list instead of being an opaque bar: 62% + a 14px blur'),
  // ---- the wash behind the glass -------------------------------------------------------
  //
  // FLATTENED. This was three very low-opacity radial washes — accent, amber and accent again — placed so the
  // frosted header had something to blur. It worked, and it is exactly the decoration the brief removes: a
  // coloured haze behind the glass is the single most recognisable mark of the 2021-era frosted panel, and on a
  // neutral canvas three tinted washes also reintroduce the colour the palette just gave up.
  //
  // The header is still frosted, and it still has something to blur: the CONTENT scrolling under it. That is what
  // a translucent surface is FOR, and it does not need a gradient behind it to prove the point.
  D('wash-backdrop', 'frame', '.sr-body', { backgroundImage: 'none' },
    'the decorative radial washes are gone: a translucent header blurs the content under it, which is the real thing glass is for'),
  D('wash-root', 'frame', '.sr-root', { backgroundImage: 'none' },
    'and the panel takes the flat canvas, so the surface steps are the only thing separating the regions'),
  D('hero-display', 'hero', '.sr-hero-spark', { color: 'var(--sr-display)' },
    'the sparkline is a graphic, not text, so it can carry the card\'s full-chroma blue that the accent cannot'),
  D('frost-foot', 'frame', '.sr-foot', {
    background: 'color-mix(in srgb, var(--sr-card) 58%, transparent)',
    backdropFilter: 'saturate(1.7) blur(14px)',
    WebkitBackdropFilter: 'saturate(1.7) blur(14px)',
    borderTopColor: 'color-mix(in srgb, var(--sr-line) 45%, transparent)',
  }, 'and the footer matches, so the two sticky edges read as one material'),
  D('float-card', 'card', '.sr-skill', {
    boxShadow: 'var(--sr-e2)',
    borderColor: 'color-mix(in srgb, var(--sr-line) 72%, transparent)',
    borderRadius: 8,
  }, 'a softer border and a deeper shadow, so a card floats instead of being outlined'),
  D('float-hero', 'hero', '.sr-hero', {
    boxShadow: 'none',
    border: '1px solid color-mix(in srgb, var(--sr-line) 55%, transparent)',
  }, 'the hero is a summary strip, not a card: flat and translucent, no float'),
  // ---- the readable content scale: this is the actual fix for "ugly" ----
  //
  // The first pass of this block got the RELATIVE sizes wrong and looking at the render is the
  // only reason it was caught: at 26px the four stat numbers were twice the size of a skill
  // name, so the diagnostic figures shouted while the browsable catalogue whispered. A summary
  // is not the content.
  D('type-stat-v', 'stat', '.sr-stat-v', { fontSize: 20, fontWeight: 650, lineHeight: 1.1 },
    '20px, not 26px: the counters summarise the list, they are not the thing being read'),
  D('type-name', 'card', '.sr-skill-name', { fontSize: 14, lineHeight: 1.4, fontWeight: 600 },
    'the skill name is what gets scanned, and 12px made it the same size as its own description'),
  D('type-blurb', 'card', '.sr-blurb', { fontSize: 13, lineHeight: 1.5 },
    'the description is how you choose between skills, so it is content, not a footnote'),
  D('type-src', 'meta', '.sr-src', { fontSize: 11, lineHeight: 1.6, color: 'var(--sr-fg2)' },
    'provenance was the smallest, faintest text on the card while being the reason to trust or update it'),
  D('type-src-bare', 'meta', '.sr-src--bare', { color: 'var(--sr-fg3)' },
    'with no recorded source the line carries only the cues, so it steps back a notch'),
  D('type-tag', 'meta', '.sr-tag', { fontSize: 11, lineHeight: 18 },
    'tags rise with everything else, and lose the pill fill: a pill reads as "clickable"'),
  D('avatar-neutral', 'card', '.sr-avatar', {
    background: 'var(--sr-sunken)',
    color: 'var(--sr-fg2)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--sr-line) 80%, transparent)',
  }, 'an UNMARKED skill is a quiet sunken tile — a coloured tile now means "I marked this one"'),
  D('avatar-marked', 'card', '.sr-avatar--marked', {
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.24)',
  }, 'a marked tile gets a hairline of its own colour, so a dark swatch does not read as a hole'),
  D('avatar-btn', 'card', '.sr-avatar-btn', {
    flex: 'none',
    // `display:flex` + `line-height:0`, NOT `display:block`.
    //
    // Measured: as a plain block this element is a flex item of `.sr-skill-head` with
    // `align-items:center`, so it STRETCHES to the row's height — and it took the avatar with
    // it. The head row came out 200px tall and the tile rendered as a giant oval. A flex box
    // whose size comes from its single child cannot stretch that way, and `line-height:0`
    // removes the inline-box strut that would otherwise add a few pixels under the tile.
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 0,
    background: 'none',
    cursor: 'pointer',
    borderRadius: 8,
    lineHeight: 0,
  }, 'the avatar is the colour affordance, so it is clickable without looking like a button'),
  D('avatar-btn-tile', 'card', '.sr-avatar-btn .sr-avatar', { flex: 'none' },
    'and inside it the tile keeps its 30x30 size instead of filling the button'),
  D('avatar-btn-focus', 'a11y', '.sr-avatar-btn:focus-visible .sr-avatar', { outline: '2px solid var(--sr-accent)', outlineOffset: 2 },
    'focus lands on the wrapper, so the ring has to be drawn on the tile inside it'),
  D('palette-row', 'card', '.sr-palette-row', {
    alignSelf: 'stretch', width: '100%', marginTop: 'calc(var(--sr-u) * .5)', paddingTop: 'calc(var(--sr-u) * 2)',
    borderTop: '1px solid var(--sr-line)',
  }, 'the palette is its own row at card width, never a child of the button row'),
  D('swatches', 'card', '.sr-swatches', { display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--sr-u) * 2)', alignItems: 'center' },
    'eight swatches plus a reset, wrapping on a narrow card'),
  D('swatch', 'card', '.sr-swatch', {
    width: 20, height: 20, borderRadius: 999, border: '1px solid color-mix(in srgb, #111113 14%, transparent)',
    padding: 0, cursor: 'pointer', flex: 'none',
  }, 'a 20px dot: big enough to hit with a mouse, small enough that nine fit one row'),
  D('swatch-on', 'card', '.sr-swatch--on', { boxShadow: '0 0 0 2px var(--sr-card), 0 0 0 4px var(--sr-accent)' },
    'the chosen swatch is ringed with a gap, so the ring reads against any swatch colour'),
  D('swatch-none', 'card', '.sr-swatch--none', {
    background: 'var(--sr-sunken)', color: 'var(--sr-fg3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }, 'the reset swatch shows the neutral tile itself, so "no colour" looks like what you get'),

  /* ============================ 21. the refinement pass ============================
   *
   * Sourced from the aesthetic references rather than from taste: the glassmorphism recipe
   * (translucent fill + translucent border + blur, over a gradient), the "tight inside, loose
   * outside" spacing rule, and the 8-point grid. Each record is one decision and is asserted by
   * count in test/ui-polish.mjs, so this block cannot quietly shrink.
   */
  // ---- spacing: tight inside a card, loose between cards (the single most-cited rule) -----
  D('r-space-card-pad', 'space', '.sr-skill', { padding: 12 },
    'card padding 12, not 14: with the type scale tightened, 14 left the card reading loose against its own contents'),
  // The card's rows are spread over its full height rather than stacked at the top.
  //
  // The grid stretches every card in a row to the tallest, and one card carries 3–4 blurb lines where its
  // neighbour carries 1–2, so a short card used to end with a band of empty space BELOW its buttons: it read
  // as top-heavy and the rows across a row of cards visibly did not line up. Spreading the slack into the gaps
  // gives the content the card's whole height instead of the first two thirds of it, which is what "整体居中
  // 显示" describes — the content sits in the middle of the box rather than at the start of it.
  D('r-space-card-spread', 'space', '.sr-skill', { justifyContent: 'space-between' },
    'the card distributes its rows over its full height instead of stacking them at the top'),
  D('r-space-card-gap', 'space', '.sr-skill', { gap: 12 },
    'and one gap between its rows: 14 inside, 12 between rows, 16 between cards — three tiers'),
  D('r-space-grid-gap', 'space', '.sr-grid', { gap: 16 },
    'between cards is the LARGEST of the three tiers, which is what makes them read as objects'),
  D('r-space-group', 'space', '.sr-group', { marginTop: 28 },
    'between groups is larger again: 14 < 16 < 28 is the whole spacing hierarchy'),
  D('r-space-body', 'space', '.sr-body', { paddingInline: 16 },
    'the body inset matches the header padding, so the left edge is one straight line'),
  D('r-space-sec', 'space', '.sr-sec', { marginTop: 20 },
    'a section break is smaller than a group break: nesting is communicated by spacing alone'),
  // ---- radii: ONE value, at the owner's request --------------------------------------------
  //
  // "圆角统一为 6px-8px". The system had three (card 14 / control 9 / pill 999) and the pill family had grown to
  // roughly thirty records — buttons, inputs, chips, tabs, swatches, tabs' thumbs, counters, badges. It arrived
  // there legitimately (the owner asked for the buttons to be 椭圆, and the rest followed), but a pill button beside
  // a 14px card is two systems, and "统一" is the point of this pass.
  //
  // 8 for everything, because it is the top of the range and it is what reads as a considered control at a 28px
  // height, where 6 would look sharp. The exceptions are round by NATURE rather than by style — the switch track,
  // a circular swatch, a progress bar — and each one says so where it is declared.
  D('r-radius-card', 'card', '.sr-skill', { borderRadius: 8 },
    'the single radius: cards, the panel, controls, fields and chips all take 8'),
  D('r-radius-control', 'btn', '.sr-btn', { borderRadius: 8 },
    'controls share the card value now — that sameness IS the request'),
  D('r-radius-input', 'sheet', '.sr-input', { borderRadius: 8 },
    'inputs match controls, so a field and a button in one row have the same corner'),
  D('r-radius-tile', 'card', '.sr-avatar', { borderRadius: 8 },
    'the avatar tile is a square control with the one radius, not a circle'),
  // ---- borders: fewer of them, and lighter where they stay -------------------------------
  D('r-border-card', 'card', '.sr-skill', { borderColor: 'color-mix(in srgb, var(--sr-line) 60%, transparent)' },
    'a card border at 60% of the hairline: the shadow does the separating, not the line'),
  D('r-border-btn', 'btn', '.sr-btn', { borderColor: 'color-mix(in srgb, var(--sr-line) 80%, transparent)' },
    'buttons keep a slightly firmer edge because they are targets, not containers'),
  D('r-border-input', 'sheet', '.sr-input', { borderColor: 'color-mix(in srgb, var(--sr-line) 85%, transparent)' },
    'a field edge has to be findable: inputs are the one place a clear border earns its keep'),
  D('r-border-tag', 'meta', '.sr-tag', { borderColor: 'transparent' },
    'tags lose their outline entirely: a filled pill needs no stroke'),
  D('r-border-sec', 'sec', '.sr-sec', { borderTopColor: 'color-mix(in srgb, var(--sr-line) 45%, transparent)' },
    'section rules go lighter than card edges, so the eye sorts them below content'),
  // ---- type: tracking and weight follow size ---------------------------------------------
  D('r-type-tight-xl', 'type', '.sr-stat-v', { letterSpacing: '-.028em' },
    'large numerals want negative tracking; the browser default looks loose above 18px'),
  D('r-type-tight-lg', 'type', '.sr-title', { letterSpacing: '-.011em' },
    'the panel title is 13px semibold, so it takes a light negative step, not the display value'),
  D('r-type-body-normal', 'type', '.sr-blurb', { letterSpacing: '0' },
    'body copy sits at zero tracking: negative tracking on small text costs legibility'),
  D('r-type-caps-loose', 'type', '.sr-statcard--inline .sr-stat-l', { letterSpacing: '.055em' },
    'uppercase micro-labels need positive tracking; this is the same value the loose token holds'),
  D('r-type-weight-title', 'type', '.sr-title', { fontWeight: 620 },
    'between 600 and 700: at 13px the heavier weight closes the counters of CJK glyphs'),
  D('r-type-weight-name', 'type', '.sr-skill-name', { fontWeight: 600 },
    'names sit at 600 and descriptions at 400; that gap IS the hierarchy on a card'),
  D('r-type-weight-label', 'type', '.sr-tag', { fontWeight: 520 },
    'micro-labels step just above body weight so they hold at 11px without looking bold'),
  D('r-type-line-blurb', 'type', '.sr-blurb', { lineHeight: 1.55 },
    '1.55 for running text: at 12.5px the difference from 1.5 is visible over three lines'),
  D('r-type-line-meta', 'meta', '.sr-src', { lineHeight: 1.5 },
    'metadata reads as one line, so it gets a tighter leading than the blurb'),
  D('r-type-num-stat', 'stat', '.sr-stat-v', { fontVariantNumeric: 'tabular-nums' },
    'live counters with proportional digits jitter on every poll'),
  D('r-type-num-share', 'stat', '.sr-share-n', { fontVariantNumeric: 'tabular-nums' },
    'and so does the share figure, which updates with the same timer'),
  D('r-type-num-time', 'time', '.sr-age', { fontVariantNumeric: 'tabular-nums' },
    'and the age column, which ticks every second'),
  // ---- depth: one light source, top-down -------------------------------------------------
  D('r-depth-card', 'card', '.sr-skill', { boxShadow: 'var(--sr-e2)' },
    'cards sit at e2: lifted, but below anything that floats over them'),
  D('r-depth-card-hover', 'card', '.sr-skill:hover', { boxShadow: 'var(--sr-e3)' },
    'hover raises one level — the only motion that is not a colour change'),
  D('r-depth-head', 'frame', '.sr-head', { boxShadow: 'none' },
    'the header casts nothing at rest: a sticky bar with a shadow reads as a second card'),
  D('r-depth-foot', 'frame', '.sr-foot', { boxShadow: 'none' },
    'same for the footer, so the two sticky edges bracket the content instead of boxing it'),
  D('r-depth-btn', 'btn', '.sr-btn', { boxShadow: 'var(--sr-e1)' },
    'controls take the smallest shadow, which is what makes them look pressable'),
  D('r-depth-btn-hover', 'btn', '.sr-btn:hover:not(:disabled)', { boxShadow: 'var(--sr-e2)' },
    'and step up one level on hover, matching the card behaviour'),
  D('r-depth-primary', 'btn', '.sr-btn--primary', { boxShadow: 'var(--sr-glow)' },
    'the primary action carries the accent-tinted glow instead of a grey shadow'),
  D('r-depth-input-focus', 'sheet', '.sr-input:focus', { boxShadow: '0 0 0 3px var(--sr-accent-weak)' },
    'focus is a soft 3px halo, not a hard ring: it has to be visible without being shouty'),
  D('r-depth-inset-track', 'stat', '.sr-share-track', { boxShadow: 'inset 0 1px 2px rgba(28,25,23,.06)' },
    'tracks read as recessed, so the fill appears to sit inside them'),
  // ---- controls: states, hit area, quiet defaults ----------------------------------------
  D('r-ctrl-hit', 'btn', '.sr-btn', { minHeight: 28 },
    'every control is at least 28px tall, so a row of them has one baseline'),
  D('r-ctrl-icon-square', 'btn', '.sr-btn--icon', { width: 28, height: 28, padding: 0 },
    'icon buttons are exact squares: a 12px icon in a padded box drifts off-centre'),
  D('r-ctrl-disabled', 'btn', '.sr-btn:disabled', { opacity: 0.42, cursor: 'not-allowed' },
    'disabled reads as unavailable at a glance, and the cursor says why'),
  D('r-ctrl-armed', 'btn', '.sr-btn--armed', { boxShadow: '0 0 0 2px var(--sr-danger-weak)' },
    'an armed destructive button gets a halo: the second click is the dangerous one'),
  D('r-ctrl-accent-quiet', 'btn', '.sr-btn--accent', { background: 'var(--sr-accent-weak)', borderColor: 'var(--sr-accent-line)' },
    'a "something is available" button is tinted, not filled — it must not outrank 引用'),
  D('r-ctrl-toggle-off', 'btn', '.sr-btn--toggle:not(.sr-btn--on)', { background: 'transparent', borderColor: 'var(--sr-line)' },
    'the OFF switch is an outline: an unpressed control should not carry a fill'),
  D('r-ctrl-chip', 'sec', '.sr-chip', { borderRadius: 8 },
    'filter chips are pills while buttons are not, which is how the two read differently'),
  D('r-ctrl-chip-on', 'sec', '.sr-chip--on', { background: 'var(--sr-accent-weak)', borderColor: 'var(--sr-accent-line)', color: 'var(--sr-fg)' },
    'a selected chip is tinted with the accent rather than inverted to solid'),
  D('r-ctrl-tab', 'sheet', '.sr-tab', { borderRadius: 8 },
    'tabs join the control radius, so the sheet has the same corner language as the panel'),
  // ---- surfaces: the frosted family ------------------------------------------------------
  D('r-surface-sheet', 'sheet', '.sr-sheet', { background: 'color-mix(in srgb, var(--sr-card) 92%, transparent)' },
    'the dialog is 92% opaque: enough glass to belong to the family, enough body to be read'),
  D('r-surface-sheet-blur', 'sheet', '.sr-sheet', {
    backdropFilter: 'saturate(1.6) blur(20px)',
    WebkitBackdropFilter: 'saturate(1.6) blur(20px)',
  }, 'and it blurs the page behind it at 20px, which is what makes it feel lifted off the page'),
  D('r-surface-scrim', 'sheet', '.sr-backdrop', { background: 'color-mix(in srgb, #1c1917 42%, transparent)' },
    'a warm scrim: a blue-black one over a warm panel looked like a colour cast'),
  D('r-surface-toast', 'toast', '.sr-toast', { background: 'color-mix(in srgb, var(--sr-card) 96%, transparent)' },
    'toasts are near-opaque because they carry text that has to be read at a glance'),
  D('r-surface-hero', 'hero', '.sr-hero', { background: 'color-mix(in srgb, var(--sr-raised) 70%, transparent)' },
    'the hero is translucent so the wash behind it shows through'),
  // ---- interaction polish -----------------------------------------------------------------
  D('r-focus-ring', 'a11y', '.sr-btn:focus-visible', { outline: '2px solid var(--sr-accent)', outlineOffset: 2 },
    'one focus treatment everywhere: the browser default disagrees with the palette'),
  D('r-focus-tight', 'a11y', '.sr-chip:focus-visible', { outlineOffset: 1 },
    'chips sit in a tight row, so their ring closes in by a pixel rather than overlapping'),
  D('r-select-accent', 'a11y', '.sr-input', { caretColor: 'var(--sr-accent)' },
    'the caret takes the accent, so typing feels like part of the panel'),
  D('r-select-none-btn', 'btn', '.sr-btn', { userSelect: 'none' },
    'a double-click on a button must not select its label'),
  D('r-cursor-pointer', 'btn', '.sr-chip', { cursor: 'pointer' },
    'a chip is a button, so it says so with the cursor'),
  D('r-no-tap-highlight', 'btn', '.sr-btn', { WebkitTapHighlightColor: 'transparent' },
    'the mobile tap flash is a different colour language entirely'),
  D('r-scroll-gutter', 'frame', '.sr-body', { scrollbarGutter: 'stable' },
    'reserve the scrollbar track, so the layout does not jump when the list grows'),
  D('r-overscroll', 'frame', '.sr-body', { overscrollBehavior: 'contain' },
    'scrolling to the end of the panel must not scroll the page behind it'),
  D('r-transition-tokens', 'frame', '{root}', { '--sr-speed-fast': '.11s', '--sr-speed-slow': '.22s' },
    'three durations rather than one: a hover is faster than an expansion'),
  D('r-transition-hover', 'frame', '.sr-skill', { transition: 'box-shadow var(--sr-speed-fast) var(--sr-ease), border-color var(--sr-speed-fast) var(--sr-ease)' },
    'hover moves only shadow and border — transform on a grid item causes a repaint ripple'),
  D('r-reduced-motion', 'a11y', '.sr-toast', { animationDuration: '.01ms' },
    'the reduced-motion block also shortens the toast, not only the sheet'),
  // ---- texture: the small things that make it look designed ------------------------------
  //
  // The fading section rule is GONE. It was a `border-image` gradient that dissolved the hairline at both ends, on
  // the reasoning that a full-bleed rule looks like a table edge. On a neutral palette the fix for that is a rule
  // that stops short of the edges, not one that fades — and a gradient border is the kind of detail that reads as
  // effort rather than as precision. The base `.sr-sec` keeps its plain 1px top border.
  D('r-avatar-ring', 'card', '.sr-avatar', { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.35)' },
    'a 1px inner highlight on the tile, the same trick that makes a button feel physical'),
  D('r-avatar-letter-tight', 'card', '.sr-avatar', { letterSpacing: '-.02em' },
    'a single letter at 13px needs tightening or it sits off-centre in its tile'),
  D('r-pill-tabular', 'meta', '.sr-pill', { fontVariantNumeric: 'tabular-nums' },
    'counts in pills change while polling; proportional digits make the pill twitch'),
  D('r-empty-quiet', 'sec', '.sr-empty', { color: 'var(--sr-fg3)', fontSize: 11 },
    'an empty state is informational text, not a heading'),
  D('r-hint-quiet', 'sec', '.sr-hint', { color: 'var(--sr-fg3)' },
    'hints recede: they are read once and then never again'),
  D('r-kbd-look', 'meta', '.sr-kbd', { borderRadius: 6, borderBottomWidth: 1 },
    'key caps: the heavier bottom edge is gone with the other thick borders — a 1px bottom plus the sunken fill and the 6px radius is what makes a cap read as a cap at this size'),
  D('r-badge-dot', 'hero', '.sr-badge', { gap: 6 },
    'the badge dot needs separating from its label or it reads as a bullet'),
  D('r-turn-rule', 'time', '.sr-turn', { borderTopColor: 'color-mix(in srgb, var(--sr-line) 50%, transparent)' },
    'turn separators are lighter than section rules: they are the finest division in the panel'),
  D('r-share-fill-round', 'stat', '.sr-share-fill', { borderRadius: 999 },
    'a 7px track takes a pill fill; a square end inside a round track shows'),
  D('r-share-track-round', 'stat', '.sr-share-track', { borderRadius: 999 },
    'and the track matches it, so the pair reads as one gauge'),
  D('r-guide-icon', 'sec', '.sr-guide .sr-ic', { marginTop: 1 },
    'the leading icon in the guide block is optically aligned to the first text line'),
  D('r-title-balance', 'frame', '.sr-title', { textWrap: 'balance' },
    'a wrapped title breaks evenly instead of leaving one word on the second line'),
  // The warm-ink shadow override that used to sit here is GONE, not merely neutralised.
  //
  // It re-declared --sr-e1/2/3 with a warm hue on top of the neutral scale, on the reasoning that a black shadow
  // on a warm surface reads as grey dust. The palette is neutral now, so a hue here would be the only tinted thing
  // in the sheet — and the flattening pass collapsed each elevation to one layer, so the override had nothing left
  // to say. Deleting it is the honest move: a record with empty props generates no CSS and only invites the
  // question of why it is there.
  D('r-ring-warm', 'card', '{root}', { '--sr-ring': 'inset 0 0 0 1px rgba(255,255,255,.6)' },
    'the inner highlight is white, matching the card surface it separates'),
  // ---- scrollbars, placeholders, selection: the surfaces nobody designs ------------------
  // The panel scrolls constantly and every one of these was browser default until now, which is
  // the single clearest tell that a UI was assembled rather than designed.
  D('r-sb-width', 'frame', '.sr-body', { scrollbarWidth: 'thin' },
    'a thin scrollbar: the default width steals 15px from a 920px panel'),
  D('r-sb-color', 'frame', '.sr-body', { scrollbarColor: 'color-mix(in srgb, var(--sr-fg3) 34%, transparent) transparent' },
    'the thumb is warm ink at a third, the track is invisible — no grey channel down the panel'),
  D('r-sb-webkit', 'frame', '.sr-body::-webkit-scrollbar', { width: 9, height: 9 },
    'a 9px override for WebKit, which ignores the two properties above'),
  D('r-sb-thumb', 'frame', '.sr-body::-webkit-scrollbar-thumb', {
    background: 'color-mix(in srgb, var(--sr-fg3) 30%, transparent)',
    borderRadius: 999,
    border: '2px solid transparent',
    backgroundClip: 'padding-box',
  }, 'the thumb floats inside its track thanks to the clip, instead of filling it edge to edge'),
  D('r-sb-thumb-hover', 'frame', '.sr-body::-webkit-scrollbar-thumb:hover', { background: 'color-mix(in srgb, var(--sr-fg3) 52%, transparent)' },
    'and it darkens on hover, which is the only affordance a scrollbar can offer'),
  D('r-sb-track', 'frame', '.sr-body::-webkit-scrollbar-track', { background: 'transparent' },
    'an explicit transparent track: leaving it unset lets the platform draw one'),
  D('r-sb-corner', 'frame', '.sr-body::-webkit-scrollbar-corner', { background: 'transparent' },
    'the corner square appears whenever both axes scroll, and it is never wanted'),
  D('r-select-ink', 'a11y', '.sr-root ::selection', { background: 'var(--sr-accent-weak)', color: 'var(--sr-fg)' },
    'selection is accent-tinted ink, not the platform blue'),
  D('r-placeholder', 'sheet', '.sr-input::placeholder', { color: 'var(--sr-fg3)', opacity: 1 },
    'opacity 1 on purpose: Firefox dims placeholders again on top of the colour, so it comes out grey'),
  D('r-textarea-resize', 'sheet', '.sr-textarea', { resize: 'vertical' },
    'vertical only: a horizontally resizable field breaks the column'),
  D('r-tabular-any-number', 'meta', '.sr-count', { fontVariantNumeric: 'tabular-nums' },
    'every counter in the panel is live; this is the third one and it was still proportional'),
  // ---- panel frame ----------------------------------------------------------------------
  D('r-root-overflow-anchor', 'frame', '.sr-root', { overflowAnchor: 'none' },
    'nothing may re-anchor the scroll position: the list re-renders on a 5s timer'),
  D('r-root-radius', 'frame', '.sr-root', { borderRadius: 8 },
    'the panel frame takes the largest radius in the system; the nested cards stay below it'),
  D('r-root-ring', 'frame', '.sr-root', { boxShadow: 'var(--sr-ring), var(--sr-e1)' },
    'a single inner highlight plus the smallest shadow: the panel is a surface, not a floating card'),
  D('r-head-height', 'frame', '.sr-head', { minHeight: 44 },
    '44px: the sticky header needs to clear its own contents plus the scroll shadow'),
  D('r-head-sticky-z', 'frame', '.sr-head', { zIndex: 6 },
    'above the body wash and the section headers, both of which also stick'),
  D('r-foot-sticky-z', 'frame', '.sr-foot', { zIndex: 6 },
    'the footer matches the header, so the two never cross during a scroll'),
  D('r-fade-colour', 'frame', '.sr-fade--t', { background: 'linear-gradient(var(--sr-card), transparent)' },
    'the scroll fade is drawn from the card colour, so it stays correct in both themes'),
  D('r-fade-height', 'frame', '.sr-fade--t', { height: 14 },
    '14px: enough to soften the cut, short enough not to look like a gap'),
  // ---- content rhythm -------------------------------------------------------------------
  D('r-hero-pad', 'hero', '.sr-hero', { padding: '14px 16px' },
    'the hero uses the card padding so all four surfaces share one inset'),
  D('r-hero-radius', 'hero', '.sr-hero', { borderRadius: 8 },
    'and the card radius, for the same reason'),
  D('r-stat-pad', 'stat', '.sr-stat', { padding: '10px 12px' },
    'the stat cards are tighter than content cards: they hold a number and a label, nothing else'),
  D('r-stat-gap', 'stat', '.sr-stats', { gap: 10 },
    '10px between the four counters, 16 between skill cards: a summary grid is denser than a list'),
  D('r-group-note-align', 'card', '.sr-group-note', { textAlign: 'right' },
    'the group note is a caption for the count, so it aligns away from the label'),
  D('r-blurb-clamp', 'card', '.sr-blurb', { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
    'descriptions clamp at three lines in a narrow column: a wall of text breaks the grid rhythm'),
  D('r-name-clamp-none', 'card', '.sr-skill-name', { WebkitLineClamp: 'unset' },
    'and the NAME is explicitly exempt — it is the one string that must never be cut'),
  D('r-src-ellipsis', 'meta', '.sr-src-text', { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    'a repository URL may truncate, because its beginning identifies it'),
  D('r-src-mono', 'meta', '.sr-src-text', { fontFamily: 'var(--sr-mono)', fontSize: 11 },
    'provenance is machine text, so it is set in the mono face at one step down'),
  D('r-slug-mono', 'card', '.sr-skill-slug', { fontFamily: 'var(--sr-mono)' },
    'the slug is an identifier too, and it matches the source line'),
  D('r-avatar-font', 'card', '.sr-avatar', { fontSize: 12, fontWeight: 620 },
    'one letter at 13px/620: at 12px it looked like a broken glyph rather than an initial'),
  D('r-turn-pad', 'time', '.sr-turn-h', { padding: '6px 8px' },
    'turn headers are a scan list, so they are tighter than content rows'),
  D('r-age-mono', 'time', '.sr-age', { fontFamily: 'var(--sr-mono)' },
    'ages are figures in a column, so they align in the mono face'),
  D('r-call-name-mono', 'time', '.sr-call-name', { fontFamily: 'var(--sr-mono)' },
    'and so is every skill name shown in the per-turn list'),
  D('r-toast-gap', 'toast', '.sr-toast', { gap: 10 },
    '10px between a toast icon and its message, matching the card row rhythm'),
  D('r-toast-radius', 'toast', '.sr-toast', { borderRadius: 8 },
    'toasts take the control radius: they are transient, not containers'),
  D('r-toast-pad', 'toast', '.sr-toast', { padding: '10px 12px' },
    'and the stat-card padding, so a toast and a counter feel like the same family'),
  D('r-sheet-radius', 'sheet', '.sr-sheet', { borderRadius: 8 },
    'the dialog is the largest floating object, so it takes the largest radius after the panel'),
  D('r-sheet-pad', 'sheet', '.sr-sheet-head', { padding: '14px 16px' },
    'the sheet header shares the panel header inset, so the two read as the same chrome'),
  D('r-sheet-foot-pad', 'sheet', '.sr-sheet-foot', { padding: '12px 16px' },
    'the footer steps down one notch, which is what makes it read as a footer'),
  D('r-drop-dash', 'sheet', '.sr-drop', { borderStyle: 'dashed', borderWidth: 1.5 },
    'the drop zone is the one dashed edge in the system, and that is how it is recognised'),
  D('r-preview-bg', 'sheet', '.sr-preview', { background: 'var(--sr-raised)' },
    'the install preview is a recessed panel: it is a summary of something not yet done'),
  D('r-switch-ease', 'btn', '.sr-switch', { transitionTimingFunction: 'var(--sr-ease)' },
    'the switch uses the system ease, not the browser default, which overshoots'),
  D('r-switch-knob-shadow', 'btn', '.sr-switch-knob', { boxShadow: '0 1px 2px rgba(28,25,23,.3)' },
    'the knob needs a shadow to read as a knob rather than a dot'),
  D('r-badge-radius', 'hero', '.sr-badge', { borderRadius: 6 },
    'the status badge is a pill, matching the chips that filter the same list'),
  D('r-caret-rotate', 'sec', '.sr-sec-caret', { transition: 'transform var(--sr-speed) var(--sr-ease)' },
    'the disclosure caret rotates on the system ease, like the switch'),
  D('r-skel-ease', 'frame', '.sr-skel', { animationTimingFunction: 'linear' },
    'a shimmer must be linear: an ease on a loop makes it visibly pulse'),
  D('r-guide-dash', 'sec', '.sr-guide', { borderStyle: 'dashed' },
    'the empty guide joins the drop zone as a dashed surface — both mean "something goes here"'),
  D('r-hist-mono', 'time', '.sr-hist-row', { fontFamily: 'var(--sr-mono)' },
    'the install history is a log, so it is set in mono throughout'),
  D('r-tab-active-weight', 'sheet', '.sr-tab[aria-selected="true"]', { fontWeight: 620 },
    'the selected tab firms up a step: the underline alone is easy to miss at 11.5px'),
  D('r-label-transform', 'sheet', '.sr-label', { textTransform: 'none' },
    'explicitly no uppercase on field labels: CJK has no case, and it reads as noise beside it'),
  D('r-check-accent', 'sheet', '.sr-check', { accentColor: 'var(--sr-accent)' },
    'the native checkbox takes the accent, so the one native control stops being off-palette'),
  D('r-input-accent', 'sheet', '.sr-input', { accentColor: 'var(--sr-accent)' },
    'and so does any native affordance inside a field'),
  D('r-body-min-width', 'frame', '.sr-body', { minWidth: 0 },
    'a flex child needs min-width 0 or a long unbroken string forces the whole column wide'),
  D('r-group-head-sticky', 'card', '.sr-group-head', { position: 'sticky', top: 44, zIndex: 4 },
    'the group heading sticks under the header, so the user always knows which group they are in'),
  D('r-group-head-bg', 'card', '.sr-group-head', { background: 'color-mix(in srgb, var(--sr-card) 92%, transparent)' },
    'and it is near-opaque, or rows scroll visibly through the label'),
  D('r-group-head-blur', 'card', '.sr-group-head', {
    backdropFilter: 'saturate(1.5) blur(8px)',
    WebkitBackdropFilter: 'saturate(1.5) blur(8px)',
  }, 'with a small blur, matching the header it sits beneath'),

  /* ============================ 21b. motion ========================================
   *
   * Duration and easing as a SYSTEM, not per-component values. Three durations by distance
   * travelled (a colour change is not an expansion) and one curve, so unrelated parts of the panel
   * feel like they belong to the same object. The reduced-motion block at the end of the base
   * sheet neutralises all of it in one place.
   */
  D('r-motion-durations', 'frame', '{root}', {
    '--sr-speed-fade': '.12s',
    '--sr-speed-move': '.18s',
    '--sr-speed-layout': '.26s',
  }, 'three durations by distance: a fade, a move, a layout change — one value for all three makes an expansion feel twitchy'),
  D('r-motion-duration-legacy', 'frame', '{root}', { '--sr-speed': 'var(--sr-speed-move)' },
    'the old single --sr-speed now points at the middle one, so existing rules inherit the system'),
  D('r-motion-card-hover', 'card', '.sr-skill:hover', { transition: 'box-shadow var(--sr-speed-fade) var(--sr-ease), border-color var(--sr-speed-fade) var(--sr-ease)' },
    'a hover is a colour and depth change, so it takes the SHORTEST duration'),
  D('r-motion-card-lift', 'card', '.sr-skill', { willChange: 'box-shadow' },
    'declare the property that changes, so the browser can promote the layer before the first hover'),
  D('r-motion-btn-press', 'btn', '.sr-btn:active:not(:disabled)', { transitionDuration: '.06s' },
    'a press must feel instantaneous: the same curve at 120ms reads as sluggish under the finger'),
  D('r-motion-switch-knob', 'btn', '.sr-switch-knob', { transition: 'transform var(--sr-speed-move) var(--sr-ease)' },
    'the knob travels a distance, so it takes the MOVEMENT duration rather than the fade one'),
  D('r-motion-caret', 'sec', '.sr-sec-caret', { transition: 'transform var(--sr-speed-move) var(--sr-ease)' },
    'the disclosure caret rotates through an arc, so it matches the knob'),
  D('r-motion-sheet-in', 'sheet', '.sr-sheet', { animation: 'sr-sheet-in var(--sr-speed-layout) var(--sr-ease)' },
    'the dialog is the largest thing that moves, so it takes the layout duration'),
  D('r-motion-toast-in', 'toast', '.sr-toast', { animation: 'sr-toast-in var(--sr-speed-move) var(--sr-ease)' },
    'a toast enters with a small slide, not a full layout animation'),
  D('r-motion-strip-expand', 'frame', '.sr-strip-panel', { transition: 'max-height var(--sr-speed-layout) var(--sr-ease)' },
    'the strip expansion changes the layout height, so it is the slowest thing in the panel'),
  D('r-motion-avatar-hover', 'card', '.sr-skill:hover .sr-avatar', { transition: 'transform var(--sr-speed-fade) var(--sr-ease)' },
    'the avatar lift follows the card, at the fade duration'),
  D('r-motion-fade-opacity', 'frame', '.sr-fade--t', { transition: 'opacity var(--sr-speed-fade) linear' },
    'a scroll fade is driven by scroll position, so it eases linearly — an ease makes it lag the finger'),
  D('r-motion-skel-linear', 'frame', '.sr-skel', { animationDuration: '1.4s', animationIterationCount: 'infinite' },
    'the shimmer runs at 1.4s: faster reads as an alarm, slower reads as a freeze'),
  D('r-motion-spin', 'frame', '.sr-spin', { animationDuration: '.9s', animationTimingFunction: 'linear' },
    'a spinner is linear by definition; an ease makes it visibly stutter each revolution'),
  D('r-motion-transition-none-input', 'sheet', '.sr-input', { transition: 'border-color var(--sr-speed-fade) var(--sr-ease), box-shadow var(--sr-speed-fade) var(--sr-ease)' },
    'a field animates its edge and halo only — moving a field while typing is disorienting'),
  D('r-motion-list-enter', 'card', '.sr-skill', { animationFillMode: 'both' },
    'cards enter with `both` so the pre-animation state is the start keyframe, not the final one'),
  D('r-motion-list-enter-name', 'card', '.sr-skill', { animationName: 'sr-card-in', animationDuration: 'var(--sr-speed-layout)', animationTimingFunction: 'var(--sr-ease)' },
    'one short rise-and-fade as the catalogue appears, so a filter change does not snap'),

  /* ============================ 21c. responsive ====================================
   *
   * Two breakpoints beyond the phone one, which the base sheet already had. The panel is embedded
   * in a host column that is itself resizable, so its width is not the window's width — these are
   * tuned to the PANEL's own box. The tablet step is the one that was actually missing: between
   * 560px and ~900px the three-column grid collapsed straight to one, with a whole row of dead
   * space in the middle of the range.
   */
  D('r-bp-grid-tablet', 'frame', '.sr-grid', { gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' },
    'mid-width: allow a narrower card floor, so two columns fit where three will not'),
  D('r-bp-stats-tablet', 'frame', '.sr-stats', { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 },
    'four counters become a 2x2 at mid width instead of squashing into one row'),
  D('r-bp-hero-top-tablet', 'hero', '.sr-hero-top', { flexDirection: 'column', alignItems: 'flex-start', gap: 10 },
    'the sparkline drops under the summary rather than compressing it'),
  D('r-bp-spark-tablet', 'hero', '.sr-spark', { width: '100%', height: 34 },
    'and takes the full width, which is what makes a wrapped hero look deliberate'),
  D('r-bp-card-pad-phone', 'card', '.sr-skill', { padding: 10 },
    'on a phone the card padding comes in a step so more content survives per screen. 10 against the base 12 — this was 12 against a base of 14 until the compactness pass moved the base, and a breakpoint whose value equals the base emits a rule identical to it, which the sheet then contains OUTSIDE its media query. The guard caught exactly that'),
  D('r-bp-name-phone', 'card', '.sr-skill-name', { fontSize: 14 },
    'and the name steps down one notch, because the column is now the phone width'),
  D('r-bp-actions-phone', 'card', '.sr-card-foot .sr-row-actions', { columnGap: 6 },
    'the action row tightens: five controls at desktop spacing overflow a phone card'),
  D('r-bp-tools-phone', 'sec', '.sr-toolbar', { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
    'the toolbar stacks, so the search field keeps a usable width'),
  D('r-bp-stats-stack-phone', 'stat', '.sr-stats', { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
    'the counters stay 2x2 on a phone rather than becoming four stacked rows'),
  D('r-bp-sheet-phone', 'sheet', '.sr-sheet', { borderRadius: 0, maxHeight: '100dvh' },
    'a phone dialog is full-bleed: a floating card on a 390px screen wastes the edges'),
  D('r-bp-sheet-pad-phone', 'sheet', '.sr-sheet-body', { paddingInline: 14 },
    'and its inner padding comes in with the screen, keeping the text measure sane'),
  D('r-bp-tabs-phone', 'sheet', '.sr-tab', { fontSize: 13, padding: '0 calc(var(--sr-u) * 2)' },
    'three install-mode tabs have to fit 390px without wrapping the labels'),
  D('r-bp-grid-wide', 'frame', '.sr-grid', { minWidth: 0 },
    'explicit: the grid may be narrower than its content minimum, because overflowing the column is worse than a cramped card'),
  D('r-bp-gap-phone', 'space', '.sr-grid', { gap: 12 },
    'the gap between cards scales down with the breakpoint, keeping the spacing hierarchy proportions intact'),

  /* ============================ 21d. interaction states ============================
   *
   * Every interactive element needs the same four states with the same treatment. These records
   * exist so that "does this control have a hover / focus / active / disabled?" is answerable by
   * reading one group rather than auditing the sheet.
   */
  D('r-state-card-hover', 'card', '.sr-skill:hover', { borderColor: 'var(--sr-line2)' },
    'hover firms the edge one step: this is the card-level equivalent of a focus ring'),
  D('r-state-row-hover', 'time', '.sr-turn-h:hover', { background: 'var(--sr-fill)' },
    'a list row takes a fill on hover, exactly like a card, so the two lists behave alike'),
  D('r-state-chip-hover', 'sec', '.sr-chip:hover', { color: 'var(--sr-fg)' },
    'a filter chip darkens its label on hover, matching the button behaviour'),
  D('r-state-tab-hover', 'sheet', '.sr-tab:hover', { color: 'var(--sr-fg)' },
    'hovering a tab darkens its label to full ink, matching buttons and chips so the states agree'),
  D('r-state-drop-hover', 'sheet', '.sr-drop:hover', { borderColor: 'var(--sr-accent-line)' },
    'the drop zone tints its dashed edge: it is the one target that must invite a drag'),
  D('r-state-drop-active', 'sheet', '.sr-drop[data-over="true"]', { borderColor: 'var(--sr-accent)', background: 'var(--sr-accent-weak)' },
    'and while a file is over it, the whole zone lights up — a border change alone is too small'),
  D('r-state-toast-hover', 'toast', '.sr-toast:hover', { boxShadow: 'var(--sr-e3)' },
    'hovering a toast raises it, which is the same depth language as a card'),
  D('r-state-input-hover', 'sheet', '.sr-input:hover:not(:focus)', { borderColor: 'var(--sr-line2)' },
    'a field edge firms on hover, so it is clear it is editable before it is clicked'),
  D('r-state-avatar-hover', 'card', '.sr-avatar-btn:hover .sr-avatar', { boxShadow: 'var(--sr-ring), var(--sr-e2)' },
    'the avatar is the colour affordance, so it has to look clickable — it was the least obvious control on the card'),
  D('r-state-avatar-cursor', 'card', '.sr-avatar-btn', { cursor: 'pointer' },
    'and say so with the cursor'),
  D('r-state-disabled-icon', 'btn', '.sr-btn--icon:disabled', { background: 'transparent', borderColor: 'transparent' },
    'a disabled icon button drops its box entirely, rather than showing a faded outline of a button'),
  D('r-state-checked-chip', 'sec', '.sr-chip--on:hover', { background: 'color-mix(in srgb, var(--sr-accent) 16%, transparent)' },
    'a selected chip deepens on hover instead of reverting, so the state never disappears under the pointer'),
  D('r-state-swatch-hover', 'card', '.sr-swatch:hover', { transform: 'scale(1.12)' },
    'the colour swatches scale slightly on hover: at 20px they need help being targets'),
  D('r-state-swatch-active', 'card', '.sr-swatch:active', { transform: 'scale(.96)' },
    'and press inward, which is the only feedback a 20px dot can give'),
  D('r-state-focus-swatch', 'a11y', '.sr-swatch:focus-visible', { outline: '2px solid var(--sr-fg)', outlineOffset: 2 },
    'the swatch focus ring is INK not accent: on a coloured dot an accent ring is invisible'),
  D('r-state-focus-avatar', 'a11y', '.sr-avatar-btn:focus-visible', { outline: '2px solid var(--sr-accent)', outlineOffset: 2, borderRadius: 8 },
    'the avatar wrapper takes the app focus ring, at the control radius so the ring follows the corner it rings'),
  D('r-state-hover-none-touch', 'frame', '.sr-skill', { WebkitTapHighlightColor: 'transparent' },
    'and the mobile tap flash is suppressed on cards too, not only on buttons'),

  /* ============================ 21e. the strip becomes two floats ==================
   *
   * Three requests from the user, and one of them exposed a structural mistake.
   *
   * `.sr-strip-shell--open` put a border, a background, a radius and `overflow:hidden` on the
   * SHELL, which wraps BOTH the bar and the expanded report — so expanding merged the two into one
   * card instead of floating the report beneath the bar. The shell is now a transparent layout
   * column and each child carries its own surface. That `overflow:hidden` is also why the counters
   * could not ride the bar in the open state.
   */
  D('r-strip-shell-transparent', 'frame', '.sr-strip-shell--open', {
    border: 0,
    background: 'transparent',
    overflow: 'visible',
    boxShadow: 'none',
  }, 'the shell is a layout column, not a surface: each float owns its own edges'),
  D('r-strip-shell-gap', 'frame', '.sr-strip-shell--open', { gap: 'calc(var(--sr-u) * 2)' },
    'two floats need a gap; the old shell set gap 0 because it was one box'),
  D('r-strip-bar-float', 'frame', '.sr-strip-shell--open .sr-strip-row', {
    padding: 'calc(var(--sr-u) * 1.5) calc(var(--sr-u) * 2)',
    border: '1px solid var(--sr-line)',
    borderRadius: 8,
    background: 'color-mix(in srgb, var(--sr-card) 72%, transparent)',
    backdropFilter: 'saturate(1.7) blur(14px)',
    WebkitBackdropFilter: 'saturate(1.7) blur(14px)',
    boxShadow: 'var(--sr-e2)',
    position: 'relative',
  }, 'the bar becomes its own frosted float, so it stays visibly separate from the report below'),
  D('r-strip-panel-float', 'frame', '.sr-strip-panel', {
    border: '1px solid var(--sr-line)',
    borderRadius: 8,
    background: 'var(--sr-card)',
    boxShadow: 'var(--sr-e3)',
    overflow: 'hidden',
  }, 'and the report is a SECOND float with its own edges — the request was explicit that they not merge'),
  // ---- the counters ride the bar in BOTH states ------------------------------------------
  //
  // THE SELECTORS HERE ARE `.sr-strip .sr-strip-stats`, NOT `.sr-strip-stats`, AND THAT IS THE
  // POINT. The older `statline` record — emitted LATER in this file — declares `flex:none` on the
  // same element at the same specificity, so it won on source order and the counters stayed
  // unshrinkable no matter what these records said. Measured: the summary sat at its 96px floor
  // while the counter row held 305px and clipped nothing. One extra class settles it by
  // specificity, which does not depend on where a record happens to sit in this array.
  D('r-strip-stats-always', 'stat', '.sr-strip .sr-strip-stats', {
    flex: 'none',
    gap: 4,
  }, 'the counters are never gated on the open state, and they hold their size: a shrunk counter is an unreadable one'),
  D('r-strip-stats-one-line', 'stat', '.sr-strip .sr-strip-stats', { flexWrap: 'nowrap' },
    'and they hold one line, because the bar has exactly one'),
  // MEASURED, and three attempts were wrong in the same direction: the summary collapsed to 0px
  // instead of anything else giving way. `flex:1 1 0%`, then `flex:1 1 auto`, then a large shrink
  // factor — none held, because `min-width:auto` on a shrinkable flex item resolves to its
  // MIN-CONTENT width and "调用次数 61" cannot shrink below its content. The answer is not to shrink
  // the counters but to make them SMALLER: computed from the chip record, four chips need ~255px at
  // the current settings and ~209px compact, and that 44px is the difference between a 31px and a
  // 77px summary at a narrow bar. So the panel breakpoint below makes them compact, and the chips
  // never shrink at all.
  // `flex-grow: 0` here, NOT 1, and it is what makes the mark's `margin-inline: auto` mean anything:
  // an auto margin can only centre in space that is actually free, and a growing summary consumes
  // all of it. With the summary at its natural width, the free space collects around the mark and
  // pushes the counters to the right edge — measured, the mark's centre then sits on the bar's centre.
  // `flex-shrink` stays 1 with a `min-width: 0`, so a narrow bar still truncates the summary rather
  // than overflowing.
  D('r-strip-text-shrink', 'frame', '.sr-strip-text', { flex: '0 1 auto', minWidth: 0 },
    'the summary takes its natural width and truncates when cramped; it does NOT grow, or the mark has no free space to be centred in'),
  D('r-strip-text-clip', 'frame', '.sr-strip-text', { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    'and it truncates rather than overflowing its own box'),
  D('r-strip-n-hold', 'frame', '.sr-strip-n', { flex: 'none' },
    'the turn count holds its width'),
  D('r-strip-chip-pad-tight', 'stat', '.sr-strip .sr-statcard--inline', { paddingInline: 6 },
    'the chips take a 6px inline inset rather than the 8px the older statcard record sets — 16px across the row, hence the two-class selector'),
  // ---- the action buttons sit BESIDE the bar, and must not be overlapped ------------------
  D('r-strip-row-shrink', 'frame', '.sr-strip-row', { minWidth: 0, flexWrap: 'nowrap' },
    'the row never wraps: one line is the whole point of the strip'),
  D('r-strip-row-actions-gap', 'frame', '.sr-strip-row', { columnGap: 6 },
    '6px between the bar and its buttons: the row is tight by design, but the buttons need to read as separate from the bar'),
  D('r-strip-btn-hold', 'btn', '.sr-strip-row > .sr-btn', { flex: 'none' },
    'the buttons never shrink, so the bar is what gives when the window narrows'),
  // ---- the count replaces the word 技能 ---------------------------------------------------
  D('r-strip-brand', 'frame', '.sr-strip-brand', { display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none' },
    'the dot and the count are one unit, so the dot reads as belonging to the number'),
  D('r-strip-count', 'stat', '.sr-strip-count', {
    fontSize: 12,
    fontWeight: 620,
    fontVariantNumeric: 'tabular-nums',
    padding: '1px 7px',
    borderRadius: 6,
    background: 'var(--sr-sunken)',
    color: 'var(--sr-fg2)',
    flex: 'none',
  }, 'the install count in a quiet chip where a static label used to be — it is a fact, so it is styled like one. Radius 6, the micro-label step'),
  D('r-strip-count-hover', 'stat', '.sr-strip:hover .sr-strip-count', { background: 'var(--sr-fill)', color: 'var(--sr-fg)' },
    'and it responds with the bar, so the whole control moves as one surface'),
  // ---- the brand mark, centred on the ROW ---------------------------------------------------
  //
  // WHY NOT INSIDE THE BAR, which is where it was: `margin-inline: auto` centres an element in the
  // space left over BESIDE it. Inside the bar the mark therefore sat midway between the summary text
  // and the four counters — and the user's report was exactly right, "why is the cat not centred?".
  // Nor is the bar's own 50% the answer: the bar is `flex:1` of a row that also holds four action
  // buttons, so the bar's centre sits well left of the row's. The ROW is the floating box, so the
  // row is what the mark is centred on.
  //
  // `pointer-events:none` is load-bearing here: this overlay sits ON TOP of a button (the bar), so
  // without it the mark would swallow clicks aimed at the middle of the bar.
  // ---- the brand mark: between two EQUAL flanks -------------------------------------------
  //
  // Five arrangements were tried and each was MEASURED, and the geometry below is what explains all
  // of them (dumped by tools/shot-strip.mjs):
  //
  //   sr-strip-brand   47px  @73..120
  //   sr-strip-text   294px  @128..422     (capped)
  //   sr-strip-logo    22px                <- landed at 393 / 460 / 478 / 507 / 553 depending on rule
  //   sr-strip-stats  302px  @526..828
  //   sr-strip-caret   11px  @836..847
  //
  //   * `margin-inline: auto` is satisfied AFTER `flex-grow` takes the free space, so with growable
  //     siblings the margin computes to 0px and the mark is just the next item in the row.
  //   * an absolute overlay at 50% of the ROW was genuinely centred (0.0px offset, measured) but the
  //     bar is `flex:1` of a row that also holds four action buttons, so the row's centre lands INSIDE
  //     the bar — on the summary or on the first chip, and that thing moved with the content.
  //   * no flex weight can fix it either: the counter block is a fixed 302px with no slack, so grow
  //     values of 1, 3 and 6 all measured identically.
  //   * an optical `translateX` nudge is a magic number that breaks the moment a label changes width.
  //
  // The answer is neither a weight nor an offset but EQUAL FLANKS: two wrappers at `flex:1` are the
  // same width by construction, so the mark between them is on the centre line at every width, with
  // any labels, and with no number to keep in sync.
  // EQUAL WIDTHS DO NOT REQUIRE PUSHING THE CONTENTS TO THE MIDDLE, and conflating the two is what
  // this fixes. The flank had `justify-content: flex-end` so that its CONTENT sat against the mark,
  // which centred the summary text as well — the user's report. A flex container's width and its
  // items' alignment are independent: `flex: 1 1 0%` alone makes the two flanks equal, and the
  // contents still start at their natural edge.
  D('r-strip-flank-left', 'frame', '.sr-strip-left', {
    flex: '1 1 0%',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  }, 'the left flank: equal to the right one by construction, with its contents starting at the bar edge'),
  D('r-strip-flank-right', 'frame', '.sr-strip-right', {
    flex: '1 1 0%',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  }, 'the right flank at the same width, its contents against the far edge — the two SEESAW about the mark without moving it'),
  D('r-strip-flank-text', 'frame', '.sr-strip-left .sr-strip-text', { flex: '0 1 auto', minWidth: 0, textAlign: 'left' },
    'the summary takes its natural width and truncates at its right end; explicitly LEFT-aligned, because a centred one-line summary reads as a heading'),
  D('r-strip-flank-stats', 'stat', '.sr-strip-right .sr-strip-stats', { flex: 'none', minWidth: 0 },
    'and the counters keep their natural size, so the flank around them absorbs the slack'),
  D('r-logo-layer', 'frame', '.sr-strip-logo', {
    flex: '0 0 22px',
    width: 22,
    height: 22,
    display: 'grid',
    placeItems: 'center',
  }, 'the middle column: a fixed 22px slot between two equal flanks, so it is centred rather than nudged'),
  D('r-strip-brand-hold', 'frame', '.sr-strip-brand', { flex: 'none' },
    'the brand block holds its width, so the summary is the only thing that gives'),
  D('r-strip-caret-hold', 'frame', '.sr-strip-caret', { flex: 'none' },
    'and so does the caret'),
  D('r-logo-img', 'frame', '.sr-logo', { width: '100%', height: '100%', objectFit: 'contain', display: 'block', userSelect: 'none' },
    'the mark fills its 22px box without distortion'),
  D('r-logo-light', 'frame', '.sr-logo--light', { display: 'block' },
    'the open-eye mark is the light-theme one'),
  D('r-logo-dark', 'frame', '.sr-logo--dark', { display: 'none' },
    'the closed-eye mark is hidden until the theme says otherwise'),
  D('r-logo-tone', 'frame', '.sr-strip-logo', { opacity: 0.92 },
    'a hair under full opacity, so the mark sits in the bar rather than on top of it'),

  /* ============================ 21f. the third refinement pass =====================
   *
   * The areas the first two passes left alone: the rail and its toasts, the install sheet, the
   * loading and empty states, the footer, and the small typographic details that only show up when
   * something changes at runtime. Same discipline: one decision per record, each with a reason.
   */
  // ---- the status rail and its toasts ----------------------------------------------------
  D('r-rail-gap', 'toast', '.sr-rail', { gap: 8 },
    'toasts stack at 8px: they are transient and should read as one column of notices'),
  D('r-rail-width', 'toast', '.sr-rail', { width: '100%' },
    'the rail fills its seat so a long message has the whole width'),
  D('r-rail-float-pad', 'toast', '.sr-rail--float', { padding: '8px 12px' },
    'the floating variant keeps its own inset so it does not touch the viewport edge'),
  D('r-rail-empty', 'toast', '.sr-rail--float:empty', { display: 'none' },
    'and an empty floating rail takes no space at all, rather than a padded gap'),
  D('r-toast-enter', 'toast', '.sr-toast', { animationName: 'sr-toast-in' },
    'a toast enters with a 6px rise: enough to notice, not enough to feel like a popup'),
  D('r-toast-icon-align', 'toast', '.sr-toast .sr-ic', { marginTop: 2 },
    'the icon aligns to the first line of the message, not to the box'),
  D('r-toast-close-hit', 'toast', '.sr-toast-close', { width: 22, height: 22, marginTop: -2, marginRight: -2 },
    'the close button is a 22px target that bleeds slightly out of the padding, so it does not push the text'),
  D('r-toast-close-hover', 'toast', '.sr-toast-close:hover', { background: 'var(--sr-fill)', color: 'var(--sr-fg)' },
    'and it responds, because a dismiss control that does not look pressable gets mis-clicked'),
  D('r-toast-message-wrap', 'toast', '.sr-toast-msg', { overflowWrap: 'anywhere' },
    'a message can contain a path or a URL with no break opportunity'),
  D('r-toast-hint-mono', 'toast', '.sr-toast-hint', { fontFamily: 'var(--sr-mono)' },
    'the hint is usually an address, so it is set in the mono face'),
  D('r-toast-pending-pulse', 'toast', '.sr-toast--pending .sr-ic', { animationName: 'sr-spin', animationIterationCount: 'infinite' },
    'a pending toast spins its icon: motion is the only honest signal that work is still running'),
  D('r-toast-ok-rule', 'toast', '.sr-toast--ok', { borderLeftWidth: 3 },
    'success and failure carry a 3px left rule, which reads at a glance in a stack'),
  D('r-toast-error-rule', 'toast', '.sr-toast--error', { borderLeftWidth: 3 },
    'the same rule on failure, so the two are distinguishable without reading the text'),
  D('r-toast-rule-colour-less', 'toast', '.sr-toast--pending', { borderLeftWidth: 1 },
    'a pending toast keeps the hairline: nothing has happened yet, so nothing is emphasised'),
  // ---- the install sheet -----------------------------------------------------------------
  D('r-sheet-width', 'sheet', '.sr-sheet', { width: 'min(560px, 100%)' },
    'a 560px cap: the sheet is a form, and a full-width form on a 1400px window is unreadable'),
  D('r-sheet-head-rule', 'sheet', '.sr-sheet-head', { borderBottom: '1px solid var(--sr-line)' },
    'one rule under the title, separating chrome from form'),
  D('r-sheet-body-gap', 'sheet', '.sr-sheet-body', { gap: 14 },
    'fields sit 14px apart, the same tier the cards use'),
  D('r-sheet-foot-rule', 'sheet', '.sr-sheet-foot', { borderTop: '1px solid var(--sr-line)', background: 'var(--sr-raised)' },
    'the footer gets a rule AND a step down in surface, because it is outside the form'),
  D('r-field-label-weight', 'sheet', '.sr-label', { fontWeight: 560 },
    'a field label is a label: just above body weight, below a heading'),
  D('r-field-help-size', 'sheet', '.sr-help', { fontSize: 11, lineHeight: 1.5, color: 'var(--sr-fg3)' },
    'help text under a field is the smallest thing in the sheet, and it should be'),
  D('r-field-help-align', 'sheet', '.sr-help', { textAlign: 'left' },
    'left-aligned, because a centred helper under a left-aligned field reads as unrelated'),
  D('r-input-pad', 'sheet', '.sr-input', { padding: '9px 12px' },
    'a 9/12 inset: enough for a caret to breathe, tight enough to look like a field'),
  D('r-input-mono-size', 'sheet', '.sr-input--mono', { fontSize: 13, letterSpacing: '-.01em' },
    'mono runs visually wider, so it steps down a fraction and tightens'),
  D('r-input-invalid', 'sheet', '.sr-input[aria-invalid="true"]', { borderColor: 'var(--sr-danger)' },
    'an invalid field says so on its own edge, not only in the message below it'),
  D('r-textarea-min', 'sheet', '.sr-textarea', { minHeight: 150 },
    'a SKILL.md paste needs to show roughly ten lines, or the user cannot check what they pasted'),
  D('r-textarea-mono', 'sheet', '.sr-textarea', { fontFamily: 'var(--sr-mono)', fontSize: 13, lineHeight: 1.6 },
    'markdown in a proportional face hides frontmatter mistakes'),
  D('r-check-hit', 'sheet', '.sr-check', { minHeight: 26 },
    'a checkbox row is a target, so the whole row is clickable, not just the 16px box'),
  D('r-check-gap', 'sheet', '.sr-check', { gap: 8 },
    'and the box sits 8px from its label'),
  D('r-tabs-track-rule', 'sheet', '.sr-tab-track', { borderBottom: '1px solid var(--sr-line)' },
    'the tab row gets a rule that the selected indicator sits ON, which is what makes it read as a tab'),
  D('r-seg-gap', 'sheet', '.sr-seg', { gap: 6 },
    'segmented controls tighten to 6px so the group reads as one control'),
  D('r-seg-radius', 'sheet', '.sr-seg', { borderRadius: 8 },
    'and the group takes one radius around its members'),
  D('r-preview-rule', 'sheet', '.sr-preview', { border: '1px solid var(--sr-line)' },
    'the install preview is outlined rather than filled: it is a preview, not a result'),
  D('r-preview-meta-size', 'sheet', '.sr-preview-meta', { fontSize: 13, color: 'var(--sr-fg3)' },
    'the file count and type are metadata, so they recede behind the name and description'),
  D('r-preview-name-mono', 'sheet', '.sr-preview-name', { fontFamily: 'var(--sr-mono)' },
    'the previewed name is the slug that will land on disk, so it is shown as one'),
  D('r-drop-height', 'sheet', '.sr-drop', { minHeight: 96 },
    'a drop zone has to be big enough to aim at without precision'),
  D('r-drop-title-weight', 'sheet', '.sr-drop-title', { fontWeight: 560 },
    'and its instruction is a label, at the same weight as a field label'),
  D('r-note-pad', 'sheet', '.sr-note', { padding: '9px 11px' },
    'notes are 9/11 rather than the card 14: they are inline asides, not cards'),
  D('r-note-hint-size', 'sheet', '.sr-note-hint', { fontSize: 11 },
    'the second line of a note is the actionable part, so it steps down but stays legible'),
  D('r-warn-rule', 'sheet', '.sr-note--warn', { borderLeftWidth: 3 },
    'warnings carry the same 3px rule the toasts use, so "attention" looks the same everywhere'),
  // ---- loading and empty states ----------------------------------------------------------
  D('r-skel-radius', 'frame', '.sr-skel', { borderRadius: 8 },
    'the skeleton takes the control radius: it is standing in for cards and rows'),
  D('r-skel-track', 'frame', '.sr-skel', { background: 'linear-gradient(90deg, var(--sr-sunken), var(--sr-fill), var(--sr-sunken))', backgroundSize: '220% 100%' },
    'the shimmer needs a track WIDER than the element, or the sweep is a hard edge'),
  D('r-skel-name', 'frame', '.sr-skel-name', { height: 15, width: '42%' },
    'the placeholder line lengths are deliberate: 42% reads as a title, 100% as a paragraph'),
  D('r-skel-row', 'frame', '.sr-skel-row', { height: 11 },
    'and body lines are 11px, matching the text they stand in for'),
  D('r-empty-pad', 'sec', '.sr-empty', { padding: '18px 16px' },
    'an empty state gets room, because it is the only thing on screen when it appears'),
  D('r-empty-rule', 'sec', '.sr-empty', { border: '1px dashed var(--sr-line)', borderRadius: 8 },
    'dashed, joining the drop zone and the guide: all three say "nothing here yet"'),
  D('r-guide-pad', 'sec', '.sr-guide', { padding: '14px 16px', gap: 10 },
    'the first-run guide matches the card inset and the row gap, so it belongs to the same system'),
  D('r-guide-icon-size', 'sec', '.sr-guide .sr-ic', { width: 16, height: 16 },
    'the leading icon is 16px: at 18 it outranked the sentence it introduces'),
  D('r-guide-text-size', 'sec', '.sr-guide-text', { fontSize: 13, lineHeight: 1.6 },
    'the guide is the one paragraph a new user reads, so it gets the loosest leading'),
  // ---- panel chrome ----------------------------------------------------------------------
  D('r-sec-head-pad', 'sec', '.sr-sec-h', { padding: '10px 16px' },
    'section headers share the 16px inset with the header and the body, so the left edge is one line'),
  D('r-sec-title-size', 'sec', '.sr-sec-t', { fontSize: 12, fontWeight: 620 },
    'a section title is the third level, between the panel title and a card name'),
  D('r-sec-count-quiet', 'sec', '.sr-sec-h .sr-count', { fontSize: 11, color: 'var(--sr-fg3)' },
    'the count beside a section title is metadata, so it does not compete with the title'),
  D('r-sec-caret-size', 'sec', '.sr-sec-caret .sr-ic', { width: 12, height: 12 },
    'a 12px caret: big enough to aim at inside a 44px row, small enough not to dominate'),
  D('r-sec-caret-colour', 'sec', '.sr-sec-caret', { color: 'var(--sr-fg3)' },
    'and it stays tertiary even when the section is open, because the state is the rotation'),
  D('r-toolbar-pad', 'sec', '.sr-toolbar', { padding: '8px 16px', gap: 8 },
    'the toolbar is part of the header block, so it shares the inset and its own tight gap'),
  D('r-filter-height', 'sec', '.sr-filter input', { height: 30 },
    'the search field is 30px: one step above a control, because it holds a caret and a query'),
  D('r-chips-gap', 'sec', '.sr-chips', { gap: 6 },
    'filter chips sit 6px apart, tight enough to read as a set'),
  D('r-chips-wrap', 'sec', '.sr-chips', { flexWrap: 'wrap', rowGap: 6 },
    'and they wrap, because the tag list is as long as the user made it'),
  D('r-sort-size', 'sec', '.sr-sort button', { fontSize: 12 },
    'the sort control is a micro-label, matching the section count'),
  D('r-group-count-pill', 'card', '.sr-group-head .sr-pill', { fontVariantNumeric: 'tabular-nums' },
    'group counts change as skills are toggled, so they hold their width'),
  D('r-group-title-size', 'card', '.sr-group-title', { fontSize: 12, letterSpacing: '.02em' },
    'the group heading is a micro-caps label: the tracking keeps it legible at 11px'),
  D('r-group-note-size', 'card', '.sr-group-note', { fontSize: 12 },
    'and its explanation is one step below the heading it explains'),
  D('r-hero-badge-mono', 'hero', '.sr-badge', { fontFamily: 'var(--sr-mono)', fontSize: 11 },
    'the hero badges name skills, and a skill name is an identifier'),
  D('r-hero-empty-size', 'hero', '.sr-hero-empty', { fontSize: 12, lineHeight: 1.5 },
    'the first-run sentence in the hero matches body size rather than the meta size around it'),
  D('r-share-name-mono', 'stat', '.sr-share-name', { fontFamily: 'var(--sr-mono)' },
    'the per-skill bar list names skills, so they align in the mono face'),
  D('r-share-bar-height', 'stat', '.sr-share-track', { height: 7 },
    'a 7px bar: visible at a glance, not a chart'),
  D('r-share-value-width', 'stat', '.sr-share-n', { minWidth: 34, textAlign: 'right' },
    'the value column is fixed-width and right-aligned, so the bars share one baseline'),
  D('r-stat-value-width', 'stat', '.sr-stat-v', { minWidth: 22 },
    'counter digits hold a 22px floor, so the label does not shift as the number grows'),
  // ---- micro-typography ------------------------------------------------------------------
  D('r-cjk-line-break', 'type', '{root}', { lineBreak: 'strict' },
    'strict line breaking keeps CJK punctuation off the start of a line, which is a correctness rule in Chinese typesetting, not a preference'),
  D('r-word-break-headings', 'type', '.sr-title', { wordBreak: 'keep-all' },
    'a title breaks between words, never inside one'),
  D('r-hyphens-off', 'type', '.sr-blurb', { hyphens: 'none' },
    'no automatic hyphenation: it needs a language hint and produces wrong breaks in mixed CJK/Latin text'),
  D('r-text-rendering', 'type', '{root}', { textRendering: 'optimizeLegibility' },
    'kerning and ligatures on, which matters for the mono face in slugs and hashes'),
  D('r-font-synthesis', 'type', '{root}', { fontSynthesis: 'none' },
    'never fake a bold or italic: a synthesised weight in a CJK face is visibly smeared'),
  D('r-tab-size-code', 'type', '.sr-input--mono, .sr-textarea', { tabSize: 2 },
    'pasted YAML is indented with two spaces, so a tab stop of 2 keeps it aligned'),
  D('r-uppercase-off-cjk', 'type', '.sr-group-note', { textTransform: 'none' },
    'explicitly no uppercase on a string that is Chinese: it is a no-op at best and a hint at worst'),
  D('r-numeral-context', 'type', '.sr-stat-l', { fontVariantNumeric: 'normal' },
    'labels are words, not numbers: tabular figures make Latin labels look loose'),
  // ---- depth and material, second pass ---------------------------------------------------
  D('r-sheet-shadow', 'sheet', '.sr-sheet', { boxShadow: 'var(--sr-e3)' },
    'the dialog is the highest object on screen, so it takes the top elevation'),
  D('r-strip-shadow', 'frame', '.sr-strip', { boxShadow: 'var(--sr-e1)' },
    'the collapsed bar floats a little, so it reads as a layer over the composer'),
  D('r-strip-hover', 'frame', '.sr-strip:hover', { boxShadow: 'var(--sr-e2)', borderColor: 'var(--sr-line2)' },
    'and rises one step on hover, like every other surface'),
  D('r-dot-ring', 'frame', '.sr-strip-dot', { boxShadow: '0 0 0 3px var(--sr-fill)' },
    'the status dot gets a 3px halo, which is what makes a 7px dot readable'),
  D('r-statcard-ring', 'stat', '.sr-statcard--inline', { borderColor: 'color-mix(in srgb, var(--sr-line) 55%, transparent)' },
    'the counter chips get a faint edge: they sit on the bar, which is itself a translucent surface'),
  D('r-btn-icon-colour', 'btn', '.sr-btn--icon', { color: 'var(--sr-fg2)' },
    'icon buttons are secondary ink at rest, because a row of full-ink icons shouts'),
  D('r-btn-icon-hover-colour', 'btn', '.sr-btn--icon:hover:not(:disabled)', { color: 'var(--sr-fg)' },
    'and come to full ink on hover'),
  D('r-btn-danger-quiet', 'btn', '.sr-btn--danger', { background: 'transparent', borderColor: 'color-mix(in srgb, var(--sr-danger) 30%, transparent)', color: 'var(--sr-danger)' },
    'delete is an outline in the danger hue: available, not advertised'),
  D('r-btn-danger-filled', 'btn', '.sr-btn--danger.sr-btn--armed', { background: 'var(--sr-danger)', color: '#fff', borderColor: 'var(--sr-danger)' },
    'and it FILLS when armed, so the second click cannot be mistaken for the first'),
  D('r-btn-primary-weight', 'btn', '.sr-btn--primary', { fontWeight: 580 },
    'the primary action carries a touch more weight than its neighbours'),
  D('r-btn-sm-radius', 'btn', '.sr-btn--sm', { borderRadius: 8 },
    'small controls take a smaller radius: 9px on a 24px-tall button looks like a bubble'),
  D('r-toggle-on-colour', 'btn', '.sr-btn--on', { borderColor: 'color-mix(in srgb, var(--sr-ok) 34%, transparent)' },
    'the ON switch keeps the hairline but tints it green, so the outline agrees with the track'),
  D('r-swatch-size-phone', 'card', '.sr-swatch', { minWidth: 20, minHeight: 20 },
    'a floor on the swatch size, so a flex row cannot squeeze them into slivers'),

  /* ============================ 21g. the per-turn and per-skill views =============
   *
   * The two report sections the earlier passes never reached: the turn list (what happened, in
   * order) and the per-skill table (which skills the work went to). These are the surfaces a user
   * reads when something went wrong, so alignment matters more here than anywhere else.
   */
  D('r-turn-row-grid', 'time', '.sr-turn', { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'baseline', columnGap: 10, rowGap: 4 },
    'a three-column row: time, what happened, and the age. A grid rather than flex because the monospace time column must not shift between rows'),
  D('r-turn-time-width', 'time', '.sr-turn-t', { minWidth: 46, fontVariantNumeric: 'tabular-nums' },
    'the time column is fixed and tabular, so consecutive turns line up down the page'),
  D('r-turn-time-mono', 'time', '.sr-turn-t', { fontFamily: 'var(--sr-mono)', fontSize: 12 },
    'and set in mono at the meta size, because it is a figure rather than prose'),
  D('r-turn-time-colour', 'time', '.sr-turn-t', { color: 'var(--sr-fg3)' },
    'the timestamp recedes: it is an index, not the content'),
  D('r-turn-body-colour', 'time', '.sr-turn-body', { color: 'var(--sr-fg2)' },
    'the body is secondary ink, leaving full ink for the skill names that matter'),
  D('r-turn-sep', 'time', '.sr-turn + .sr-turn', { borderTop: '1px solid color-mix(in srgb, var(--sr-line) 50%, transparent)' },
    'a hairline between turns, lighter than a section rule: turns are the finest division here'),
  D('r-turn-pad-y', 'time', '.sr-turn', { paddingBlock: 7 },
    '7px above and below each turn: enough to separate, tight enough to scan a long list'),
  D('r-call-chip', 'time', '.sr-call', { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '1px 7px', borderRadius: 8 },
    'a called skill is a small pill, so several fit one line without wrapping'),
  D('r-call-chip-auto', 'time', '.sr-call--auto', { background: 'var(--sr-accent-weak)', color: 'var(--sr-fg)' },
    'an automatic call is accent-tinted: it is the case the user is usually looking for'),
  D('r-call-chip-manual', 'time', '.sr-call--manual', { background: 'var(--sr-sunken)', color: 'var(--sr-fg2)' },
    'a manual call is neutral, because the user already knows they typed it'),
  D('r-call-chip-none', 'time', '.sr-call--none', { background: 'var(--sr-warn-weak)', color: 'var(--sr-warn)' },
    'the amber case is the one this plugin exists for: a turn where no skill was used'),
  D('r-call-name-tight', 'time', '.sr-call-name', { letterSpacing: '-.01em' },
    'mono runs wide at 11px, so the chip name tightens a fraction to fit more per line'),
  D('r-skill-table-head', 'stat', '.sr-per-head', { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 10, padding: '6px 0' },
    'the per-skill table has a header row, so the columns are named rather than inferred'),
  D('r-skill-table-head-size', 'stat', '.sr-per-head', { fontSize: 12, letterSpacing: '.045em', textTransform: 'uppercase', color: 'var(--sr-fg3)' },
    'a micro-caps header: the one place uppercase earns its keep, because it labels numbers'),
  D('r-skill-table-row', 'stat', '.sr-per-row', { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 10, alignItems: 'center', padding: '5px 0' },
    'body rows share the header grid exactly, so the columns cannot drift apart'),
  D('r-skill-table-num', 'stat', '.sr-per-n', { minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
    'both figures are right-aligned and tabular, so they form a readable column'),
  D('r-skill-table-bar', 'stat', '.sr-per-bar', { height: 5, borderRadius: 999, background: 'var(--sr-sunken)', overflow: 'hidden' },
    'a 5px bar inside the skill row: subordinate to the share chart, which is 7px'),
  D('r-skill-table-fill', 'stat', '.sr-per-fill', { height: '100%', borderRadius: 999, background: 'var(--sr-accent)' },
    'and its fill takes the accent, tying the table to the chart above it'),
  D('r-skill-table-zero', 'stat', '.sr-per-row--zero', { color: 'var(--sr-fg3)' },
    'a skill with no calls is dimmed: it is the interesting absence, not an error'),
  // ---- the footer ------------------------------------------------------------------------
  D('r-foot-grid', 'frame', '.sr-foot', { display: 'flex', alignItems: 'center', gap: 10 },
    'the footer is one row of small facts, evenly spaced'),
  D('r-foot-size', 'frame', '.sr-foot', { fontSize: 11 },
    'footer text is the smallest tier: it is reference information, not content'),
  D('r-foot-version-mono', 'frame', '.sr-foot-v', { fontFamily: 'var(--sr-mono)', fontVariantNumeric: 'tabular-nums' },
    'the version and the fetched-at stamp are both figures, so both are mono and tabular'),
  D('r-foot-root', 'frame', '.sr-foot-root', { fontFamily: 'var(--sr-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, direction: 'rtl', textAlign: 'left' },
    'the skills root is a PATH, so it is mono, it truncates, and rtl direction keeps the END of the path visible — the beginning of every path here is the same home directory'),
  D('r-foot-sep', 'frame', '.sr-foot-sep', { color: 'var(--sr-fg3)', opacity: 0.6 },
    'the separators between footer facts are dimmer than the facts, or they read as content'),
  D('r-foot-kbd-gap', 'frame', '.sr-foot', { rowGap: 0 },
    'no row gap: the footer is one line and must never grow into two'),
  // ---- the sidebar glyph and host integration --------------------------------------------
  D('r-glyph-current', 'a11y', '.sr-glyph', { color: 'currentColor' },
    'the sidebar glyph inherits the host colour, so it matches the neighbouring icons in both themes'),
  D('r-glyph-opacity', 'a11y', '.sr-glyph', { opacity: 0.85 },
    'and sits at 85%, which is where the host draws its own inactive icons'),
  D('r-glyph-active', 'a11y', '.sr-glyph--on', { opacity: 1 },
    'the active state is full opacity, matching the host sidebar'),
  D('r-glyph-transition', 'a11y', '.sr-glyph', { transition: 'opacity var(--sr-speed-fade) var(--sr-ease)' },
    'and it fades between states rather than snapping'),
  // ---- the last typographic details ------------------------------------------------------
  D('r-quote-mark', 'type', '.sr-quote', { fontFamily: 'var(--sr-sans)', fontStyle: 'normal' },
    'quoted user text is NOT italic: an oblique synthesised in a CJK face is visibly wrong'),
  D('r-mono-optical', 'type', '{root}', { '--sr-mono-size-adjust': '.96' },
    'a named optical correction: mono faces set about 4% larger than sans at the same nominal size'),
  D('r-list-marker', 'type', '.sr-guide-list', { paddingInlineStart: 18 },
    'list markers get 18px, which is what keeps a two-line item aligned under its own text'),
  D('r-code-inline', 'type', '.sr-code', { fontFamily: 'var(--sr-mono)', fontSize: '.94em', padding: '1px 4px', borderRadius: 6, background: 'var(--sr-sunken)' },
    'inline code steps DOWN to .94em, because mono at the same nominal size looks larger'),
  D('r-time-now', 'time', '.sr-age--now', { color: 'var(--sr-ok)' },
    'the age column turns green under a minute, which is the one moment the reader cares about it'),
  D('r-empty-icon', 'sec', '.sr-empty .sr-ic', { opacity: 0.5 },
    'the empty-state icon is half strength: it decorates a sentence rather than leading it'),
  D('r-badge-dot-size', 'hero', '.sr-badge-dot', { width: 5, height: 5 },
    'a 5px dot inside a 20px badge: any larger and it competes with the label'),
  D('r-src-dot-align', 'meta', '.sr-src-dot', { alignSelf: 'center' },
    'the provenance dot centres on its line rather than sitting on the baseline'),
  D('r-stat-label-caps', 'stat', '.sr-stat-l', { textTransform: 'none' },
    'counter labels stay in sentence case: four uppercase labels in a row is a wall of capitals'),
  D('r-share-row-pad', 'stat', '.sr-share-row', { paddingBlock: 4 },
    'the share rows are 4px apart: they are a ranked list, so density is the point'),
  D('r-hist-row-gap', 'time', '.sr-hist-row', { gap: 8 },
    'history rows take the toast gap, so the two transient lists look related'),
  D('r-sheet-tab-count', 'sheet', '.sr-tab .sr-count', { fontSize: 11, opacity: 0.8 },
    'a count inside a tab steps down and dims, because the tab label is the target'),
  D('r-opt-size', 'sheet', '.sr-opt', { fontSize: 12, fontWeight: 400, textTransform: 'none' },
    'the 可选 marker is a quiet suffix: no case change, no weight, no colour of its own'),
  D('r-path-mono', 'sheet', '.sr-path', { fontFamily: 'var(--sr-mono)', fontSize: 12 },
    'any path the sheet shows is mono at the meta size'),
  D('r-counter-unit', 'meta', '.sr-unit', { fontSize: 12, color: 'var(--sr-fg3)' },
    'units like 次 and 个 step down from their number, so the figure stays the subject'),
  D('r-hint-kbd-inline', 'sec', '.sr-hint .sr-kbd', { marginInline: 2 },
    'a key cap inside a sentence needs 2px either side, or it touches the words'),
  D('r-toast-counter-mono', 'toast', '.sr-toast-n', { fontFamily: 'var(--sr-mono)', fontVariantNumeric: 'tabular-nums' },
    'the toast countdown is a figure that ticks every second, so it must not reflow'),
  D('r-drop-icon-size', 'sheet', '.sr-drop .sr-ic', { width: 20, height: 20, opacity: 0.7 },
    'the drop-zone icon at 20px and 70%: present enough to find, quiet enough not to be a button'),
  D('r-toggle-label-gap', 'btn', '.sr-btn--toggle', { gap: 6 },
    'the switch and its label sit 6px apart, the same gap the avatar uses for its initial'),
  D('r-toggle-track-size', 'btn', '.sr-switch', { width: 26, height: 15 },
    'a 26x15 track: legible as a switch at a glance, still smaller than the button that holds it'),
  D('r-toggle-knob-size', 'btn', '.sr-switch-knob', { width: 11, height: 11 },
    'an 11px knob in a 15px track leaves the 2px inset that makes a switch look mechanical'),
  D('r-per-section-gap', 'stat', '.sr-per-list', { rowGap: 1 },
    'one pixel between table rows: the grid alignment already separates them, so a gap would only add height'),
  D('r-recent-gap', 'time', '.sr-recent-list', { rowGap: 2 },
    'the recent list gets 2px, one step more than the table, because its rows are prose rather than figures'),
  D('r-capability-note', 'sheet', '.sr-cap-note', { fontSize: 12, lineHeight: 1.5, color: 'var(--sr-fg3)' },
    'the read-only explanation is a footnote, so it is set as one'),

  D('r-bp-chip-compact-tablet', 'stat', '.sr-statcard--inline', { paddingInline: 5, gap: 4, borderRadius: 6 },
    'the counter chips go compact below 900px: computed from the chip geometry that is 44px across four of them, which is what buys the summary a readable width instead of shrinking the numbers themselves'),
  D('r-bp-chip-label-tablet', 'stat', '.sr-stat-l', { fontSize: 12 },
    'and the chip label steps to 9.5px, the smallest size that still holds CJK shapes'),
  D('r-bp-chip-value-tablet', 'stat', '.sr-stat-v', { fontSize: 12 },
    'the value steps with its label rather than staying large over small caps'),
  D('r-bp-strip-count-tablet', 'stat', '.sr-strip-count', { paddingInline: 5, fontSize: 12 },
    'the install count chip tightens too, so the bar has one compact rhythm rather than two'),
  D('r-bp-mark-tablet', 'frame', '.sr-strip-logo', { width: 18, height: 18 },
    'and the brand mark steps down to 18px, freeing 4px and matching the smaller chips around it'),

  /* ============================ 21h. rounder controls, the oval count, and the colour filter ===
   *
   * Three requests: "整个插件的界面可以让很多按钮不要那么方正，可以更圆一点", the install count as an
   * OVAL rather than a rounded rectangle, and the tag/category chips replaced by colour blocks.
   */
  //
  // THE PILL FAMILY IS GONE, replaced by the one radius.
  //
  // It started as a real request ("还有很多按钮没有变成椭圆的是为什么") and the buttons honoured it; the rest of the
  // family followed on the reasoning that a field and a button in one row must share a corner. That reasoning is
  // still right — it is the VALUE that was wrong, and this pass sets it to 8 for all of them at once. Deleting the
  // records rather than setting each to 8 is deliberate: ~20 records that exist only to say "8" would leave the
  // next reader hunting for the rule, and the rule is now the base declarations above.
  //
  // What remains below is what is round by NATURE, not by style.
  D('r-round-seg-thumb', 'meta', '.sr-seg-ind', { borderRadius: 6 },
    'the selected tab\'s thumb is ONE STEP IN from its 8px track, which is what makes a segmented control read as inset rather than pasted on'),
  D('r-round-swatch', 'card', '.sr-swatch', { borderRadius: 999 },
    'colour swatches stay CIRCLES. A radius would turn a colour picker into a row of small squares, and a circle is what a colour reads as'),
  D('r-round-avatar-btn', 'card', '.sr-avatar-btn', { borderRadius: 8 },
    'the avatar wrapper follows the tile it wraps rather than being rounder than it'),
  D('r-round-hero', 'hero', '.sr-hero', { borderRadius: 8 },
    'the hero takes the one radius, like every other surface'),
  D('r-round-stat', 'stat', '.sr-stat', { borderRadius: 8 },
    'the stat cards take it too'),
  D('r-round-toast', 'toast', '.sr-toast', { borderRadius: 8 },
    'toasts are cards with a message in them, so they take the card radius'),
  D('r-round-textarea', 'sheet', '.sr-textarea', { borderRadius: 8 },
    'a textarea is a field, and every field is 8'),
  //
  // THE INSTALL COUNT AS AN OVAL. It was a rounded rectangle at radius 999 already, but only 20px tall
  // against a wide label, which is what made it read as a box rather than a lozenge: the fix is height
  // and horizontal padding, so the curve has room to be seen.
  D('r-count-oval', 'stat', '.sr-strip-count', {
    borderRadius: 6,
    paddingInline: 10,
    minHeight: 20,
    lineHeight: '18px',
    display: 'inline-flex',
    alignItems: 'center',
  }, 'the install count as a true lozenge: a pill radius on a short box still reads as a rectangle'),
  D('r-count-soft-bg', 'stat', '.sr-strip-count', { background: 'var(--sr-accent-weak)', color: 'var(--sr-accent)' },
    'and it is tinted with the accent rather than sunk into grey, so the counts read as information rather than as a disabled control'),
  D('r-count-soft-bg-hover', 'stat', '.sr-strip:hover .sr-strip-count', { background: 'color-mix(in srgb, var(--sr-accent) 20%, transparent)' },
    'deepening on hover with the bar, in the same tint family'),
  //
  // THE COLOUR FILTER that replaced the tag chips. Each swatch is a small circle carrying its own
  // colour, with the skill count beside it, so the row says both "which colour" and "how many".
  D('r-cf-row', 'sec', '.sr-swatches-filter', {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    rowGap: 4,
  }, 'the colour row replaces the category chips in the toolbar'),
  D('r-cf-item', 'sec', '.sr-cf', {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 7px 2px 4px',
    borderRadius: 999,
    border: '1px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--sr-fg2)',
    minHeight: 20,
  }, 'one colour as a small capsule: the dot identifies it, the number sizes it'),
  D('r-cf-dot', 'sec', '.sr-cf-dot', {
    width: 11,
    height: 11,
    borderRadius: 999,
    background: 'var(--sr-cf)',
    flex: 'none',
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.16)',
  }, 'the dot carries the colour, with a hairline inside so a pale swatch is still visible on white'),
  D('r-cf-n', 'sec', '.sr-cf-n', { fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--sr-fg3)' },
    'the count steps down and dims: the colour is the subject of this control'),
  D('r-cf-hover', 'sec', '.sr-cf:hover:not(:disabled)', { background: 'var(--sr-fill)', color: 'var(--sr-fg)' },
    'and it responds like every other chip'),
  D('r-cf-on', 'sec', '.sr-cf--on', {
    background: 'color-mix(in srgb, var(--sr-cf) 14%, transparent)',
    borderColor: 'color-mix(in srgb, var(--sr-cf) 42%, transparent)',
    color: 'var(--sr-fg)',
  }, 'selected is a tint of that swatch\'s own colour, so which filter is active is obvious without a label'),
  D('r-cf-off', 'sec', '.sr-cf:disabled', { opacity: 0.34, cursor: 'default' },
    'a colour with no skills behind it is dimmed rather than hidden, so the palette keeps a stable width'),
  D('r-cf-none', 'sec', '.sr-cf--none', { paddingInline: 8 },
    'the unmarked entry has no dot to show, so it takes the padding the dot would have used'),

  /* ============================ 21i. the action icons move INSIDE the bar =========
   *
   * "我希望浮窗的这几个图标也是在左边这个框里面的" — the four action buttons were siblings of the bar in
   * `.sr-strip-row`, so they sat outside its rounded frame. They are children of the bar now.
   *
   * That is why the bar became a `div` with `role="button"`: HTML forbids interactive content inside a
   * real `<button>`, and an inner button's click would also fire the outer toggle. The keyboard contract
   * is restored explicitly with `onKeyDown`, so nothing about the control is less reachable than before.
   */
  D('r-strip-is-control', 'frame', '.sr-strip', { cursor: 'pointer' },
    'a div does not get a pointer cursor for free, and this one is still a control'),
  D('r-strip-focus', 'a11y', '.sr-strip:focus-visible', { outline: '2px solid var(--sr-accent)', outlineOffset: 2 },
    'the focus ring a real button would have had, since the element no longer provides one'),
  D('r-strip-actions', 'frame', '.sr-strip-actions', {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    flex: 'none',
    marginLeft: 2,
  }, 'the icons sit at the end of the bar, inside its frame, as one group'),
  D('r-strip-action-btn', 'frame', '.sr-strip-actions .sr-btn', { width: 24, height: 24 },
    'one step smaller than the standalone size, because they are inside a 36px bar now rather than beside it'),
  D('r-strip-row-tight', 'frame', '.sr-strip-row', { columnGap: 0 },
    'nothing sits beside the bar any more, so the row gap has nothing left to separate'),

  /* ============================ 22. enable / disable + catalogue groups ============ */
  D('group-head', 'card', '.sr-group-head', { display: 'flex', alignItems: 'center', gap: 'calc(var(--sr-u) * 2)', padding: 'calc(var(--sr-u) * 2.5) 0 calc(var(--sr-u) * 1.5)' },
    'a group header is a row: label, count, and the sentence that explains the state'),
  D('group-gap', 'card', '.sr-group', { marginTop: 'calc(var(--sr-u) * 2)' },
    'the two groups are separate lists and need air between them'),
  D('group-title', 'card', '.sr-group-title', { fontSize: 12, fontWeight: 700, letterSpacing: 'var(--sr-track-loose)', textTransform: 'uppercase', color: 'var(--sr-fg2)' },
    'the group heading is the one thing that tells the user what the model can load'),
  D('group-note', 'card', '.sr-group-note', { fontSize: 12, color: 'var(--sr-fg3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
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
  D('statcard-inline-num', 'stat', '.sr-statcard--inline .sr-stat-v', { fontSize: 12, fontWeight: 700, letterSpacing: 'var(--sr-track-tight)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
    '15px is the largest that still fits four chips across the strip'),
  D('statcard-inline-label', 'stat', '.sr-statcard--inline .sr-stat-l', { fontSize: 12, letterSpacing: '.03em', textTransform: 'uppercase', fontWeight: 550, color: 'var(--sr-fg3)' },
    'the same micro-caps treatment as the full-size cards, so the two read as one system'),
  // The bar is one 18px line; a chip with card padding would set the bar's height and
  // visibly thicken it when the strip expands.
  D('statcard-bar', 'stat', '.sr-statcard--bar', { padding: 'calc(var(--sr-u) * .25) calc(var(--sr-u) * 1.5)', borderRadius: 6, gap: 'calc(var(--sr-u))' },
    'the bar variant is smaller again, so four chips fit an 18px line without thickening it'),
  D('statcard-bar-num', 'stat', '.sr-statcard--bar .sr-stat-v', { fontSize: 12, fontWeight: 700 },
    'the number steps down with the chip and stays the largest thing in it'),
  D('statcard-bar-label', 'stat', '.sr-statcard--bar .sr-stat-l', { fontSize: 12, letterSpacing: '.02em' },
    'and the label follows, keeping the pair readable at bar scale'),

  /* the claim row: its own row, at the card width ----------------------------- */
  D('cardfoot', 'card', '.sr-card-foot', { flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'calc(var(--sr-u) * 1.5)', minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' },
    'the card action column: buttons right-aligned, any revealed row BELOW them at full width'),
  D('claim-row', 'card', '.sr-claim-row', { alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 'calc(var(--sr-u) * 1.5)', width: '100%', marginTop: 'calc(var(--sr-u) * .5)', paddingTop: 'calc(var(--sr-u) * 2)', borderTop: '1px solid var(--sr-line)' },
    'the revealed claim field spans the CARD, which is why it is no longer a child of the button row'),
  D('claim-inner', 'card', '.sr-claim-row .sr-claim', { padding: 0, background: 'none', borderRadius: 8, borderTop: 0, marginTop: 0 },
    'one frame, not two: the row owns the rule and the padding'),
  D('claim-help', 'card', '.sr-claim-row .sr-help', { textAlign: 'left' },
    'the helper line sits under the field it describes'),
  // Both forms, on purpose, and BOTH are needed:
  //   * `.sr-portal-host` — the host as it is now (`install.js` no longer puts `sr-root` on a
  //     node that lives on `document.body`, so a future rule-loss cannot grow the page);
  //   * `.sr-root.sr-portal-host` — if the frame class ever comes back, this variant outranks
  //     `.sr-root` on specificity (0,2,0 vs 0,1,0) and still neutralises it.
  // What must NEVER happen is the form that shipped in 4.0.1: a rooted descendant
  // (`.sr-root .sr-portal-host`), which cannot match an element that IS a `.sr-root` rather
  // than being inside one. The host kept the panel frame as an empty box below `#root` and the
  // document grew by a full viewport of blank, scrollable page.
  D('portal-host', 'a11y', '.sr-portal-host,.sr-root.sr-portal-host', { position: 'static', display: 'contents' },
    'the portal host adds no box of its own: the sheet is positioned against the viewport',
    { rooted: false }),
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
])
// The four CORNER-RADIUS properties used to be in the set above, and they are lengths — someone added
// them to silence a checker rather than because a radius is unitless, and the effect was that every
// `borderTopLeftRadius: 14` emitted the unitless `border-top-left-radius:14`. That is invalid CSS, so
// the browser dropped it and the record did nothing at all while looking correct in the source.
// tools/check-css-units.mjs now fails on exactly this, which is how they were found.

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

/**
 * The declarations a record produces, in the sheet's exact spelling.
 *
 * EXPORTED so the test can compare against the generator instead of re-deriving it. The test used
 * to rebuild these two rules itself (camelCase to kebab-case, and "numbers under 100 get px unless
 * the key is unitless") and the copy drifted: it did not know about UNITLESS_KEYS, so a `tabSize: 2`
 * record was expected as `tab-size:2px` while the generator correctly emitted `tab-size:2` — and the
 * assertion reported a missing declaration that was present. One implementation, used twice.
 */
function designDeclarations(record) {
  const camel = (key) => key.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)
  // A number is a LENGTH unless the property is named as unitless — see the long note in polish.js.
  // The old version only appended `px` below 100, so `borderRadius: 8` emitted the invalid
  // `border-radius:999`, the browser discarded it, and every pill in the sheet was silently square
  // while the stylesheet read as correct.
  const value = (key, v) => (typeof v === 'number' && !UNITLESS_KEYS.has(key) ? `${v}px` : String(v))
  return Object.entries(record.props)
    .map(([key, raw]) => `${camel(key)}:${value(key, raw)}`)
    .join(';')
}

function designRuleFor(record, roots) {
  const decls = designDeclarations(record)
  const at = record.at
  // `rooted: false` emits the selector EXACTLY as written, for a rule that must match an
  // element which is not a descendant of a surface — the portal host on `document.body` is
  // the case that forced this. Without it, a bare class silently became "a descendant of a
  // surface", which for `.sr-portal-host` produced a selector that could never match the host
  // itself: the host kept the `.sr-root` frame (height:100%, 1px border, radius, --sr-max
  // width) as an empty box after `#root`, and the document grew by a full viewport — the
  // "blank framed page below the shell" a user reported.
  if (record.rooted === false) {
    if (!at.includes('.sr-')) throw new Error(`design rule "${record.id}" opts out of rooting with a selector that is not the plugin's: ${at}`)
    return `${at}{${decls}}`
  }
  if (at.includes('{all}')) return `${descendantSelector(at, roots)}{${decls}}`
  if (at.includes('{root}')) return `${roots.map((root) => root + at.replace('{root}', '')).join(',')}{${decls}}`
  if (roots.some((root) => at.startsWith(root))) return `${at}{${decls}}`
  if (!at.includes('.sr-')) throw new Error(`design rule "${record.id}" would apply OUTSIDE the plugin surfaces: ${at}`)
  return `${descendantSelector(at, roots)}{${decls}}`
}

/**
 * The keyframes the motion records reference.
 *
 * Kept here, next to the records that name them, rather than in the base sheet: an animation whose
 * keyframes live in a different file from the rule that uses it is how a `animation-name` ends up
 * pointing at nothing. `test/ui-polish.mjs` asserts every name referenced by a record exists here.
 */
const KEYFRAMES = Object.freeze({
  'sr-card-in': 'from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}',
  'sr-sheet-in': 'from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}',
  'sr-toast-in': 'from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}',
  // Referenced by the pending toast, whose icon spins while work is in flight. It was missing when
  // the assertion that checks for it was added — a name with no keyframes is silent, so the toast
  // simply never span and nothing reported it.
  'sr-spin': 'to{transform:rotate(360deg)}',
})

/**
 * The media queries each responsive record belongs to, keyed by the record-id suffix.
 *
 * A responsive record MUST NOT be emitted as a bare rule, or it would apply at every width and
 * silently override the desktop layout — which is the exact shape of the bug that made the
 * catalogue a single column everywhere (a `minmax(0,1fr)` grid rule that sat outside its media
 * query in the cascade). So the `r-bp-` records are pulled OUT of the main block and re-emitted
 * here inside their query.
 */
const BREAKPOINTS = Object.freeze([
  ['-wide', '(min-width: 1180px)'],
  ['-tablet', '(max-width: 900px)'],
  ['-phone', '(max-width: 560px)'],
])

/** Which query a record id belongs to, or `null` when it is not a responsive record. */
function breakpointOf(id) {
  if (!id.startsWith('r-bp-')) return null
  for (const [suffix, query] of BREAKPOINTS) if (id.endsWith(suffix)) return query
  throw new Error(`responsive record "${id}" ends in none of the known breakpoints (${BREAKPOINTS.map(([s]) => s).join(', ')})`)
}

function designCSS(roots) {
  if (!Array.isArray(roots) || roots.length === 0) return ''
  return [
    '/* ---- 4.0re design pass (generated from DESIGN in src/client/design.js) ---- */',
    // Responsive records are excluded here on purpose; they live in designResponsiveCSS.
    ...DESIGN.filter((record) => breakpointOf(record.id) === null).map((record) => designRuleFor(record, roots)),
    '/* keyframes named by the motion records above */',
    ...Object.entries(KEYFRAMES).map(([name, body]) => `@keyframes ${name}{${body}}`),
  ].join('\n')
}

/**
 * The responsive block: the `r-bp-` records, each inside its own media query.
 *
 * Emitted AFTER the main design block, so a breakpoint can override a desktop value without
 * needing extra specificity — the same ordering discipline the polish block follows.
 */
function designResponsiveCSS(roots) {
  if (!Array.isArray(roots) || roots.length === 0) return ''
  const out = ['/* ---- responsive steps (generated from the r-bp- records) ---- */']
  for (const [suffix, query] of BREAKPOINTS) {
    const records = DESIGN.filter((record) => record.id.startsWith('r-bp-') && record.id.endsWith(suffix))
    if (records.length === 0) continue
    out.push(`@media ${query}{`)
    for (const record of records) out.push(`  ${designRuleFor(record, roots)}`)
    out.push('}')
  }
  return out.join('\n')
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
  // NEUTRAL DARK, rebuilt with the light palette rather than left behind.
  //
  // The light pass moved to a neutral grey canvas and a single blue, so the old warm dark scale (#100e0c /
  // #f2efe9, with a periwinkle accent) would have been a different product. These values were SOLVED with the
  // same luminance maths `test/ui-polish.mjs` uses, not picked:
  //
  //   --sr-fg   #f5f5f7  12.80:1 on the card
  //   --sr-fg2  #a1a1a6   5.42:1
  //   --sr-fg3  #98989d   4.85:1  (the value that constrains the scale — it sits on the card, not on the darkest step)
  //   accent    #5c9bff   5.04:1 as text on the card
  //
  // TWO VALUES ARE COUNTER-INTUITIVE, and both were caught by computing rather than by looking:
  //
  //   * --sr-fg3 had to be RAISED from #8e8e93, which measured 4.27:1 on the card — under AA on the surface most
  //     of the small print actually sits on.
  //   * --sr-accent-ink is INK, not white. White on this accent is 2.77:1, so a filled primary button in dark
  //     mode carries dark text on the bright blue — which is also what macOS and Windows do. A dark theme that
  //     reuses the light theme's white-on-accent is unreadable, and nothing but the maths shows it.
  const overrides = {
    '--sr-canvas': '#1c1c1e',
    '--sr-card': '#2c2c2e',
    '--sr-raised': '#3a3a3c',
    '--sr-sunken': '#121214',
    '--sr-fill': 'rgba(255,255,255,.065)',
    '--sr-fill2': 'rgba(255,255,255,.038)',
    '--sr-line': 'rgba(255,255,255,.11)',
    '--sr-line2': 'rgba(255,255,255,.19)',
    '--sr-fg': '#f5f5f7',
    '--sr-fg2': '#a1a1a6',
    '--sr-fg3': '#98989d',
    '--sr-accent': '#5c9bff',
    '--sr-accent-ink': '#0b1220',
    '--sr-accent-weak': 'color-mix(in srgb, var(--sr-accent) 18%, transparent)',
    '--sr-accent-line': 'color-mix(in srgb, var(--sr-accent) 44%, transparent)',
    '--sr-display': '#5c9bff',
    '--sr-danger': '#ff6961',
    '--sr-danger-weak': 'color-mix(in srgb, var(--sr-danger) 16%, transparent)',
    '--sr-ok': '#5fc98a',
    '--sr-ok-weak': 'color-mix(in srgb, var(--sr-ok) 16%, transparent)',
    '--sr-warn': '#e3b341',
    '--sr-warn-weak': 'color-mix(in srgb, var(--sr-warn) 18%, transparent)',
    '--sr-scrim': 'rgba(0,0,0,.58)',
    // ONE shadow each, and a shallow one. The old values stacked two or three layers to build "elevation"; a
    // modern dark surface separates by LIGHTNESS (the four steps above) and uses shadow only to lift a floating
    // element off the page. Stacked dark blurs on a dark canvas read as dirt, which is the thing the brief calls
    // 老旧粗糙感.
    '--sr-e1': '0 1px 2px rgba(0,0,0,.30)',
    '--sr-e2': '0 2px 6px -1px rgba(0,0,0,.38)',
    '--sr-e3': '0 8px 24px -8px rgba(0,0,0,.50)',
    '--sr-ring': 'inset 0 0 0 1px rgba(255,255,255,.055)',
    '--sr-glow': 'none',
  }
  const decls = Object.entries(overrides).map(([key, value]) => `${key}:${value}`).join(';')
  const block = `${roots.join(',')}{${decls}}`
  // `[data-theme="dark"]` / `.dark` on any ancestor, plus the OS preference.
  const explicit = ['.dark', '[data-theme="dark"]', '[data-dsw-theme="dark"]']
    .map((sel) => `${sel} :is(${roots.join(',')})`)
    .join(',')

  /**
   * The brand mark swaps with the theme.
   *
   * The two marks are one brand in two states — open eye for light, closed eye for dark — so the
   * swap has to follow the SAME two signals the palette does, or a user who picks Dark in the app
   * while the OS is light would get the dark palette with the light logo. It is emitted here rather
   * than as parent-scoped records because it needs both a media query and ancestor-scoped
   * selectors, and a record can only be one of those.
   *
   * The `.sr-logo` classes appear in exactly one component, so the ancestor-scoped selectors need no
   * class prefix of their own — and a bare `.dark .sr-logo--light{display:none}` cannot accidentally
   * hide an icon in the host's own UI, because no other element carries that class.
   */
  const darkSignals = ['.dark', '[data-theme="dark"]', '[data-dsw-theme="dark"]']
  const darkLogos = [
    ...darkSignals.map((sel) => `${sel} .sr-logo--light{display:none}`),
    ...darkSignals.map((sel) => `${sel} .sr-logo--dark{display:block}`),
  ].join('\n')
  const osLogos = [
    '@media (prefers-color-scheme: dark){',
    '.sr-logo--light{display:none}',
    '.sr-logo--dark{display:block}',
    '}',
  ].join('\n')
  return `${osLogos}\n@media (prefers-color-scheme: dark){\n${block}\n}\n${explicit}{${decls}}\n/* the brand mark follows the same two signals */\n${darkLogos}`
}

/** Counts per group, for the tally a reviewer reads. */
function designCounts() {
  const out = {}
  for (const record of DESIGN) out[record.group] = (out[record.group] ?? 0) + 1
  return out
}

module.exports = { DESIGN, DESIGN_GROUPS, KEYFRAMES, BREAKPOINTS, designCSS, designResponsiveCSS, designDarkCSS, designCounts, designRuleFor, designDeclarations }
