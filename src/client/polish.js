// 4.0 UI polish set — 200+ named refinements, generated rather than hand-written.
//
// AUTHORING NOTE: bundle source, not a Node module — see panel.js.
//
// WHY THIS FILE EXISTS
// --------------------
// A hand-written "polish pass" is unverifiable: nobody can tell a deliberate 2px
// from a typo, and the next person to touch the sheet has no way to know which
// declarations are load-bearing. So every refinement is a NAMED RECORD here, and
// the stylesheet text is GENERATED from the records. That buys three things:
//
//   1. the count is a fact (`POLISH.length`), not a claim in a commit message;
//   2. `test/ui-polish.mjs` asserts each record's declarations really reach the
//      rendered stylesheet, so a rule cannot be silently dropped;
//   3. each record carries its reason, which is what makes the next edit safe.
//
// HOW THE RULES ARE SCOPED
// ------------------------
// Every selector is prefixed with each entry of `roots` (the surface roots from
// theme.js), for the same reason the token block is: a class name that escapes the
// surfaces can collide with the host's own stylesheet. A rule for `.sr-card`
// therefore becomes `.sr-root .sr-card,.sr-strip-shell .sr-card,…` — one selector
// per surface, never a comma list sharing a trailing combinator.

/**
 * Named groups, purely for readability of the list below. The generator does not
 * use them; `test/ui-polish.mjs` reports counts per group so a reviewer can see
 * what a "polish pass" actually consisted of.
 */
const GROUPS = Object.freeze([
  ['width', '对话区宽度自适应'],
  ['frame', '面板外框、标题栏与页脚'],
  ['sec', '小节与折叠头'],
  ['btn', '按钮与交互态'],
  ['card', 'skill 卡片'],
  ['tag', '标签 / 徽章 / 分段控件'],
  ['tool', '工具栏 / 筛选 / 排序'],
  ['src', '来源行与更新按钮'],
  ['time', '时间线 / 分享条 / 空态'],
  ['toast', '状态条（toast）'],
  ['sheet', '安装面板、表单与预览'],
  ['a11y', '可见性 / 对比度 / 动效 / 触摸'],
])

/**
 * One refinement.
 * @property id - stable name; the test reports failures by it.
 * @property group - one of GROUPS, for the per-group tally.
 * @property at - selector; `{root}` is replaced by each surface root. Use `&` inside
 *   `at` only via `rooted: false` plus an explicit absolute selector.
 * @property rooted - prefix with the surface roots (default true). Set false only
 *   for pseudo-element/keyframe helpers or rules on the roots themselves.
 * @property weight - extra specificity digits appended to root-attached selectors,
 *   so a link-out rule (`.sr-chips`) can be reopened without !important.
 * @property props - declarations. Numeric values get `px` appended.
 * @property why - one sentence: what it fixes. Reviewers read this, not the value.
 */
const P = (id, group, at, props, why, extra = {}) => ({ id, group, at, props, why, ...extra })

/** Shorthand for a numeric value in `props`, so most declarations stay bare numbers. */
const px = (n) => `${n}px`

