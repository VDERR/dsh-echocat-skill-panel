const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
import {pathToFileURL,fileURLToPath} from 'node:url'
import {join,dirname} from 'node:path'
import {writeFileSync} from 'node:fs'
// Masked GPU layers can vary by a few quantisation levels when their backdrop is
// repainted. Report the actual delta, while still rejecting text or colour leaks.
async function comparePixels(page,a,b){
 if(a.equals(b))return {equal:true,max:0,changed:0,ratio:0}
 return page.evaluate(async([a,b])=>{
  const decode=src=>new Promise(resolve=>{const image=new Image();image.onload=()=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);resolve(ctx.getImageData(0,0,c.width,c.height).data)};image.src='data:image/png;base64,'+src})
  const [x,y]=await Promise.all([decode(a),decode(b)])
  let max=0,changed=0
  for(let i=0;i<x.length;i+=4){let d=0;for(let c=0;c<3;c++)d=Math.max(d,Math.abs(x[i+c]-y[i+c]));if(d)changed++;max=Math.max(max,d)}
  const ratio=changed/(x.length/4)
  return {equal:max<=3&&ratio<.0001,max,changed,ratio}
 },[a.toString('base64'),b.toString('base64')])
}

const out=join(dirname(fileURLToPath(import.meta.url)),'../交付/预览')
const base='20260922_GPT技能面板液态改版_V3'
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || undefined,args:['--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader']})
const results=[]
const errors=[]
const check=(name,condition,detail)=>{results.push({name,pass:Boolean(condition),detail});console.log(`${condition?'PASS':'FAIL'} ${name}${detail===undefined?'':' '+JSON.stringify(detail)}`)}
try{
const page=await browser.newPage({viewport:{width:1440,height:1220},deviceScaleFactor:1})
await page.addInitScript(()=>{
 const pending=new Set(), contexts=[], listeners=[]
 const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window)
 window.requestAnimationFrame=callback=>{const id=request(t=>{pending.delete(id);callback(t)});pending.add(id);return id}
 window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id)}
 const get=HTMLCanvasElement.prototype.getContext
 HTMLCanvasElement.prototype.getContext=function(...args){const c=get.apply(this,args);if(args[0]==='webgl'&&c)contexts.push(c);return c}
 const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener
 const names=new Set(['move','leave','press','scroll','sync','theme','lost','syncContentMask'])
 EventTarget.prototype.addEventListener=function(type,cb,...args){if(names.has(cb?.name))listeners.push({target:this,type,cb});return add.call(this,type,cb,...args)}
 EventTarget.prototype.removeEventListener=function(type,cb,...args){const i=listeners.findIndex(l=>l.target===this&&l.type===type&&l.cb===cb);if(i>=0)listeners.splice(i,1);return remove.call(this,type,cb,...args)}
 window.liquidMetrics=()=>({frames:pending.size,contexts:contexts.length,liveContexts:contexts.filter(c=>!c.isContextLost()).length,listeners:listeners.length,canvases:document.querySelectorAll('.sr-liquid-field').length})
})
page.on('pageerror',e=>errors.push(e.message))
await page.goto(pathToFileURL(out+'/'+base+'.html').href)
await page.waitForTimeout(600)
check('实际 React 组件渲染技能卡片',await page.locator('.sr-skill').count()===10)
check('单一共享液态光场',await page.locator('[data-sr-renderer="webgl"]').count()===1)
const bounds=await page.locator('.sr-grid').evaluate(n=>({columns:getComputedStyle(n).gridTemplateColumns.split(' ').length,left:n.getBoundingClientRect().left,right:innerWidth-n.getBoundingClientRect().right}))
check('宽屏三列且内容居中',bounds.columns===3&&Math.abs(bounds.left-bounds.right)<2,bounds)
const field=page.locator('.sr-liquid-field')
const frameA=await field.screenshot()
await page.waitForTimeout(1000)
const frameB=await field.screenshot()
check('时间推进时光场像素持续变化',!frameA.equals(frameB))
await page.getByRole('button',{name:'引用',exact:true}).first().click()
check('引用写入演示输入框', (await page.getByRole('textbox',{name:'演示对话输入'}).inputValue()).includes('/3d-animation-short-generator'))
const filter=page.getByRole('searchbox',{name:'筛选已安装 skill'})
await filter.fill('gpt-image')
check('搜索过滤保留目标技能',await page.locator('.sr-skill').count()===1)
await filter.fill('')
const toggle=page.locator('.sr-toggle-head').first()
await toggle.click()
await page.waitForTimeout(180)
check('停用交互沿用既有 action 契约',await page.evaluate(()=>previewRequests.some(r=>r.body.action==='disable')))
await page.locator('.sr-skill--off .sr-toggle-head').click()
await page.waitForTimeout(180)
check('重新启用可恢复卡片',await page.locator('.sr-skill--off').count()===0)
await page.locator('.sr-card-actions button').filter({hasText:/^中文名$/}).first().click()
await page.locator('.sr-rename-input').fill('三维动画工作室')
await page.getByRole('button',{name:'保存',exact:true}).click()
await page.waitForTimeout(180)
check('中文名编辑仍可保存',await page.locator('.sr-skill-name').filter({hasText:'三维动画工作室'}).count()===1)
await page.locator('.sr-avatar-btn').first().click()
check('颜色选项可展开',await page.locator('.sr-swatches').count()===1)
await page.getByRole('button',{name:'丁香紫',exact:true}).last().click()
await page.waitForTimeout(120)
check('颜色写入沿用既有 action 契约',await page.evaluate(()=>previewRequests.some(r=>r.body.action==='color')))
const action=page.getByRole('button',{name:'安装',exact:true})
const before=await action.boundingBox()
await action.hover()
await page.waitForTimeout(220)
const after=await action.boundingBox()
check('按钮悬停不产生布局偏移',Math.abs(after.x-before.x)<.1&&Math.abs(after.y-before.y)<=1.1,{before,after})
await action.click()
await page.getByRole('dialog').waitFor()
check('安装弹层共享真实组件且独立光场',await page.locator('.sr-sheet canvas').count()===1)
await page.getByRole('tab',{name:'粘贴 SKILL.md'}).click()
await page.locator('#sr-install-text').fill('---\nname: demo-skill\ndescription: 离线 UI 验证\n---\n# 演示技能\n这里是预览内容。')
await page.screenshot({path:out+'/'+base+'_安装面板.png',fullPage:true})
check('安装输入与标签切换可用',await page.locator('#sr-install-text').inputValue().then(v=>v.includes('演示技能')))
await page.getByRole('button',{name:'关闭安装面板',exact:true}).click()
await page.getByRole('dialog').waitFor({state:'detached'})
check('弹层关闭释放其光场',await page.locator('.sr-liquid-field').count()===1)
await page.getByRole('button',{name:'中心报告',exact:true}).click()
await page.waitForTimeout(300)
check('中心报告保留四项统计',await page.locator('.sr-stats .sr-stat').count()===4)
await page.screenshot({path:out+'/'+base+'_中心报告.png',fullPage:true})
await page.getByRole('button',{name:'横栏视图',exact:true}).click()
await page.waitForTimeout(250)
await page.getByRole('button',{name:'窄容器',exact:true}).click()
await page.waitForTimeout(250)
const narrow=await page.locator('.sr-root').evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth,cards:[...n.querySelectorAll('.sr-skill')].every(c=>c.scrollWidth<=c.clientWidth+1)}))
check('430px 容器与长名称不横向溢出',narrow.scroll===narrow.client&&narrow.cards,narrow)
await page.getByRole('button',{name:'宽屏',exact:true}).click()
await page.getByRole('button',{name:'深色主题',exact:true}).click()
await page.waitForTimeout(250)
check('深色主题同步光场与文字',await page.locator('.sr-strip-shell').getAttribute('data-sr-theme')==='dark')
await page.getByRole('button',{name:'浅色主题',exact:true}).click()
await page.emulateMedia({reducedMotion:'reduce'})
await page.waitForTimeout(200)
check('减少动态停止连续渲染',await page.locator('.sr-strip-shell').getAttribute('data-sr-motion')==='paused',(await page.evaluate(()=>liquidMetrics())))
const reducedA=await field.screenshot()
await page.waitForTimeout(500)
const reducedB=await field.screenshot()
check('减少动态下材质静止但保留',reducedA.equals(reducedB))
// With motion stopped, changing text BEHIND the plugin must change zero interior pixels.
await page.evaluate(()=>document.body.dataset.hostCheck='true')
const shellBox=await page.locator('.sr-strip-shell').boundingBox()
const interior={x:shellBox.x+24,y:shellBox.y+24,width:shellBox.width-48,height:shellBox.height-48}
const hostA=await page.screenshot({clip:interior})
await page.evaluate(()=>document.querySelector('.preview-host-copy').textContent='CHANGED HOST TEXT '.repeat(1000))
const hostB=await page.screenshot({clip:interior})
const hostDelta=await comparePixels(page,hostA,hostB)
check('不透明基底隔绝后方宿主文字（量化容差内）',hostDelta.equal,hostDelta)
await page.evaluate(()=>delete document.body.dataset.hostCheck)
await page.emulateMedia({reducedMotion:'no-preference'})
await page.evaluate(()=>document.querySelector('.preview-seat').style.visibility='hidden')
await page.waitForTimeout(100)
check('不可见时暂停渲染',await page.locator('.sr-strip-shell').getAttribute('data-sr-motion')==='paused')
await page.evaluate(()=>document.querySelector('.preview-seat').style.visibility='visible')
await page.waitForTimeout(100)
for(let i=0;i<6;i++){
 await page.getByRole('button',{name:'隐藏面板',exact:true}).click()
 await page.waitForTimeout(80)
 const metrics=await page.evaluate(()=>liquidMetrics())
 check('卸载清理 '+(i+1),metrics.frames===0&&metrics.liveContexts===0&&metrics.listeners===0&&metrics.canvases===0,metrics)
 await page.getByRole('button',{name:'显示面板',exact:true}).click()
 await page.waitForTimeout(80)
}
check('反复开关仍只有一个活跃光场',(await page.evaluate(()=>liquidMetrics())).liveContexts===1)
await page.evaluate(()=>document.querySelector('.preview-seat').style.transform='translateY(5000px)')
await page.waitForTimeout(120)
check('离屏时暂停光场',await page.locator('.sr-strip-shell').getAttribute('data-sr-motion')==='paused')
await page.evaluate(()=>document.querySelector('.preview-seat').style.transform='')
await page.setViewportSize({width:390,height:920})
await page.waitForTimeout(200)
await page.getByRole('button',{name:'安装',exact:true}).click()
await page.getByRole('dialog').waitFor()
const modal=await page.getByRole('dialog').evaluate(n=>({width:n.getBoundingClientRect().width,scroll:n.scrollWidth,client:n.clientWidth,window:innerWidth}))
check('390px 视口弹层不溢出',modal.width<=modal.window&&modal.scroll<=modal.client+1,modal)
check('弹层进入过程保持不透明',await page.getByRole('dialog').evaluate(n=>getComputedStyle(n).opacity==='1'&&getComputedStyle(n.parentElement).opacity==='1'&&getComputedStyle(n).backgroundColor.startsWith('rgb(')))
await page.waitForTimeout(280)
await page.screenshot({path:out+'/'+base+'_窄屏弹层.png',fullPage:true})
check('无浏览器运行异常',errors.length===0,errors)
writeFileSync(out+'/'+base+'_后台验证.json',JSON.stringify({type:'离线真实组件预览，非 DSH 实机',results,errors,completed:new Date().toISOString()},null,2))
if(results.some(r=>!r.pass))process.exitCode=1
}finally{await browser.close()}
