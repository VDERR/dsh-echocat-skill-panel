// One bounded renderer per visible plugin surface. No host APIs or business state.
const React = require('react')
const background = require('./background-store.js')

const VERTEX = `attribute vec2 a_position;
varying vec2 v_uv;
void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`

// Periodic domain-warped height field with a broad reflected band and a thin rim.
// Every time term is an integer harmonic of the same 18-second cycle.
const FRAGMENT = `precision mediump float;
varying vec2 v_uv;
uniform float u_phase;
uniform float u_dark;
uniform float u_aspect;
uniform vec3 u_pointer;
uniform vec3 u_primary;
uniform vec3 u_secondary;
uniform vec3 u_highlight;
uniform float u_amplitude;
uniform float u_shine;
float surface(vec2 p){
  vec2 q=p+u_amplitude*vec2(.23*sin(p.y*2.1+u_phase),.21*cos(p.x*1.7-u_phase));
  q+=.12*u_amplitude*vec2(cos(q.y*3.2-u_phase),sin(q.x*2.6+u_phase));
  return sin(q.x*2.2+q.y*1.3+.32*sin(u_phase))*.58
    +cos(q.y*3.1-q.x*.7+.42*cos(u_phase))*.34
    +sin(q.x*1.2-q.y*2.3+u_phase)*.18;
}
void main(){
  vec2 uv=vec2(v_uv.x,1.-v_uv.y);
  vec2 p=(uv-.5)*vec2(min(u_aspect,2.4)*2.,2.6);
  vec2 delta=uv-u_pointer.xy;
  float influence=exp(-dot(delta*vec2(u_aspect,1.),delta*vec2(u_aspect,1.))*19.)*u_pointer.z;
  p+=delta*.11*influence;
  float f=surface(p);
  float dx=(surface(p+vec2(.012,0.))-f)/.012;
  float dy=(surface(p+vec2(0.,.012))-f)/.012;
  vec3 normal=normalize(vec3(-dx*.48,-dy*.48,1.));
  float reflected=dot(normal,normalize(vec3(-.45,.65,1.)));
  float broad=pow(max(reflected,0.),8.);
  float ribbon=exp(-pow((f-.16)*5.5,2.));
  float edge=exp(-pow((f-.31)*22.,2.));
  float valley=exp(-pow((f+.05)*7.,2.));
  vec3 base=mix(u_primary,u_secondary,.28+.14*sin(p.x*.7+u_phase));
  base=mix(base,u_highlight,.08+.04*sin(p.y*.7-u_phase));
  vec3 light=base+(broad*.10+ribbon*.032+edge*.009-valley*.02)*u_shine;
  light+=vec3(-.009,.008,.012)*influence;
  vec3 night=mix(base*.28,vec3(.075,.105,.16),.42);
  night+=(broad*.075+ribbon*.03+edge*.012)*u_shine*u_highlight;
  gl_FragColor=vec4(mix(light,night,u_dark),1.);
}`

const controls = 'button,[role="button"],.sr-tab,.sr-seg-btn'
const activeSurfaces = new Set()
let clockFrame = 0
let previousFrame = 0
let clockOrigin = null

function tick(now) {
  clockFrame = 0
  if (clockOrigin === null) clockOrigin = now
  if (now - previousFrame >= 1000 / 30) {
    previousFrame = now
    const phase = (now - clockOrigin) / 18000 * Math.PI * 2
    for (const renderer of activeSurfaces) renderer(phase)
  }
  if (activeSurfaces.size) clockFrame = requestAnimationFrame(tick)
}
function schedule(renderer, running) {
  if (running) activeSurfaces.add(renderer)
  else activeSurfaces.delete(renderer)
  if (activeSurfaces.size && !clockFrame) clockFrame = requestAnimationFrame(tick)
  if (!activeSurfaces.size && clockFrame) {
    cancelAnimationFrame(clockFrame)
    clockFrame = 0
  }
}