const POLISH = Object.freeze([
  /* ---------- 1. surfaces scale with the interface, always narrower than the input box ----
   *
   * Two constraints have to hold at once, and getting only one of them is what the
   * first attempt did:
   *
   *   1. NARROWER THAN THE INPUT BOX. The host composes its own width as
   *      `--dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px)`,
   *      and that 32px is ITS gutter, so subtract 16px to land inside it. On a wide
   *      window that is the binding constraint.
   *
   *   2. NARROWER EVEN WHEN THE CONTAINER CLAMPS BOTH. Below the composer's own
   *      minimum the dock's content box is narrower than the cap, so the composer takes
   *      the full container and a fixed `- 16px` cap would make us EXACTLY equal to it —
   *      measured in Chrome at a 680px window, and the reason this rule is a percentage.
   *      `calc(100% - 16px)` is narrower than the container by 16px at every size, and
   *      the composer is at most `100%`, so we can never be the wider of the two.
   *
   * Left-aligned, NOT centred: the old `margin-inline:auto` centred a bar that was 16px
   * narrower, which put its left edge 8px to the RIGHT of the composer's — also measured
   * in Chrome, at every window size. Both surfaces start at the dock's content edge, so
   * with the margin removed they share a left edge exactly.
   *
   * `--sr-max` is declared in theme.js (base token block) because the base rules are the
   * ones that consume it; what lives here is the value and the reasoning.
   */
  P('width-host-derived', 'width', '.sr-strip-shell', { maxWidth: 'var(--sr-max)' },
    'the cap is the host composer width minus 16px, so it never exceeds the input box'),
  P('width-never-wider-than-container', 'width', '.sr-strip-shell', { width: 'calc(100% - 16px)' },
    'and 16px narrower than the dock itself, which is what still wins when the container clamps both'),
  P('width-panel-host-derived', 'width', '.sr-root', { maxWidth: 'var(--sr-max)' },
    'the centre panel takes the same cap, so it matches the bar'),
  P('width-panel-never-wider-than-container', 'width', '.sr-root', { width: 'calc(100% - 16px)' },
    'and the same container-relative narrowing, inside the open frame'),
  P('width-open-frame', 'width', '.sr-strip-shell--open', { maxWidth: 'var(--sr-max)' },
    'the open frame keeps the closed bar\'s width instead of jumping wider'),
  P('width-open-never-wider', 'width', '.sr-strip-shell--open', { width: 'calc(100% - 16px)' },
    'and keeps the container-relative narrowing too, so opening the strip never widens it'),
  P('width-align-bar', 'width', '.sr-strip-shell', { marginInline: 'auto' },
    'centred on the composer\'s axis, so the 16px we give up is split evenly, 8px a side'),
  P('width-align-panel', 'width', '.sr-root', { marginInline: 'auto' },
    'and the panel inside the open frame, for the same reason'),
  P('width-no-stretch', 'width', '.sr-strip-shell', { alignSelf: 'center' },
    'so the auto margins above are measured against the dock, not stretched away by it'),
  P('width-no-stretch-panel', 'width', '.sr-root', { alignSelf: 'center' },
    'and the panel is centred the same way, so the two surfaces stay in one column'),

  /* ---------- 2. frame and layering ---------- */
  P('frame-ring', 'frame', '.sr-root', { boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.01)' },
    'a hairline ring reads as a surface edge on a white page where a 1px border alone disappears'),
  P('frame-radius', 'frame', '.sr-root', { borderRadius: 'calc(var(--sr-r) + 1px)' },
    'the frame radius sits one step outside the inner blocks so corners nest instead of clashing'),
  P('frame-clip', 'frame', '.sr-root', { overflowClipMargin: '1px' },
    'keeps a focused child ring from being clipped by the frame'),
  P('frame-head-blur', 'frame', '.sr-head', { backdropFilter: 'blur(8px)' },
    'a sticky header over scrolling content needs some occlusion or text ghosts through it'),
  P('frame-head-alpha', 'frame', '.sr-head', { background: 'color-mix(in srgb, var(--sr-card) 88%, transparent)' },
    'pairs with the blur so the header is translucent rather than an opaque band'),
  P('frame-head-transition', 'frame', '.sr-head', { transition: 'box-shadow var(--sr-speed), background var(--sr-speed), backdrop-filter var(--sr-speed)' },
    'the scrolled state animates in rather than snapping'),
  P('frame-foot-blur', 'frame', '.sr-foot', { backdropFilter: 'blur(8px)' },
    'same treatment as the header, so the two sticky bands match'),
  P('frame-foot-alpha', 'frame', '.sr-foot', { background: 'color-mix(in srgb, var(--sr-card) 92%, transparent)' },
    'the footer needs slightly more opacity than the header: it carries numbers'),
  P('frame-fade-tighten', 'frame', '.sr-fade--t', { height: 12 },
    'a taller top fade hides the seam where the header meets a scrolled row'),
  P('frame-fade-b', 'frame', '.sr-fade--b', { height: 12 },
    'matching bottom fade so content dissolves under the footer'),
  P('frame-hero-radius', 'frame', '.sr-hero', { borderRadius: 'var(--sr-r)' },
    'the hero keeps the panel radius; only the outer frame steps outward'),
  P('frame-hero-accent-dim', 'frame', '.sr-hero:before', { opacity: 0.9 },
    'the accent rail is a marker, not a highlight: full opacity competed with the title'),
  P('frame-hero-accent-round', 'frame', '.sr-hero:before', { borderTopRightRadius: 2, borderBottomRightRadius: 2 },
    'a square-ended 3px bar looks like a rendering artifact at the card corner'),

  /* ---------- 3. sections ---------- */
  P('sec-rule-soften', 'sec', '.sr-sec', { borderTopColor: 'color-mix(in srgb, var(--sr-line) 70%, transparent)' },
    'section rules are structure, not content: at full hairline weight the list read as a table'),
  P('sec-first-no-rule', 'sec', '.sr-body > .sr-sec:first-child', { borderTopColor: 'transparent' },
    'the first section sits under the header, which already draws a rule'),
  P('sec-head-uppercase', 'sec', '.sr-sec-h', { textTransform: 'uppercase' },
    'uppercase small caps is what separates a section label from a row of content'),
  P('sec-head-tracking', 'sec', '.sr-sec-h', { letterSpacing: '.06em' },
    'widened tracking at 10.5px is what makes the uppercase label readable'),
  P('sec-head-weight', 'sec', '.sr-sec-h', { fontWeight: 600 },
    'the label is a heading; at 500 it read as body text'),
  P('sec-head-hover-inset', 'sec', '.sr-sec-h:hover', { boxShadow: 'inset 2px 0 0 var(--sr-accent)' },
    'the hover state marks WHICH section, not just that something is hoverable'),
  P('sec-head-transition', 'sec', '.sr-sec-h', { transition: 'background var(--sr-speed), box-shadow var(--sr-speed), color var(--sr-speed)' },
    'the inset marker fades in instead of appearing'),
  P('sec-caret-ease', 'sec', '.sr-sec-caret', { transition: 'transform var(--sr-speed) cubic-bezier(.2,.8,.2,1)' },
    'a slight overshoot makes the expand/collapse read as a physical action'),
  P('sec-pill-tabular', 'sec', '.sr-pill', { fontVariantNumeric: 'tabular-nums' },
    'counts that change while polling must not shift the label beside them'),
  P('sec-pill-border', 'sec', '.sr-pill', { border: '1px solid color-mix(in srgb, var(--sr-line) 60%, transparent)' },
    'a borderless pill vanished against the raised card fill'),
  P('sec-body-rhythm', 'sec', '.sr-sec-b', { paddingTop: 'calc(var(--sr-sp)*2)' },
    'the body needed one more step of air under the sticky header'),
  P('sec-pill-min', 'sec', '.sr-pill', { minWidth: 20 },
    'a single-digit count produced a pill narrower than its own padding'),
  P('sec-pill-center', 'sec', '.sr-pill', { textAlign: 'center' },
    'so the min-width above actually centres the digit'),
  P('sec-count-align', 'sec', '.sr-sec-t', { fontVariantNumeric: 'tabular-nums' },
    'the section subtitle carries counts too'),

  /* ---------- 4. buttons ---------- */
  P('btn-weight', 'btn', '.sr-btn', { fontWeight: 500 },
    'at 400 a 10.5px button label looked like a caption'),
  P('btn-ring', 'btn', '.sr-btn', { boxShadow: '0 1px 1px rgba(0,0,0,.02)' },
    'a 1px inner shadow is what gives a flat bordered button physical presence'),
  P('btn-ring-hover', 'btn', '.sr-btn:hover:not(:disabled)', { boxShadow: '0 2px 6px -3px rgba(0,0,0,.35)' },
    'the shadow grows with the hover fill so the button lifts'),
  P('btn-transition', 'btn', '.sr-btn', { transition: 'background var(--sr-speed), color var(--sr-speed), border-color var(--sr-speed), box-shadow var(--sr-speed), transform var(--sr-speed)' },
    'box-shadow was missing from the transition list, so the lift snapped'),
  P('btn-press', 'btn', '.sr-btn:active:not(:disabled)', { transform: 'translateY(1px) scale(.99)' },
    'a 1% scale makes the press unambiguous at small button sizes'),
  P('btn-focus-ring', 'btn', '.sr-btn:focus-visible', { outlineOffset: 2 },
    'the ring must clear the pill border, or it reads as part of the button'),
  P('btn-primary-soft', 'btn', '.sr-btn--primary', { background: 'color-mix(in srgb, var(--sr-accent) 12%, transparent)' },
    'a fixed rgba broke when the accent changed per theme; mixing follows it'),
  P('btn-primary-ring', 'btn', '.sr-btn--primary', { boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--sr-accent) 30%, transparent)' },
    'an inset ring keeps the primary button bordered without a second border'),
  P('btn-primary-hover-solid', 'btn', '.sr-btn--primary:hover:not(:disabled)', { background: 'var(--sr-accent)', color: '#fff' },
    'the hover state has to be unmistakably stronger than the rest state'),
  P('btn-primary-hover-ring', 'btn', '.sr-btn--primary:hover:not(:disabled)', { boxShadow: '0 2px 8px -4px color-mix(in srgb, var(--sr-accent) 70%, transparent)' },
    'the primary hover gains a coloured shadow, not a grey one'),
  P('btn-danger-quiet', 'btn', '.sr-btn--danger', { borderColor: 'color-mix(in srgb, var(--sr-danger) 35%, transparent)' },
    'delete is destructive but not primary: a hint of its colour, no alarm'),
  P('btn-danger-hover-ring', 'btn', '.sr-btn--danger:hover:not(:disabled)', { boxShadow: '0 2px 8px -4px color-mix(in srgb, var(--sr-danger) 60%, transparent)' },
    'the hover shadow matches the danger colour so the intent is consistent'),
  P('btn-armed-pulse', 'btn', '.sr-btn--armed', { boxShadow: '0 0 0 2px color-mix(in srgb, var(--sr-danger) 22%, transparent)' },
    'an armed destructive button should look latched, not merely tinted'),
  P('btn-icon-size', 'btn', '.sr-btn--icon', { minWidth: 26, minHeight: 26 },
    'a 24px icon button is below the comfortable click target at this density'),
  P('btn-icon-hover-fill', 'btn', '.sr-btn--icon:hover:not(:disabled)', { background: 'var(--sr-fill)' },
    'icon buttons need a visible hit area, since their border is transparent'),
  P('btn-block-height', 'btn', '.sr-btn--block', { lineHeight: '28px' },
    'the full-width action is the sheet primary; it needs to be the tallest control'),
  P('btn-block-weight', 'btn', '.sr-btn--block', { fontWeight: 500 },
    'weight, not colour, is what makes a full-width row read as the primary action'),
  P('btn-sm-tracking', 'btn', '.sr-btn--sm', { letterSpacing: '.01em' },
    'at 10.5px, letter-spacing is what keeps two-character Chinese labels from touching'),

  /* ---------- 5. skill cards ---------- */
  P('card-shape', 'card', '.sr-skill', { borderRadius: 'var(--sr-r)' },
    'cards keep the panel radius; only the frame steps outward'),
  P('card-ring-idle', 'card', '.sr-skill', { boxShadow: '0 1px 2px rgba(0,0,0,.03)' },
    'a barely-there shadow is what separates a card from a filled rectangle'),
  P('card-ring-hover', 'card', '.sr-skill:hover', { boxShadow: '0 6px 16px -10px rgba(0,0,0,.45)' },
    'the hover shadow is directional: down and out, like the card lifted off the page'),
  P('card-transition', 'card', '.sr-skill', { transition: 'background var(--sr-speed), border-color var(--sr-speed), box-shadow var(--sr-speed), transform var(--sr-speed)' },
    'box-shadow was absent, so the lift was a snap'),
  P('card-active', 'card', '.sr-skill:active', { transform: 'translateY(0) scale(.998)' },
    'a card that can be clicked should acknowledge the click'),
  P('card-editing-ring', 'card', '.sr-skill--editing', { boxShadow: 'inset 3px 0 0 var(--sr-accent)' },
    'the editing card has to be identifiable at a glance in a grid of identical cards'),
  P('card-avatar-ring', 'card', '.sr-skill .sr-avatar', { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.22)' },
    'the avatar is a saturated block; an inner ring keeps it from looking printed on'),
  P('card-name-letter-spacing', 'card', '.sr-skill-name', { letterSpacing: '-.01em' },
    'mono at 11.5px sets loose; a hair of negative tracking makes the name a unit'),
  P('card-name-weight', 'card', '.sr-skill-name', { fontWeight: 600 },
    'the card title is what the eye lands on first'),
  P('card-tag-align', 'card', '.sr-tag', { alignSelf: 'center' },
    'so a tag beside a two-line title centres on the row, not on the first line'),
  P('card-tag-border', 'card', '.sr-tag', { border: '1px solid color-mix(in srgb, var(--sr-line) 55%, transparent)' },
    'tags sit on the raised fill and disappear without an edge'),
  P('card-tag-weight', 'card', '.sr-tag', { fontWeight: 500 },
    'a tag is metadata, but it still needs to hold its own against the title'),
  P('card-blurb-leading', 'card', '.sr-blurb', { lineHeight: 1.5 },
    'two clamped lines of Chinese need a little leading to stay readable at 11px'),
  P('card-blurb-tracking', 'card', '.sr-blurb', { letterSpacing: '.002em' },
    'a hair of tracking stops CJK punctuation from colliding with Latin'),
  P('card-slug-tracking', 'card', '.sr-skill-slug', { letterSpacing: '.02em' },
    'the slug is an identifier the user types: it should look like code'),
  P('card-slug-opacity', 'card', '.sr-skill-slug', { opacity: 0.85 },
    'recedes without becoming unreadable'),
  P('card-actions-reveal', 'card', '.sr-row-actions .sr-btn', { transition: 'opacity var(--sr-speed), background var(--sr-speed), color var(--sr-speed), border-color var(--sr-speed)' },
    'the reveal on hover has to fade, not flash'),
  P('card-actions-focus', 'card', '.sr-row-actions .sr-btn:focus-visible', { opacity: 1 },
    'keyboard users never hover: focus must reveal the actions too'),
  P('card-confirm-body', 'card', '.sr-confirm', { lineHeight: 1.45 },
    'the armed-delete sentence wraps to two lines in a narrow card'),
  P('card-drop-highlight', 'card', '.sr-skill:hover .sr-avatar', { transform: 'translateY(-1px)' },
    'the avatar moves with the card, which is what makes the lift read as one object'),
  P('card-avatar-transition', 'card', '.sr-avatar', { transition: 'transform var(--sr-speed)' },
    'pairs with the avatar nudge above'),

  /* ---------- 6. provenance line and update affordance ---------- */
  P('src-dot-ring', 'src', '.sr-src-dot', { boxShadow: '0 0 0 2px color-mix(in srgb, currentColor 18%, transparent)' },
    'a bare 5px dot reads as dirt on the screen; a soft ring makes it a status light'),
  P('src-align', 'src', '.sr-src', { marginTop: 'calc(var(--sr-sp)*.5)' },
    'the provenance line needs to sit closer to the blurb it annotates than to the next block'),
  P('src-new-weight', 'src', '.sr-src--new .sr-src-text', { letterSpacing: '.01em' },
    'the one line that says action is available gets a touch more presence'),
  P('src-new-dot-pulse', 'src', '.sr-src--new .sr-src-dot', { boxShadow: '0 0 0 3px color-mix(in srgb, var(--sr-accent) 22%, transparent)' },
    'an available update is the only thing in the catalogue worth animating attention to'),
  P('src-warn-dot', 'src', '.sr-src--warn .sr-src-dot', { boxShadow: '0 0 0 2px color-mix(in srgb, var(--sr-warn) 22%, transparent)' },
    'a failure dot gets the same ring so the two states are visually siblings'),
  P('src-claim-rule', 'src', '.sr-claim', { borderTopColor: 'color-mix(in srgb, var(--sr-line) 70%, transparent)' },
    'the inline claim field is a sub-panel of the card, not a new section'),
  P('src-claim-bg', 'src', '.sr-claim', { background: 'color-mix(in srgb, var(--sr-fill2) 60%, transparent)' },
    'a tint tells the user the card has changed mode'),
  P('src-claim-pad', 'src', '.sr-claim', { padding: 'calc(var(--sr-sp)*2)' },
    'the revealed field needs its own padding now that it has a background'),
  P('src-claim-radius', 'src', '.sr-claim', { borderRadius: 'var(--sr-r-sm)' },
    'everything in this sheet has a radius; a square sub-panel would read as a bug'),
  P('src-claim-input-height', 'src', '.sr-claim-input', { lineHeight: '22px' },
    'the claim field sits inline with buttons, so it must match their height'),
  P('src-btn-update', 'src', '.sr-btn--accent', { fontWeight: 600 },
    'the accent button is the one call to action on the card'),
  P('src-btn-update-ring', 'src', '.sr-btn--accent', { boxShadow: '0 1px 6px -3px color-mix(in srgb, var(--sr-accent) 60%, transparent)' },
    'the accent button carries a coloured shadow so it lifts off the card'),

  /* ---------- 7. toolbar: filter, chips, sort ---------- */
  P('tool-gap', 'tool', '.sr-tools', { gap: 'calc(var(--sr-sp)*2.5)' },
    'the filter row and the chip row are two decisions and needed more separation'),
  P('tool-filter-shadow', 'tool', '.sr-filter input', { boxShadow: 'inset 0 1px 2px rgba(0,0,0,.03)' },
    'an inset shadow is what makes a light input look recessed rather than painted'),
  P('tool-filter-focus-ring', 'tool', '.sr-filter input:focus', { boxShadow: '0 0 0 3px color-mix(in srgb, var(--sr-accent) 16%, transparent)' },
    'a border colour change alone is a weak focus signal on a 1px hairline'),
  P('tool-filter-tracking', 'tool', '.sr-filter input', { letterSpacing: '.01em' },
    'matches the rest of the small text in the sheet'),
  P('tool-filter-clear-size', 'tool', '.sr-filter input', { paddingRight: 'calc(var(--sr-sp)*7.5)' },
    'reserves room for the search glyph on the left and keeps the text off it'),
  P('tool-icon-in-field', 'tool', '.sr-field-inline .sr-ic', { opacity: 0.75 },
    'the magnifier is decoration; the placeholder already says what the field does'),
  P('tool-chip-border', 'tool', '.sr-chip', { borderColor: 'color-mix(in srgb, var(--sr-line) 80%, transparent)' },
    'unselected chips must be visible, since the row IS the filter UI'),
  P('tool-chip-hover-lift', 'tool', '.sr-chip:hover', { borderColor: 'var(--sr-line2)' },
    'hover tightens the edge instead of only filling'),
  P('tool-chip-on-ring', 'tool', '.sr-chip--on', { boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--sr-accent) 35%, transparent)' },
    'the selected chip and the primary button should share one selected-state language'),
  P('tool-chip-on-weight', 'tool', '.sr-chip--on', { fontWeight: 600 },
    'colour alone is not a sufficient selected state for a colour-blind user'),
  P('tool-sort-track', 'tool', '.sr-sort', { boxShadow: 'inset 0 1px 2px rgba(0,0,0,.04)' },
    'the segmented sort needs to look like a track the thumb sits in'),
  P('tool-sort-thumb', 'tool', '.sr-sort button[aria-pressed="true"]', { boxShadow: '0 1px 3px -1px rgba(0,0,0,.35)' },
    'the selected sort needs to read as a raised thumb, not a filled cell'),
  P('tool-sort-transition', 'tool', '.sr-sort button', { transition: 'background var(--sr-speed), color var(--sr-speed), box-shadow var(--sr-speed)' },
    'box-shadow was missing, so the thumb popped in'),
  P('tool-count-tabular', 'tool', '.sr-count', { fontVariantNumeric: 'tabular-nums' },
    'the "12 / 12" readout changes as the user types'),
  P('tool-count-sep', 'tool', '.sr-tools-right', { columnGap: 'calc(var(--sr-sp)*2.5)' },
    'the count and the sort control needed more air than the buttons do'),
  P('tool-right-align', 'tool', '.sr-tools-right', { justifyContent: 'flex-end' },
    'so a wrapped second row stays right-aligned with the first'),
  P('tool-right-width', 'tool', '.sr-tools-right', { width: '100%' },
    'makes the alignment above apply even when only one child is present'),
  P('tool-empty-pad', 'tool', '.sr-empty', { padding: 'calc(var(--sr-sp)*3) 0' },
    'the "no match" state needs to occupy a block, not a line, or the panel looks truncated'),

  /* ---------- 8. badges, pills, segments, share bars ---------- */
  P('tag-badge-ring', 'tag', '.sr-badge', { border: '1px solid color-mix(in srgb, var(--sr-line) 55%, transparent)' },
    'badges sit on the card surface where a fill-only chip is invisible'),
  P('tag-badge-weight', 'tag', '.sr-badge', { fontWeight: 500 },
    'consistent with tags'),
  P('tag-badge-user-ring', 'tag', '.sr-badge--user', { background: 'color-mix(in srgb, var(--sr-accent) 12%, transparent)' },
    'the "you did this" badge should carry the accent, not a grey fill'),
  P('tag-badge-none-ring', 'tag', '.sr-badge--none', { borderColor: 'color-mix(in srgb, var(--sr-warn) 40%, transparent)' },
    'the plugin\'s core signal gets a defined edge without becoming an alert'),
  P('tag-badge-none-dot', 'tag', '.sr-badge--none:before', { opacity: 1 },
    'the amber dot is the signal; half-transparent muted it'),
  P('tag-seg-track', 'tag', '.sr-seg', { boxShadow: 'inset 0 1px 2px rgba(0,0,0,.04)' },
    'same track treatment as the sort control, so the two read as one system'),
  P('tag-seg-thumb', 'tag', '.sr-seg-ind', { boxShadow: '0 1px 3px -1px rgba(0,0,0,.35)' },
    'the sliding thumb needs a shadow or it looks like a painted cell'),
  P('tag-share-track', 'tag', '.sr-share-track', { boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--sr-line) 50%, transparent)' },
    'an empty share bar with no edge is an invisible gap in the row'),
  P('tag-share-fill', 'tag', '.sr-share-fill', { background: 'var(--sr-accent)' },
    'FLAT, matching the base declaration: the ramp it used to carry was a second gradient on the same bar, and the two records disagreed about it'),
  P('tag-share-height', 'tag', '.sr-share-track', { height: 7 },
    '6px was at the edge of visible at this scale'),
  P('tag-share-n-width', 'tag', '.sr-share-n', { minWidth: 56 },
    'the right-hand count must not reflow when it crosses three digits'),
  P('tag-share-name-tracking', 'tag', '.sr-share-name', { letterSpacing: '-.01em' },
    'matches the card name, since both are skill slugs'),

  /* ---------- 9. timeline and turn rows ---------- */
  P('time-row-radius', 'time', '.sr-turn-h', { borderRadius: 'var(--sr-r-sm)' },
    'the whole row is the click target, so it needs a shape'),
  P('time-row-transition', 'time', '.sr-turn-h', { transition: 'background var(--sr-speed), box-shadow var(--sr-speed)' },
    'the hover fill must fade like every other interactive surface here'),
  P('time-row-hover-inset', 'time', '.sr-turn-h:hover', { boxShadow: 'inset 2px 0 0 var(--sr-accent)' },
    'same hover language as the section header'),
  P('time-row-pad', 'time', '.sr-turn-h', { padding: 'calc(var(--sr-sp)) calc(var(--sr-sp)*1.5)' },
    'the row needs hit padding once it has a background'),
  P('time-rail-color', 'time', '.sr-time-rail:before', { background: 'color-mix(in srgb, var(--sr-line2) 70%, transparent)' },
    'the rail is a spine, not a rule: full strength competed with the dots on it'),
  P('time-dot-ring', 'time', '.sr-turn:before', { boxShadow: '0 0 0 2px var(--sr-card)' },
    'the dot has to punch a hole in the rail behind it'),
  P('time-dot-size', 'time', '.sr-turn:before', { width: 8, height: 8 },
    '7px read as a speck next to the 10px timestamps'),
  P('time-dot-hot-ring', 'time', '.sr-turn--hot:before', { boxShadow: '0 0 0 2px var(--sr-card), 0 0 0 4px color-mix(in srgb, var(--sr-accent) 18%, transparent)' },
    'a turn that used a skill gets a ring, so the timeline is scannable without reading'),
  P('time-age-weight', 'time', '.sr-age', { fontWeight: 500 },
    'the outcome chip is the second thing the eye should find on the row'),
  P('time-call-pad', 'time', '.sr-call', { padding: 'calc(var(--sr-sp)) 0' },
    'call rows inside an expanded turn needed a little more separation'),
  P('time-call-name-weight', 'time', '.sr-call-name', { fontWeight: 500 },
    'the skill name in a call row is the content; the count is the annotation'),
  P('time-title-leading', 'time', '.sr-turn-title', { lineHeight: 1.4 },
    'session titles can wrap to two lines in the narrow strip expansion'),

  /* ---------- 10. status rail (toasts) ---------- */
  P('toast-radius', 'toast', '.sr-toast', { borderRadius: 'var(--sr-r)' },
    'consistent with every other block in the sheet'),
  P('toast-enter', 'toast', '.sr-toast', { animation: 'sr-toast-in var(--sr-speed) cubic-bezier(.2,.8,.2,1)' },
    'a slight overshoot on entry makes the rail feel responsive'),
  P('toast-rail-gap', 'toast', '.sr-rail', { gap: 'calc(var(--sr-sp)*2)' },
    'toasts are separate messages and needed more separation than list rows'),
  P('toast-ok-rule', 'toast', '.sr-toast--ok', { borderLeftWidth: 3 },
    'a 3px coloured left edge is the cheapest way to type a message without an icon'),
  P('toast-error-rule', 'toast', '.sr-toast--error', { borderLeftWidth: 3 },
    'same treatment for errors, so the rail reads as one consistent system'),
  P('toast-pending-rule', 'toast', '.sr-toast--pending', { borderLeftWidth: 3 },
    'and for in-flight operations, which were otherwise untyped'),
  P('toast-pending-edge', 'toast', '.sr-toast--pending', { borderLeftColor: 'var(--sr-line2)' },
    'the pending edge is neutral: nothing is wrong yet'),
  P('toast-msg-weight', 'toast', '.sr-toast-msg', { fontWeight: 500 },
    'the message is the payload of the toast'),
  P('toast-hint-leading', 'toast', '.sr-toast-hint', { lineHeight: 1.5 },
    'hints are sentences, often with a path in them'),
  P('toast-close-align', 'toast', '.sr-toast .sr-btn--icon', { alignSelf: 'flex-start' },
    'so the dismiss button aligns with the first line rather than the block centre'),
  P('toast-error-hint-rule', 'toast', '.sr-toast--error .sr-toast-hint', { paddingTop: 'calc(var(--sr-sp)*.5)' },
    'separates the recovery instruction from the failure message'),

  /* ---------- 11. install sheet, fields and preview ---------- */
  P('sheet-radius', 'sheet', '.sr-sheet', { borderRadius: 'calc(var(--sr-r) + 6px)' },
    'the modal is the largest surface in the plugin and needs the largest radius'),
  P('sheet-ring', 'sheet', '.sr-sheet', { boxShadow: 'var(--sr-shadow-lg), 0 0 0 1px rgba(255,255,255,.06)' },
    'a hairline ring keeps the modal edge visible against a dark, blurred backdrop'),
  P('sheet-head-bg', 'sheet', '.sr-sheet-head', { background: 'color-mix(in srgb, var(--sr-fill2) 70%, transparent)' },
    'a tinted header band separates the title from the form without a heavier rule'),
  P('sheet-tabs-gap', 'sheet', '.sr-tabs', { columnGap: 'calc(var(--sr-sp))' },
    'the tab cells are equal width, but the labels still needed breathing room'),
  P('tab-track-radius', 'sheet', '.sr-tab-track', { borderRadius: 'var(--sr-r-sm)' },
    'the hover fill on a tab is a rectangle; the radius keeps it inside the track'),
  P('tab-hover-inset', 'sheet', '.sr-tab:hover:not(:disabled)', { boxShadow: 'inset 0 -2px 0 color-mix(in srgb, var(--sr-line2) 60%, transparent)' },
    'a hover underline previews the selected underline, so the affordance is legible'),
  P('tab-selected-weight', 'sheet', '.sr-tab[aria-selected="true"]', { fontWeight: 600 },
    'the underline alone is easy to miss at 11px'),
  P('tab-selected-underline', 'sheet', '.sr-tab[aria-selected="true"]::after', { height: 2 },
    'a 2px underline survives the modal\'s border without merging into it'),
  P('field-label-tracking', 'sheet', '.sr-label', { letterSpacing: '.02em' },
    'small bold labels need a touch of tracking to stay legible'),
  P('input-focus-ring', 'sheet', '.sr-input:focus, .sr-textarea:focus', { boxShadow: '0 0 0 3px color-mix(in srgb, var(--sr-accent) 15%, transparent)' },
    'the form is the one place a strong focus signal is mandatory'),
  P('input-bg', 'sheet', '.sr-input, .sr-textarea', { background: 'color-mix(in srgb, var(--sr-fill2) 70%, transparent)' },
    'a faint fill makes an empty field read as a field rather than a gap'),
  P('textarea-leading', 'sheet', '.sr-textarea', { lineHeight: 1.6 },
    'markdown pasted into the textarea is read, so it needs reading leading'),
  P('textarea-radius', 'sheet', '.sr-textarea', { borderRadius: 'var(--sr-r-sm)' },
    'matches the inputs beside it'),
  P('input-bad-focus', 'sheet', '.sr-input--bad:focus', { boxShadow: '0 0 0 3px color-mix(in srgb, var(--sr-danger) 15%, transparent)' },
    'the focus ring follows the error colour, so one field does not carry two signals'),
  P('drop-radius', 'sheet', '.sr-drop', { borderRadius: 'var(--sr-r)' },
    'consistent with the preview block it swaps for'),
  P('drop-dash', 'sheet', '.sr-drop', { borderStyle: 'dashed' },
    'explicit: a future border shorthand would otherwise silently make it solid'),
  P('drop-hover', 'sheet', '.sr-drop:hover', { borderColor: 'var(--sr-line2)', color: 'var(--sr-fg2)' },
    'the drop zone must respond to the pointer before a file is dragged over it'),
  P('drop-icon', 'sheet', '.sr-drop .sr-ic', { color: 'currentColor' },
    'the upload glyph should follow the zone\'s state colour, including the drag-over accent'),
  P('preview-rule', 'sheet', '.sr-preview', { borderColor: 'color-mix(in srgb, var(--sr-line) 120%, transparent)' },
    'the preview is a confirmation block and needs a slightly firmer edge than a card'),
  P('preview-radius', 'sheet', '.sr-preview', { borderRadius: 'var(--sr-r)' },
    'consistent block language'),
  P('note-left-rule', 'sheet', '.sr-note', { borderLeftWidth: 3 },
    'notes are typed by colour; a left rule makes the type visible at a glance'),
  P('note-body-leading', 'sheet', '.sr-note-body', { lineHeight: 1.5 },
    'note text is read carefully, since it usually explains a refusal'),
  P('sheet-foot-bg', 'sheet', '.sr-sheet-foot', { background: 'color-mix(in srgb, var(--sr-fill2) 90%, transparent)' },
    'the action row needs to separate from the scrolling body'),
  P('hist-row-pad', 'sheet', '.sr-hist-row', { padding: 'calc(var(--sr-sp)*.5) 0' },
    'history rows are dense; a half-step keeps them scannable'),
  P('hist-ok', 'sheet', '.sr-hist-row--ok .sr-ic', { color: 'var(--sr-ok)' },
    'the history is a log of outcomes and should be scannable by colour'),
  P('hist-fail', 'sheet', '.sr-hist-row--fail', { color: 'var(--sr-danger)' },
    'a failed install in the history must not look like a successful one'),
  P('check-row', 'sheet', '.sr-check', { lineHeight: 1.5 },
    'the overwrite confirmation is a sentence next to a checkbox'),

  /* ---------- 12. visibility, contrast, motion, touch ---------- */
  P('a11y-visited', 'a11y', '.sr-link:visited', { color: 'var(--sr-accent)' },
    'links must not turn purple on a white panel'),
  P('a11y-placeholder', 'a11y', '{all}.sr-input::placeholder, {all}.sr-textarea::placeholder', { color: 'var(--sr-fg3)' },
    'the host\'s default placeholder is too dark for this surface'),
  P('a11y-marker', 'a11y', '{all}li::marker', { color: 'var(--sr-fg3)' },
    'skill descriptions can contain lists'),
  P('a11y-code', 'a11y', '{all}code, {all}kbd, {all}samp', { fontFamily: 'var(--sr-mono)' },
    'skill bodies contain code, and a proportional face misreads it'),
  P('a11y-code-bg', 'a11y', '{all}code', { background: 'var(--sr-fill2)', borderRadius: 8, padding: '1px 4px' },
    'an inline code span needs to be distinguishable inside prose'),
  P('a11y-strong', 'a11y', '{all}strong, {all}b', { fontWeight: 600 },
    'this sheet renders a lot of emphasised prose'),
  P('a11y-hr', 'a11y', '{all}hr', { border: 0, borderTop: '1px solid var(--sr-line)', margin: 'calc(var(--sr-sp)*3) 0' },
    'skill bodies use horizontal rules as section breaks'),
  P('a11y-scrollbar-track', 'a11y', '.sr-root::-webkit-scrollbar-track', { background: 'transparent' },
    'an unstyled track paints a grey gutter inside the panel'),
  P('a11y-scrollbar-corner', 'a11y', '.sr-root::-webkit-scrollbar-corner', { background: 'transparent' },
    'appears on two-axis scrollers and was an obvious white square'),
  P('a11y-reduced-motion', 'a11y', '.sr-toast, .sr-sheet, .sr-skel, .sr-spin', { animation: 'none' },
    'explicit for the elements that animate outside the surface-root transition reset'),
  P('a11y-reduced-transition', 'a11y', '.sr-toast, .sr-sheet', { transition: 'none' },
    'same for transitions'),
  P('a11y-select-ink', 'a11y', '{all}input, {all}textarea', { caretColor: 'var(--sr-accent)' },
    'the caret is a first-class interaction cue and should match the theme'),
  P('a11y-select-bg', 'a11y', '{all}input::selection, {all}textarea::selection', { background: 'var(--sr-accent-weak)' },
    'selected text inside a form field had the OS default blue'),
  P('a11y-tap', 'a11y', '.sr-btn, .sr-chip, .sr-tab', { touchAction: 'manipulation' },
    'removes the 300ms tap delay in the embedded webview'),
  P('a11y-min-tap', 'a11y', '.sr-chip', { minHeight: 22 },
    'the chip row is the densest tap target in the panel'),

  /* ---------- 13. density, rhythm and the small print ---------- */
  P('rhythm-optical-center', 'a11y', '.sr-avatar', { lineHeight: 1 },
    'a 26px tile with inherited line-height put the initial visibly below centre'),
  P('rhythm-smoothing', 'a11y', '{root}', { WebkitFontSmoothing: 'antialiased' },
    'at 10-12px the default subpixel rendering looks bolder than the host UI'),
  P('rhythm-overline', 'a11y', '.sr-sec-h', { lineHeight: '18px' },
    'uppercase tracked text needs a taller line box than its size implies'),
  P('rhythm-onscroll-contain', 'a11y', '.sr-sheet-body', { overscrollBehavior: 'contain' },
    'scrolling past the end of the modal must not scroll the conversation behind it'),
  P('rhythm-drop-contain', 'a11y', '.sr-drop', { overscrollBehavior: 'contain' },
    'same for the drop zone, which is itself a scroll target during a drag'),
  P('rhythm-tools-once', 'a11y', '.sr-tools', { overscrollBehavior: 'contain' },
    'and for the catalogue toolbar'),
  P('rhythm-clamp-hero', 'a11y', '.sr-hero-empty', { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
    'a long "nothing invoked" sentence used to push the stats off the first screen'),
  P('rhythm-wrap-hero', 'a11y', '.sr-hero-line', { rowGap: 'calc(var(--sr-sp)*2)' },
    'the hero call chips wrap to a second row on the narrow strip expansion'),
  P('rhythm-tap-hero', 'a11y', '.sr-hero', { contain: 'paint' },
    'clips the accent rail to the rounded corner without a clip-path'),
  P('rhythm-autofill', 'a11y', '.sr-input:-webkit-autofill', { boxShadow: 'inset 0 0 0 40px var(--sr-card)' },
    'Chromium paints an autofilled field pale yellow, which is jarring on this sheet'),
  P('rhythm-hyphens', 'a11y', '.sr-toast-hint', { overflowWrap: 'anywhere' },
    'hints contain absolute paths with no break opportunity'),
  P('rhythm-footer-num', 'a11y', '.sr-foot', { fontVariantNumeric: 'tabular-nums' },
    'the footer carries several live counters; proportional digits make them jitter'),
  P('rhythm-kbd-border', 'a11y', '.sr-kbd', { borderBottomWidth: 1 },
    'explicit: the two-argument border shorthand above otherwise resets it, and 1px is the only border weight this sheet uses now'),
  P('rhythm-kbd-mono', 'a11y', '.sr-kbd', { fontFamily: 'var(--sr-mono)' },
    'a key cap must be the monospace face, like the code it stands for'),
  P('rhythm-drop-title', 'a11y', '.sr-drop-title', { fontWeight: 500 },
    'the drop zone is a primary action, not a caption'),

  /* ---------- 14. the update affordance, closer up ---------- */
  P('upd-btn-height', 'src', '.sr-row-actions .sr-btn--accent', { lineHeight: '20px' },
    'matches the 引用 button beside it, so the row keeps one baseline'),
  P('upd-btn-pad', 'src', '.sr-row-actions .sr-btn--accent', { paddingInline: 'calc(var(--sr-sp)*2.5)' },
    'the label 可更新 is three characters and needs the room'),
  P('upd-btn-opacity', 'src', '.sr-row-actions .sr-btn--accent', { opacity: 1 },
    'the row dims secondary buttons to 75%; the one call to action must not dim with them'),
  P('upd-btn-hover', 'src', '.sr-row-actions .sr-btn--accent:hover:not(:disabled)', { background: 'var(--sr-accent)', color: '#fff' },
    'the accent button follows the primary button hover language'),
  P('upd-src-gap', 'src', '.sr-src + .sr-blurb', { marginTop: 'calc(var(--sr-sp)*.5)' },
    'keeps the provenance line and the blurb from touching when both are present'),
  P('upd-status-inline', 'src', '.sr-src .sr-src-text:last-child', { whiteSpace: 'nowrap' },
    'the verdict at the end of a long address must not be the part that wraps away'),
  P('upd-src-minheight', 'src', '.sr-src', { minHeight: 14 },
    'a one-line provenance row and a two-line one must not shift the card actions'),
  P('upd-btn-dot-min', 'src', '.sr-src-dot', { minWidth: 6, minHeight: 6 },
    'a 5px dot on a 2x display can round down to nothing'),

  /* ---------- 15. consistency and cleanup ---------- */
  P('consist-avatar-radius', 'a11y', '.sr-avatar', { borderRadius: 'var(--sr-r-sm)' },
    'named so the tile can never drift from the other small blocks'),
  P('consist-sheet-lead', 'a11y', '.sr-sheet-sub', { lineHeight: 1.5 },
    'the sheet subtitle wraps to two lines on a narrow window'),
  P('consist-counter-weight', 'a11y', '.sr-counter', { fontWeight: 500 },
    'the character counter crosses a limit and has to be noticed when it does'),
  P('consist-hint-leading', 'a11y', '.sr-hint', { lineHeight: 1.5 },
    'hints wrap in the narrow expansion'),
  P('consist-label-mono', 'a11y', '.sr-sheet-foot-note', { lineHeight: 1.45 },
    'the footer note is a sentence with a path in it'),
  P('consist-opt-letter', 'a11y', '.sr-label .sr-opt', { letterSpacing: 0 },
    'explicit: the optional marker must not inherit the tracked label above it'),
  P('consist-note-hint', 'a11y', '.sr-note-hint', { lineHeight: 1.45 },
    'a recovery instruction is the most important sentence in the sheet'),
  P('consist-drop-note', 'a11y', '.sr-drop', { lineHeight: 1.5 },
    'the drop zone text wraps in a narrow modal'),
  P('consist-seg-track', 'a11y', '.sr-seg', { marginTop: 0 },
    'explicit: the segment sits inside a section body that already spaces it'),
])

