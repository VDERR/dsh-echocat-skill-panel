// Install & manage skill surfaces: the sheet, the per-skill row actions, and the
// async-result status rail.
//
// AUTHORING NOTE: bundle source, not a Node module — see panel.js.
//
// Everything here is driven by props plus two stores (api.js for the transport
// and toasts, source.js for the published snapshot), so the panel and the
// composer strip can both host the same sheet: installing needs no composer
// access, which is why the root-scoped `main` slot can offer it too.
//
// Test seam: several sub-states (`mode`, `text`, `preview`, `busy`, `error`) are
// *controlled when a prop is supplied*. That is a normal React pattern (a parent
// may pre-fill the sheet when opened from a specific affordance) and it is also
// what lets the bundle test render a specific state without a reconciler.

const React = require('react')
const { Icon } = require('./icons.js')
const api = require('./api.js')
const {
  canInstall,
  installDisabled,
  disabledReason,
  gitState,
  installModes,
  uploadLimit,
  formatBytes,
  checkSize,
  validateInstall,
  slugify,
  post,
  bodyFor,
  previewBodyFor,
  readFileBase64,
  useToasts,
  dismissToast,
  pushToast,
  performInstall,
  performUninstall,
  performUpdate,
  performClaim,
  performSetEnabled,
} = api

const h = React.createElement

/**
 * Longest accepted Chinese display name. Mirrors `DISPLAY_NAME_ZH_MAX` in
 * `src/install.js`, so an over-long value is refused in the sheet rather than
 * after a round trip.
 */
const DISPLAY_NAME_ZH_MAX = 40

const MODE_LABEL = { auto: '粘贴地址', text: '粘贴 SKILL.md', file: '上传文件', url: '从链接', git: 'Git 仓库' }
const MODE_ICON = { auto: 'link', text: 'file', file: 'upload', url: 'link', git: 'git' }
const MODE_HINT = {
  auto: '把作者给的地址整个粘进来就行：仓库主页、仓库里的文件夹链接、SKILL.md 链接，或 zip 直链；主机侧自己判断该怎么装',
  text: '整份 SKILL.md 内容，含 frontmatter 时名称与描述会自动解析',
  file: '单个 .md 或 .zip（zip 内可含脚本与资源文件）',
  url: '指向 SKILL.md 或 .zip 的直链，主机侧代为下载',
  git: 'owner/repo、完整克隆地址，或 GitHub 的 tree 链接',
}

/**
 * The tabs this sheet offers, in order.
 *
 * One address tab, not two: `auto` works out whether an address is a repository,
 * a folder inside one, a file, or a zip, so "从链接" and "Git 仓库" were the same
 * gesture wearing two hats — and the Git form asked the user to split a URL into
 * three boxes by hand.
 */
const TAB_ORDER = ['auto', 'text', 'file']

/**
 * Describe a pasted address for the user, without asking the host.
 *
 * This is a pre-flight readout, not the decision: the host re-parses the same
 * string with `detectSource` and its answer is authoritative. Keeping a local copy
 * of the rules is what lets the field say what it understood on the very first
 * keystroke instead of waiting for a round trip. Keep the two in step.
 */
function describeAddress(raw) {
  const value = String(raw ?? '').trim()
  if (value === '') return null
  if (/^[\w.-]+\/[\w.-]+$/u.test(value)) {
    return { ok: true, kind: 'GitHub 仓库', detail: value, hint: '会用仓库默认分支', ref: '', subpath: '' }
  }
  if (/^git@[^:]+:/u.test(value)) return { ok: true, kind: 'SSH 仓库', detail: value, hint: '', ref: '', subpath: '' }
  let url
  try {
    url = new URL(value)
  } catch {
    return {
      ok: false,
      kind: '',
      detail: '',
      hint: '',
      ref: '',
      subpath: '',
      message: '这不像一个地址。如果手上有整篇 SKILL.md，用「粘贴 SKILL.md」那一栏。',
    }
  }
  const fail = (message) => ({ ok: false, kind: '', detail: '', hint: '', ref: '', subpath: '', message })
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail(`只支持 http/https，收到的是 ${url.protocol}`)

  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter(Boolean)
  const marker = parts.findIndex((part) => part === 'tree' || part === 'blob')
  const forge = /(github|gitlab|bitbucket|gitee|codeberg)\./u.test(host) || host.endsWith('.sr.ht')

  if (forge && marker >= 1) {
    const segments = parts.slice(0, marker).filter((part) => part !== '-')
    if (segments.length >= 2) {
      const ref = parts[marker + 1] ?? ''
      let subpath = parts.slice(marker + 2).join('/')
      if (parts[marker] === 'blob') subpath = subpath.includes('/') ? subpath.slice(0, subpath.lastIndexOf('/')) : ''
      const detail = [segments.join('/'), ref === '' ? '' : `分支 ${ref}`, subpath === '' ? '' : `子目录 ${subpath}`].filter((p) => p !== '').join(' · ')
      return { ok: true, kind: '仓库里的位置', detail, hint: '会按这个分支和子目录克隆', ref, subpath }
    }
  }
  if (/\.zip$/iu.test(url.pathname) || host.startsWith('codeload.')) {
    return { ok: true, kind: 'zip 压缩包', detail: url.pathname.split('/').pop() ?? '', hint: '下载后解压安装', ref: '', subpath: '' }
  }
  if (/\.(md|markdown|txt)$/iu.test(url.pathname) || host.startsWith('raw.')) {
    return { ok: true, kind: 'SKILL.md 直链', detail: url.pathname.split('/').pop() ?? '', hint: '直接取这一份文件', ref: '', subpath: '' }
  }
  if (forge && parts.length >= 2) {
    return { ok: true, kind: '仓库主页', detail: `${parts[0]}/${parts[1]}`, hint: '会用仓库默认分支', ref: '', subpath: '' }
  }
  return { ok: true, kind: '直链', detail: url.hostname, hint: '先下载，再按内容判断是 SKILL.md 还是 zip', ref: '', subpath: '' }
}

/**
 * Resolve a sub-state: a supplied prop wins, otherwise local state.
 *
 * Kept in one place so every field behaves identically and the controlled path
 * can never drift from the uncontrolled one. The setter always writes local
 * state, which is simply inert while a prop controls the value.
 */
