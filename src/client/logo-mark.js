// The EchoCat mark, as its own leaf module.
//
// WHY IT IS NOT IN panel.js, where it started: the background-customisation dialog needs to render the same mark, because
// it carries the switch that hides it and a switch with nothing on screen to affect is not a live preview. `panel.js`
// already requires `background-panel.js` for the toolbar button, so importing the mark back the other way would be a cycle
// — which happens to survive here only because function declarations hoist, and would break the moment this became a
// `const` arrow. A leaf module removes the question instead of relying on the answer.
//
// Both images are always in the DOM with one hidden by CSS rather than chosen in JavaScript: reading the active theme from
// JS means reading a class off `document.documentElement` or subscribing to `prefers-color-scheme`, and the stylesheet
// already answers that question for every surface through those same two signals. Selecting in CSS keeps the answer in one
// place instead of two that can disagree.
//
// `aria-hidden` and `pointer-events:none`: it is a mark, not a control.
const React = require('react')
const logo = require('./logo.js')
const h = React.createElement

function LogoMark() {
  return h(
    'span',
    { className: 'sr-strip-logo', 'aria-hidden': 'true', style: { '--sr-logo-mask': `url("${logo.LOGO_BY_THEME.light}")` } },
    h('img', { className: 'sr-logo sr-logo--light', src: logo.LOGO_BY_THEME.light, alt: '', draggable: 'false' }),
    h('img', { className: 'sr-logo sr-logo--dark', src: logo.LOGO_BY_THEME.dark, alt: '', draggable: 'false' }),
  )
}

module.exports = { LogoMark }