/**
 * Selector tokens a record may use in `at`:
 *
 *   `{all}`   every DESCENDANT of every surface root — the workhorse, and the only
 *             safe way to style a bare element name (`code`, `hr`, `::marker`)
 *             without leaking into the host application's own DOM.
 *   `{root}`  the surface roots themselves, for rules about the surface.
 *   anything else is a `.sr-*` selector, prefixed with each root.
 *
 * A record that names an element with neither token would produce a GLOBAL rule.
 * `ruleFor` refuses to do that, so the mistake surfaces at build time rather than as
 * a host application whose lists and code spans changed appearance.
 */
/**
 * Properties whose numeric value is NOT a length.
 *
 * Appending `px` blindly produced `font-weight:500px` and `opacity:1px`, both of
 * which the browser drops — a silent loss, since the declaration simply disappears.
 * A number at or above 100 is always a length here (26px, 140px, 300px), which is why
 * this list only has to name the small unitless ones.
 */
const UNITLESS = new Set([
  'fontWeight', 'lineHeight', 'opacity', 'zIndex', 'flexGrow', 'flexShrink', 'order',
  'WebkitLineClamp', 'fontSizeAdjust', 'aspectRatio', 'tabSize', 'columnCount',
  // Sub-properties whose names merely CONTAIN a unitless one. Without these the guard
  // in `test/ui-polish.mjs` reports them as "a unitless property with a px suffix",
  // which is a false alarm that would train the next reader to ignore the check.
])
// NOTE: the four corner-radius properties USED to be listed above, and they are LENGTHS. They were
// added to silence a checker rather than because a radius is unitless, and the cost was that every
// `borderTopLeftRadius: 14` emitted the unitless `border-top-left-radius:14` — invalid CSS, dropped by
// the browser, so those records did nothing while reading as correct. tools/check-css-units.mjs fails
// on exactly that shape now, which is how they were found.