function useControlled(propValue, initial) {
  const [local, setLocal] = React.useState(initial)
  return [propValue !== undefined ? propValue : local, setLocal]
}

/* ------------------------------ status rail ------------------------------ */

/**
 * The rail itself (polish item 23). Presentational on purpose: the store lives in
 * api.js, and a container that is always mounted is what makes the live region
 * announce insertions.
 */
function StatusRail({ toasts, onDismiss, className = 'sr-rail', label = '操作结果' }) {
  const list = Array.isArray(toasts) ? toasts : []
  return h(
    'div',
    { className, role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false', 'aria-label': label },
    list.map((toast) =>
      h(
        'div',
        { key: String(toast.id), className: `sr-toast sr-toast--${toast.kind}`, 'data-code': toast.code },
        h(Icon, { name: toast.kind === 'ok' ? 'check' : toast.kind === 'error' ? 'warning' : 'clock', size: 13 }),
        h(
          'div',
          { className: 'sr-toast-main' },
          h('span', { className: 'sr-toast-msg' }, toast.message),
          toast.hint === undefined ? null : h('span', { className: 'sr-toast-hint' }, toast.hint),
        ),
        typeof onDismiss === 'function'
          ? h(
              'button',
              {
                type: 'button',
                className: 'sr-btn sr-btn--icon sr-btn--sm',
                onClick: () => onDismiss(toast.id),
                'aria-label': '关闭提示',
                title: '关闭',
              },
              h(Icon, { name: 'close', size: 11 }),
            )
          : null,
      ),
    ),
  )
}

/** Rail wired to the toast store; mounted by both surfaces. */
function LiveRail({ className }) {
  const toasts = useToasts()
  return h(StatusRail, { toasts, onDismiss: dismissToast, className: className ?? 'sr-rail' })
}

/* ------------------------------ per-skill actions ------------------------------ */

/** Copy text, preferring the async clipboard and degrading to a selection copy. */
function copyText(text, onDone) {
  const finish = (okFlag) => {
    if (okFlag) onDone()
    else pushToast({ kind: 'error', message: '复制失败，请手动选择名称' })
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(() => finish(true), () => finish(false))
      return
    }
  } catch {
    // fall through to the selection fallback
  }
  try {
    if (typeof document !== 'undefined') {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const okFlag = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
      document.body.removeChild(area)
      finish(okFlag === true)
      return
    }
  } catch {
    // fall through to the error toast
  }
  finish(false)
}

/**
 * 引用 / 复制名称 / 删除 for one card (polish items 29 + 36).
 *
 * Deleting is a two-step in-card confirm: the first click only arms, so a stray
 * click can never remove a skill. The host takes its own backup, and its path is
 * reported back through the status rail.
 */
