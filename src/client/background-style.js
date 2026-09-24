const BACKGROUND_CSS=`
.sr-root.sr-root[data-sr-theme="light"],.sr-strip-shell.sr-strip-shell[data-sr-theme="light"],.sr-backdrop.sr-backdrop[data-sr-theme="light"],.sr-backdrop .sr-sheet[data-sr-theme="light"]{--sr-fg:#28364b;--sr-fg2:#46556d;--sr-fg3:#596980;
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
 --sr-speed:200ms;--sr-reflection:50%;}
.sr-root.sr-root[data-sr-theme="dark"],.sr-strip-shell.sr-strip-shell[data-sr-theme="dark"],.sr-backdrop.sr-backdrop[data-sr-theme="dark"],.sr-backdrop .sr-sheet[data-sr-theme="dark"]{--sr-fg:#edf2fc;--sr-fg2:#c0cde1;--sr-fg3:#a6b7cd;
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
 --sr-material-shadow:0 8px 26px -18px rgba(0,0,0,.7);}

:is(.sr-root,.sr-strip-shell)[data-sr-background] :is(.sr-title,.sr-status,.sr-foot-item,.sr-strip-brand,.sr-strip-text,.sr-group-head,.sr-bg-sample-title){text-shadow:0 0 2px var(--sr-text-halo),0 1px 7px var(--sr-text-halo)}
:is(.sr-root,.sr-strip-shell,.sr-backdrop,.sr-rail) .sr-btn.sr-btn--primary:hover:not(:disabled){color:var(--sr-accent-ink)}
.sr-background-layer,.sr-background-shade{position:absolute;top:0;left:0;z-index:-1;pointer-events:none;border-radius:inherit;max-width:none}
.sr-background-layer{background-repeat:no-repeat}
.sr-root .sr-bg-open,.sr-strip-shell .sr-bg-open{white-space:nowrap;gap:5px;padding-inline:9px}
.sr-strip-shell .sr-strip-panel .sr-head .sr-bg-open{display:none}
.sr-strip-shell .sr-strip-actions{flex:none;flex-wrap:wrap}
.sr-strip-shell .sr-strip-actions .sr-bg-open{width:auto;min-width:104px;flex:none;height:28px}
.sr-strip-shell .sr-strip-right{flex-wrap:wrap;row-gap:6px}
/*
 * NAMED sr-strip — the container the strip shell declares. Unnamed, this resolved against the nearest ancestor container
 * instead, which is not the strip: the shell collapses its 「背景自定义」 button to the icon form only when the STRIP is
 * narrow, so an unrelated narrow ancestor was hiding that button's label on a full-width strip.
 */
@container sr-strip (max-width:640px){
 .sr-strip-shell .sr-strip-actions .sr-bg-open{width:28px;min-width:28px;padding-inline:0;justify-content:center}
 .sr-strip-shell .sr-bg-open-label{display:none}
}
.sr-bg-backdrop.sr-backdrop{padding:24px;background:rgba(21,32,48,.30);z-index:10020}
.sr-backdrop .sr-bg-dialog{display:flex;flex-direction:column;width:min(960px,100%);max-height:min(900px,92dvh);min-height:0;border-radius:26px;padding:0;background:var(--sr-menu);color:var(--sr-fg);border:1px solid var(--sr-line);box-shadow:0 22px 80px -30px rgba(10,25,48,.4);font-family:var(--sr-sans);overflow:hidden}
.sr-backdrop .sr-bg-header{padding:24px 28px 16px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex:none}
.sr-backdrop .sr-bg-eyebrow{font-size:11px;letter-spacing:.10em;color:var(--sr-fg3)}
.sr-backdrop .sr-bg-header h2{font-size:22px;letter-spacing:-.02em;margin:6px 0 6px;font-weight:650;color:var(--sr-fg)}
.sr-backdrop .sr-bg-header p{font-size:12px;line-height:1.6;color:var(--sr-fg2);margin:0}
.sr-backdrop .sr-bg-body{display:grid;grid-template-columns:minmax(240px,310px) minmax(0,1fr);gap:28px;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 28px 20px;scrollbar-width:thin;scrollbar-color:var(--sr-line2) transparent}
.sr-backdrop .sr-bg-aside{position:sticky;top:0;align-self:start;min-width:0}
.sr-backdrop .sr-bg-sample.sr-root{width:100%;height:234px;min-height:234px;max-width:none;margin:0;padding:18px;display:flex;gap:14px;overflow:hidden;border-radius:20px;container-type:normal}
.sr-backdrop .sr-bg-sample-title{display:flex;flex-direction:column;gap:4px;font-size:15px;font-weight:650;color:var(--sr-fg)}
.sr-backdrop .sr-bg-sample-title span{font-size:10px;font-weight:400;color:var(--sr-fg2)}
.sr-backdrop .sr-bg-sample .sr-skill{padding:14px;gap:8px;border-radius:14px;flex:1;min-height:0}
.sr-backdrop .sr-bg-sample .sr-skill strong{font-size:12px;font-weight:600}
.sr-backdrop .sr-bg-sample .sr-skill p{color:var(--sr-fg2);font-size:11px;line-height:1.65;margin:0}
.sr-backdrop .sr-bg-sample .sr-btn{align-self:flex-start}
.sr-backdrop .sr-bg-section{margin:0 0 22px;min-width:0}
.sr-backdrop .sr-bg-section h3{font-size:12px;font-weight:650;letter-spacing:.025em;color:var(--sr-fg);margin:0 0 12px}
.sr-backdrop .sr-bg-help{font-size:11px;line-height:1.7;color:var(--sr-fg2);margin:10px 0 18px}
.sr-backdrop .sr-bg-controls{min-width:0}
.sr-backdrop .sr-bg-controls fieldset{border:0;padding:0;margin:0;min-width:0}
.sr-backdrop .sr-bg-presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.sr-backdrop .sr-bg-preset{border:1px solid var(--sr-line);border-radius:12px;background:var(--sr-control);padding:7px;text-align:left;color:var(--sr-fg);cursor:pointer;min-width:0;transition:border-color 180ms,box-shadow 180ms}
.sr-backdrop .sr-bg-preset:hover,.sr-backdrop .sr-bg-preset[aria-pressed="true"]{border-color:var(--sr-accent);box-shadow:0 0 0 2px var(--sr-accent-weak)}
.sr-backdrop .sr-bg-preset strong{display:block;font-size:11px;padding:7px 2px 1px;font-weight:550}
.sr-backdrop .sr-bg-swatch{display:block;height:38px;border-radius:7px}
.sr-backdrop .sr-bg-modes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-bottom:14px}
.sr-backdrop .sr-bg-modes .sr-btn{justify-content:center;white-space:nowrap;padding-inline:6px;min-height:32px}
.sr-backdrop .sr-bg-modes .sr-btn[aria-pressed="true"]{background-color:var(--sr-accent-weak);border-color:var(--sr-accent);color:var(--sr-fg)}
.sr-backdrop .sr-bg-select,.sr-backdrop .sr-bg-toggle{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:12px;margin:12px 0;color:var(--sr-fg2)}
.sr-backdrop .sr-bg-select select{max-width:60%;border:1px solid var(--sr-line2);border-radius:9px;padding:6px 9px;background:var(--sr-control);color:var(--sr-fg);font:inherit}
.sr-backdrop .sr-bg-toggle input{width:17px;height:17px;accent-color:var(--sr-accent)}
.sr-backdrop .sr-bg-colors{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.sr-backdrop .sr-bg-color{display:flex;flex-direction:column;gap:8px;font-size:11px;color:var(--sr-fg2);min-width:0}
.sr-backdrop .sr-bg-color-input{display:flex;align-items:center;gap:5px;background:var(--sr-control);border:1px solid var(--sr-line);border-radius:9px;padding:5px;min-width:0}
.sr-backdrop .sr-bg-color input[type=color]{padding:0;width:25px;height:25px;flex:none;border:0;background:none;cursor:pointer}
.sr-backdrop .sr-bg-color input[type=text]{width:100%;min-width:0;border:0;background:transparent;font:10px var(--sr-mono);color:var(--sr-fg);padding:0}
.sr-backdrop .sr-bg-range{margin:14px 0}
.sr-backdrop .sr-bg-range-label{display:flex;align-items:center;justify-content:space-between;font-size:12px;gap:12px;color:var(--sr-fg2);margin-bottom:7px}
.sr-backdrop .sr-bg-range output{font-variant-numeric:tabular-nums;font-size:11px;color:var(--sr-fg3)}
.sr-backdrop .sr-bg-range input{display:block;accent-color:var(--sr-accent);width:100%;height:16px;margin:0;cursor:pointer}
.sr-backdrop .sr-bg-image{display:flex;align-items:center;gap:12px;min-width:0;font-size:11px;color:var(--sr-fg2);margin-bottom:12px}
.sr-backdrop .sr-bg-image img{width:80px;height:56px;object-fit:cover;border-radius:10px}
.sr-backdrop .sr-bg-image span{overflow-wrap:anywhere;min-width:0}
.sr-backdrop .sr-bg-file{display:none}
.sr-backdrop .sr-bg-inline{display:flex;flex-wrap:wrap;gap:8px}
.sr-backdrop .sr-bg-footer{display:flex;align-items:center;gap:10px;padding:16px 28px 22px;flex:none}
.sr-backdrop .sr-bg-save-note{flex:1;font-size:11px;color:var(--sr-fg2);line-height:1.5}
.sr-backdrop .sr-bg-error{font-size:12px;line-height:1.6;color:var(--sr-danger);background:var(--sr-danger-weak);padding:10px 14px;margin:0 28px;border-radius:12px}
.sr-backdrop .sr-bg-dialog :is(button,input,select):focus-visible{outline:2px solid var(--sr-accent);outline-offset:3px}
@media(max-width:720px){
 .sr-bg-backdrop.sr-backdrop{padding:12px}
 .sr-backdrop .sr-bg-dialog{max-height:94dvh;border-radius:22px}
 .sr-backdrop .sr-bg-header{padding:20px 18px 14px}
 .sr-backdrop .sr-bg-body{grid-template-columns:minmax(0,1fr);gap:8px;padding:0 18px 12px}
 .sr-backdrop .sr-bg-aside{position:static}
 .sr-backdrop .sr-bg-sample.sr-root{height:210px;min-height:210px}
 .sr-backdrop .sr-bg-presets{grid-template-columns:repeat(3,minmax(0,1fr))}
 .sr-backdrop .sr-bg-footer{padding:12px 18px 16px;flex-wrap:wrap;gap:8px}
 .sr-backdrop .sr-bg-save-note{flex-basis:100%;order:-1}
 .sr-backdrop .sr-bg-footer .sr-btn:first-child{margin-right:auto}
 .sr-backdrop .sr-bg-error{margin-inline:18px}
}
`
module.exports={BACKGROUND_CSS:BACKGROUND_CSS.replace(/;\s*\}/gu,'}')}
