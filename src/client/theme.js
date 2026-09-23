// Design tokens + the one stylesheet the plugin injects.
//
// AUTHORING NOTE: bundle source, not a Node module — see panel.js.
//
// The sheet (install.js) and the report (panel.js) are one visual system, so the
// stylesheet lives here rather than in either component file: a single injected
// <style> also means a single HMR cleanup target.
//
// Token discipline (the "looks like a product" bar):
//   * spacing is a 4px rhythm, expressed as multiples of --sr-sp
//   * one type scale: 10 / 10.5 / 11 / 11.5 / 12.5 / 17
//   * one radius scale: --sr-r (panels) / --sr-r-sm (controls) / --sr-r-pill
//   * one accent hue, taken from the host theme so it follows the user's skin
//   * motion is short (<=.18s) and always optional under prefers-reduced-motion

/** Package id; also the CSS tag's `data-plugin` value and the dedupe key prefix. */
const PLUGIN_ID = 'dsh-echocat-skill-panel'

/** `data-plugin-css` value — the selector that makes re-injection idempotent. */
const TAG_ID = 'dsh-echocat-skill-panel/panel.css'

/**
 * Mirrors `package.json`, and `test/release.mjs` asserts all three copies agree.
 *
 * The browser half cannot import `src/version.js`: it ships as its own bundle with its own
 * module table, resolved against the host's frozen platform table. So this copy is a
 * necessity — and therefore the one that silently goes stale. Bump it with the others.
 */
const VERSION = '5.1.0'

/**
 * Every element that can be the ROOT of one of this plugin's surfaces: the centre
 * panel, the composer strip, the modal overlay, and the status rail when it is
 * mounted as a sibling of the strip.
 *
 * Kept as a LIST so the derived sets below can repeat every root. That matters
 * far more than it looks, because **a comma-separated selector list cannot share a
 * trailing combinator**:
 *
 *   .a,.b ::selection   styles `.a` ITSELF, and only a descendant of `.b`.
 *
 * That one mistake produced three separate visual defects:
 *   * `background:var(--sr-accent-weak)` painted the whole panel and the strip
 *     pale blue (measured #D0DFFF on screen = that tint over the page);
 *   * `outline:2px solid var(--sr-accent)` drew a dark rectangle around the
 *     panel — the "black lines" down both sides;
 *   * `box-sizing:border-box` reached `.sr-rail` only, so inputs with
 *     `width:100%` plus padding overflowed the sheet.
 *
 * So: tokens and typography use SURFACES (the roots themselves); anything meant
 * for the INSIDE of a surface uses one of the expanded sets.
 */
const SURFACE_ROOTS = ['.sr-root', '.sr-strip-shell', '.sr-backdrop', '.sr-rail']
/** The roots themselves — for the token block and base typography. */
const SURFACES = SURFACE_ROOTS.join(',')
/** Every descendant of every root. */
const SURFACES_ALL = SURFACE_ROOTS.map((root) => `${root} *`).join(',')
/** Selected text inside any surface. */
const SURFACES_SELECTION = SURFACE_ROOTS.map((root) => `${root} ::selection`).join(',')
/** Focus rings inside any surface. */
const SURFACES_FOCUS = SURFACE_ROOTS.map((root) => `${root} :focus-visible`).join(',')

/**
 * Two generated blocks, in a deliberate order:
 *
 *   `polish.js`  the 211 behavioural refinements (width contract, alignment, resets);
 *   `design.js`  the 228-record design pass, which SUPERSEDES polish for the properties
 *                they share — tokens, type scale, radii, elevation, component shape.
 *
 * Both are generated from data and interpolated BELOW the hand-written rules and ABOVE
 * the media queries. That position is load-bearing in both directions:
 *
 *   * the polish width rules must be able to win their ties against the base `.sr-root`
 *     and `.sr-strip-shell` caps (they win by carrying an extra surface class);
 *   * neither block may sit after `@media (max-width:560px)`, or it would silently
 *     override the narrow-viewport layout — the one place the sheet has to get smaller
 *     rather than more refined.
 *
 * The design pass's own dark palette is the single exception: it IS appended at the very
 * end, because it only redefines tokens inside `prefers-color-scheme: dark` and has to
 * beat the earlier dark block, which it cannot do from a lower position.
 */
const { LIQUID_CSS } = require('./liquid-style.js')
const { BACKGROUND_CSS } = require('./background-style.js')
const polish = require('./polish.js')
const design = require('./design.js')
const { POLISH, polishCounts } = polish
const { DESIGN, designCounts } = design
const POLISH_CSS = polish.polishCSS(SURFACE_ROOTS)
const DESIGN_CSS = design.designCSS(SURFACE_ROOTS)
const DESIGN_DARK_CSS = design.designDarkCSS(SURFACE_ROOTS)
// The breakpoint steps, generated from the `r-bp-` records. Emitted AFTER the hand-written narrow
// queries below (so a breakpoint wins an equal-specificity tie) and BEFORE the dark palette (so a
// dark-themed narrow window gets dark tokens, not the light breakpoint values).
const DESIGN_RESPONSIVE_CSS = design.designResponsiveCSS(SURFACE_ROOTS)