function mountLiquid(root) {
  if (!root || typeof root.appendChild !== 'function' || typeof window === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.className = 'sr-liquid-field'
  canvas.setAttribute('aria-hidden', 'true')
  root.setAttribute('data-sr-liquid', 'true')
  const layer = document.createElement('div')
  const shade = document.createElement('div')
  layer.className = 'sr-background-layer'
  shade.className = 'sr-background-shade'
  layer.setAttribute('aria-hidden', 'true')
  shade.setAttribute('aria-hidden', 'true')
  root.appendChild(layer)
  root.appendChild(canvas)
  root.appendChild(shade)
  let settings = background.getSnapshot().settings
  let palette = []
  let flowPhase = 0
  let lastClock = null
  let gl = null
  let contextLost = false
  let program = null
  let buffer = null
  const shaders = []
  let width = 1
  let height = 1
  let dark = 0
  let disposed = false
  let visible = true
  let sized = false
  let hoveredControl = null
  let pressedControl = null
  let pressTimer = null
  let interactionFrame = 0
  let lastPointer = null
  let pointer = [0.5, 0.5, 0]
  const targetPointer = [0.5, 0.5, 0]
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const scheme = window.matchMedia?.('(prefers-color-scheme: dark)')
  let uniforms = null
  let lastPhase = 0

  function compile(type, source) {
    const shader = gl.createShader(type)
    shaders.push(shader)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('liquid shader compilation failed')
    return shader
  }
  function releaseGPU() {
    if (!gl) return
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
    for (const shader of shaders.splice(0)) gl.deleteShader(shader)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    gl = null
  }
  try {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (gl) {
      program = gl.createProgram()
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('liquid shader linking failed')
      gl.useProgram(program)
      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
      const position = gl.getAttribLocation(program, 'a_position')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
      uniforms = Object.fromEntries(['phase','dark','aspect','pointer','primary','secondary','highlight','amplitude','shine'].map(key => [key,gl.getUniformLocation(program, `u_${key}`)]))
    }
  } catch {
    releaseGPU()
  }
  root.setAttribute('data-sr-renderer', gl ? 'webgl' : 'static')

  function draw(phase = 0) {
    if (disposed || !gl || contextLost || !sized) return
    lastPhase = phase
    const delta = lastClock === null ? 0 : Math.max(0, Math.min(.25, phase - lastClock))
    lastClock = phase
    flowPhase = (flowPhase + delta * settings.speed / 100) % (Math.PI * 2)
    const materialPhase = settings.animate && !motion?.matches ? flowPhase : 0
    pointer = pointer.map((value, i) => value + (targetPointer[i] - value) * .12)
    gl.uniform1f(uniforms.phase, materialPhase)
    gl.uniform1f(uniforms.dark, dark)
    gl.uniform1f(uniforms.aspect, width / height)
    gl.uniform3f(uniforms.pointer, ...pointer)
    for (let i = 0; i < 3; i++) gl.uniform3f(uniforms[['primary','secondary','highlight'][i]], ...palette[i])
    gl.uniform1f(uniforms.amplitude, settings.amplitude / 100)
    gl.uniform1f(uniforms.shine, settings.shine / 50)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    // The mark uses the same global phase, without its own animation loop.
    root.style.setProperty('--sr-reflection', `${45 + 22 * Math.sin(materialPhase)}%`)
  }
  function sync() {
    const shown = root.getClientRects().length > 0 && window.getComputedStyle(root).visibility !== 'hidden'
    const running = Boolean(settings.mode === 'liquid' && settings.animate && gl && !contextLost && shown && visible && sized && !document.hidden && !motion?.matches)
    root.setAttribute('data-sr-motion', running ? 'running' : 'paused')
    schedule(draw, running)
    if (settings.mode === 'liquid' && visible && sized && !document.hidden) draw(motion?.matches ? 0 : lastPhase)
  }
  function resize() {
    width = root.clientWidth
    height = root.clientHeight
    sized = width > 0 && height > 0
    const scale = Math.min(window.devicePixelRatio || 1, 1.25, 1100 / Math.max(width, height, 1))
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    for (const node of [layer, shade]) { node.style.width = `${width}px`; node.style.height = `${height}px` }
    gl?.viewport(0, 0, canvas.width, canvas.height)
    scroll()
    sync()
  }
  function theme() {
    const explicit = root.closest('[data-theme],[data-dsw-theme],.dark,.light')
    const value = explicit?.getAttribute('data-theme') || explicit?.getAttribute('data-dsw-theme')
    dark = explicit ? Number(value === 'dark' || (!value && explicit.classList.contains('dark'))) : Number(Boolean(scheme?.matches))
    if (settings.theme !== 'auto') dark = Number(settings.theme === 'dark')
    root.setAttribute('data-sr-theme', dark ? 'dark' : 'light')
    root.style.setProperty('--sr-text-halo', dark ? 'rgba(10,18,30,.94)' : 'rgba(255,255,255,.94)')
    const veil = settings.veil / 100
    shade.style.backgroundColor = dark ? 'rgba(13,23,37,' + veil + ')' : 'rgba(249,251,255,' + veil + ')'
    root.style.setProperty('--sr-control-highlight', dark ? 'rgba(179,207,248,.19)' : 'rgba(255,255,255,.65)')
    root.style.setProperty('--sr-glass', dark ? 'rgba(29,43,62,.90)' : 'rgba(249,252,255,.88)')
    root.style.setProperty('--sr-accent', 'color-mix(in srgb,' + settings.secondary + (dark ? ' 35%,#d8e5ff)' : ' 28%,#1b3964)'))
    root.style.setProperty('--sr-accent-weak', 'color-mix(in srgb,' + settings.secondary + ' 22%,transparent)')
    sync()
  }
  function scroll() { for (const node of [canvas, layer, shade]) node.style.transform = 'translateY(' + (root.scrollTop || 0) + 'px)' }
  function appearance() {
    const snapshot = background.getSnapshot()
    settings = snapshot.settings
    palette = [settings.primary, settings.secondary, settings.highlight].map(color => [1,3,5].map(start => parseInt(color.slice(start,start+2),16)/255))
    root.setAttribute('data-sr-background', settings.mode)
    root.setAttribute('data-sr-background-image', snapshot.image ? 'true' : 'false')
    canvas.style.display = settings.mode === 'liquid' ? '' : 'none'
    layer.style.backgroundColor = settings.primary
    layer.style.backgroundImage = (settings.mode === 'gradient' || (settings.mode === 'liquid' && (!gl || contextLost)))
      ? 'linear-gradient(' + settings.angle + 'deg,' + settings.primary + ',' + settings.secondary + ' 65%,' + settings.highlight + ')'
      : settings.mode === 'image' && snapshot.imageUrl ? 'url("' + snapshot.imageUrl + '")' : 'none'
    layer.style.backgroundSize = settings.fit === 'stretch' ? '100% 100%' : settings.fit
    layer.style.backgroundPosition = settings.positionX + '% ' + settings.positionY + '%'
    const filter = 'brightness(' + settings.brightness/100 + ') saturate(' + settings.saturation/100 + ') contrast(' + (settings.mode === 'solid' ? 1 : settings.contrast/100) + ') blur(' + (settings.mode === 'solid' ? 0 : settings.softness*.3) + 'px)'
    canvas.style.filter = filter
    layer.style.filter = filter
    targetPointer[2] = 0
    pointer = [.5,.5,0]
    resetControl()
    theme()
  }
  function resetControl() {
    if (!hoveredControl) return
    hoveredControl.style.removeProperty('--sr-pointer-x')
    hoveredControl.style.removeProperty('--sr-pointer-y')
    hoveredControl = null
  }
  function move(event) {
    if (motion?.matches || settings.mode !== 'liquid' || !settings.pointer) return
    lastPointer = event
    if (interactionFrame) return
    interactionFrame = requestAnimationFrame(() => {
      interactionFrame = 0
      if (disposed || !lastPointer) return
      const rect = root.getBoundingClientRect()
      targetPointer[0] = (lastPointer.clientX - rect.left) / Math.max(rect.width, 1)
      targetPointer[1] = (lastPointer.clientY - rect.top) / Math.max(rect.height, 1)
      targetPointer[2] = 1
      if (!settings.animate) { pointer = [...targetPointer]; draw(lastPhase) }
      const control = lastPointer.target?.closest?.(controls)
      if (control !== hoveredControl) resetControl()
      if (control && root.contains(control) && !control.disabled) {
        hoveredControl = control
        const bounds = control.getBoundingClientRect()
        control.style.setProperty('--sr-pointer-x', `${lastPointer.clientX - bounds.left}px`)
        control.style.setProperty('--sr-pointer-y', `${lastPointer.clientY - bounds.top}px`)
      }
    })
  }
  function leave() { targetPointer[2] = 0; resetControl(); lastPointer = null; if (!settings.animate) { pointer = [...targetPointer]; draw(lastPhase) } }
  function releasePress() {
    if (pressTimer !== null) clearTimeout(pressTimer)
    pressTimer = null
    pressedControl?.removeAttribute('data-sr-pressed')
    pressedControl = null
  }
  function press(event) {
    const control = event.target?.closest?.(controls)
    if (!control || !root.contains(control) || control.disabled) return
    releasePress()
    pressedControl = control
    control.setAttribute('data-sr-pressed', 'true')
    pressTimer = setTimeout(releasePress, 220)
  }
  function lost() { contextLost = true; schedule(draw, false); canvas.style.opacity = '0'; root.setAttribute('data-sr-renderer', 'static'); root.setAttribute('data-sr-motion', 'paused'); appearance() }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
  resizeObserver?.observe(root)
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting)
    sync()
  }) : null
  intersection?.observe(root)
  // Observe theme attributes only on the ancestor chain, never the host subtree.
  const mutation = typeof MutationObserver === 'function' ? new MutationObserver(theme) : null
  for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
    mutation?.observe(ancestor, { attributes: true, attributeFilter: ['class','data-theme','data-dsw-theme','hidden','style'] })
  }
  root.addEventListener('pointermove', move, { passive: true })
  root.addEventListener('pointerleave', leave, { passive: true })
  root.addEventListener('pointerdown', press, { passive: true })
  root.addEventListener('scroll', scroll, { passive: true })
  canvas.addEventListener('webglcontextlost', lost)
  document.addEventListener('visibilitychange', sync)
  motion?.addEventListener?.('change', sync)
  scheme?.addEventListener?.('change', theme)
  if (!resizeObserver) window.addEventListener('resize', resize)
  const unsubscribeBackground = background.subscribe(appearance)
  appearance()
  resize()
  void background.load()

  return () => {
    disposed = true
    unsubscribeBackground()
    schedule(draw, false)
    if (interactionFrame) cancelAnimationFrame(interactionFrame)
    releasePress()
    resetControl()
    resizeObserver?.disconnect()
    intersection?.disconnect()
    mutation?.disconnect()
    root.removeEventListener('pointermove', move)
    root.removeEventListener('pointerleave', leave)
    root.removeEventListener('pointerdown', press)
    root.removeEventListener('scroll', scroll)
    canvas.removeEventListener('webglcontextlost', lost)
    document.removeEventListener('visibilitychange', sync)
    motion?.removeEventListener?.('change', sync)
    scheme?.removeEventListener?.('change', theme)
    if (!resizeObserver) window.removeEventListener('resize', resize)
    releaseGPU()
    canvas.remove()
    layer.remove()
    shade.remove()
    for (const name of ['data-sr-liquid','data-sr-renderer','data-sr-motion','data-sr-theme','data-sr-background','data-sr-background-image']) root.removeAttribute(name)
    for (const name of ['--sr-reflection','--sr-text-halo','--sr-glass','--sr-accent','--sr-accent-weak','--sr-control-highlight']) root.style.removeProperty(name)
  }
}