function SkillRowActions({ skill, onUse, capability, onChanged, onEdit, update }) {
  // Which destructive action is armed right now — `''` when none. A single shared
  // flag would arm the delete button while the user was confirming an update, which
  // is exactly the stray click both confirmations exist to prevent.
  const [armed, setArmed] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  // The source claim is a two-step in-card flow too: 「标记来源」 reveals the field,
  // and nothing is written until the address is submitted.
  const [claiming, setClaiming] = React.useState(false)
  const [claimDraft, setClaimDraft] = React.useState('')
  const [claimNote, setClaimNote] = React.useState('')
  const name = String(skill?.name ?? '')
  const hasChinese = typeof skill?.displayNameZh === 'string' && skill.displayNameZh !== ''
  const provenance = skill?.provenance
  const canUpdate = api.updateable(provenance)
  const checked = update?.phase === 'done' && update?.result !== undefined && update.result !== null
  const behind = checked && update.result.hasUpdate === true
  const edited = api.locallyEdited(provenance)
  const disabled = skill?.disabled === true

  const onCopy = React.useCallback(() => {
    copyText(name, () => {
      setCopied(true)
      if (typeof setTimeout === 'function') setTimeout(() => setCopied(false), 1400)
    })
  }, [name])

  const onDelete = React.useCallback(() => {
    if (armed !== 'delete') {
      setArmed('delete')
      return
    }
    setArmed('')
    setBusy(true)
    void performUninstall(name, {
      onDone: () => {
        if (typeof onChanged === 'function') onChanged()
      },
    }).then(() => setBusy(false))
  }, [armed, name, onChanged])

  /**
   * Replace this skill with its source's current content.
   *
   * Two-step for the same reason delete is: it overwrites files. The text says what
   * actually happens — the host parks the old copy in the backup root first — and
   * when the local files were edited after the install, that is said out loud,
   * because this is the one action that discards such an edit.
   */
  const onUpdate = React.useCallback(() => {
    if (armed !== 'update') {
      setArmed('update')
      return
    }
    setArmed('')
    setBusy(true)
    void performUpdate(name, {
      // Only a user-claimed source needs the host's extra confirmation; a verified
      // one proceeds, because the update IS the action the button promised.
      confirm: provenance?.claimed === true,
      onDone: () => {
        if (typeof onChanged === 'function') onChanged()
      },
    }).then(() => setBusy(false))
  }, [armed, name, onChanged, provenance])

  const submitClaim = React.useCallback(() => {
    const verdict = api.validateClaim({ input: claimDraft, capability })
    if (verdict.ok !== true) {
      setClaimNote(verdict.message)
      return
    }
    setBusy(true)
    setClaimNote('')
    void performClaim(name, claimDraft.trim(), {
      onDone: () => {
        setClaiming(false)
        setClaimDraft('')
        if (typeof onChanged === 'function') onChanged()
      },
    }).then(() => setBusy(false))
  }, [claimDraft, capability, name, onChanged])

  /**
   * Enable / disable — ONE step, and it destroys nothing.
   *
   * The host moves the directory out of (or back into) the root DSH watches, so this is
   * the control that actually decides whether the model can load the skill. It is not
   * destructive, so unlike delete and update it needs no second click; the button's own
   * label and state carry what will happen.
   */
  const onToggleEnabled = React.useCallback(() => {
    setBusy(true)
    void performSetEnabled(name, disabled, {
      onDone: () => {
        if (typeof onChanged === 'function') onChanged()
      },
    }).then(() => setBusy(false))
  }, [disabled, name, onChanged])

  // Every action on this row writes, so one predicate gates them all.
  const writable = canInstall(capability)
  // The claim field is a ROW, not a cell in the button row: it used to be a
  // `flex-basis:100%` child of an inline-flex box, which resolves the percentage against
  // the box's shrink-to-fit width rather than the card's — so the field and its focus
  // ring overflowed the card and painted across the neighbouring tiles.
  const claimRow = claiming
    ? h(
        'div',
        { className: 'sr-claim-row' },
        h(
          'div',
          { className: 'sr-claim' },
          h('input', {
            className: 'sr-input sr-input--mono sr-claim-input',
            value: claimDraft,
            placeholder: '粘贴来源地址：仓库主页 / 文件夹链接 / 直链',
            'aria-label': `为 ${name} 标记来源地址`,
            spellCheck: 'false',
            onChange: (event) => setClaimDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitClaim()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setClaiming(false)
              }
            },
            'data-sr-focusable': 'true',
            'data-sr-autofocus': 'true',
          }),
          h('button', { type: 'button', className: 'sr-btn sr-btn--sm sr-btn--primary', onClick: submitClaim, disabled: busy }, '记录'),
          h('button', { type: 'button', className: 'sr-btn sr-btn--sm', onClick: () => setClaiming(false), disabled: busy }, '取消'),
        ),
        h('div', { className: claimNote === '' ? 'sr-help' : 'sr-help sr-help--bad' }, claimNote === '' ? '只写记录，不动文件；标记后可用「更新」按这个地址替换。' : claimNote),
      )
    : null

  return h(
    'div',
    { className: 'sr-card-foot' },
    h(
      'div',
      { className: 'sr-row-actions' },
      // Enable / disable sits FIRST among the row actions: it is the one control that
      // changes what the model can do, and it is a switch, not a destructive verb.
      writable
        ? h(
            'button',
            {
              type: 'button',
              className: disabled ? 'sr-btn sr-btn--sm sr-btn--toggle' : 'sr-btn sr-btn--sm sr-btn--toggle sr-btn--on',
              onClick: onToggleEnabled,
              disabled: busy,
              role: 'switch',
              'aria-checked': disabled ? 'false' : 'true',
              title: disabled ? `启用 ${name}（移回 skills 目录，模型就能用它）` : `停用 ${name}（移出 skills 目录，模型不再加载它；文件保留，随时可恢复）`,
              'aria-label': disabled ? `启用 ${name}` : `停用 ${name}`,
            },
            h('span', { className: 'sr-switch', 'aria-hidden': 'true' }, h('span', { className: 'sr-switch-knob' })),
          )
        : null,
      typeof onUse === 'function' && !disabled
        ? h(
            'button',
            { type: 'button', className: 'sr-btn sr-btn--sm sr-btn--primary', onClick: () => onUse(name), title: `把 /${name} 写进输入框` },
            '引用',
          )
        : null,
      h(
        'button',
        { type: 'button', className: 'sr-btn sr-btn--sm sr-btn--icon', onClick: onCopy, title: copied ? '已复制' : `复制名称 ${name}`, 'aria-label': `复制名称 ${name}` },
        h(Icon, { name: copied ? 'check' : 'copy', size: 12 }),
      ),
      copied ? h('span', { className: 'sr-pill', style: { color: 'var(--sr-ok)' } }, '已复制') : null,
      typeof onEdit === 'function' && canInstall(capability)
        ? h(
            'button',
          {
            type: 'button',
            className: 'sr-btn sr-btn--sm',
            onClick: onEdit,
            title: hasChinese ? `修改 ${name} 的中文显示名` : `给 ${name} 起个中文名`,
            'aria-label': hasChinese ? `修改 ${name} 的中文显示名` : `给 ${name} 起个中文名`,
          },
          hasChinese ? '改中文名' : '中文名',
        )
      : null,
    // Update: only for a VERIFIED recorded source. A claimed one is offered the
    // 「标记来源」 flow instead — offering "update" from an address nobody checked
    // would be a guess presented as a fact.
    canUpdate && writable
      ? h(
          'button',
          {
            type: 'button',
            className: armed === 'update' ? 'sr-btn sr-btn--sm sr-btn--danger sr-btn--armed' : behind ? 'sr-btn sr-btn--sm sr-btn--accent' : 'sr-btn sr-btn--sm',
            onClick: onUpdate,
            disabled: busy,
            title:
              armed === 'update'
                ? `再点一次：用 ${api.sourceLabel(provenance)} 的内容替换 ${name}`
                : behind
                  ? `${name} 的来源有新版本`
                  : `用 ${api.sourceLabel(provenance)} 的内容更新 ${name}`,
            'aria-label': armed === 'update' ? `确认更新 ${name}` : `更新 ${name}`,
          },
          armed === 'update' ? '确认更新' : behind ? '可更新' : '更新',
        )
      : null,
    !canUpdate && api.hasSource(provenance) !== true && writable && !claiming
      ? h(
          'button',
          {
            type: 'button',
            className: 'sr-btn sr-btn--sm sr-btn--icon',
            onClick: () => {
              setClaiming(true)
              setClaimNote('')
            },
            title: `记录 ${name} 的来源地址，之后就能检查更新`,
            'aria-label': `标记 ${name} 的来源`,
          },
          h(Icon, { name: 'link', size: 12 }),
        )
      : null,
    writable
      ? h(
          'button',
          {
            type: 'button',
            className: armed === 'delete' ? 'sr-btn sr-btn--sm sr-btn--danger sr-btn--armed' : 'sr-btn sr-btn--sm sr-btn--danger sr-btn--icon',
            onClick: onDelete,
            disabled: busy,
            title: armed === 'delete' ? '再点一次即删除' : `删除 ${name}`,
            'aria-label': armed === 'delete' ? `确认删除 ${name}` : `删除 ${name}`,
          },
          armed === 'delete' ? '确认删除' : h(Icon, { name: 'trash', size: 12 }),
        )
      : null,
    armed === 'update'
      ? h(
          'span',
          { className: 'sr-confirm' },
          edited
            ? '再点一次即更新：你改过这个 skill 的文件，更新会覆盖它们；旧副本会先备份到备份根目录。'
            : '再点一次即更新；旧副本会先备份到备份根目录。',
        )
      : null,
    armed === 'delete'
      ? h('span', { className: 'sr-confirm' }, '再点一次即删除；主机侧会先把该目录备份到备份根目录。')
      : null,
    ),
    claimRow,
  )
}