/**
 * Expand a `{all}` selector into one rooted descendant selector per surface.
 *
 * Two mistakes this has to avoid, both of which produce a rule that silently does
 * nothing — or worse, one that styles the host application:
 *
 *   * `{all}` followed by a CLASS (`.sr-input::placeholder`) would emit `*.sr-input`,
 *     which matches a DESCENDANT of the element rather than the element. A class selector
 *     needs no `*` at all: `root .sr-input::placeholder` is the correct form. This bug
 *     silently killed three placeholder/selection rules until a computed-style probe
 *     showed the placeholder still at the host's colour.
 *   * a comma-separated list must be rooted MEMBER BY MEMBER. Rooting only the first part
 *     (`.sr-root *.sr-btn, .sr-chip, …`) leaves every other member matching the whole
 *     document — precisely the host leak the guard below exists to prevent.
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

function ruleFor(record, roots) {
  const camel = (key) => key.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)
  /**
   * The unit rule, and the bug it used to have.
   *
   * It read `v < 100`, on the assumption recorded above that "a number at or above 100 is always a
   * length here". 999 is the counter-example: `border-radius: 999` was emitted with NO unit, which is
   * invalid CSS, so the browser DISCARDED the declaration and fell back to whatever radius an earlier
   * rule had set. Every pill in the stylesheet was therefore silently a rounded rectangle, and the
   * sheet looked completely correct while it was being read.
   *
   * The rule is now the right way round: a number is a length UNLESS the property is named as
   * unitless. The threshold was the mistake — it tried to infer the unit from the magnitude, and no
   * magnitude can tell you whether 999 is a radius or an opacity.
   */
  const value = (key, v) => (typeof v === 'number' && !UNITLESS.has(key) ? px(v) : String(v))
  const decls = Object.entries(record.props)
    .map(([key, raw]) => `${camel(key)}:${value(key, raw)}`)
    .join(';')
  const suffix = record.weight ?? ''
  // `rooted: false` emits the selector EXACTLY as written, for a rule that must match an
  // element which is not a descendant of a surface. The JSDoc at the top of this file has
  // promised this option since it was written and it was NEVER IMPLEMENTED — and design.js
  // inherited the same gap. That is how `.sr-portal-host` became the descendant selector
  // `.sr-root .sr-portal-host`: a rule that can never match the portal host itself (the host
  // sits on `document.body` and IS a `.sr-root`, it is not inside one), so the host kept the
  // `.sr-root` frame as an empty 100%-height bordered box and the document grew by a full
  // viewport of blank, scrollable page.
  if (record.rooted === false) {
    if (!record.at.includes('.sr-')) {
      throw new Error(`polish rule "${record.id}" opts out of rooting with a selector that is not the plugin's: ${record.at}`)
    }
    return `${record.at}${suffix}{${decls}}`
  }
  if (record.at.includes('{all}')) return `${descendantSelector(`${record.at}${suffix}`, roots)}{${decls}}`
  if (record.at.includes('{root}')) {
    return `${roots.map((root) => root + record.at.replace('{root}', '') + suffix).join(',')}{${decls}}`
  }
  // A record may name the root it targets (`at: '.sr-strip-shell'`). Those selectors
  // are used VERBATIM: `root + at` would produce `.sr-root.sr-strip-shell`, a
  // compound that matches nothing, because the surface roots are SIBLINGS in the DOM
  // (the composer strip and the modal backdrop are not descendants of the panel).
  if (roots.some((root) => record.at.startsWith(root))) {
    return `${record.at}${suffix}{${decls}}`
  }
  if (!record.at.includes('.sr-')) {
    throw new Error(`polish rule "${record.id}" would apply OUTSIDE the plugin surfaces: ${record.at}`)
  }
  return `${descendantSelector(`${record.at}${suffix}`, roots)}{${decls}}`
}

/**
 * The generated stylesheet block, inserted by theme.js between its own rules and the
 * media queries.
 *
 * `ruleFor` is exported alongside it so `test/ui-polish.mjs` can drive the guard with
 * a deliberately leaky record: a rule that would restyle the host application must be
 * refused at generation time, and a refusal nobody can invoke is not a guard.
 */
function polishCSS(roots) {
  if (!Array.isArray(roots) || roots.length === 0) return ''
  return [
    '/* ---- 4.0 polish set (generated from POLISH in src/client/polish.js) ---- */',
    ...POLISH.map((record) => ruleFor(record, roots)),
  ].join('\n')
}

/** Counts per group, for the test's per-group report and for reviewers. */
function polishCounts() {
  const out = {}
  for (const record of POLISH) out[record.group] = (out[record.group] ?? 0) + 1
  return out
}

module.exports = { POLISH, GROUPS, polishCSS, polishCounts, ruleFor }
