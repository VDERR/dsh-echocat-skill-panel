/* eslint-disable */
// Blank-region diagnostic for a DSH page: find what is taller than the viewport.
//
// Written while chasing a user report of "scrolling down shows a blank page". It is kept
// because it is the tool that got to the answer: it prints the page's overflow, every
// scroller and how much it hides, each plugin `.sr-root` with its computed height, the
// ANCESTOR CHAIN of that panel with each level's height/scrollHeight/overflow/flex, and the
// biggest scroller's children ranked by height. In that report the culprit turned out NOT to
// be this plugin — but only once the numbers were on screen.
//
// HOW TO USE: paste into the DevTools console (F12 -> Console) with the page in the state you
// want to inspect, then read the output. Read-only; F5 has nothing to undo.
;(() => {
  const lines = []
  const add = (a, b) => lines.push(String(a).padEnd(30) + b)
  const cls = (n) => (typeof n.className === 'string' && n.className !== '' ? n.className.trim().split(/\s+/)[0] : '')
  const N = (n) => (n ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (cls(n) ? '.' + cls(n) : '') : '(none)')
  const mine = (n) => /(^| )sr-/.test(typeof n.className === 'string' ? n.className : '')
  const vh = innerHeight

  add('viewport', innerWidth + 'x' + vh)
  add('page overflow', document.documentElement.scrollHeight - vh)

  // ---- 1. What does the PAGE's own scroll box contain, and which child overflows? -----
  const se = document.scrollingElement
  add('scrollingElement', N(se))
  const pageKids = []
  for (const kid of se.children) {
    const b = kid.getBoundingClientRect()
    pageKids.push({ name: N(kid), h: Math.round(b.height), bottom: Math.round(b.bottom) })
  }
  add('children of scrollingElement', String(pageKids.length))
  for (const k of pageKids) add('  ' + k.name, 'h=' + k.h + ' bottom=' + k.bottom)

  // ---- 2. The plugin's main panel: where is it, and how tall? -----------------------
  const roots = [...document.querySelectorAll('.sr-root')]
  add('', '')
  add('.sr-root count', roots.length)
  for (const r of roots.slice(0, 4)) {
    const b = r.getBoundingClientRect()
    const cs = getComputedStyle(r)
    add('  ' + N(r) + ' @' + N(r.parentElement), 'h=' + Math.round(b.height) + ' top=' + Math.round(b.top) + ' bottom=' + Math.round(b.bottom))
    add('    computed', 'height=' + cs.height + ' minHeight=' + cs.minHeight + ' display=' + cs.display + ' flex=' + cs.flex)
    // Its own body: is the panel's CONTENT forcing the height?
    const body = r.querySelector(':scope > .sr-body')
    if (body !== null) {
      const bb = body.getBoundingClientRect()
      add('    .sr-body', 'h=' + Math.round(bb.height) + ' scrollH=' + body.scrollHeight + ' clientH=' + body.clientHeight + ' overflowY=' + getComputedStyle(body).overflowY)
    }
  }

  // ---- 3. Every ancestor of a `.sr-root`, with the numbers that decide its height ----
  const first = roots[0]
  if (first !== undefined) {
    add('', '')
    add('ancestor chain of .sr-root', '')
    let i = 0
    for (let n = first; n !== null && i < 10; n = n.parentElement, i += 1) {
      const b = n.getBoundingClientRect()
      const cs = getComputedStyle(n)
      add('  ' + i + ' ' + N(n) + (mine(n) ? ' [PLUGIN]' : ''), 'h=' + Math.round(b.height) + ' scrollH=' + n.scrollHeight + ' overflowY=' + cs.overflowY + ' flex=' + cs.flex + ' minH=' + cs.minHeight)
    }
  }

  // ---- 4. The big host scroller: what is its content? --------------------------------
  let big = null
  for (const n of document.querySelectorAll('*')) {
    const cs = getComputedStyle(n)
    if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue
    const hidden = n.scrollHeight - n.clientHeight
    if (big === null || hidden > big.hidden) big = { hidden, n }
  }
  if (big !== null) {
    add('', '')
    add('biggest scroller', N(big.n) + '  hidden=' + big.hidden + 'px  scrollH=' + big.n.scrollHeight + ' clientH=' + big.n.clientHeight)
    // Its children and grandchildren by height — the culprit will be at the top of this list.
    const rows = []
    const walk = (node, depth) => {
      if (depth > 3) return
      for (const kid of node.children) {
        const b = kid.getBoundingClientRect()
        rows.push({ depth, name: N(kid), h: Math.round(b.height), mine: mine(kid) })
        walk(kid, depth + 1)
      }
    }
    walk(big.n, 0)
    rows.sort((a, b) => b.h - a.h)
    for (const r of rows.slice(0, 12)) add('  '.repeat(r.depth + 1) + r.name + (r.mine ? ' [PLUGIN]' : ''), 'h=' + r.h)
  }

  // ---- 5. Does any plugin element sit inside a scroller, and how tall is it? --------
  add('', '')
  const pluginInside = []
  for (const n of document.querySelectorAll('[class^="sr-"],[class*=" sr-"]')) {
    if (n.closest('[class^="sr-"],[class*=" sr-"]') !== n && n.closest('[class^="sr-"]') !== null) continue
    const b = n.getBoundingClientRect()
    pluginInside.push({ name: N(n), h: Math.round(b.height), bottom: Math.round(b.bottom) })
  }
  add('top-level plugin elements', pluginInside.length)
  for (const p of pluginInside.slice(0, 8)) add('  ' + p.name, 'h=' + p.h + ' bottom=' + p.bottom + ' (viewport ' + vh + ')')

  const text = lines.join('\n')
  console.log(text)
  try {
    copy(text)
  } catch {}
  return text
})()