/* ------------------------------ the install sheet ------------------------------ */

/**
 * The class on the portal host appended to `document.body`.
 *
 * DELIBERATELY NOT `sr-root` ANY MORE, and that matters more than it looks. `sr-root` is the
 * PANEL FRAME class: `height:100%`, `max-width:var(--sr-max)`, a 1px border, a radius, a white
 * background. Putting it on a node that lives on `document.body` meant that if the rule which
 * neutralises the host ever failed to apply, the page gained a full-viewport-tall bordered
 * white box BELOW the app shell — a blank, scrollable page under the interface. That is exactly
 * what happened in 4.0.1: the neutraliser was generated as the descendant selector
 * `.sr-root .sr-portal-host`, which can never match the host, because the host IS a `.sr-root`
 * rather than being inside one.
 *
 * The host needs none of that frame. The tokens and base typography come from `.sr-backdrop`,
 * which is a surface root in its own right and is ALWAYS the portal's content, so the sheet
 * inherits everything it needs from there. Dropping the frame class means the worst case for a
 * future rule-loss is a zero-height empty div — the dialog stops being centred — instead of a
 * blank page.
 */
const PORTAL_HOST_CLASS = 'sr-portal-host'

/**
 * The surfaces that must NEVER receive a blur, a transform, a filter or a contain.
 *
 * Each sits on the DOM path from document.body down to .sr-backdrop, which is
 * position:fixed; inset:0. Any of those four properties turns an element into a CONTAINING
 * BLOCK for fixed-position descendants, so the dialog would size itself against that ancestor
 * instead of the viewport and stop being centred — the same failure the portal was introduced
 * to fix. .sr-strip-shell is the dangerous one in practice, because a frosted-glass shell is
 * exactly what a designer reaches for first.
 *
 * A blur on .sr-head, .sr-foot or .sr-sec-head is fine: those live INSIDE the panel and are not
 * ancestors of the backdrop.
 *
 * Listed here so a test can assert the shipped sheet never does it to them — a CSS comment
 * cannot enforce itself. (NO BACKTICKS IN THIS FILE: it is inlined into a template literal.)
 */
const NO_CONTAINING_BLOCK = ['.sr-strip-shell', '.sr-root', '.sr-rail', '.sr-portal-host']

/**
 * The one portal host, created on first use and reused for the life of the page.
 *
 * Module-level rather than per-render: this function is called on every render of the
 * sheet, and appending a fresh node each time would leak one empty `<div>` per keystroke
 * in the address field. It is never removed, because the sheet is mounted for the whole
 * life of its surface — the alternative is a ref-plus-effect dance whose only benefit is
 * deleting an empty element at page teardown.
 */
let portalHost = null

/**
 * Render into `document.body` instead of into our own subtree.
 *
 * WHY. The sheet is `position:fixed; inset:0`, which should mean "the viewport" — and it
 * did not: the strip renders the sheet as a child of `.sr-strip-shell`, which carries a
 * width cap and `overflow:hidden`, so the "full-viewport" backdrop was being laid out
 * inside a ~700px column and the dialog came out pinned to the left of the page instead
 * of centred. Any ancestor with a transform, a filter or `contain` does the same thing,
 * silently, and one of those is easy to add later by accident.
 *
 * Portalling removes the whole class of problem instead of chasing it: `document.body` is
 * the top of the tree, so the dialog is centred on the page and no future ancestor can
 * capture it. `react-dom` is a platform seed word — shipped plugins import
 * `createPortal` from it — so this costs no dependency.
 *
 * FALLBACK. Without a usable `document` or `react-dom` — the bundle test's stub, a
 * server render — the node is returned as-is. The sheet is then exactly what it was
 * before this change, so the plugin keeps working wherever there is no DOM to portal
 * into.
 */
function portal(node) {
  if (typeof document === 'undefined' || document.body === undefined || typeof document.createElement !== 'function') return node
  if (portalHost === null) {
    try {
      portalHost = document.createElement('div')
      portalHost.className = PORTAL_HOST_CLASS
      document.body.appendChild(portalHost)
    } catch {
      // A document we cannot write to is a document we do not portal into.
      portalHost = null
      return node
    }
  }
  const ReactDOM = (() => {
    try {
      return require('react-dom')
    } catch {
      return undefined
    }
  })()
  if (ReactDOM === undefined || typeof ReactDOM.createPortal !== 'function') return node
  return ReactDOM.createPortal(node, portalHost)
}

/**
 * Extract a usable slug out of an `INVALID_NAME` hint, so the fix is one click.
 * Falls back to slugifying whatever the user typed.
 */
function fixSlugFrom(error, current) {
  const hint = typeof error?.hint === 'string' ? error.hint : ''
  const tokens = hint.match(/[A-Za-z0-9][A-Za-z0-9._-]{0,63}/gu) ?? []
  const decorated = tokens.filter((token) => /[-_.]/u.test(token))
  const pick = decorated.length > 0 ? decorated[0] : tokens.find((token) => token.length > 2)
  return slugify(pick === undefined ? current : pick)
}

/** One labelled field with helper text, validation styling and a counter. */
function Field({ id, label, optional, hint, bad, counter, children }) {
  return h(
    'div',
    { className: 'sr-field' },
    h(
      'label',
      { className: 'sr-label', htmlFor: id },
      label,
      optional === true ? h('span', { className: 'sr-opt' }, '可选') : null,
    ),
    children,
    hint === undefined && counter === undefined
      ? null
      : h(
          'div',
          { className: bad === true ? 'sr-help sr-help--bad' : 'sr-help' },
          h('span', null, hint ?? ''),
          counter === undefined ? null : h('span', { className: counter.over === true ? 'sr-counter sr-counter--over' : 'sr-counter' }, counter.text),
        ),
  )
}

/**
 * The install sheet (polish items 24-28).
 *
 * @param props.open       - controlled: the parent owns the trigger.
 * @param props.onClose    - called after the exit animation.
 * @param props.capability - host capability record; drives every enablement.
 * @param props.history    - `installHistory`, newest first.
 * @param props.onInstalled- called with the success payload.
 */
