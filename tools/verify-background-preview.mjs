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

const out=join(dirname(fileURLToPath(import.meta.url)),'../交付/预览'),base='20260922_GPT技能面板液态改版_V3'
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || undefined,args:['--enable-unsafe-swiftshader']})
const results=[],errors=[]
const check=(name,pass,detail)=>{results.push({name,pass:Boolean(pass),detail});console.log((pass?'PASS ':'FAIL ')+name+(detail===undefined?'':' '+JSON.stringify(detail)));if(!pass)throw Error(name)}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),requests=[]
 page.on('request',request=>requests.push(request.url()))
 await page.addInitScript(()=>{
  const active=new Set(),pending=new Set(),req=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window)
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL)
  URL.createObjectURL=(...args)=>{const url=create(...args);active.add(url);return url}
  URL.revokeObjectURL=url=>{active.delete(url);return revoke(url)}
  window.requestAnimationFrame=fn=>{const id=req(t=>{pending.delete(id);fn(t)});pending.add(id);return id}
  window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id)}
  window.bgMetrics=()=>({urls:active.size,frames:pending.size})
 })
 page.on('pageerror',e=>errors.push(e.message))
 const url=pathToFileURL(out+'/'+base+'.html').href
 await page.goto(url)
 await page.waitForFunction(()=>window.previewPlugin&&!previewPlugin.__background.getSnapshot().loading)
 const state=()=>page.evaluate(()=>{const s=previewPlugin.__background.getSnapshot();return {settings:s.settings,image:s.image?{name:s.image.name,bytes:s.image.blob.size,width:s.image.width,height:s.image.height}:null,editing:!!s.editor,busy:s.busy,error:s.error}})
 const open=async()=>{await page.getByRole('button',{name:'背景自定义',exact:true}).click();await page.getByRole('dialog',{name:'背景自定义',exact:true}).waitFor()}
 const button=name=>page.getByRole('button',{name,exact:true})
 const mode=async label=>{await button(label).click();await page.waitForTimeout(90)}
 const range=async(label,value)=>{const input=page.getByRole('slider',{name:label,exact:true});await input.fill(String(value));await input.dispatchEvent('input');await input.dispatchEvent('change');await page.waitForTimeout(70)}
 const cancel=async()=>{await button('取消').click();await page.getByRole('dialog',{name:'背景自定义'}).waitFor({state:'detached'})}
 const save=async()=>{await button('保存背景').click();await page.getByRole('dialog',{name:'背景自定义'}).waitFor({state:'detached'})}
 const sample=()=>page.locator('.sr-bg-sample').screenshot()
 const appearance=()=>page.locator('.preview-seat [data-sr-liquid]').first()
 const readUniform=(name,preview=false)=>page.locator(preview?'.sr-bg-sample .sr-liquid-field':'.preview-seat .sr-liquid-field').first().evaluate((c,name)=>{const gl=c.getContext('webgl');return gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM),gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM),name))},name)
 const defaults=(await state()).settings
 const widths=await page.locator('.sr-strip-actions').evaluate(n=>{const bs=[...n.querySelectorAll('button')].map(b=>b.getBoundingClientRect());return {width:bs[0].width,overlap:bs.some((b,i)=>i&&b.left<bs[i-1].right-1)}})
 check('宽屏入口文字完整且与原按钮不重叠',widths.width>=104&&!widths.overlap,widths)
 await page.locator('.sr-strip').click({position:{x:12,y:12}})
 check('横栏可收起',await page.locator('.sr-strip').getAttribute('aria-expanded')==='false')
 await button('背景自定义').focus();await page.keyboard.press('Enter')
 await page.getByRole('dialog',{name:'背景自定义'}).waitFor()
 check('Enter 打开背景设置不展开横栏',await page.locator('.sr-strip').getAttribute('aria-expanded')==='false')
 await button('预设：雾紫').click();await page.keyboard.press('Escape')
 check('Esc 只关闭设置并恢复原背景',!(await state()).editing&&JSON.stringify((await state()).settings)===JSON.stringify(defaults)&&await page.locator('.sr-strip').getAttribute('aria-expanded')==='false')
 await button('背景自定义').focus();await page.keyboard.press('Space')
 check('Space 打开背景设置不展开横栏',await page.locator('.sr-strip').getAttribute('aria-expanded')==='false')
 await page.keyboard.press('n')
 check('设置内快捷键不打开下层安装窗',await page.getByRole('dialog').count()===1)
 await cancel();await page.locator('.sr-strip').click({position:{x:12,y:12}});await open()
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100)
 let before=await sample()
 for(const name of ['珍珠白','雾紫','暖砂灰','深色金属','青瓷','柔雾银蓝']){
  await button('预设：'+name).click();await page.waitForTimeout(80)
  const after=await sample();check('预设实际改变背景：'+name,!before.equals(after));before=after
 }
 for(const label of ['柔和渐变','纯色','液态']){
  before=await sample();await mode(label);check('模式实际改变背景：'+label,!before.equals(await sample()))
 }
 for(const [label,value] of [['主色','#c0d9cf'],['辅助色','#bd9abc'],['高光色','#fff4d9']]){
  before=await sample();await page.getByRole('textbox',{name:label+'色值',exact:true}).fill(value);await page.waitForTimeout(100)
  check(label+'色值实际生效',!before.equals(await sample()))
 }
 for(const [label,value] of [['亮度',75],['饱和度',0],['对比强度',125],['金属高光',95],['柔化',20],['背景遮罩',80],['形变幅度',100]]){
  before=await sample();await range(label,value);check(label+'滑杆实际改变材质',!before.equals(await sample()))
 }
 await button('预设：珍珠白').click();before=await sample();await range('渐变方向',280);check('渐变方向实际生效',!before.equals(await sample()))
 await mode('纯色');check('纯色模式隐藏不适用的流动/高光/柔化控制',await page.getByRole('slider',{name:'金属高光',exact:true}).count()===0&&await page.getByRole('slider',{name:'柔化',exact:true}).count()===0&&await page.getByRole('checkbox',{name:'开启动态',exact:true}).count()===0)
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(130)
 check('纯色不维持动画循环',(await page.evaluate(()=>bgMetrics())).frames===0)
 await mode('柔和渐变');await page.waitForTimeout(100);check('渐变不维持动画循环',(await page.evaluate(()=>bgMetrics())).frames===0)
 await button('预设：柔雾银蓝').click()
 await range('流动速度',10);let phaseA=await readUniform('u_phase');await page.waitForTimeout(500);let slow=((await readUniform('u_phase'))-phaseA+Math.PI*2)%(Math.PI*2)
 await range('流动速度',150);phaseA=await readUniform('u_phase');await page.waitForTimeout(500);let fast=((await readUniform('u_phase'))-phaseA+Math.PI*2)%(Math.PI*2)
 check('流动速度确实改变相位推进速度',fast>slow*4,{slow,fast})
 await page.getByRole('checkbox',{name:'开启动态',exact:true}).uncheck();await page.waitForTimeout(100)
 check('关闭动态停止持续循环',(await page.evaluate(()=>bgMetrics())).frames===0)
 const surface=await page.locator('.sr-bg-sample').boundingBox()
 await page.mouse.move(surface.x+150,surface.y+24);await page.waitForTimeout(80)
 check('关闭流动时仍可单次响应指针',(await readUniform('u_pointer',true))[2]>0)
 await page.getByRole('checkbox',{name:'指针经过时轻微响应',exact:true}).uncheck()
 await page.mouse.move(surface.x+160,surface.y+28);await page.waitForTimeout(80)
 check('关闭指针反馈后不产生光场偏移',(await readUniform('u_pointer',true))[2]===0)
 await page.getByLabel('面板明暗',{exact:true}).selectOption('dark')
 check('自定义深色只改变插件主题',await appearance().getAttribute('data-sr-theme')==='dark'&&await page.evaluate(()=>document.documentElement.dataset.theme)==='light')
 await page.getByLabel('面板明暗',{exact:true}).selectOption('light')
 await mode('柔和渐变');await range('亮度',108)
 const saved=(await state()).settings;await save()
 await page.reload();await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().loading)
 check('保存后刷新仍保留全部参数',JSON.stringify((await state()).settings)===JSON.stringify(saved))
 await button('中心报告').click();await open()
 check('中心报告真实右上角也有入口',await page.locator('.preview-seat .sr-head .sr-bg-open').count()===1)
 check('跨面板共享已保存背景',JSON.stringify((await state()).settings)===JSON.stringify(saved)&&await appearance().getAttribute('data-sr-background')==='gradient')
 await button('恢复默认').click();check('恢复默认立即预览',JSON.stringify((await state()).settings)===JSON.stringify(defaults))
 await cancel();check('取消恢复默认可回到已保存背景',JSON.stringify((await state()).settings)===JSON.stringify(saved))
 await open();await page.getByLabel('面板明暗',{exact:true}).selectOption('dark');await cancel();check('取消明暗调整恢复保存值',(await state()).settings.theme===saved.theme)
 await open();await mode('本地图片')
 await button('保存背景').click();check('图片模式未选图片时不会保存错误空背景',(await state()).editing&&(await state()).error.includes('选择'))
 const imageData=await page.evaluate(()=>{
  const make=flip=>{const c=document.createElement('canvas');c.width=800;c.height=1200;const x=c.getContext('2d');for(let i=0;i<6;i++){x.fillStyle=(flip?['#734859','#caaca1','#eaded4','#71949a','#4b6c7e','#d1b8a0']:['#1c4a6e','#537e93','#8cafb5','#ded3a4','#ba7a54','#5e4841'])[i];x.fillRect(0,i*200,800,200)}return c.toDataURL('image/png').split(',')[1]};return [make(false),make(true)]
 })
 const input=page.getByLabel('选择背景图片',{exact:true})
 await input.setInputFiles({name:'本地测试-长名称背景图片.png',mimeType:'image/png',buffer:Buffer.from(imageData[0],'base64')})
 await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().busy)
 check('选择图片仅在本机压缩并生效',(await state()).image.bytes<=1500*1024&&await appearance().getAttribute('data-sr-background-image')==='true')
 await page.waitForTimeout(80);check('图片模式不维持动画循环',(await page.evaluate(()=>bgMetrics())).frames===0)
 before=await sample();await page.getByLabel('图片填充',{exact:true}).selectOption('contain');await page.waitForTimeout(70);check('完整显示与裁切填充真实变化',!before.equals(await sample()))
 before=await sample();await range('水平位置',0);check('图片水平位置生效',!before.equals(await sample()))
 await page.getByLabel('图片填充',{exact:true}).selectOption('cover');before=await sample();await range('垂直位置',0);check('图片垂直位置生效',!before.equals(await sample()))
 await page.getByLabel('图片填充',{exact:true}).selectOption('stretch');check('拉伸模式隐藏位置控制',await page.getByRole('slider',{name:'水平位置',exact:true}).count()===0)
 await page.screenshot({path:out+'/'+base+'_图片自定义.png',fullPage:true})
 const firstImage=(await state()).image;await save();await page.reload();await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().loading)
 check('图片和参数刷新后仍保留',(await state()).image.name===firstImage.name&&(await state()).settings.fit==='stretch')
 await button('安装').click();await page.getByRole('dialog',{name:'安装 skill',exact:true}).waitFor()
 check('安装弹层共享图片设置且不运行动画',await page.locator('.sr-sheet').getAttribute('data-sr-background')==='image'&&await page.locator('.sr-sheet').getAttribute('data-sr-motion')==='paused'&&await page.locator('.sr-sheet .sr-background-layer').evaluate(n=>n.style.backgroundImage.startsWith('url("blob:')))
 await button('关闭安装面板').click();await page.getByRole('dialog').waitFor({state:'detached'})
 await open();await input.setInputFiles({name:'替换背景.png',mimeType:'image/png',buffer:Buffer.from(imageData[1],'base64')});await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().busy)
 check('更换图片实际更新本地预览',(await state()).image.name==='替换背景.png')
 await cancel();check('取消更换保留原图片',(await state()).image.name===firstImage.name)
 await open();await button('移除图片').click();check('移除图片立即移除预览',(await state()).image===null)
 await cancel();check('取消移除恢复原图片',(await state()).image.name===firstImage.name)
 await open();await input.setInputFiles({name:'too-large.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(8*1024*1024+1)})
 await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().busy);check('超过8 MB图片有明确错误并保留原图',(await state()).error.includes('8 MB')&&(await state()).image.name===firstImage.name)
 await input.setInputFiles({name:'wrong.txt',mimeType:'text/plain',buffer:Buffer.from('test')});await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().busy);check('拒绝非图片格式',(await state()).error.includes('JPG'))
 await input.setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')});await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().busy);check('损坏图片提示读取错误且无草稿丢失',(await state()).error.includes('无法读取')&&(await state()).image.name===firstImage.name)
 await mode('柔和渐变');await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('quota','QuotaExceededError')}})
 await button('保存背景').click();await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().busy)
 check('存储容量错误不谎报保存成功',(await state()).editing&&(await state()).error.includes('空间不足'))
 await page.evaluate(()=>IDBObjectStore.prototype.put=window.originalPut);await cancel();check('保存失败后取消仍恢复原背景',(await state()).settings.mode==='image')
 await open();await page.evaluate(()=>{window.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(cb,...args){return window.originalToBlob.call(this,blob=>setTimeout(()=>cb(blob),500),...args)}})
 await input.setInputFiles({name:'late.png',mimeType:'image/png',buffer:Buffer.from(imageData[1],'base64')})
 await page.waitForFunction(()=>previewPlugin.__background.getSnapshot().busy)
 await page.evaluate(()=>previewControls.setMounted(false));await page.waitForTimeout(650)
 const unmounted=await state();check('图片处理中卸载使异步草稿失效',!unmounted.editing&&!unmounted.busy&&unmounted.image.name===firstImage.name)
 check('卸载释放动画及图片对象地址',(await page.evaluate(()=>bgMetrics())).frames===0&&(await page.evaluate(()=>bgMetrics())).urls===0,await page.evaluate(()=>bgMetrics()))
 await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.originalToBlob;previewControls.setMounted(true)});await page.waitForTimeout(120)
 check('重新挂载恢复已保存图片',(await state()).image.name===firstImage.name&&await appearance().getAttribute('data-sr-background-image')==='true')
 await open();await button('移除图片').click();await mode('纯色');await save();await page.reload();await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().loading)
 check('移除图片并保存后刷新不再加载旧图',(await state()).image===null&&(await state()).settings.mode==='solid')
 await open();await mode('柔和渐变')
 const committed=(await state()).settings
 await page.evaluate(()=>{
  const proto=IDBTransaction.prototype,descriptor=Object.getOwnPropertyDescriptor(proto,'oncomplete');window.completeDescriptor=descriptor
  Object.defineProperty(proto,'oncomplete',{...descriptor,set(fn){descriptor.set.call(this,event=>setTimeout(()=>fn(event),300))}})
 })
 await button('保存背景').click();await page.waitForFunction(()=>previewPlugin.__background.getSnapshot().busy)
 await page.evaluate(()=>previewControls.setMounted(false));await page.waitForTimeout(30)
 await page.evaluate(()=>previewControls.setMounted(true));await open();await button('预设：雾紫').click()
 await page.waitForTimeout(400)
 check('迟到的保存结果不覆盖新打开的草稿',(await state()).editing&&(await state()).settings.primary!==committed.primary)
 await page.evaluate(()=>Object.defineProperty(IDBTransaction.prototype,'oncomplete',window.completeDescriptor));await cancel()
 check('取消新草稿回到已完成保存的背景',JSON.stringify((await state()).settings)===JSON.stringify(committed))
 await open();await button('恢复默认').click();await save();await page.reload();await page.waitForFunction(()=>!previewPlugin.__background.getSnapshot().loading)
 check('保存恢复默认清除旧图片并可刷新保持',(await state()).image===null&&JSON.stringify((await state()).settings)===JSON.stringify(defaults))
 await button('深色主题').click();await open();await page.getByLabel('面板明暗',{exact:true}).selectOption('light')
 check('深色宿主里可单独使用浅色背景',await appearance().getAttribute('data-sr-theme')==='light'&&await appearance().evaluate(n=>getComputedStyle(n).getPropertyValue('--sr-fg').trim())==='#28364b')
 for(const theme of ['light','dark']){
  await page.getByLabel('面板明暗',{exact:true}).selectOption(theme)
  await button('保存背景').hover();await page.waitForTimeout(220)
  const contrast=await button('保存背景').evaluate(n=>{
   const css=getComputedStyle(n),c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d')
   const light=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0)}
   const a=light(css.color),b=light(css.backgroundColor);return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),color:css.color,background:css.backgroundColor}
  })
  check(theme+' 保存按钮悬停文字对比达标',contrast.ratio>=4.5,contrast)
 }
 await page.getByLabel('面板明暗',{exact:true}).selectOption('light')
 await page.screenshot({path:out+'/'+base+'_明暗独立设置.png',fullPage:true})
 await cancel();await button('浅色主题').click()
 await page.setViewportSize({width:390,height:920});await open();await page.waitForTimeout(100)
 check('窄屏设置内容和底部操作不横向溢出',await page.getByRole('dialog').evaluate(n=>n.scrollWidth<=n.clientWidth&&n.getBoundingClientRect().right<=innerWidth))
 await page.screenshot({path:out+'/'+base+'_背景自定义_窄屏.png',fullPage:true})
 await button('保存背景').focus();await page.keyboard.press('Tab')
 check('弹窗键盘焦点保持在弹窗中',await page.getByRole('dialog').evaluate(n=>n.contains(document.activeElement)))
 await cancel();await page.setViewportSize({width:1440,height:1100})
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100)
 const box=await appearance().boundingBox(),clip={x:box.x+24,y:box.y+24,width:box.width-48,height:box.height-48}
 await page.evaluate(()=>document.body.dataset.hostCheck='true');before=await page.screenshot({clip});await page.evaluate(()=>document.querySelector('.preview-host-copy').textContent='CHANGED HOST TEXT '.repeat(1000));const delta=await comparePixels(page,before,await page.screenshot({clip}));check('新背景不透出宿主文字',delta.equal,delta)
 await page.evaluate(()=>delete document.body.dataset.hostCheck)
 check('原技能界面仍可引用',await page.getByRole('button',{name:'引用',exact:true}).count()===10)
 await page.locator('.preview-seat .sr-liquid-field').first().evaluate(c=>c.getContext('webgl').getExtension('WEBGL_lose_context').loseContext());await page.waitForTimeout(100)
 check('图形上下文丢失时使用静态材质并停止循环',await appearance().getAttribute('data-sr-renderer')==='static'&&await appearance().getAttribute('data-sr-motion')==='paused'&&await page.locator('.preview-seat .sr-background-layer').first().evaluate(n=>n.style.backgroundImage.startsWith('linear-gradient')))
 check('图片及背景操作没有向网络发出请求',!requests.some(url=>/^https?:/u.test(url)))
 check('无页面运行异常',errors.length===0,errors)
}catch(error){errors.push(error.message);console.error(error.stack);process.exitCode=1}
finally{writeFileSync(out+'/'+base+'_背景功能验证.json',JSON.stringify({type:'后台离线真实组件，非 DSH 实机',results,errors},null,2));await browser.close()}
