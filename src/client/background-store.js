// Isolated, local-only appearance store. No host routes or skill configuration.
const React = require('react')
const DB_NAME = 'echocat-skill-panel-appearance-v1'
const FILE_LIMIT = 8 * 1024 * 1024
const IMAGE_LIMIT = 1500 * 1024
const DEFAULTS = Object.freeze({mode:'liquid',theme:'auto',primary:'#e3edf5',secondary:'#a4cddd',highlight:'#e9def8',brightness:100,saturation:90,contrast:100,shine:55,speed:45,amplitude:45,softness:3,veil:18,animate:true,pointer:true,angle:125,fit:'cover',positionX:50,positionY:50})
const PRESETS = [
 {id:'silver',name:'柔雾银蓝',note:'细腻、轻盈的缓慢反射',settings:{...DEFAULTS}},
 {id:'pearl',name:'珍珠白',note:'清爽的柔和静态渐变',settings:{...DEFAULTS,mode:'gradient',primary:'#f5f2ec',secondary:'#dfe8ed',highlight:'#ffffff',saturation:60,veil:20}},
 {id:'lilac',name:'雾紫',note:'低饱和的冷紫光泽',settings:{...DEFAULTS,primary:'#ddd7ec',secondary:'#bac7df',highlight:'#f4eafb',saturation:85,shine:38}},
 {id:'warm',name:'暖砂灰',note:'安静温润的中性色',settings:{...DEFAULTS,mode:'gradient',primary:'#e8e0d5',secondary:'#cfc9c0',highlight:'#fff4e9',saturation:65,veil:25}},
 {id:'metal',name:'深色金属',note:'深色界面与克制反光',settings:{...DEFAULTS,theme:'dark',primary:'#5c6d88',secondary:'#708890',highlight:'#bdc4e1',shine:40,saturation:65,veil:20}},
 {id:'celadon',name:'青瓷',note:'淡青与柔白自然过渡',settings:{...DEFAULTS,mode:'gradient',primary:'#dde9e3',secondary:'#bed8d3',highlight:'#f5eee0',saturation:70,angle:150}},
]
const ranges={brightness:[70,125],saturation:[0,150],contrast:[50,130],shine:[0,100],speed:[10,150],amplitude:[0,100],softness:[0,20],veil:[15,85],angle:[0,360],positionX:[0,100],positionY:[0,100]}
function normalize(value={}) {
 value=value&&typeof value==='object'?value:{}
 const next={...DEFAULTS}
 for(const key of ['primary','secondary','highlight'])if(/^#[\da-f]{6}$/iu.test(value[key]||''))next[key]=value[key].toLowerCase()
 for(const [key,[min,max]] of Object.entries(ranges))if(Number.isFinite(value[key]))next[key]=Math.min(max,Math.max(min,value[key]))
 for(const key of ['animate','pointer'])if(typeof value[key]==='boolean')next[key]=value[key]
 for(const [key,values] of Object.entries({mode:['liquid','gradient','solid','image'],theme:['auto','light','dark'],fit:['cover','contain','stretch']}))if(values.includes(value[key]))next[key]=value[key]
 return next
}
let saved={settings:{...DEFAULTS},image:null}
let state={settings:saved.settings,image:null,imageUrl:null,editor:null,dirty:false,busy:false,loading:true,error:null}
let loaded=null, session=0
const listeners=new Set()
const getSnapshot=()=>state
function publish(patch){state={...state,...patch};for(const listener of [...listeners])listener()}
function setImage(image){
 const previous=state.imageUrl
 const url=listeners.size>0&&image?.blob&&typeof URL?.createObjectURL==='function'?URL.createObjectURL(image.blob):null
 state={...state,image,imageUrl:url}
 if(previous)URL.revokeObjectURL(previous)
}
function subscribe(listener){
 const first=!listeners.size
 listeners.add(listener)
 if(first&&state.image&&!state.imageUrl)setImage(state.image)
 return ()=>{listeners.delete(listener);if(!listeners.size&&state.imageUrl){URL.revokeObjectURL(state.imageUrl);state={...state,imageUrl:null}}}
}
function storage(write,record){
 return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('当前客户端无法保存本地背景，请检查是否禁用了本地存储。'));return}
  let request
  try{request=indexedDB.open(DB_NAME,1)}catch(error){reject(error);return}
  request.onupgradeneeded=()=>request.result.createObjectStore('appearance')
  request.onerror=()=>reject(request.error)
  request.onblocked=()=>reject(new Error('本地背景存储暂被占用，请关闭其他背景设置面板后重试。'))
  request.onsuccess=()=>{
   const db=request.result
   let transaction
   try{
    transaction=db.transaction('appearance',write?'readwrite':'readonly')
    const result=write?transaction.objectStore('appearance').put(record,'current'):transaction.objectStore('appearance').get('current')
    transaction.oncomplete=()=>{db.close();resolve(write?record:result.result)}
    transaction.onabort=()=>{db.close();reject(transaction.error||new Error('本地存储未完成，请重试。'))}
    transaction.onerror=()=>{}
   }catch(error){db.close();reject(error)}
  }
 })
}
function storageMessage(error){return error?.name==='QuotaExceededError'?'本机存储空间不足，背景尚未保存。请换一张较小的图片或清理此客户端存储后重试。':error?.message||'本地背景保存失败，请重试。'}
function load(){
 if(loaded)return loaded
 loaded=storage(false).then(record=>{
  const settings=normalize(record?.settings)
  const source=record?.image
  const image=source?.blob instanceof Blob&&source.blob.type==='image/jpeg'&&source.blob.size<=IMAGE_LIMIT?source:null
  if(settings.mode==='image'&&!image)settings.mode='liquid'
  saved={settings,image}
  setImage(image);publish({settings,loading:false,error:null})
 }).catch(error=>publish({loading:false,error:storageMessage(error)}))
 return loaded
}
function useBackground(){React.useEffect(()=>{void load()},[]);return React.useSyncExternalStore(subscribe,getSnapshot,getSnapshot)}
async function begin(owner){await load();if(state.busy||owner.active===false)return;session++;setImage(saved.image);publish({editor:owner,settings:{...saved.settings},dirty:false,error:null})}
function patch(values){if(!state.editor||state.busy)return;publish({settings:normalize({...state.settings,...values}),dirty:true,error:null})}
function reset(){if(!state.editor||state.busy)return;setImage(null);publish({settings:{...DEFAULTS},dirty:true,error:null})}
function removeImage(){if(state.busy)return;setImage(null);publish({dirty:true,error:null})}
function cancel(owner,force=false){if(state.editor!==owner||(state.busy&&!force))return;session++;setImage(saved.image);publish({settings:saved.settings,editor:null,dirty:false,busy:false,error:null})}
async function save(owner){
 if(state.editor!==owner||state.busy)return false
 if(state.settings.mode==='image'&&!state.image){publish({error:'请先选择一张本地图片，或切换到其他背景。'});return false}
 const record={schema:1,settings:normalize(state.settings),image:state.image}
 const attempt=++session
 publish({busy:true,error:null})
 try{
  await storage(true,record);saved=record
  if(attempt===session||state.editor===null){setImage(record.image);publish({settings:record.settings,editor:null,dirty:false,busy:false})}
  return true
 }catch(error){if(attempt===session)publish({busy:false,error:storageMessage(error)});return false}
}
function imageError(file){
 if(!file)return '没有选择图片。'
 if(file.size>FILE_LIMIT)return '图片超过 8 MB，请先选择或导出一张较小的图片。'
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))return '请选择 JPG、PNG 或 WebP 图片。'
 return null
}
async function prepareImage(file){
 const error=imageError(file);if(error)throw new Error(error)
 const source=URL.createObjectURL(file)
 try{
  const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('无法读取这张图片，请换一张 JPG、PNG 或 WebP。'));img.src=source})
  if(image.naturalWidth*image.naturalHeight>50000000)throw new Error('图片像素过大，请将长边缩小到 6000 像素以内后重试。')
  const scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight))
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale))
  const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height)
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.84))
  if(!blob||blob.size>IMAGE_LIMIT)throw new Error('处理后的图片仍太大，请换一张细节较少的图片。')
  return {blob,name:String(file.name||'本地图片').slice(0,160),width:canvas.width,height:canvas.height}
 }finally{URL.revokeObjectURL(source)}
}
async function chooseImage(file,owner){
 if(state.editor!==owner||state.busy)return
 const attempt=++session
 publish({busy:true,error:null})
 try{const image=await prepareImage(file);if(attempt!==session||state.editor!==owner)return;setImage(image);publish({settings:{...state.settings,mode:'image'},dirty:true,busy:false})}
 catch(error){if(attempt===session)publish({busy:false,error:error.message})}
}
module.exports={DEFAULTS,PRESETS,DB_NAME,FILE_LIMIT,IMAGE_LIMIT,normalize,imageError,prepareImage,subscribe,getSnapshot,useBackground,load,begin,patch,reset,removeImage,cancel,save,chooseImage}
