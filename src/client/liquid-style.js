// Material-only layer, after the existing layout/responsive rules.
// All selectors stay within EchoCat surfaces; host controls are never selected.
const LIQUID_CSS = `
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail){
 --sr-fg:#28364b;--sr-fg2:#46556d;--sr-fg3:#596980;
 --sr-canvas:#e8edf5;--sr-card:#edf2f9;--sr-raised:#f4f7fc;--sr-sunken:#e0e7f1;
 --sr-fill:rgba(87,116,169,.10);--sr-fill2:rgba(94,123,162,.045);
 --sr-line:rgba(96,123,159,.20);--sr-line2:rgba(91,119,161,.36);
 --sr-accent:#405c9b;--sr-accent-ink:#fff;--sr-display:#3b589c;
 --sr-accent-weak:rgba(108,134,201,.15);--sr-accent-line:rgba(99,126,198,.35);
 --sr-ok:#157150;--sr-warn:#885015;--sr-danger:#ad354c;
 --sr-warn-weak:rgba(205,164,96,.15);--sr-danger-weak:rgba(185,76,97,.11);
 --sr-base:#e7edf5;--sr-glass:rgba(249,252,255,.66);--sr-glass-soft:rgba(249,252,255,.38);
 --sr-control:rgba(248,252,255,.59);--sr-specular:rgba(255,255,255,.85);
 --sr-control-highlight:rgba(255,255,255,.75);--sr-menu:#f0f4fb;
 --sr-material-shadow:0 8px 26px -18px rgba(65,88,127,.42);
 --sr-speed:200ms;--sr-reflection:50%;
}
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail)[data-sr-theme="dark"],
:is(.dark,[data-theme="dark"],[data-dsw-theme="dark"]) :is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail),
.sr-backdrop .sr-sheet[data-sr-theme="dark"]{
 --sr-fg:#edf2fc;--sr-fg2:#c0cde1;--sr-fg3:#a6b7cd;
 --sr-canvas:#182230;--sr-card:#1d293a;--sr-raised:#263448;--sr-sunken:#152030;
 --sr-fill:rgba(169,194,229,.13);--sr-fill2:rgba(169,194,229,.06);
 --sr-line:rgba(184,205,235,.19);--sr-line2:rgba(184,205,235,.33);
 --sr-accent:#a7bffa;--sr-accent-ink:#172544;--sr-display:#c1d3ff;
 --sr-accent-weak:rgba(153,181,245,.16);--sr-accent-line:rgba(173,196,247,.37);
 --sr-ok:#85dfb6;--sr-warn:#f0c995;--sr-danger:#ffabb9;
 --sr-warn-weak:rgba(208,161,99,.15);--sr-danger-weak:rgba(237,119,144,.14);
 --sr-base:#1a2637;--sr-glass:rgba(29,43,62,.76);--sr-glass-soft:rgba(33,46,67,.42);
 --sr-control:rgba(97,122,160,.14);--sr-specular:rgba(214,233,255,.22);
 --sr-control-highlight:rgba(179,207,248,.19);--sr-menu:#233148;
 --sr-material-shadow:0 8px 26px -18px rgba(0,0,0,.7);
}
.sr-root.sr-root,.sr-strip-shell.sr-strip-shell,.sr-backdrop .sr-sheet{
 position:relative;isolation:isolate;background-color:var(--sr-base);
 background-image:linear-gradient(128deg,transparent 20%,rgba(151,180,213,.18) 40%,rgba(216,210,244,.23) 49%,rgba(255,255,255,.36) 52%,transparent 64%);
 border:1px solid var(--sr-line);box-shadow:inset 0 1px 0 var(--sr-specular),var(--sr-material-shadow);
}
.sr-strip-shell.sr-strip-shell{gap:0;border-radius:20px;overflow:hidden}
.sr-liquid-field{position:absolute;top:0;left:0;z-index:-1;pointer-events:none;border-radius:inherit;opacity:.96;max-width:none}
.sr-root.sr-root{padding:0;border-radius:24px}
.sr-strip-shell.sr-strip-shell{padding:0;margin-inline:auto}
.sr-root .sr-body{background:transparent;width:100%;max-width:1280px;margin-inline:auto;padding:20px 24px 24px;box-sizing:border-box}
.sr-backdrop .sr-sheet-head,.sr-backdrop .sr-sheet-foot{
 background:var(--sr-glass);border-color:var(--sr-line);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
 box-shadow:inset 0 1px 0 var(--sr-specular);
}
.sr-root .sr-head,.sr-root .sr-foot{
 background:transparent;border:0;border-radius:0;box-shadow:none;
 -webkit-backdrop-filter:none;backdrop-filter:none;
}
/* Only the catalogue fades at its sticky viewport edges. The shared surface is
   never masked, so headings and status sit directly on the same liquid field. */
.sr-root .sr-body{
 --sr-content-top:0px;--sr-content-bottom:0px;
 -webkit-mask-image:linear-gradient(to bottom,transparent var(--sr-content-top),#000 calc(var(--sr-content-top) + 14px),#000 calc(100% - var(--sr-content-bottom) - 18px),transparent calc(100% - var(--sr-content-bottom)));
 mask-image:linear-gradient(to bottom,transparent var(--sr-content-top),#000 calc(var(--sr-content-top) + 14px),#000 calc(100% - var(--sr-content-bottom) - 18px),transparent calc(100% - var(--sr-content-bottom)));
}
.sr-root .sr-fade{display:none}
.sr-root .sr-title{font-weight:650;letter-spacing:.02em}
.sr-root .sr-head{padding:13px 24px;min-height:58px}
.sr-root .sr-foot{padding:12px 24px}
.sr-root .sr-hero{
 background:var(--sr-glass-soft);border:1px solid var(--sr-line);border-radius:18px;margin:0;padding:18px 20px;
 box-shadow:inset 0 1px 0 var(--sr-specular);overflow:hidden;
}
.sr-root .sr-hero::before{background:linear-gradient(180deg,#829ccc,#b7afd3,#91c9d4);width:3px}
.sr-root .sr-stat{background:var(--sr-glass-soft);border-color:var(--sr-line);box-shadow:inset 0 1px 0 var(--sr-specular)}
.sr-root .sr-stat-v{color:var(--sr-display)}
.sr-root .sr-stats{padding:18px 0 0;gap:12px}
.sr-root .sr-section{background:transparent;border-color:var(--sr-line)}
.sr-root .sr-skill{
 background:var(--sr-glass);border:1px solid var(--sr-line);border-radius:20px;padding:18px;gap:14px;
 box-shadow:inset 0 1px 0 var(--sr-specular),0 3px 8px -6px rgba(49,79,121,.30);
 transition:background 200ms,border-color 200ms,box-shadow 200ms;
}
.sr-root .sr-skill:hover{background:var(--sr-glass);border-color:var(--sr-accent-line);box-shadow:inset 0 1px 0 var(--sr-specular),0 5px 15px -10px rgba(71,100,150,.43)}
.sr-root .sr-skill-name,.sr-root .sr-skill-desc{color:var(--sr-fg)}
.sr-root .sr-skill-desc{line-height:1.65}
.sr-root .sr-skill-slug,.sr-root .sr-source{color:var(--sr-fg3)}
.sr-root .sr-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:stretch}
.sr-root .sr-sec{border:0;margin-top:22px}
.sr-root .sr-sec-head{top:calc(var(--sr-content-head-height,58px) + 14px);background:var(--sr-glass);border:1px solid var(--sr-line);border-radius:14px;padding:4px;overflow:hidden;box-shadow:inset 0 1px 0 var(--sr-specular)}
.sr-root .sr-sec-h{border-radius:10px;padding:10px 12px;letter-spacing:.02em}
.sr-root .sr-sec-actions{padding:0 4px;align-items:center;gap:7px}
.sr-root .sr-sec-b{padding:14px 0 0}
.sr-root .sr-group{margin-top:16px}
.sr-root .sr-group-head{position:static;background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;padding:0 2px 12px;border:0;gap:8px}
.sr-root .sr-group-note{font-size:11px}
.sr-root .sr-skill-head{align-items:flex-start;gap:12px;min-height:36px}
.sr-root .sr-skill-headtext{gap:5px}
.sr-root .sr-skill-name{font-family:var(--sr-sans);font-size:14px;font-weight:650;line-height:1.45;letter-spacing:0;overflow-wrap:anywhere}
.sr-root .sr-skill-slug{font-size:11px;line-height:1.45;letter-spacing:0}
.sr-root .sr-avatar{width:34px;height:34px;border-radius:10px;font-size:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.28)}
.sr-root .sr-skill-main{flex:1;min-height:64px}
.sr-root .sr-blurb{font-size:13px;line-height:1.7;letter-spacing:0;color:var(--sr-fg2);margin:0}
.sr-root .sr-card-foot-row{display:flex;flex-direction:column;align-items:stretch;gap:12px;padding-top:12px;border-top:1px solid var(--sr-line);width:100%}
.sr-root .sr-card-src{order:-1;justify-content:flex-start;width:100%;flex:none}
.sr-root .sr-card-lead{display:flex;width:100%;align-items:center;gap:8px}
.sr-root .sr-card-calls{order:2;margin-left:auto;color:var(--sr-fg3);font-size:11px;white-space:nowrap}
.sr-root .sr-card-actions{flex:1;min-width:0}
.sr-root .sr-card-foot-row .sr-row-actions{flex-wrap:wrap;gap:7px}
.sr-root .sr-row-actions .sr-btn{opacity:1}
.sr-root .sr-skill--editing .sr-skill-main{min-height:0}
.sr-strip-shell .sr-strip-row,.sr-strip-shell.sr-strip-shell--open .sr-strip-row{
 padding:0;background:transparent;border:0;border-radius:0;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;
}
.sr-strip-shell .sr-strip,.sr-strip-shell.sr-strip-shell--open .sr-strip{
 background:transparent;border:0;border-radius:0;box-shadow:none;
 transition:background 200ms;
}
.sr-strip-shell .sr-strip{padding:12px 22px}
.sr-strip-shell .sr-strip:hover{background:transparent;transform:none;box-shadow:none}
.sr-strip-shell .sr-strip-panel{
 background:transparent;border:0;border-radius:0;box-shadow:none;
 animation:sr-liquid-reveal 260ms ease-out;
}
.sr-strip-shell .sr-strip-panel .sr-root{width:100%;max-width:none;margin:0;background:transparent;border:0;border-radius:0;box-shadow:none;isolation:auto}
.sr-strip-shell .sr-strip-panel .sr-head{background:transparent;border-radius:0}
.sr-strip-shell .sr-strip-count{color:var(--sr-display);background:var(--sr-accent-weak);box-shadow:inset 0 1px 0 var(--sr-specular)}
.sr-strip-shell .sr-strip-stat{background:var(--sr-glass-soft);color:var(--sr-fg2);border:1px solid var(--sr-line)}
.sr-strip-shell .sr-strip-stat-n{color:var(--sr-fg)}
.sr-strip-shell .sr-strip-logo,.sr-root .sr-strip-logo{
 position:relative;opacity:1;border:0;box-shadow:none;background:none;border-radius:0;filter:none;
 width:26px;height:26px;flex-basis:26px;overflow:hidden;
}
:is(.sr-root,.sr-strip-shell) .sr-logo{filter:grayscale(.70) saturate(.5) contrast(1.08);mix-blend-mode:multiply;opacity:.88}
:is(.sr-root,.sr-strip-shell) .sr-strip-logo::after{
 content:'';position:absolute;inset:0;pointer-events:none;
 background:linear-gradient(115deg,transparent 28%,rgba(209,234,251,.12) 39%,rgba(247,253,255,.7) 49%,rgba(200,190,240,.16) 59%,transparent 72%);
 background-size:220% 100%;background-position:var(--sr-reflection) 0;
 -webkit-mask:var(--sr-logo-mask) center/contain no-repeat;mask:var(--sr-logo-mask) center/contain no-repeat;
 mix-blend-mode:soft-light;
}
:is(.sr-root,.sr-strip-shell)[data-sr-theme="dark"] .sr-logo{mix-blend-mode:screen;filter:grayscale(.6) saturate(.6);opacity:.9}
:is(.sr-root,.sr-strip-shell)[data-sr-theme="light"] .sr-logo--light{display:block}
:is(.sr-root,.sr-strip-shell)[data-sr-theme="light"] .sr-logo--dark{display:none}
:is(.sr-root,.sr-strip-shell)[data-sr-theme="dark"] .sr-logo--light{display:none}
:is(.sr-root,.sr-strip-shell)[data-sr-theme="dark"] .sr-logo--dark{display:block}
/*
 * The EchoCat mark is optional, and HIDDEN MEANS "hidden but still occupying its slot".
 *
 * .sr-strip-logo is flex:0 0 22px — the fixed middle column between two equal flanks, which is what centres the summary
 * rather than nudging it. display:none would collapse that column and shift the summary sideways as the switch is flipped,
 * so the bar would visibly jerk every time. visibility:hidden keeps the geometry and removes the mark, which is what
 * "hide the logo" means to someone toggling it.
 */
:is(.sr-root,.sr-strip-shell)[data-sr-logo="hide"] .sr-strip-logo{visibility:hidden}
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) :is(.sr-btn,.sr-tab,.sr-seg-btn,.sr-filter-chip,.sr-section-toggle){
 border-radius:9px;
 background-color:var(--sr-control);
 background-image:radial-gradient(ellipse at var(--sr-pointer-x,50%) var(--sr-pointer-y,0%),var(--sr-control-highlight),transparent 90%);
 color:var(--sr-fg2);border-color:var(--sr-line);
 box-shadow:inset 0 1px 0 var(--sr-specular),inset 0 -1px 0 rgba(80,114,165,.055),0 2px 5px -4px rgba(42,69,107,.35);
 transition:background-color 200ms,border-color 180ms,box-shadow 200ms,transform 180ms ease;
}
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) :is(.sr-btn,.sr-tab,.sr-seg-btn):hover:not(:disabled){
 border-color:var(--sr-accent-line);color:var(--sr-fg);transform:translateY(-1px);
 box-shadow:inset 0 1px 0 var(--sr-specular),0 3px 10px -6px rgba(84,110,174,.55);
}
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) .sr-btn.sr-btn--primary{
 color:var(--sr-accent-ink);background-color:var(--sr-accent);
 background-image:radial-gradient(ellipse at var(--sr-pointer-x,45%) var(--sr-pointer-y,0%),rgba(197,224,255,.14),transparent 95%),linear-gradient(125deg,rgba(57,111,174,.1),rgba(115,97,167,.1));
 border-color:rgba(107,131,192,.48);box-shadow:inset 0 1px 0 rgba(237,248,255,.43),0 3px 9px -6px rgba(66,83,150,.55);
}
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) .sr-btn.sr-btn--danger{color:var(--sr-danger);border-color:color-mix(in srgb,var(--sr-danger) 28%,transparent)}
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) :is(.sr-btn,.sr-tab,.sr-seg-btn)[data-sr-pressed="true"],
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) :is(.sr-btn,.sr-tab,.sr-seg-btn):active:not(:disabled){transform:translateY(0) scale(.98);box-shadow:inset 0 1px 4px rgba(53,83,130,.16);transition-duration:100ms}
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) :is(.sr-btn,.sr-tab,.sr-seg-btn):disabled{opacity:.48;transform:none;animation:none;box-shadow:none;cursor:not-allowed}
:is(.sr-root,.sr-backdrop) :is(.sr-tab[aria-selected="true"],.sr-seg-btn[aria-pressed="true"],.sr-chip[aria-pressed="true"]){
 background:var(--sr-accent-weak);border-color:var(--sr-accent-line);color:var(--sr-display);box-shadow:inset 0 1px 0 var(--sr-specular);
}
:is(.sr-root,.sr-backdrop) :is(.sr-input,.sr-textarea,.sr-filter-input,select){background:var(--sr-glass);color:var(--sr-fg);border-color:var(--sr-line2);box-shadow:inset 0 1px 3px rgba(61,91,139,.045);transition:border-color 180ms,box-shadow 180ms}
:is(.sr-root,.sr-backdrop) :is(.sr-input,.sr-textarea,.sr-filter-input,select):focus{outline:0;border-color:var(--sr-accent);box-shadow:0 0 0 3px var(--sr-accent-weak),inset 0 1px 0 var(--sr-specular)}
:is(.sr-root,.sr-backdrop) :is(.sr-input,.sr-textarea,.sr-filter-input)::placeholder{color:var(--sr-fg3);opacity:1}
:is(.sr-root,.sr-backdrop) :is(select,option,.sr-color-pop,.sr-popover,.sr-menu){background-color:var(--sr-menu);color:var(--sr-fg)}
:is(.sr-root,.sr-backdrop) :is(.sr-switch,.sr-toggle){transition:background 200ms,border-color 200ms;box-shadow:inset 0 1px 3px rgba(42,62,95,.12)}
:is(.sr-root,.sr-backdrop) :is(.sr-switch,.sr-toggle)::after{transition:transform 200ms cubic-bezier(.2,.8,.3,1)}
.sr-backdrop.sr-backdrop{background:rgba(23,35,55,.42);backdrop-filter:none;-webkit-backdrop-filter:none;animation:none}
.sr-backdrop .sr-sheet{border-radius:22px;max-height:min(88dvh,800px);animation:sr-liquid-reveal 260ms ease-out}
.sr-backdrop .sr-sheet-body{background:transparent}
.sr-backdrop .sr-sheet-foot-note{white-space:normal;line-height:1.55}
.sr-backdrop .sr-note,.sr-root .sr-note{line-height:1.65;border-width:1px;background:var(--sr-glass);color:var(--sr-fg2)}
:is(.sr-root,.sr-backdrop) .sr-note--warn{background:var(--sr-warn-weak);color:var(--sr-warn);border-color:color-mix(in srgb,var(--sr-warn) 42%,transparent)}
:is(.sr-root,.sr-backdrop) .sr-note--error{background:var(--sr-danger-weak);color:var(--sr-danger);border-color:color-mix(in srgb,var(--sr-danger) 42%,transparent)}
.sr-root .sr-color-menu,.sr-root .sr-color-popover{background:var(--sr-menu);border-color:var(--sr-line2);backdrop-filter:none}
@container (max-width:1000px){.sr-root .sr-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@keyframes sr-liquid-reveal{from{transform:translateY(4px)}to{transform:translateY(0)}}
@container (max-width:640px){
 .sr-strip-shell .sr-strip{flex-wrap:wrap;gap:8px;padding:10px 12px}
 .sr-strip-shell .sr-strip-left{flex:1 1 65%;min-width:0}
 .sr-strip-shell .sr-strip-right{flex:1 1 100%;min-width:0;justify-content:space-between}
 .sr-strip-shell .sr-strip-right{flex-wrap:wrap;row-gap:8px}
 .sr-strip-shell .sr-strip-stats{flex-wrap:wrap;gap:3px}
 .sr-strip-shell .sr-strip-logo{order:0;flex:0 0 24px}
 .sr-root .sr-head{flex-wrap:wrap;gap:8px}
 .sr-root .sr-head-tools{margin-left:auto;flex-wrap:wrap}
 .sr-root .sr-section-head{flex-wrap:wrap}
 .sr-root .sr-turn-head{flex-wrap:wrap}
 .sr-root .sr-turn{min-width:0}
 .sr-root .sr-share-name{max-width:45%;overflow-wrap:anywhere}
 .sr-root .sr-grid{grid-template-columns:minmax(0,1fr)}
 .sr-root .sr-body{padding:16px}
 .sr-root .sr-head,.sr-root .sr-foot{padding:12px 16px}
 .sr-root .sr-group-head{flex-wrap:wrap}
 .sr-root .sr-group-note{flex-basis:100%;text-align:left;white-space:normal}
 .sr-root .sr-sec-head{flex-wrap:wrap;gap:4px}
 .sr-root .sr-skill{padding:16px}
}
.sr-strip-shell.sr-strip-shell,.sr-root.sr-root{container-type:inline-size}
@media (prefers-reduced-motion:reduce){
 :is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) *,
 :is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) *::before,
 :is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) *::after{animation:none!important;transition:none!important;scroll-behavior:auto}
 :is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) :is(.sr-btn,.sr-tab,.sr-seg-btn):hover{transform:none}
}
/* end of stylesheet */
`

module.exports = { LIQUID_CSS: LIQUID_CSS.replace(/;\s*\}/gu, '}') }
