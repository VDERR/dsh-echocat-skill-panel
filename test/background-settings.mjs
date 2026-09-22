import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {fileURLToPath} from 'node:url'
import {dirname,join} from 'node:path'
const root=process.env.ECHOCAT_TEST_ROOT||join(dirname(fileURLToPath(import.meta.url)),'..')
const module={exports:{}}
runInNewContext(readFileSync(join(root,'src/client/background-store.js'),'utf8'),{module,require:()=>({}),console,Blob,URL,Set,Object,Number,Math,Promise})
const bg=module.exports
let count=0
const check=(label,pass)=>{if(!pass)throw Error(label);count++;console.log('PASS '+label)}
check('empty configuration restores defaults',JSON.stringify(bg.normalize(null))===JSON.stringify(bg.DEFAULTS))
check('unrecognised fields do not enter settings',!('endpoint' in bg.normalize({endpoint:'https://example.invalid'})))
check('unknown mode falls back safely',bg.normalize({mode:'remote-url'}).mode==='liquid')
check('host-selector strings are not accepted as a theme',bg.normalize({theme:'.host'}).theme==='auto')
check('colour cannot contain a URL or CSS expression',bg.normalize({primary:'url(https://example.invalid)'}).primary===bg.DEFAULTS.primary)
check('hex colour normalisation preserves user colour',bg.normalize({primary:'#AABBCC'}).primary==='#aabbcc')
check('brightness clamped to readable range',bg.normalize({brightness:10000}).brightness===125)
check('opacity cannot remove the readability veil',bg.normalize({veil:-1}).veil===15)
check('non-finite speed rejected',bg.normalize({speed:Infinity}).speed===bg.DEFAULTS.speed)
check('negative image position clamped',bg.normalize({positionX:-200}).positionX===0)
check('string false does not accidentally disable motion',bg.normalize({animate:'false'}).animate===true)
check('boolean false is retained',bg.normalize({animate:false,pointer:false}).animate===false)
check('oversized input rejected before decoding',bg.imageError({size:bg.FILE_LIMIT+1,type:'image/jpeg'}).includes('8 MB'))
check('SVG and non-image payloads rejected',bg.imageError({size:100,type:'image/svg+xml'}).includes('JPG'))
check('supported local raster input accepted',bg.imageError({size:100,type:'image/png'})===null)
check('preset values all obey the same saved schema',bg.PRESETS.every(p=>JSON.stringify(bg.normalize(p.settings))===JSON.stringify(p.settings)))
console.log('RESULT: '+count+'/'+count+' passed')