const CSS = `
${SURFACES}{
--sr-fg:var(--dsw-alias-label-primary,#1f2329);
--sr-fg2:var(--dsw-alias-label-secondary,#646a73);
--sr-fg3:var(--dsw-alias-label-tertiary,#8f959e);
/* An accent has to be a COLOUR. This was bound to --dsw-alias-label-primary, which
   is the TEXT colour (#0f1115 in this theme), so every accent in the panel — the
   hero's rail, the primary buttons, the selected-tab underline, the focus ring, the
   usage bars — rendered near-black. A 3px near-black rail does not read as an
   accent; it reads as a stray thick line. */
--sr-accent:#4176e6;
--sr-accent-weak:rgba(65,118,230,.12);
--sr-danger:var(--dsw-alias-label-error,#d54941);
--sr-danger-weak:rgba(213,73,65,.12);
--sr-ok:#2ba471;
--sr-ok-weak:rgba(43,164,113,.12);
--sr-warn:#c7891b;
/* The weak companion to --sr-warn, for the one signal this plugin exists to
   report: "this turn invoked no skill". It is NOT an error — the turn was simply
   a normal turn — so it must not borrow --sr-danger and must not shout. A muted
   amber chip says "nothing happened here" without implying failure. */
--sr-warn-weak:rgba(199,137,27,.12);
/* Hairlines we own, deliberately NOT the host's border tokens:
   --dsw-alias-border-l1 is #0000000a — 4% black, which is invisible on a white
   surface. Borrowing it left every card, divider and input border effectively
   unrendered, so the panel read as one undifferentiated white sheet and all the
   structure had to come from text alone. */
--sr-line:rgba(0,0,0,.12);
--sr-line2:rgba(0,0,0,.22);
--sr-fill2:rgba(127,127,127,.04);
/* The two fill tokens below are deliberately NEUTRAL GREY rather than the app's
   --dsw-alias-fill-* tokens. Those are tinted and meant for small interactive
   states; using them as the background of large containers (hero, drop zone,
   preview, section rows) is what made the panel read as a stack of washed-out
   blue boxes. Colour is carried by borders, badges and the accent, not by area. */
--sr-fill:rgba(127,127,127,.07);
/* Our own opaque surface.
   NOT a host token: the host's surfaces in this theme are a bluish family
   (--dsw-static-neutral-bluish-*), and borrowing them for a large column made the
   panel read as a tinted block rather than a page. A surface this large has to be
   a value we own outright. */
--sr-card:#fff;
/* The one raised step above the panel surface. Every "card" uses exactly this, so
   the panel reads as a single surface with outlined blocks instead of a patchwork
   of whatever the host happens to paint behind a transparent element. */
--sr-raised:var(--sr-fill2);
/* Content cap.
 *
 * 4.0: this was a fixed 1120px, which is WIDER than the composer on any window below
 * ~1500px — so the strip above the input box stuck out past the input box it belongs
 * to, and on a narrow window the stat cells still became metre-wide frames. The cap is
 * now derived from the host's own composer width, so it scales with the interface and
 * is always narrower than the box it sits above. See polish.js (group: width) for the
 * arithmetic and the reasoning; this token is only where the value is declared, because
 * the base rules below are the ones that consume it. */
--sr-max:calc(var(--dsh-composer-card-max-width, 952px) - 16px);
--sr-mono:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);
--sr-sp:4px;
/**
 * MATCHING THE HOST'S COMPOSER, which the owner named as the reference: "所有圆度改为像下面对话框的这种圆度".
 *
 * Read off the DSH shell rather than guessed: the message input box is .Ogvy6G_card with border-radius:22px, and its own
 * scale turns out to have the same SHAPE as ours: a large radius for surfaces, a small one for controls inside them, a
 * pill for genuinely round things. So the STRUCTURE here is unchanged and only the large step moves, 8 -> 22.
 *
 * The three steps are copied from the host deliberately:
 *   --sr-r     22px  surfaces and the containers that hold controls — the composer card, and now the strip and cards
 *   --sr-r-sm   8px  controls INSIDE those surfaces — the host uses 8 for its own select and notice elements, for the
 *                    same reason a 22px corner on a 22px-tall small button is a stadium rather than a button
 *   --sr-r-pill      genuinely round things: the switch, dots, progress bars, scrollbar
 */
--sr-r:22px;
--sr-r-sm:8px;
--sr-r-pill:8px;
--sr-head-h:38px;
--sr-shadow:0 12px 32px -20px rgba(0,0,0,.5);
--sr-shadow-lg:0 28px 60px -28px rgba(0,0,0,.6);
--sr-speed:.16s}
/* Base typography for every surface root, not just the panel. */
${SURFACES}{color:var(--sr-fg);font-size:12px;line-height:1.55;caret-color:var(--sr-accent)}
/* Centred with max-width + auto margins, which is deterministic.
   Percentage padding resolved against a different width than auto margins do
   (measured on screen: the column sat at x≈531 of a 1696px window instead of
   centred, so the panel looked shoved to one side).

   The panel carries a REAL 1px frame. It had none — only inner blocks (hero,
   stat cells, cards) were bordered — so on a white page the panel had no boundary
   whatsoever and every block read as floating text. A frame plus one soft shadow
   is what makes it a surface instead of a region. */
.sr-root{display:flex;flex-direction:column;height:100%;min-height:0;width:100%;max-width:var(--sr-max);margin-inline:auto;
border:1px solid var(--sr-line);border-radius:var(--sr-r);box-shadow:0 1px 2px rgba(0,0,0,.04);
background:var(--sr-card);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
scrollbar-width:thin;scrollbar-color:var(--sr-line2) transparent}
${SURFACES_ALL}{box-sizing:border-box}
${SURFACES_SELECTION}{background:var(--sr-accent-weak);color:var(--sr-fg)}
.sr-root::-webkit-scrollbar{width:9px;height:9px}
.sr-root::-webkit-scrollbar-thumb{background:var(--sr-line2);border-radius:9px;border:2px solid transparent;background-clip:content-box}
.sr-root::-webkit-scrollbar-thumb:hover{background:var(--sr-fg3);background-clip:content-box}
.sr-root ::-webkit-scrollbar{width:9px}
.sr-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.sr-ic{display:block;flex:none}
${SURFACES_FOCUS}{outline:2px solid var(--sr-accent);outline-offset:2px;border-radius:var(--sr-r-sm)}

/* ---- buttons ---- */
.sr-btn{flex:none;display:inline-flex;align-items:center;gap:calc(var(--sr-sp)*1.5);font:inherit;font-size:11px;line-height:20px;padding:0 calc(var(--sr-sp)*2.75);border-radius:var(--sr-r-pill);border:1px solid var(--sr-line);background:transparent;color:var(--sr-fg2);cursor:pointer;transition:background var(--sr-speed),color var(--sr-speed),border-color var(--sr-speed),transform var(--sr-speed)}
.sr-btn:hover:not(:disabled){background:var(--sr-fill);color:var(--sr-fg);border-color:var(--sr-line2)}
.sr-btn:active:not(:disabled){transform:translateY(1px)}
.sr-btn:disabled{opacity:.45;cursor:not-allowed}
.sr-btn--primary{border-color:transparent;background:var(--sr-accent-weak);color:var(--sr-accent);font-weight:500}
.sr-btn--primary:hover:not(:disabled){background:var(--sr-accent);color:var(--sr-card);border-color:transparent}
.sr-btn--danger{color:var(--sr-danger)}
.sr-btn--danger:hover:not(:disabled){background:var(--sr-danger-weak);border-color:var(--sr-danger);color:var(--sr-danger)}
.sr-btn--armed{background:var(--sr-danger-weak);border-color:var(--sr-danger);color:var(--sr-danger);font-weight:500}
.sr-btn--icon{width:24px;height:24px;padding:0;justify-content:center;border-radius:var(--sr-r-sm)}
.sr-btn--sm{line-height:18px;font-size:10.5px;padding:0 calc(var(--sr-sp)*2)}
.sr-btn--block{width:100%;justify-content:center;line-height:26px}
.sr-spin{animation:sr-spin .7s linear infinite}
@keyframes sr-spin{to{transform:rotate(360deg)}}

/* ---- skeleton ---- */
.sr-skel{border-radius:var(--sr-r-sm);background:linear-gradient(90deg,var(--sr-fill2) 0%,var(--sr-fill) 50%,var(--sr-fill2) 100%);background-size:200% 100%;animation:sr-shimmer 1.3s ease-in-out infinite}
.sr-skel--line{height:11px;margin:calc(var(--sr-sp)*1.5) 0}
.sr-skel--card{height:52px;border-radius:var(--sr-r)}
@keyframes sr-shimmer{0%{background-position:120% 0}100%{background-position:-120% 0}}
.sr-skel-wrap{padding:calc(var(--sr-sp)*3) calc(var(--sr-sp)*3.5)}

/* ---- header / footer ---- */
.sr-head{position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:calc(var(--sr-sp)*2);min-height:var(--sr-head-h);padding:calc(var(--sr-sp)*2.5) calc(var(--sr-sp)*3.5);background:var(--sr-card);border-bottom:1px solid var(--sr-line);transition:box-shadow var(--sr-speed)}
.sr-head--scrolled{box-shadow:0 8px 18px -14px rgba(0,0,0,.6)}
.sr-title{flex:1;min-width:0;font-size:12.5px;font-weight:600;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-head-tools{flex:none;display:inline-flex;align-items:center;gap:calc(var(--sr-sp)*1.5)}
.sr-status{display:inline-flex;align-items:center;gap:calc(var(--sr-sp)*1.25);font-size:10px;color:var(--sr-fg3);font-variant-numeric:tabular-nums;white-space:nowrap}
.sr-status--error{color:var(--sr-danger)}
.sr-status-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.sr-fade{position:sticky;z-index:3;height:10px;pointer-events:none;opacity:0;transition:opacity var(--sr-speed)}
.sr-fade--t{top:var(--sr-head-h);margin-bottom:-10px;background:linear-gradient(var(--sr-card),transparent)}
.sr-fade--b{bottom:0;margin-top:-10px;background:linear-gradient(transparent,var(--sr-card))}
.sr-fade--on{opacity:1}
/* NO min-height:0 here.
 *
 * This child sits in a SCROLLING flex column. With min-height:0 it gets compressed
 * to the container's height, so its content overflows the box while the BOX stays
 * one screen tall — and flex:1 then pushes the footer to the bottom of that box,
 * which is the container's bottom rather than the end of the content. Sticky
 * bottom-0 has nothing left to do, and the overflowing catalogue keeps painting
 * BELOW the footer, so the footer looks stranded in the middle of the list. (This
 * is why removing the nested scroller did not fix it.)
 *
 * The initial value, min-height:auto, means "never smaller than my content": the
 * body grows with the content, .sr-root becomes the thing that scrolls, and the
 * footer's natural position is after everything, so sticky pins it to the bottom
 * edge. With short content flex:1 still stretches the body, so the footer rests at
 * the bottom of the panel. */
.sr-body{flex:1}
.sr-foot{position:sticky;bottom:0;z-index:4;display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--sr-sp)*1.5) calc(var(--sr-sp)*2.5);padding:calc(var(--sr-sp)*2) calc(var(--sr-sp)*3.5);border-top:1px solid var(--sr-line);background:var(--sr-card);font-size:10px;color:var(--sr-fg3)}
.sr-foot-item{display:inline-flex;align-items:center;gap:calc(var(--sr-sp));min-width:0;font-variant-numeric:tabular-nums}
.sr-foot-mono{font-family:var(--sr-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:26ch}
.sr-foot-reason{flex-basis:100%;color:var(--sr-warn)}
.sr-badge-ok{color:var(--sr-ok)}
.sr-badge-warn{color:var(--sr-warn)}
.sr-badge-off{color:var(--sr-fg3);opacity:.8}
.sr-kbd{font-family:var(--sr-mono);font-size:9.5px;line-height:14px;padding:0 4px;border:1px solid var(--sr-line);border-bottom-width:2px;border-radius:5px;color:var(--sr-fg3)}

/* ---- hero + sparkline ---- */
.sr-hero{margin:calc(var(--sr-sp)*3) calc(var(--sr-sp)*3.5) var(--sr-sp);padding:calc(var(--sr-sp)*2.5) calc(var(--sr-sp)*3) calc(var(--sr-sp)*2.5) calc(var(--sr-sp)*3.75);border-radius:var(--sr-r);border:1px solid var(--sr-line);background:transparent;position:relative;overflow:hidden}
.sr-hero:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--sr-accent);opacity:.85}
.sr-hero-top{display:flex;align-items:flex-start;gap:calc(var(--sr-sp)*3)}
.sr-hero-main{flex:1;min-width:0}
.sr-hero-meta{font-size:10px;color:var(--sr-fg3);font-variant-numeric:tabular-nums}
.sr-hero-line{display:flex;flex-wrap:wrap;gap:calc(var(--sr-sp)*1.5);margin-top:calc(var(--sr-sp)*1.5)}
.sr-hero-empty{font-size:12px;color:var(--sr-fg3);margin-top:calc(var(--sr-sp)*1.25)}
.sr-spark{flex:none;width:104px;height:34px;color:var(--sr-accent)}
.sr-spark-fill{fill:currentColor;opacity:.14;stroke:none}
.sr-spark-line{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.sr-spark-dot{fill:currentColor}
.sr-spark-cap{flex:none;font-size:9.5px;color:var(--sr-fg3);text-align:right}

/* ---- stats ---- */
.sr-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:calc(var(--sr-sp)*2);padding:calc(var(--sr-sp)*3) calc(var(--sr-sp)*3.5)}
.sr-stat{display:flex;flex-direction:row-reverse;align-items:baseline;justify-content:space-between;gap:calc(var(--sr-sp)*2);padding:calc(var(--sr-sp)*2) calc(var(--sr-sp)*2.5);border-radius:var(--sr-r);border:1px solid var(--sr-line);background:var(--sr-raised);transition:background var(--sr-speed),border-color var(--sr-speed),transform var(--sr-speed)}
.sr-stat:hover{background:var(--sr-fill);border-color:var(--sr-line2);transform:translateY(-1px)}
.sr-stat-v{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.sr-stat-l{font-size:10px;color:var(--sr-fg3)}

/* ---- sections ---- */
.sr-sec{border-top:1px solid var(--sr-line)}
.sr-sec-head{position:sticky;top:var(--sr-head-h);z-index:2;display:flex;align-items:stretch;gap:0;background:var(--sr-card)}
.sr-sec-h{display:flex;align-items:center;gap:calc(var(--sr-sp)*2);flex:1;min-width:0;margin:0;padding:calc(var(--sr-sp)*2.25) calc(var(--sr-sp)*3.5);border:0;background:transparent;color:inherit;font:inherit;font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;text-align:left;cursor:pointer;transition:background var(--sr-speed)}
.sr-sec-h:hover{background:var(--sr-fill)}
.sr-sec-caret{flex:none;color:var(--sr-fg3);transition:transform var(--sr-speed)}
.sr-sec-h[aria-expanded="true"] .sr-sec-caret{transform:rotate(90deg)}
.sr-sec-t{flex:0 1 auto;min-width:0;color:var(--sr-fg3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-sec-actions{flex:none;display:inline-flex;align-items:center;gap:calc(var(--sr-sp));padding-right:calc(var(--sr-sp)*2.5)}
.sr-pill{flex:none;font-size:10px;line-height:16px;padding:0 calc(var(--sr-sp)*2);border-radius:var(--sr-r-pill);background:var(--sr-fill);color:var(--sr-fg2);font-variant-numeric:tabular-nums;letter-spacing:0}
.sr-sec-b{padding:calc(var(--sr-sp)*1.5) calc(var(--sr-sp)*3.5) calc(var(--sr-sp)*3)}
.sr-hint{font-size:10px;color:var(--sr-fg3);padding-top:calc(var(--sr-sp)*2);display:flex;align-items:center;gap:calc(var(--sr-sp)*1.5);flex-wrap:wrap}
.sr-empty{display:flex;align-items:center;gap:calc(var(--sr-sp)*1.75);font-size:11px;color:var(--sr-fg3);padding:calc(var(--sr-sp)*1.5) 0}
.sr-empty:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.5;flex:none}
/* The one guidance block that replaces three separate "nothing here yet"
   placeholders. Three empty slots read as a broken panel; one sentence plus the
   action that fixes it reads as a starting point. */
.sr-guide{display:flex;align-items:flex-start;gap:calc(var(--sr-sp)*3);margin:calc(var(--sr-sp)*4) calc(var(--sr-sp)*3.5);padding:calc(var(--sr-sp)*3.5) calc(var(--sr-sp)*4);border:1px solid var(--sr-line);border-radius:var(--sr-r);background:var(--sr-fill2)}
.sr-guide-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:calc(var(--sr-sp)*1.5)}
.sr-guide-title{font-size:12px;font-weight:600}
.sr-guide-text{font-size:11px;color:var(--sr-fg2);line-height:1.6}
.sr-guide-act{flex:none;display:flex;align-items:center;gap:calc(var(--sr-sp)*2)}

/* ---- catalog toolbar ---- */
.sr-tools{display:flex;flex-direction:column;gap:calc(var(--sr-sp)*2);padding:calc(var(--sr-sp)) 0 calc(var(--sr-sp)*2.5)}
.sr-filter{display:flex;align-items:center;gap:calc(var(--sr-sp)*2)}
.sr-field-inline{position:relative;flex:1;min-width:0;display:flex;align-items:center}
.sr-field-inline .sr-ic{position:absolute;left:calc(var(--sr-sp)*2.5);color:var(--sr-fg3);pointer-events:none}
.sr-filter input{flex:1;min-width:0;width:100%;font:inherit;font-size:11.5px;line-height:24px;padding:0 calc(var(--sr-sp)*2.5) 0 calc(var(--sr-sp)*7.5);border-radius:var(--sr-r-pill);border:1px solid var(--sr-line);background:var(--sr-raised);color:var(--sr-fg);transition:border-color var(--sr-speed),background var(--sr-speed)}
.sr-filter input::placeholder{color:var(--sr-fg3)}
.sr-filter input:focus{border-color:var(--sr-accent);background:var(--sr-card)}
.sr-chips{display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--sr-sp)*1.5)}
.sr-chip{display:inline-flex;align-items:center;gap:calc(var(--sr-sp)*1.25);font:inherit;font-size:10px;line-height:18px;padding:0 calc(var(--sr-sp)*2);border-radius:var(--sr-r-pill);border:1px solid var(--sr-line);background:transparent;color:var(--sr-fg3);cursor:pointer;transition:background var(--sr-speed),color var(--sr-speed),border-color var(--sr-speed)}
.sr-chip:hover{background:var(--sr-fill);color:var(--sr-fg2)}
.sr-chip--on{background:var(--sr-accent-weak);border-color:transparent;color:var(--sr-accent);font-weight:500}
.sr-tools-right{display:flex;align-items:center;gap:calc(var(--sr-sp)*2);flex-wrap:wrap}
.sr-sort{display:inline-flex;align-items:center;gap:calc(var(--sr-sp)*.5);padding:2px;border-radius:var(--sr-r-pill);background:var(--sr-fill2);border:1px solid var(--sr-line)}
.sr-sort button{font:inherit;font-size:10px;line-height:16px;padding:0 calc(var(--sr-sp)*1.75);border:0;border-radius:var(--sr-r-pill);background:transparent;color:var(--sr-fg3);cursor:pointer;transition:background var(--sr-speed),color var(--sr-speed)}
.sr-sort button[aria-pressed="true"]{background:var(--sr-card);color:var(--sr-fg);font-weight:500;box-shadow:var(--sr-shadow)}
.sr-count{font-size:10px;color:var(--sr-fg3);font-variant-numeric:tabular-nums}

/* ---- skill cards ---- */
/**
 * The card grid: two or three columns across the panel, never four.
 *
 * The floor is 290px, and it is not arbitrary. A card carries a 30px avatar, a name that must
 * not break mid-word, a tag row, a blurb and a row of up to five buttons. MEASURED: at a 216px
 * floor the name breaks INSIDE words ("h3- prompt- writ ing", "manua l-only- skill") and the
 * blurb wraps one word per line — visibly worse than a single column. At 290px the name fits,
 * and the panel's own --sr-max (about 920px on a full window) yields three columns while a
 * narrow window yields two.
 *
 * The lesson: a responsive grid's floor has to come from the CONTENT's minimum width, not from
 * how many columns would be nice. The first attempt used 216px and rendered as a broken page.
 *
 * NO BACKTICKS IN THIS FILE. This comment is inside the stylesheet template literal, and a
 * backtick here ends that literal early; the rest of the sheet then parses as JavaScript, which
 * usually still parses, so the break surfaces at runtime instead of at build time. That mistake
 * has cost six debugging cycles in this repository, and tools/check-template-literals.mjs now
 * fails the build over it.
 */
.sr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:calc(var(--sr-sp)*3)}
.sr-skill{display:flex;align-items:center;gap:calc(var(--sr-sp)*2.5);padding:calc(var(--sr-sp)*2) calc(var(--sr-sp)*2.25) calc(var(--sr-sp)*2) calc(var(--sr-sp)*3);border:1px solid var(--sr-line);border-radius:var(--sr-r);background:var(--sr-raised);text-align:left;transition:background var(--sr-speed),border-color var(--sr-speed),transform var(--sr-speed)}
/* HOVER CARRIES NO TRANSFORM HERE, and that is the fix for a bug that made the hover scale invisible.
   This hardcoded rule used to end with transform:translateY(-1px). The design pass then added a hover SCALE on the
   same selector, and because this sheet is emitted BEFORE the generated passes, every one of those later rules won —
   so the card lifted by one pixel and never grew, and the effect the owner asked for appeared to be missing entirely.
   It was, in the browser, even though both the record and the generated CSS contained scale(1.02).

   The trap is that this file holds a hand-written stylesheet for the same elements the two generated passes style, so
   a property declared here is silently overridable and the override is invisible from either side. The lift is gone
   from this rule; the design pass owns the card's hover transform. */
.sr-skill:hover{background:var(--sr-fill);border-color:var(--sr-line2)}
.sr-avatar{flex:none;width:26px;height:26px;border-radius:var(--sr-r-sm);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--sr-card);text-transform:uppercase;letter-spacing:0}
.sr-skill-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:calc(var(--sr-sp)*.5)}
/* .sr-skill-top is gone on purpose: it was the row that put the name and the actions side
   by side, which is what truncated the name to a few characters plus an ellipsis once the
   card had six buttons. The card is a column of three rows now — head, text, actions — and
   the design pass in design.js owns that layout. Left as a note, because a rule with no
   element is the kind of thing that lingers for years.
   NO BACKTICKS IN THIS FILE: the stylesheet is a template literal, so one would end it. */
.sr-skill-name{font-family:var(--sr-mono);font-size:11.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-tag{flex:none;font-size:10px;line-height:16px;padding:0 calc(var(--sr-sp)*1.75);border-radius:var(--sr-r-pill);background:var(--sr-fill);color:var(--sr-fg3);white-space:nowrap}
/* The usage marker (item 44) is the one tag that carries good news, so it is the
   one tag allowed the accent — the same treatment as a selected chip. */
.sr-tag--used{background:var(--sr-accent-weak);color:var(--sr-accent)}
/* The slug under a Chinese title: mono and muted, because it is an identifier the
   user types rather than a label they read. */
.sr-skill-slug{font-family:var(--sr-mono);font-size:10px;color:var(--sr-fg3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Inline display-name editor: the card keeps its shape and only its body changes. */
.sr-skill--editing{align-items:flex-start;background:var(--sr-fill2)}
.sr-rename-row{display:flex;align-items:center;gap:calc(var(--sr-sp)*1.5)}
.sr-rename-input{flex:1;min-width:0}
.sr-blurb{font-size:11px;color:var(--sr-fg2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sr-blurb--en{color:var(--sr-fg3)}
.sr-row-actions{flex:none;display:inline-flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:calc(var(--sr-sp))}
/* Secondary card actions read as icons, not as three more buttons: the card row
   already carries a bordered primary (引用), and outlining all of them made every
   tile look like a toolbar. The armed delete keeps its danger treatment. */
.sr-row-actions .sr-btn--icon{border-color:transparent;background:transparent;color:var(--sr-fg3)}
.sr-row-actions .sr-btn--icon:hover:not(:disabled){border-color:transparent;background:var(--sr-fill);color:var(--sr-fg)}
.sr-row-actions .sr-btn--armed{border-color:var(--sr-danger);background:var(--sr-danger-weak);color:var(--sr-danger)}
.sr-row-actions .sr-btn{opacity:.75}
.sr-row-actions:hover .sr-btn,.sr-row-actions .sr-btn:focus-visible{opacity:1}
.sr-confirm{flex-basis:100%;font-size:10px;color:var(--sr-danger);padding-top:calc(var(--sr-sp))}
/* Provenance line: quieter than the blurb above it, because it is reference
   material rather than content. The dot carries the state and the text stays
   neutral, so "an update exists" never reads as a warning. */
.sr-src{display:flex;align-items:center;gap:calc(var(--sr-sp)*1.25);font-size:10px;color:var(--sr-fg3);min-width:0}
.sr-src-dot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--sr-line2)}
.sr-src-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-src--new{color:var(--sr-accent)}
.sr-src--new .sr-src-dot{background:var(--sr-accent)}
.sr-src--new .sr-src-text{font-weight:500}
.sr-src--warn{color:var(--sr-warn)}
.sr-src--warn .sr-src-dot{background:var(--sr-warn)}
/* The update button earns colour only when a check actually found something new. */
.sr-btn--accent{border-color:var(--sr-accent);background:var(--sr-accent-weak);color:var(--sr-accent)}
.sr-btn--accent:hover:not(:disabled){border-color:var(--sr-accent);background:var(--sr-accent-weak);color:var(--sr-accent)}
/* The claim-source field, revealed in place inside the actions row. */
.sr-claim{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--sr-sp)*1.5);padding-top:calc(var(--sr-sp)*1.5);margin-top:calc(var(--sr-sp)*.5);border-top:1px solid var(--sr-line)}
.sr-claim-input{flex:1;min-width:140px}
.sr-claim .sr-help{flex-basis:100%}
.sr-skill--busy{opacity:.6;pointer-events:none}

/* ---- badges ---- */
.sr-badge{flex:none;font-size:10px;line-height:17px;padding:0 calc(var(--sr-sp)*2);border-radius:var(--sr-r-pill);background:var(--sr-fill);color:var(--sr-fg2);white-space:nowrap}
.sr-badge--user{color:var(--sr-accent)}
/* "Used nothing this turn" — the plugin's core signal, and the calmest possible
   treatment of it: a muted amber, never the error red. */
.sr-badge--none{display:inline-flex;align-items:center;gap:calc(var(--sr-sp)*1.25);background:var(--sr-warn-weak);color:var(--sr-warn)}
.sr-badge--none:before{content:"";flex:none;width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.8}

/* ---- per-skill share bars ---- */
.sr-share{display:flex;align-items:center;gap:calc(var(--sr-sp)*2);padding:calc(var(--sr-sp)*1.25) 0}
.sr-share-name{flex:none;max-width:34%;font-family:var(--sr-mono);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-share-track{flex:1;min-width:0;height:6px;border-radius:var(--sr-r-pill);background:var(--sr-fill);overflow:hidden}
.sr-share-fill{display:block;height:100%;border-radius:var(--sr-r-pill);background:var(--sr-accent);opacity:.75;transition:width var(--sr-speed)}
.sr-share-n{flex:none;font-size:10.5px;color:var(--sr-fg2);font-variant-numeric:tabular-nums;min-width:52px;text-align:right}

/* ---- segmented control ---- */
.sr-seg{position:relative;display:inline-flex;padding:2px;border-radius:var(--sr-r-pill);background:var(--sr-fill2);border:1px solid var(--sr-line);margin-bottom:calc(var(--sr-sp)*2)}
.sr-seg-ind{position:absolute;top:2px;bottom:2px;left:2px;border-radius:var(--sr-r-pill);background:var(--sr-card);box-shadow:var(--sr-shadow);transition:transform var(--sr-speed),width var(--sr-speed)}
.sr-seg button{position:relative;z-index:1;font:inherit;font-size:10px;line-height:18px;padding:0 calc(var(--sr-sp)*2.5);border:0;background:transparent;color:var(--sr-fg3);cursor:pointer;border-radius:var(--sr-r-pill);transition:color var(--sr-speed)}
.sr-seg button[aria-pressed="true"]{color:var(--sr-fg);font-weight:500}

/* ---- timeline ---- */
.sr-time-rail{position:relative;padding-left:calc(var(--sr-sp)*3.5)}
.sr-time-rail:before{content:"";position:absolute;left:3px;top:6px;bottom:6px;width:1px;background:var(--sr-line)}
.sr-turn{position:relative;padding:calc(var(--sr-sp)*1.25) 0}
.sr-turn:before{content:"";position:absolute;left:calc(var(--sr-sp)*-3.5);top:11px;width:7px;height:7px;border-radius:50%;background:var(--sr-card);border:1.5px solid var(--sr-line2)}
.sr-turn--hot:before{border-color:var(--sr-accent);background:var(--sr-accent)}
.sr-turn--now:before{animation:sr-pulse 2.1s ease-out infinite}
@keyframes sr-pulse{0%{box-shadow:0 0 0 0 var(--sr-accent-weak)}70%{box-shadow:0 0 0 6px rgba(0,0,0,0)}100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}
.sr-turn-h{display:flex;align-items:center;gap:calc(var(--sr-sp)*1.75);min-width:0;width:100%;margin:0;padding:calc(var(--sr-sp)*.5) 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:var(--sr-r-sm)}
.sr-turn-h:hover{background:var(--sr-fill)}
.sr-time{flex:none;font-size:10px;color:var(--sr-fg3);font-variant-numeric:tabular-nums}
.sr-turn-title{flex:1;min-width:0;font-size:11px;color:var(--sr-fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-age{flex:none;font-size:10px;line-height:16px;padding:0 calc(var(--sr-sp)*1.75);border-radius:var(--sr-r-pill);background:var(--sr-fill);color:var(--sr-fg3)}
/* Same signal as .sr-badge--none, in the timeline's outcome slot. */
.sr-age--none{background:var(--sr-warn-weak);color:var(--sr-warn)}
.sr-turn-caret{flex:none;color:var(--sr-fg3);transition:transform var(--sr-speed)}
.sr-turn-h[aria-expanded="true"] .sr-turn-caret{transform:rotate(90deg)}
.sr-turn-body{padding-top:calc(var(--sr-sp)*.5)}
.sr-call{display:flex;align-items:center;gap:calc(var(--sr-sp)*2);padding:calc(var(--sr-sp)*.75) 0}
.sr-call-name{flex:1;min-width:0;font-family:var(--sr-mono);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-call-n{flex:none;font-size:11px;color:var(--sr-fg2);font-variant-numeric:tabular-nums}

/* ---- composer strip ---- */
.sr-strip-shell{display:flex;flex-direction:column;gap:calc(var(--sr-sp)*1.5);width:100%;max-width:var(--sr-max)}
.sr-strip-row{display:flex;align-items:center;gap:calc(var(--sr-sp)*1.5)}
/* Open: ONE card. The FRAME lives on the shell, so it encloses the bar row AND the
   report — which is the only way the two can share edges, because the bar is only
   as wide as the row's first cell (the ＋ / ↻ buttons sit beside it). Putting a
   frame on each half instead produced an open-ended box: the bar's bottom border
   was suppressed and the report's top border removed, so no line existed at all. */
/* Open: the shell is a TRANSPARENT LAYOUT COLUMN and each float owns its own surface.
   This rule used to put a border, a background, a radius and overflow:hidden on the shell, which wrapped BOTH the bar
   and the report — so expanding merged them into one card instead of floating the report under the bar, and the
   the overflow:hidden is what stopped the counters riding the bar. The design pass then neutralised all four, but the
   declarations stayed here, and the shell's radius was still measurable at 12px while every other corner in the sheet
   was 8. Removing them here rather than re-overriding them is the honest fix: the shell has no surface. */
.sr-strip-shell--open{gap:calc(var(--sr-sp)*2)}
/* The bar inside the open float is TRANSPARENT, because the row around it is now the surface carrying the frame.
   Its radius drops to the CONTROL step: closed, the bar IS the surface and takes the large corner; open, it is a control
   sitting inside the float, and the host's own scale makes the same distinction — 22 for its composer card, 8 for the
   selects inside it. This line used to zero the radius because the shell was drawing the frame; the shell no longer
   does, so the bar keeps a corner of its own either way. */
.sr-strip-shell--open .sr-strip{border:0;border-radius:var(--sr-r-sm);background:transparent}
/* The bar row above already offers install and refresh. Without this the report's
   own header repeated the same two buttons a few pixels below them. */
.sr-strip-shell--open .sr-strip-panel .sr-head .sr-btn{display:none}
.sr-strip{flex:1;min-width:0;display:flex;align-items:center;gap:calc(var(--sr-sp)*2);padding:calc(var(--sr-sp)*1.5) calc(var(--sr-sp)*3);border:1px solid var(--sr-line);border-radius:var(--sr-r);background:var(--sr-card);color:var(--sr-fg);font:inherit;font-size:11px;line-height:18px;text-align:left;cursor:pointer;transition:background var(--sr-speed),border-color var(--sr-speed)}
.sr-strip:hover{background:var(--sr-fill);border-color:var(--sr-line2)}
.sr-strip-dot{flex:none;width:7px;height:7px;border-radius:50%}
.sr-strip-label{flex:none;color:var(--sr-fg3)}
.sr-strip-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-strip-n{flex:none;font-size:10px;line-height:16px;padding:0 calc(var(--sr-sp)*1.75);border-radius:var(--sr-r-pill);background:var(--sr-fill);color:var(--sr-fg3);font-variant-numeric:tabular-nums}
.sr-strip-caret{flex:none;color:var(--sr-fg3);transition:transform var(--sr-speed)}
.sr-strip-caret--open{transform:rotate(90deg)}
/* No frame of its own: the shell owns the frame when open, so there is never a box
   inside a box. Inside the strip's card the report also drops its own frame, its
   corners and its shadow.
 *
 * ONE scroller, and it is the report inside; this wrapper only bounds the height.
 * Both being scrollers is what broke the sticky footer: with a nested pair, a
 * sticky bottom-0 element pins to the OUTER scrollport while being constrained to
 * its own containing block, so the footer could sit in the middle of the content
 * with the catalogue still visible below it. A flex column wrapper plus a flex-1 /
 * min-height-0 child gives the report a definite height, so its own overflow-y
 * auto is the only scrollport and the footer hugs its bottom edge. */
.sr-strip-panel{display:flex;flex-direction:column;max-height:46vh;overflow:hidden;border:0;border-radius:0;background:transparent}
.sr-strip-panel .sr-root{flex:1;min-height:0;height:auto;overflow-y:auto;overscroll-behavior:contain;border:0;border-radius:0;box-shadow:none}

/* ---- status rail (toasts) ---- */
.sr-rail{display:flex;flex-direction:column;gap:calc(var(--sr-sp)*1.5);padding:0}
.sr-rail--float{padding:calc(var(--sr-sp)*2) calc(var(--sr-sp)*3.5)}
.sr-rail--float:empty{padding:0}
.sr-toast{display:flex;align-items:flex-start;gap:calc(var(--sr-sp)*2);padding:calc(var(--sr-sp)*2) calc(var(--sr-sp)*2.5);border-radius:var(--sr-r);border:1px solid var(--sr-line);background:var(--sr-card);font-size:11px;box-shadow:var(--sr-shadow);animation:sr-toast-in var(--sr-speed) ease-out}
@keyframes sr-toast-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.sr-toast--ok{border-color:var(--sr-ok);color:var(--sr-ok)}
.sr-toast--error{border-color:var(--sr-danger);color:var(--sr-danger)}
.sr-toast--pending{color:var(--sr-fg2)}
.sr-toast-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:calc(var(--sr-sp)*.5)}
.sr-toast-msg{color:var(--sr-fg)}
.sr-toast-hint{font-size:10px;color:var(--sr-fg3);word-break:break-all}
.sr-toast--error .sr-toast-hint{color:var(--sr-danger);opacity:.85}

/* ---- install sheet ---- */
.sr-backdrop{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:calc(var(--sr-sp)*6);background:rgba(15,18,24,.42);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:sr-fade-in var(--sr-speed) ease-out}
.sr-backdrop--closing{animation:sr-fade-out var(--sr-speed) ease-in forwards}
@keyframes sr-fade-in{from{opacity:0}to{opacity:1}}
@keyframes sr-fade-out{from{opacity:1}to{opacity:0}}
@supports not ((-webkit-backdrop-filter:blur(2px)) or (backdrop-filter:blur(2px))){.sr-backdrop{background:rgba(15,18,24,.72)}}
.sr-sheet{display:flex;flex-direction:column;width:min(620px,100%);max-height:min(84vh,720px);border:1px solid var(--sr-line2);border-radius:calc(var(--sr-r) + 4px);background:var(--sr-card);box-shadow:var(--sr-shadow-lg);color:var(--sr-fg);font-size:12px;overflow:hidden;animation:sr-sheet-in var(--sr-speed) ease-out}
.sr-backdrop--closing .sr-sheet{animation:sr-sheet-out var(--sr-speed) ease-in forwards}
@keyframes sr-sheet-in{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}
@keyframes sr-sheet-out{from{opacity:1}to{opacity:0;transform:translateY(6px) scale(.995)}}
.sr-sheet-head{display:flex;align-items:center;gap:calc(var(--sr-sp)*2.5);padding:calc(var(--sr-sp)*3.5) calc(var(--sr-sp)*4);border-bottom:1px solid var(--sr-line)}
.sr-sheet-title{flex:1;min-width:0;font-size:12.5px;font-weight:600}
.sr-sheet-sub{font-size:10px;color:var(--sr-fg3);font-weight:400;padding-top:2px;overflow-wrap:anywhere}
.sr-tabs{position:relative;display:flex;padding:calc(var(--sr-sp)*2.5) calc(var(--sr-sp)*4) 0;border-bottom:1px solid var(--sr-line)}
/* Equal-width cells, so nothing has to be measured at runtime. The selected-tab
   underline below is a pseudo-element positioned inside its own tab, which makes
   it exact by construction — the previous version divided the track by the tab
   count and slid the marker by 100% per step, but the tabs were content-width,
   so the marker landed between tabs. */
.sr-tab-track{position:relative;display:flex;flex:1;min-width:0}
.sr-tab{position:relative;flex:1 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:calc(var(--sr-sp)*1.5);font:inherit;font-size:11px;line-height:26px;padding:0 calc(var(--sr-sp)*2.5);border:0;background:transparent;color:var(--sr-fg3);cursor:pointer;transition:color var(--sr-speed),background var(--sr-speed)}
.sr-tab:hover:not(:disabled){color:var(--sr-fg2);background:var(--sr-fill2)}
.sr-tab[aria-selected="true"]{color:var(--sr-accent);font-weight:600}
.sr-tab[aria-selected="true"]::after{content:"";position:absolute;left:calc(var(--sr-sp)*2);right:calc(var(--sr-sp)*2);bottom:-1px;height:2px;border-radius:2px;background:var(--sr-accent);animation:sr-tab-in var(--sr-speed) ease-out}
@keyframes sr-tab-in{from{transform:scaleX(.35);opacity:.35}to{transform:none;opacity:1}}
.sr-tab:disabled{opacity:.4;cursor:not-allowed}
.sr-sheet-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:calc(var(--sr-sp)*4);display:flex;flex-direction:column;gap:calc(var(--sr-sp)*3.5)}
.sr-field{display:flex;flex-direction:column;gap:calc(var(--sr-sp)*1.5)}
.sr-field-row{display:flex;gap:calc(var(--sr-sp)*3);flex-wrap:wrap}
.sr-field-row>.sr-field{flex:1;min-width:150px}
.sr-label{font-size:10.5px;font-weight:600;color:var(--sr-fg2);display:flex;align-items:center;gap:calc(var(--sr-sp)*1.5)}
.sr-label .sr-opt{font-weight:400;color:var(--sr-fg3);font-size:10px;letter-spacing:0}
.sr-input,.sr-textarea{width:100%;min-width:0;font:inherit;font-size:11.5px;padding:calc(var(--sr-sp)*1.75) calc(var(--sr-sp)*2.5);border-radius:var(--sr-r-sm);border:1px solid var(--sr-line);background:transparent;color:var(--sr-fg);transition:border-color var(--sr-speed),background var(--sr-speed)}
.sr-input{line-height:20px}
.sr-input--mono,.sr-textarea{font-family:var(--sr-mono);font-size:11px}
.sr-textarea{min-height:168px;resize:vertical;line-height:1.5}
.sr-input:focus,.sr-textarea:focus{border-color:var(--sr-accent);background:var(--sr-card);outline:none}
.sr-input--bad{border-color:var(--sr-danger)}
.sr-help{font-size:10px;color:var(--sr-fg3);display:flex;align-items:center;gap:calc(var(--sr-sp)*2);justify-content:space-between}
.sr-help--bad{color:var(--sr-danger)}
.sr-counter{font-variant-numeric:tabular-nums}
.sr-counter--over{color:var(--sr-danger)}
.sr-check{display:inline-flex;align-items:center;gap:calc(var(--sr-sp)*2);font-size:11px;color:var(--sr-fg2);cursor:pointer;user-select:none}
.sr-check input{accent-color:var(--sr-accent);width:13px;height:13px;margin:0}
.sr-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(var(--sr-sp)*2);padding:calc(var(--sr-sp)*7) calc(var(--sr-sp)*4);border:1.5px dashed var(--sr-line2);border-radius:var(--sr-r);background:var(--sr-fill2);color:var(--sr-fg3);text-align:center;transition:border-color var(--sr-speed),background var(--sr-speed),color var(--sr-speed)}
.sr-drop--over{border-color:var(--sr-accent);background:var(--sr-accent-weak);color:var(--sr-accent)}
.sr-drop-title{font-size:11.5px;color:var(--sr-fg2)}
.sr-drop--over .sr-drop-title{color:var(--sr-accent)}
.sr-preview{border:1px solid var(--sr-line);border-radius:var(--sr-r);padding:calc(var(--sr-sp)*3);background:var(--sr-fill2);display:flex;flex-direction:column;gap:calc(var(--sr-sp)*2)}
.sr-preview-top{display:flex;align-items:center;gap:calc(var(--sr-sp)*2.5)}
.sr-preview-name{font-family:var(--sr-mono);font-size:11.5px;font-weight:500}
.sr-preview-desc{font-size:11px;color:var(--sr-fg2)}
.sr-preview-meta{display:flex;flex-wrap:wrap;gap:calc(var(--sr-sp)*1.5) calc(var(--sr-sp)*3);font-size:10px;color:var(--sr-fg3);font-variant-numeric:tabular-nums}
.sr-note{display:flex;align-items:flex-start;gap:calc(var(--sr-sp)*2);padding:calc(var(--sr-sp)*2) calc(var(--sr-sp)*2.5);border-radius:var(--sr-r-sm);font-size:11px;border:1px solid var(--sr-line)}
.sr-note--warn{border-color:var(--sr-warn);color:var(--sr-warn);background:rgba(199,137,27,.08)}
.sr-note--error{border-color:var(--sr-danger);color:var(--sr-danger);background:var(--sr-danger-weak)}
.sr-note--info{color:var(--sr-fg2);background:var(--sr-fill2)}
.sr-note--ok{border-color:var(--sr-ok);color:var(--sr-ok);background:var(--sr-ok-weak)}
.sr-note-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:calc(var(--sr-sp)*.75)}
.sr-note-hint{font-size:10px;opacity:.9;word-break:break-all}
.sr-sheet-foot{display:flex;align-items:center;gap:calc(var(--sr-sp)*2.5);padding:calc(var(--sr-sp)*3) calc(var(--sr-sp)*4);border-top:1px solid var(--sr-line);background:var(--sr-fill2)}
.sr-sheet-foot-note{flex:1;min-width:0;font-size:10px;color:var(--sr-fg3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-hist{display:flex;flex-direction:column;gap:calc(var(--sr-sp)*1.25);padding-top:calc(var(--sr-sp)*1.5)}
.sr-hist-row{display:flex;align-items:center;gap:calc(var(--sr-sp)*2);font-size:10px;color:var(--sr-fg3);font-variant-numeric:tabular-nums}
.sr-hist-row .sr-ic{opacity:.8}
.sr-hist-name{font-family:var(--sr-mono);color:var(--sr-fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:18ch}
.sr-hist-msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---- 4.0 polish set (generated — see the notes at the bottom of this file) ---- */
${POLISH_CSS}

/* ---- 4.0re design pass: supersedes the polish pass above for shared properties ---- */
${DESIGN_CSS}

/* ---- motion / transparency / responsive ---- */
@media (prefers-reduced-motion: reduce){
${SURFACES_ALL},.sr-sheet{transition:none!important;animation:none!important}
}
@media (prefers-reduced-transparency: reduce){
.sr-backdrop{-webkit-backdrop-filter:none;backdrop-filter:none;background:rgba(10,12,16,.86)}
}
/* Dark fallbacks for every token, on the same surface list. The app's own
   --dsw-alias-* variables win when it defines them; these are what keeps the
   panel readable when it does not. */
@media (prefers-color-scheme: dark){
${SURFACES}{
--sr-fg:var(--dsw-alias-label-primary,#e8e8e8);
--sr-fg2:var(--dsw-alias-label-secondary,#a8a8a8);
--sr-fg3:var(--dsw-alias-label-tertiary,#7a7a7a);
--sr-accent:var(--dsw-alias-label-primary,#4d8bff);
--sr-accent-weak:rgba(77,139,255,.16);
--sr-danger:var(--dsw-alias-label-error,#ff6b60);
--sr-danger-weak:rgba(255,107,96,.14);
--sr-ok:#4ec48f;
--sr-ok-weak:rgba(78,196,143,.14);
--sr-warn:#e0a83c;
--sr-warn-weak:rgba(224,168,60,.16);
--sr-line:rgba(255,255,255,.14);
--sr-line2:rgba(255,255,255,.26);
--sr-fill:rgba(255,255,255,.07);
--sr-fill2:rgba(255,255,255,.045);
--sr-card:#1c1d20;
--sr-shadow:0 12px 32px -20px rgba(0,0,0,.7);
--sr-shadow-lg:0 28px 60px -28px rgba(0,0,0,.78)}
}
@media (max-width:560px){
.sr-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
.sr-hero-top{flex-direction:column}
.sr-spark{width:100%;height:30px}
.sr-sheet{width:100%;max-height:100vh;height:100vh;border-radius:0}
.sr-backdrop{padding:0}
.sr-share-name{max-width:44%}
}
/* The breakpoint steps, generated from the r-bp- records. They come AFTER the hand-written
   narrow queries above (so an equal-specificity tie goes to the breakpoint) and BEFORE the dark
   palette (so a dark-themed narrow window still gets the dark tokens). */
${DESIGN_RESPONSIVE_CSS}
/* The design pass's dark palette, LAST because it redefines tokens the earlier dark
   block also declares and has to win over it. */
${DESIGN_DARK_CSS}
${LIQUID_CSS}
${BACKGROUND_CSS}
/* end of stylesheet: the build script checks that this marker survives, because a stray
   backtick in any comment above closes the template literal early and silently truncates
   the sheet — the artifact still parses, so nothing else catches it. */
`

/* ------------------------------------------------------------------ 4.0 polish -- */

/** Class names each polish record styles, for the coverage assertions. */
const POLISH_CLASSES = [...new Set(POLISH.map((record) => (/\.(sr-[a-z0-9-]+)/u.exec(record.at) ?? [])[1]).filter(Boolean))]
/** The same, for the design pass. */
const DESIGN_CLASSES = [...new Set(DESIGN.map((record) => (/\.(sr-[a-z0-9-]+)/u.exec(record.at) ?? [])[1]).filter(Boolean))]

// Injected exactly the way the shipped client bundles do it, from inside the
// factory, so `@deepseek-ai/dsh-client-hmr` can remove the tag on reload. The
// literal below (not the constant) is deliberate: it is the value HMR and the
// bundle test both grep for in the built artifact.
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-echocat-skill-panel'
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

module.exports = { PLUGIN_ID, TAG_ID, VERSION, CSS, POLISH, POLISH_CLASSES, polishCounts, DESIGN, DESIGN_CLASSES, designCounts }