function InstallSheet(props) {
  const { open, onClose, capability, history, onInstalled, onUse } = props

  const modes = installModes(capability)
  // Offer the address tab whenever the host can take an address at all: a host
  // that only advertises `url` or `git` still understands `auto` (it is the same
  // parse), and a host that advertises neither simply will not show the tab.
  const offered = modes.length > 0 ? modes : ['auto', 'text', 'file']
  const available = (() => {
    const usableTabs = TAB_ORDER.filter((tab) => offered.includes(tab) || (tab === 'auto' && (offered.includes('url') || offered.includes('git'))))
    return usableTabs.length > 0 ? usableTabs : ['text', 'file']
  })()
  const usable = canInstall(capability)
  const disabled = installDisabled(capability)
  const git = gitState(capability)

  const [modeState, setModeState] = useControlled(props.mode, props.initialMode ?? 'auto')
  const [textState, setTextState] = useControlled(props.text, '')
  const [urlState, setUrlState] = useControlled(props.url, '')
  const [repoState, setRepoState] = useControlled(props.repo, '')
  /** The branch/subdirectory overrides stay folded away until asked for. */
  const [advanced, setAdvanced] = React.useState(props.initialAdvanced === true)
  const [name, setName] = React.useState('')
  /**
   * Optional Chinese name for the panel; the slug above stays the identity.
   * Initialised from props the way `initialMode` / `initialAdvanced` are, so a
   * caller (and the tests) can start the sheet with a value already in it.
   */
  const [displayNameZh, setDisplayNameZh] = React.useState(typeof props.displayNameZh === 'string' ? props.displayNameZh : '')
  const [ref, setRef] = React.useState('')
  const [subpath, setSubpath] = React.useState('')
  const [overwrite, setOverwrite] = React.useState(false)
  const [file, setFile] = React.useState(null)
  const [fileName, setFileName] = React.useState('')
  const [fileError, setFileError] = React.useState(null)
  const [preview, setPreview] = React.useState(null)
  const [warnings, setWarnings] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [closing, setClosing] = React.useState(false)
  /**
   * Name of the skill installed by the last successful submit.
   *
   * Item 47: installing is only half the job — the user's next move is almost
   * always to use it. Keeping the name here lets the sheet's own status area offer
   * that in one click instead of letting the success toast scroll away.
   */
  const [installed, setInstalled] = React.useState(null)

  const mode = available.includes(modeState) ? modeState : available[0]
  const text = typeof textState === 'string' ? textState : ''
  const url = typeof urlState === 'string' ? urlState : ''
  const repo = typeof repoState === 'string' ? repoState : ''
  const sheetRef = React.useRef(null)
  const fileRef = React.useRef(null)

  const requestClose = React.useCallback(() => {
    if (typeof onClose !== 'function') return
    if (typeof setTimeout !== 'function') {
      onClose()
      return
    }
    setClosing(true)
    setTimeout(() => {
      try {
        setClosing(false)
        onClose()
      } catch {
        // A closed sheet whose parent already unmounted is not an error.
      }
    }, 130)
  }, [onClose])

  // Esc to close, Tab kept inside, scroll locked behind the backdrop.
  React.useEffect(() => {
    if (open !== true || typeof document === 'undefined') return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const host = sheetRef.current
      if (host === null || host === undefined || typeof host.querySelectorAll !== 'function') return
      const focusables = [...host.querySelectorAll('[data-sr-focusable]:not([disabled])')]
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (event.shiftKey === true && active === first) {
        event.preventDefault()
        last.focus()
      } else if (event.shiftKey !== true && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const autofocus = document.querySelector('[data-sr-autofocus]')
    if (autofocus !== null && typeof autofocus.focus === 'function') autofocus.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previous
    }
  }, [open, requestClose])

  const markdownLimit = capability?.limits?.markdownBytes
  const textOver = typeof markdownLimit === 'number' && text.length > markdownLimit
  const fields = { mode, text, url, repo, input: repo, name, displayNameZh, ref, subpath, file, overwrite }
  const check = validateInstall({ ...fields, capability })
  const canPreview = (mode === 'text' || mode === 'url' || mode === 'auto' || mode === 'git') && check.ok
  /** What the pasted address looks like, read locally so the field answers instantly. */
  const detected = mode === 'auto' || mode === 'url' || mode === 'git' ? describeAddress(repo) : null

  const acceptFile = React.useCallback(
    (picked) => {
      if (picked === null || picked === undefined) return
      const lower = String(picked.name ?? '').toLowerCase()
      if (!lower.endsWith('.md') && !lower.endsWith('.markdown') && !lower.endsWith('.zip')) {
        setFile(null)
        setFileName('')
        setFileError({ code: 'BAD_ARCHIVE', message: `只支持 .md 或 .zip，收到的是 ${picked.name ?? '未知文件'}` })
        return
      }
      const size = checkSize(picked.size, capability)
      if (!size.ok) {
        setFile(null)
        setFileName(String(picked.name ?? ''))
        setFileError({ code: 'TOO_LARGE', message: size.message })
        return
      }
      setFileError(null)
      setFile(picked)
      setFileName(String(picked.name ?? ''))
      setPreview(null)
      setError(null)
    },
    [capability],
  )

  const runPreview = React.useCallback(() => {
    if (!check.ok) {
      setError({ code: check.code, message: check.message })
      return
    }
    setBusy(true)
    setError(null)
    void post(previewBodyFor(mode, fields)).then((result) => {
      setBusy(false)
      if (result.ok === true) {
        setPreview(result.data.preview ?? null)
        setWarnings(Array.isArray(result.data.warnings) ? result.data.warnings : [])
      } else {
        setError(result.error)
      }
    })
  }, [check.ok, check.code, check.message, mode, fields, setError, setPreview, setWarnings, setBusy])

  const submit = React.useCallback(() => {
    if (!check.ok) {
      setError({ code: check.code, message: check.message })
      return
    }
    setBusy(true)
    setError(null)
    setInstalled(null)
    const finish = (result) => {
      setBusy(false)
      if (result.ok === true) {
        setPreview(null)
        setWarnings([])
        setError(null)
        setTextState('')
        setFile(null)
        setFileName('')
        const name = result.data?.skill?.name
        setInstalled(typeof name === 'string' && name !== '' ? name : null)
        if (typeof onInstalled === 'function') onInstalled(result.data)
      } else {
        setError(result.error)
      }
    }
    if (mode !== 'file') {
      void performInstall(bodyFor(mode, fields)).then(finish)
      return
    }
    void readFileBase64(file).then((read) => {
      if (read.ok !== true) {
        setBusy(false)
        setError(read.error)
        return
      }
      const body = bodyFor('file', { ...fields, filename: fileName, dataBase64: read.dataBase64 })
      void performInstall(body).then(finish)
    })
  }, [check.ok, check.code, check.message, mode, fields, file, fileName, onInstalled])

  const onTabKeyDown = React.useCallback(
    (event) => {
      const index = available.indexOf(mode)
      if (index < 0) return
      let next = null
      if (event.key === 'ArrowRight') next = (index + 1) % available.length
      else if (event.key === 'ArrowLeft') next = (index - 1 + available.length) % available.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = available.length - 1
      if (next === null) return
      event.preventDefault()
      setModeState(available[next])
    },
    [available, mode, setModeState],
  )

  if (open !== true) return null

  const body = []
  if (disabled) {
    body.push(
      h(
        'div',
        { key: 'off', className: 'sr-note sr-note--warn' },
        h(Icon, { name: 'ban', size: 13 }),
        h(
          'div',
          { className: 'sr-note-body' },
          h('span', null, '当前主机侧关闭了安装能力'),
          h('span', { className: 'sr-note-hint' }, disabledReason(capability)),
        ),
      ),
    )
  } else {
    body.push(
      h(
        'div',
        { key: 'tabs', className: 'sr-tabs', role: 'tablist', 'aria-label': '安装方式' },
        h(
          'div',
          { className: 'sr-tab-track' },
          // No position-measured indicator element: the selected tab draws its own
          // underline as a `::after` pseudo-element (see .sr-tab[aria-selected] in
          // theme.js), so the marker is exact by construction and cannot drift when
          // a label changes width or a mode is added.
          available.map((item) =>
            h(
              'button',
              {
                key: item,
                type: 'button',
                role: 'tab',
                id: `sr-tab-${item}`,
                className: 'sr-tab',
                'aria-selected': item === mode,
                'aria-controls': `sr-panel-${item}`,
                disabled: item === 'git' && git === 'unavailable',
                title: item === 'git' && git === 'unavailable' ? '主机侧没有可用的 git' : MODE_HINT[item],
                onClick: () => setModeState(item),
                onKeyDown: onTabKeyDown,
                'data-sr-focusable': 'true',
              },
              h(Icon, { name: MODE_ICON[item] ?? 'file', size: 12 }),
              MODE_LABEL[item] ?? item,
            ),
          ),
        ),
      ),
    )

    const panel = []
    panel.push(h('div', { key: 'modehint', className: 'sr-note sr-note--info' }, h(Icon, { name: 'info', size: 12 }), h('div', { className: 'sr-note-body' }, h('span', null, MODE_HINT[mode]))))

    if (mode === 'text') {
      panel.push(
        h(
          Field,
          {
            key: 'text',
            id: 'sr-install-text',
            label: 'SKILL.md 内容',
            hint: '含 YAML frontmatter 时会自动读取 name / description',
            counter: { text: `${text.length}${typeof markdownLimit === 'number' ? ` / ${markdownLimit}` : ''} 字符`, over: textOver },
            bad: textOver || (text.length > 0 && check.message !== undefined && check.code === 'TOO_LARGE'),
          },
          h('textarea', {
            id: 'sr-install-text',
            className: 'sr-textarea',
            value: text,
            spellCheck: false,
            placeholder: '---\nname: my-skill\ndescription: ...\n---\n\n# my-skill\n…',
            onChange: (event) => setTextState(event.target.value),
            'data-sr-focusable': 'true',
            'data-sr-autofocus': 'true',
            'aria-invalid': textOver ? 'true' : undefined,
          }),
        ),
      )
    }

    if (mode === 'file') {
      panel.push(
        h(
          'div',
          { key: 'drop', className: 'sr-field' },
          h('span', { className: 'sr-label' }, 'skill 文件'),
          h(
            'div',
            {
              className: dragOver ? 'sr-drop sr-drop--over' : 'sr-drop',
              onDragOver: (event) => {
                event.preventDefault()
                setDragOver(true)
              },
              onDragEnter: (event) => {
                event.preventDefault()
                setDragOver(true)
              },
              onDragLeave: () => setDragOver(false),
              onDrop: (event) => {
                event.preventDefault()
                setDragOver(false)
                const dropped = event.dataTransfer?.files?.[0]
                acceptFile(dropped)
              },
            },
            h(Icon, { name: 'upload', size: 20 }),
            h('span', { className: 'sr-drop-title' }, dragOver ? '松开即可选择' : '把 .md 或 .zip 拖到这里'),
            h(
              'button',
              { type: 'button', className: 'sr-btn', onClick: () => fileRef.current?.click?.(), 'data-sr-focusable': 'true' },
              h(Icon, { name: 'folder', size: 12 }),
              '选择文件',
            ),
            h('input', {
              ref: fileRef,
              id: 'sr-install-file',
              className: 'sr-sr-only',
              type: 'file',
              accept: '.md,.markdown,.zip,text/markdown,application/zip',
              onChange: (event) => acceptFile(event.target.files?.[0]),
              'data-sr-focusable': 'true',
            }),
            fileName === ''
              ? null
              : h(
                  'span',
                  { className: 'sr-help' },
                  h('span', null, fileName),
                  h('span', { className: 'sr-counter' }, file === null ? '' : formatBytes(file.size ?? 0)),
                ),
          ),
        ),
      )
    }

    if (mode === 'auto' || mode === 'url' || mode === 'git') {
      // ONE field. Everything else about the address — repo, branch, subdirectory —
      // is inferred by the host from the URL itself, because that is exactly what
      // the author published and what the user copied out of their browser.
      panel.push(
        h(
          Field,
          {
            key: 'address',
            id: 'sr-install-address',
            label: '地址',
            hint: '仓库主页 / 文件夹链接 / SKILL.md 链接 / zip 直链，直接粘贴即可',
          },
          h('input', {
            id: 'sr-install-address',
            className: 'sr-input sr-input--mono',
            type: 'text',
            value: repo,
            placeholder: 'https://github.com/owner/repo/tree/main/skills/my-skill',
            onChange: (event) => setRepoState(event.target.value),
            'data-sr-focusable': 'true',
            'data-sr-autofocus': 'true',
            spellCheck: 'false',
            autoComplete: 'off',
          }),
        ),
      )
      if (detected !== null) {
        panel.push(
          h(
            'div',
            { key: 'detected', className: detected.ok ? 'sr-note sr-note--info' : 'sr-note sr-note--warn' },
            h(Icon, { name: detected.ok ? 'check' : 'info', size: 12 }),
            h(
              'div',
              { className: 'sr-note-body' },
              h('span', null, detected.ok ? `识别为${detected.kind}${detected.detail === '' ? '' : ` · ${detected.detail}`}` : detected.message),
              detected.ok && detected.hint !== '' ? h('span', { className: 'sr-note-hint' }, detected.hint) : null,
            ),
          ),
        )
      }
      if (advanced) {
        panel.push(
          h(
            'div',
            { key: 'advanced', className: 'sr-field-row' },
            h(
              Field,
              { id: 'sr-install-ref', label: '分支 / 标签', optional: true, hint: '留空则用仓库默认分支' },
              h('input', { id: 'sr-install-ref', className: 'sr-input sr-input--mono', value: ref, placeholder: 'main', onChange: (event) => setRef(event.target.value), 'data-sr-focusable': 'true' }),
            ),
            h(
              Field,
              { id: 'sr-install-subpath', label: '子目录', optional: true, hint: '仓库里 skill 所在目录' },
              h('input', { id: 'sr-install-subpath', className: 'sr-input sr-input--mono', value: subpath, placeholder: 'skills/my-skill', onChange: (event) => setSubpath(event.target.value), 'data-sr-focusable': 'true' }),
            ),
          ),
        )
      } else {
        panel.push(
          h(
            'button',
            {
              key: 'more',
              type: 'button',
              className: 'sr-btn sr-btn--sm',
              onClick: () => setAdvanced(true),
              'data-sr-focusable': 'true',
            },
            h(Icon, { name: 'caret', size: 11 }),
            detected !== null && detected.ok && (detected.ref !== '' || detected.subpath !== '') ? '识别到的分支 / 子目录不对？手动指定' : '手动指定分支 / 子目录',
          ),
        )
      }
      if (git === 'unknown') {
        panel.push(h('div', { key: 'gitprobe', className: 'sr-note sr-note--info' }, h(Icon, { name: 'clock', size: 12 }), h('div', { className: 'sr-note-body' }, h('span', null, 'git 可用性检测中…'))))
      }
      if (git === 'unavailable') {
        panel.push(
          h(
            'div',
            { key: 'gitoff', className: 'sr-note sr-note--warn' },
            h(Icon, { name: 'warning', size: 12 }),
            h('div', { className: 'sr-note-body' }, h('span', null, '当前主机侧没有可用的 git'), h('span', { className: 'sr-note-hint' }, '粘贴 SKILL.md 或上传文件仍然可以装；仓库与 zip 链接需要 git 才能拉取。')),
          ),
        )
      }
    }

    // Rendered for EVERY mode, beside the install name: the two are the same kind
    // of field (identity vs. what the panel prints), so they belong together rather
    // than repeated inside each tab's panel.
    panel.push(
      h(
        Field,
        { key: 'name', id: 'sr-install-name', label: '安装名称', optional: true, hint: '留空则由 frontmatter / 文件名推导；必须是可作为目录名的 slug' },
        h('input', {
          id: 'sr-install-name',
          className: 'sr-input sr-input--mono',
          value: name,
          placeholder: 'my-skill',
          onChange: (event) => setName(event.target.value),
          'data-sr-focusable': 'true',
        }),
      ),
    )

    panel.push(
      h(
        Field,
        {
          key: 'displayNameZh',
          id: 'sr-install-display-zh',
          label: '中文显示名',
          optional: true,
          hint: '写进 skill 的 meta.yaml（display-name-zh），面板按它显示中文；留空则用英文或自动翻译',
          counter: { text: `${[...displayNameZh].length} / ${DISPLAY_NAME_ZH_MAX}`, over: [...displayNameZh].length > DISPLAY_NAME_ZH_MAX },
          bad: displayNameZh.length > 0 && !/^[^\u0000-\u001f\u007f]*$/u.test(displayNameZh),
        },
        h('input', {
          id: 'sr-install-display-zh',
          className: 'sr-input',
          value: displayNameZh,
          placeholder: '3D动画短片生成器',
          onChange: (event) => setDisplayNameZh(event.target.value),
          'data-sr-focusable': 'true',
        }),
      ),
    )

    if (preview !== null) {
      panel.push(
        h(
          'div',
          { key: 'preview', className: 'sr-preview' },
          h(
            'div',
            { className: 'sr-preview-top' },
            h(Icon, { name: 'spark', size: 13 }),
            h('span', { className: 'sr-preview-name' }, preview.name ?? '（未命名）'),
            preview.exists === true ? h('span', { className: 'sr-pill' }, '已存在') : null,
          ),
          typeof preview.description === 'string' && preview.description !== '' ? h('div', { className: 'sr-preview-desc' }, preview.description) : null,
          h(
            'div',
            { className: 'sr-preview-meta' },
            h('span', null, `文件 ${preview.files ?? 1} 个`),
            preview.hadFrontmatter === true ? h('span', null, '含 frontmatter') : null,
            typeof preview.kind === 'string' ? h('span', null, `类型 ${preview.kind}`) : null,
            typeof preview.bytes === 'number' ? h('span', null, formatBytes(preview.bytes)) : null,
            typeof preview.finalUrl === 'string' ? h('span', { title: preview.finalUrl }, '已跟随重定向') : null,
          ),
          preview.exists === true
            ? h(
                'label',
                { className: 'sr-check' },
                h('input', { type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked), 'data-sr-focusable': 'true' }),
                `覆盖已存在的 ${preview.name ?? ''}`,
              )
            : null,
        ),
      )
    }

    if (warnings.length > 0) {
      panel.push(
        h(
          'div',
          { key: 'warn', className: 'sr-note sr-note--warn' },
          h(Icon, { name: 'warning', size: 12 }),
          h('div', { className: 'sr-note-body' }, ...warnings.map((warning, i) => h('span', { key: i, className: 'sr-note-hint' }, String(warning)))),
        ),
      )
    }

    // Item 47: report the finished install AND the one action that follows it.
    // This is the sheet's own status area, so no new surface is invented, and the
    // button is absent when the seat that mounted us cannot reach the draft (the
    // centre panel is root-scoped and never receives `onUse`).
    if (installed !== null) {
      panel.push(
        h(
          'div',
          { key: 'done', className: 'sr-note sr-note--ok' },
          h(Icon, { name: 'check', size: 12 }),
          h(
            'div',
            { className: 'sr-note-body' },
            h('span', null, `已安装 ${installed}`),
            typeof onUse === 'function'
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'sr-btn sr-btn--sm sr-btn--primary',
                    'data-sr-insert': installed,
                    onClick: () => {
                      // The parent owns the token shape (`/name ` + append rules);
                      // this only supplies the name.
                      onUse(installed)
                      requestClose()
                    },
                  },
                  h(Icon, { name: 'plus', size: 11 }),
                  `写入输入框 /${installed}`,
                )
              : h('span', { className: 'sr-note-hint' }, '在输入框上方的横栏里点「引用」可以把它写进对话。'),
          ),
        ),
      )
    }

    if (fileError !== null) {
      panel.push(
        h(
          'div',
          { key: 'fileerr', className: 'sr-note sr-note--error' },
          h(Icon, { name: 'warning', size: 12 }),
          h('div', { className: 'sr-note-body' }, h('span', null, fileError.message)),
        ),
      )
    }

    if (error !== null && error !== undefined) {
      const needsName = error.code === 'INVALID_NAME'
      panel.push(
        h(
          'div',
          { key: 'err', className: 'sr-note sr-note--error' },
          h(Icon, { name: 'warning', size: 12 }),
          h(
            'div',
            { className: 'sr-note-body' },
            h('span', null, error.message),
            error.hint === undefined ? null : h('span', { className: 'sr-note-hint' }, error.hint),
            needsName
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'sr-btn sr-btn--sm',
                    onClick: () => {
                      setName(fixSlugFrom(error, name))
                      setError(null)
                    },
                  },
                  `改用 ${fixSlugFrom(error, name)}`,
                )
              : null,
            error.code === 'NEEDS_CONFIRM'
              ? h(
                  'label',
                  { className: 'sr-check' },
                  h('input', { type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked) }),
                  '允许覆盖后重试',
                )
              : null,
            error.code === 'NAME_TAKEN'
              ? h(
                  'label',
                  { className: 'sr-check' },
                  h('input', { type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked) }),
                  '覆盖同名 skill',
                )
              : null,
          ),
        ),
      )
    }

    panel.push(
      h(
        'div',
        { key: 'actions', className: 'sr-field-row' },
        mode === 'text' || mode === 'url' || mode === 'auto'
          ? h(
              'button',
              { type: 'button', className: 'sr-btn', onClick: runPreview, disabled: busy || !canPreview, 'data-sr-focusable': 'true' },
              h(Icon, { name: 'search', size: 12 }),
              '预览',
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'sr-btn sr-btn--primary',
            onClick: submit,
            disabled: busy || !check.ok,
            title: check.ok ? '' : check.message,
            'data-sr-focusable': 'true',
          },
          h(Icon, { name: busy ? 'refresh' : 'plus', size: 12, className: busy ? 'sr-ic sr-spin' : 'sr-ic' }),
          busy ? '处理中…' : mode === 'file' ? '选择并安装' : '安装',
        ),
      ),
    )

    if (Array.isArray(history) && history.length > 0) {
      panel.push(
        h(
          'div',
          { key: 'hist', className: 'sr-field' },
          h('span', { className: 'sr-label' }, '最近操作'),
          h(
            'div',
            { className: 'sr-hist' },
            history.slice(0, 5).map((entry, i) =>
              h(
                'div',
                { key: `${entry.at}-${i}`, className: 'sr-hist-row' },
                h(Icon, { name: entry.ok === true ? 'check' : 'warning', size: 11 }),
                h('span', { className: 'sr-hist-name' }, String(entry.name ?? '')),
                h('span', { className: 'sr-hist-msg' }, String(entry.message ?? entry.code ?? entry.action ?? '')),
                typeof entry.ms === 'number' ? h('span', null, `${entry.ms} ms`) : null,
              ),
            ),
          ),
        ),
      )
    }

    panel.push(h('span', { key: 'chkmsg', className: check.ok ? 'sr-help' : 'sr-help sr-help--bad' }, check.ok ? `上限 ${formatBytes(uploadLimit(capability) ?? 0)}` : check.message ?? ''))

    body.push(
      h(
        'div',
        { key: 'panel', className: 'sr-sheet-body', id: `sr-panel-${mode}`, role: 'tabpanel', 'aria-labelledby': `sr-tab-${mode}` },
        ...panel,
      ),
    )
  }

  return portal(
    h(
      'div',
      {
        className: closing ? 'sr-backdrop sr-backdrop--closing' : 'sr-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) requestClose()
        },
      },
      h(
        'div',
        { className: 'sr-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '安装 skill', ref: sheetRef },
        h(
          'div',
          { className: 'sr-sheet-head' },
          h(Icon, { name: 'layers', size: 15 }),
          h(
            'div',
            { className: 'sr-sheet-title' },
            h('div', null, '安装 skill'),
            h('div', { className: 'sr-sheet-sub' }, usable ? `写入目录 ${capability?.root ?? '未知'}` : disabledReason(capability)),
          ),
          h(
            'button',
            { type: 'button', className: 'sr-btn sr-btn--icon', onClick: requestClose, 'aria-label': '关闭安装面板', title: '关闭（Esc）', 'data-sr-focusable': 'true' },
            h(Icon, { name: 'close', size: 13 }),
          ),
        ),
        ...body,
        h(
          'div',
          { className: 'sr-sheet-foot' },
          h('span', { className: 'sr-sheet-foot-note' }, usable ? '安装前主机侧会做路径与大小校验；同名覆盖会先备份。' : disabledReason(capability)),
          h('button', { type: 'button', className: 'sr-btn', onClick: requestClose, 'data-sr-focusable': 'true' }, '关闭'),
        ),
      ),
    ),
  )
}

module.exports = { InstallSheet, SkillRowActions, StatusRail, LiveRail, copyText, fixSlugFrom, MODE_LABEL, MODE_ICON }