function useLiquidSurface(ref, enabled = true) {
  React.useEffect(() => enabled ? mountLiquid(ref.current) : undefined, [ref, enabled])
}

// Keep the existing root scroller and its saved position. Mask only catalogue
// content that would otherwise paint underneath the transparent sticky bars.
function useLiquidContent(ref, phase) {
  React.useEffect(() => {
    const root = ref.current
    if (!root?.querySelector) return undefined
    const body = root.querySelector('.sr-body')
    const head = root.querySelector('.sr-head')
    const foot = root.querySelector('.sr-foot')
    if (!body || !head || !foot) return undefined
    function syncContentMask() {
      const bounds = body.getBoundingClientRect()
      const headBounds = head.getBoundingClientRect()
      root.style.setProperty('--sr-content-head-height', headBounds.height + 'px')
      const top = Math.max(0, headBounds.bottom - bounds.top)
      const bottom = Math.max(0, bounds.bottom - foot.getBoundingClientRect().top)
      body.style.setProperty('--sr-content-top', top + 'px')
      body.style.setProperty('--sr-content-bottom', bottom + 'px')
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(syncContentMask) : null
    for (const node of [root, body, head, foot]) observer?.observe(node)
    root.addEventListener('scroll', syncContentMask, { passive: true })
    if (!observer) window.addEventListener('resize', syncContentMask)
    syncContentMask()
    return () => {
      observer?.disconnect()
      root.removeEventListener('scroll', syncContentMask)
      if (!observer) window.removeEventListener('resize', syncContentMask)
      root.style.removeProperty('--sr-content-head-height')
      body.style.removeProperty('--sr-content-top')
      body.style.removeProperty('--sr-content-bottom')
    }
  }, [ref, phase])
}

module.exports = { useLiquidSurface, useLiquidContent, mountLiquid }
