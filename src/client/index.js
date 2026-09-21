// echocat-skill-panel — browser half (client plugin).
//
// AUTHORING NOTE: bundle source, not a Node module — see src/client/panel.js.
//
// The shell materializes this module and hands `apply` a *client* cordis context
// whose `slots` service is the UI extension registry. Three surfaces are
// contributed, all fed by one module-level source (src/client/source.js) and one
// write path (src/client/api.js):
//
//   main                     the full report, in the centre column
//   sidebar.panellist        the resident glyph in the left sidebar that opens it
//   conversation.input.dock  the summary strip above the composer, expanding in place
//
// `main` is keyed and `sidebar.panellist` is a list; the layout addresses the
// centre panel by the *same* id the sidebar entry carries, and
// `layout.selectPanel(id)` throws when no `main` entry has that key — so the two
// constants below must never diverge.

const React = require('react')
const { SkillReportPanel, SkillReportIcon, SkillReportStrip } = require('./panel.js')
const {
  useSkillReport,
  refresh,
  stopPolling,
  getSnapshot,
  subscribe,
  DEFAULT_PATH,
  applySkills,
  checkForUpdates,
  getUpdates,
  clearUpdates,
  checkPluginRelease,
  useRelease,
  applyRelease,
  clearRelease,
  openExternal,
} = require('./source.js')

const h = React.createElement

/** Shared address of the panel in both slots. */
const PANEL_ID = 'skill-report'

const onRefresh = () => {
  void refresh()
}

/** Centre-column surface: the full report (it brings its own padding and shell). */
function PanelSurface() {
  const state = useSkillReport()
  return h(SkillReportPanel, { state, onRefresh })
}

/**
 * Composer-dock surface: the summary strip above the input box.
 *
 * `conversation.input.dock` is a full-width list seat owned by the conversation
 * entry, so the strip participates in layout instead of floating over it — no
 * positioning of our own, and no guessing at the composer's height.
 *
 * It is also the only one of our three surfaces with write access to the
 * composer: the seat is session-scoped, so it receives `inputActions` and
 * `useInput`. That is what makes one-click skill reference possible. Installing
 * does not need that access, so the same sheet is offered from both surfaces.
 */
function StripSurface({ inputActions, useInput }) {
  const state = useSkillReport()
  // Invariant for this seat (the catalog lists both props as standard), so the
  // conditional call cannot change hook order between renders.
  const draft = typeof useInput === 'function' ? useInput((input) => input.draft) : undefined

  const onUse = React.useCallback(
    (skillName) => {
      if (inputActions === undefined || typeof inputActions.setDraft !== 'function') return
      // `setDraft` REPLACES the draft. Without a readable draft we cannot append,
      // and guessing "empty" would silently destroy whatever the user had typed —
      // so an unreadable draft means "do nothing" rather than "overwrite".
      if (typeof draft !== 'string') return
      const token = `/${skillName} `
      inputActions.setDraft(draft === '' || /\s$/u.test(draft) ? draft + token : `${draft} ${token}`)
    },
    [inputActions, draft],
  )

  return h(SkillReportStrip, { state, onRefresh, onUse })
}

const inject = ['slots']

/**
 * Register one surface, never letting a failure escape.
 *
 * `slots.inject` runs its callback on a later tick, so a throw inside it is NOT
 * covered by any try/catch around `apply` — it fails this plugin's fiber, and a
 * failed client fiber surfaces as "Failed to load plugins" for the whole page.
 * A missing panel is a much better outcome than a blank shell.
 */
function contribute(ctx, slot, options, component) {
  ctx.slots.inject(slot, () => {
    try {
      return ctx.slots.register(options, component)
    } catch (error) {
      console.error(`[echocat-skill-panel] could not register into "${slot}":`, error)
      return undefined
    }
  })
}

/**
 * Client plugin body: contribute the three surfaces.
 * @param ctx - client root context.
 */
function apply(ctx) {
  if (ctx?.slots === undefined) return
  contribute(ctx, 'main', { name: 'main', key: PANEL_ID }, PanelSurface)
  contribute(
    ctx,
    'sidebar.panellist',
    { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: () => '技能调用报告' },
    SkillReportIcon,
  )
  contribute(ctx, 'conversation.input.dock', { name: 'conversation.input.dock', id: PANEL_ID, order: 40 }, StripSurface)
}

// `__*` members are the seams the bundle test drives the internals through; they
// are not part of the plugin contract.
module.exports = {
  apply,
  inject,
  PANEL_ID,
  __source: {
    refresh,
    stopPolling,
    getSnapshot,
    subscribe,
    DEFAULT_PATH,
    // Exported for the test that pins the merge contract. A write response carries no provenance, and
    // adopting it wholesale is what wiped every skill's colour — a bug that shipped because nothing asserted
    // what this function does with a response that is missing fields.
    applySkills,
    checkForUpdates,
    getUpdates,
    clearUpdates,
    // The release store's own seams, so a test can drive the two version buttons without a
    // network round trip through the host.
    checkPluginRelease,
    useRelease,
    applyRelease,
    clearRelease,
    openExternal,
  },
  __api: require('./api.js'),
  __ui: require('./panel.js'),
  __install: require('./install.js'),
  __icons: require('./icons.js'),
  __theme: require('./theme.js'),
}
