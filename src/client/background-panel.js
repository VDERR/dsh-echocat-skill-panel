const React = require('react')
const { Icon } = require('./icons.js')
const { portal } = require('./install.js')
const { useLiquidSurface } = require('./liquid.js')
const bg = require('./background-store.js')
const h = React.createElement
const MODES=[['liquid','液态'],['gradient','柔和渐变'],['solid','纯色'],['image','本地图片']]
const focusable='button:not([disabled]),input:not([disabled]):not([type="file"]),select:not([disabled]),[tabindex="0"]'

function Range({name,label,min,max,unit='%',value,disabled=false}){
 const id='sr-bg-'+name
 return h('div',{className:'sr-bg-range'},
  h('div',{className:'sr-bg-range-label'},h('label',{htmlFor:id},label),h('output',{htmlFor:id},value+unit)),
  h('input',{id,type:'range',min,max,step:1,value,disabled,onChange:e=>bg.patch({[name]:Number(e.target.value)})}))
}
function Toggle({name,label,value,disabled=false}){
 return h('label',{className:'sr-bg-toggle'},h('span',null,label),h('input',{type:'checkbox',checked:value,disabled,onChange:e=>bg.patch({[name]:e.target.checked})}))
}
function Color({name,label,value}){
 const [text,setText]=React.useState(value)
 React.useEffect(()=>setText(value),[value])
 return h('label',{className:'sr-bg-color'},h('span',null,label),
  h('span',{className:'sr-bg-color-input'},h('input',{type:'color','aria-label':label,value,onChange:e=>bg.patch({[name]:e.target.value})}),
   h('input',{type:'text','aria-label':label+'色值',value:text,maxLength:7,spellCheck:false,onChange:e=>{const v=e.target.value;setText(v);if(/^#[\da-f]{6}$/iu.test(v))bg.patch({[name]:v})},onBlur:()=>setText(value)})))
}
function Sample(){
 const ref=React.useRef(null)
 useLiquidSurface(ref)
 return h('div',{className:'sr-root sr-bg-sample',ref,'aria-label':'背景实时预览'},
  h('div',{className:'sr-bg-sample-title'},'EchoCat',h('span',null,'背景实时预览')),
  h('div',{className:'sr-skill'},h('strong',null,'清晰的内容，喜欢的背景'),h('p',null,'在这里看颜色、光泽和文字对比。外面的技能面板也会同步变化。'),h('button',{className:'sr-btn sr-btn--primary',type:'button'},'示例按钮')))
}
function BackgroundDialog({owner,state,trigger}){
 const ref=React.useRef(null),fileRef=React.useRef(null)
 const current=React.useRef(state);current.current=state
 React.useEffect(()=>{
  const previous=trigger.current||document.activeElement
  const node=ref.current
  node?.querySelector(focusable)?.focus()
  function onBackgroundKey(event){
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!current.current.busy)bg.cancel(owner);return}
   if(event.key!=='Tab')return
   const nodes=[...node.querySelectorAll(focusable)].filter(n=>n.getClientRects().length)
   if(!nodes.length)return
   const first=nodes[0],last=nodes[nodes.length-1]
   if(event.shiftKey&&(document.activeElement===first||!node.contains(document.activeElement))){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&(document.activeElement===last||!node.contains(document.activeElement))){event.preventDefault();first.focus()}
  }
  document.addEventListener('keydown',onBackgroundKey,true)
  return ()=>{document.removeEventListener('keydown',onBackgroundKey,true);if(previous?.isConnected)previous.focus()}
 },[owner,trigger])
 const p=state.settings
 const liquid=p.mode==='liquid',image=p.mode==='image',solid=p.mode==='solid'
 const section=(title,...children)=>h('section',{className:'sr-bg-section'},h('h3',null,title),...children)
 const range=(name,label,min,max,unit)=>h(Range,{key:name,name,label,min,max,unit,value:p[name]})
 return portal(h('div',{className:'sr-backdrop sr-bg-backdrop','data-sr-theme':p.theme==='auto'?(document.documentElement.classList.contains('dark')||document.documentElement.dataset.theme==='dark'?'dark':'light'):p.theme,onClick:e=>e.stopPropagation(),onKeyDown:e=>e.stopPropagation()},
  h('div',{className:'sr-bg-dialog',role:'dialog','aria-modal':'true','aria-label':'背景自定义',ref},
   h('header',{className:'sr-bg-header'},h('div',null,h('span',{className:'sr-bg-eyebrow'},'让面板更像你'),h('h2',null,'背景自定义'),h('p',null,'先随心调节，满意后保存。只影响当前客户端。')),
    h('button',{className:'sr-btn sr-btn--icon',type:'button','aria-label':'取消并关闭背景自定义',disabled:state.busy,onClick:()=>bg.cancel(owner)},h(Icon,{name:'close',size:15}))),
   h('div',{className:'sr-bg-body'},
    h('aside',{className:'sr-bg-aside'},h(Sample),
     h('p',{className:'sr-bg-help'},'实时预览 · 尚未保存的调整可随时取消'),
     section('从喜欢的风格开始',h('div',{className:'sr-bg-presets'},bg.PRESETS.map(preset=>h('button',{key:preset.id,type:'button',className:'sr-bg-preset',disabled:state.busy,'aria-label':'预设：'+preset.name,title:preset.note,'aria-pressed':JSON.stringify(p)===JSON.stringify(preset.settings),onClick:()=>bg.patch(preset.settings)},
      h('span',{className:'sr-bg-swatch',style:{background:'linear-gradient(135deg,'+preset.settings.primary+','+preset.settings.secondary+','+preset.settings.highlight+')'}}),h('strong',null,preset.name))))),
     h('p',{className:'sr-bg-help'},'图片和设置均保存在本机，不会上传或跨设备同步。')),
    h('div',{className:'sr-bg-controls'},
     h('fieldset',{disabled:state.busy},
      section('背景样式',h('div',{className:'sr-bg-modes',role:'group','aria-label':'背景模式'},MODES.map(([mode,label])=>h('button',{key:mode,type:'button',className:'sr-btn','aria-pressed':p.mode===mode,onClick:()=>bg.patch({mode})},label))),
       h('label',{className:'sr-bg-select'},h('span',null,'面板明暗'),h('select',{'aria-label':'面板明暗',value:p.theme,onChange:e=>bg.patch({theme:e.target.value})},h('option',{value:'auto'},'跟随客户端'),h('option',{value:'light'},'浅色'),h('option',{value:'dark'},'深色')))),
      image?section('你的本地图片',
       state.imageUrl?h('div',{className:'sr-bg-image'},h('img',{src:state.imageUrl,alt:'当前本地背景缩略图'}),h('span',null,state.image.name)):h('p',{className:'sr-bg-help'},'选择照片、纹理或插画作为面板背景。'),
       h('input',{ref:fileRef,type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'选择背景图片',className:'sr-bg-file',onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)void bg.chooseImage(file,owner)}}),
       h('div',{className:'sr-bg-inline'},h('button',{type:'button',className:'sr-btn',onClick:()=>fileRef.current?.click()},state.image?'更换图片':'选择图片'),state.image?h('button',{type:'button',className:'sr-btn',onClick:bg.removeImage},'移除图片'):null),
       h('p',{className:'sr-bg-help'},'JPG / PNG / WebP，最多 8 MB。仅在本机处理，保存时长边缩至 1920 像素以内。'),
       state.image?h(React.Fragment,null,
        h('label',{className:'sr-bg-select'},h('span',null,'图片填充'),h('select',{'aria-label':'图片填充',value:p.fit,onChange:e=>bg.patch({fit:e.target.value})},h('option',{value:'cover'},'铺满并裁切'),h('option',{value:'contain'},'完整显示'),h('option',{value:'stretch'},'拉伸铺满'))),
        p.fit!=='stretch'?h(React.Fragment,null,range('positionX','水平位置',0,100),range('positionY','垂直位置',0,100)):h('p',{className:'sr-bg-help'},'拉伸会铺满整个面板，无需调整位置。')):null
      ):section('配色',h('div',{className:'sr-bg-colors'},h(Color,{name:'primary',label:'主色',value:p.primary}),!solid?h(Color,{name:'secondary',label:'辅助色',value:p.secondary}):null,!solid?h(Color,{name:'highlight',label:'高光色',value:p.highlight}):null),p.mode==='gradient'?range('angle','渐变方向',0,360,'°'):null),
      section('质感与可读性',range('brightness','亮度',70,125),range('saturation','饱和度',0,150),!solid?range('contrast','对比强度',50,130):null,
       liquid?range('shine','金属高光',0,100):null,
       !solid?range('softness','柔化',0,20,''):null,
       range('veil','背景遮罩',15,85),h('p',{className:'sr-bg-help'},'遮罩越高，背景越克制；卡片会保留清晰的文字衬底。')),
      liquid?section('流动与反馈',h(Toggle,{name:'animate',label:'开启动态',value:p.animate}),
       p.animate?range('speed','流动速度',10,150):h('p',{className:'sr-bg-help'},'动态已关闭，保留静态液态材质。'),
       range('amplitude','形变幅度',0,100),h(Toggle,{name:'pointer',label:'指针经过时轻微响应',value:p.pointer}),
       h('p',{className:'sr-bg-help'},'系统开启“减少动态”时，流动和指针反馈会自动暂停。')):h('p',{className:'sr-bg-help'},'当前是静态背景，不运行流动或指针动画。'),
     ),
    ),
   ),
   state.error?h('div',{className:'sr-bg-error',role:'alert'},state.error):null,
   h('footer',{className:'sr-bg-footer'},h('button',{type:'button',className:'sr-btn',disabled:state.busy,onClick:bg.reset,title:'恢复默认配色并移除图片，保存后生效'},'恢复默认'),
    h('span',{className:'sr-bg-save-note',role:'status'},state.busy?'正在本机处理…':state.dirty?'有未保存的调整':'关闭会保留原来的背景'),
    h('button',{type:'button',className:'sr-btn',disabled:state.busy,onClick:()=>bg.cancel(owner)},'取消'),
    h('button',{type:'button',className:'sr-btn sr-btn--primary',disabled:state.busy,onClick:()=>void bg.save(owner)},'保存背景')),
  )))
}
function BackgroundButton(){
 const state=bg.useBackground(),owner=React.useRef(null),trigger=React.useRef(null)
 if(owner.current===null)owner.current={}
 React.useEffect(()=>{owner.current.active=true;return ()=>{owner.current.active=false;bg.cancel(owner.current,true)}},[])
 return h(React.Fragment,null,h('button',{type:'button',className:'sr-btn sr-bg-open',ref:trigger,'aria-label':'背景自定义',title:'背景自定义','aria-haspopup':'dialog',disabled:state.loading,onClick:e=>{e.stopPropagation();void bg.begin(owner.current)},onKeyDown:e=>e.stopPropagation()},h(Icon,{name:'layers',size:13}),h('span',{className:'sr-bg-open-label'},'背景自定义')),
  state.editor===owner.current?h(BackgroundDialog,{owner:owner.current,state,trigger}):null)
}
module.exports={BackgroundButton,BackgroundDialog}
