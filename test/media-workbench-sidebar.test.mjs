import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../packages/dsh-media-workbench/client.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
async function fixture({ draft = '', occurrences = [], bindings = [], harness = '0.1.5', selected = null } = {}) {
  let module, Panel, descriptor, message, snapshotOfPanel
  // The market id is now owner/repo, derived by Desktop from the repository
  // URL / install record — not a plugin-declared id (see client.js).
  const MARKET_ID = 'cinderzhan/dsh-media-workbench'
  let active = MARKET_ID, current = selected, owner = selected ? { [selected]: MARKET_ID } : {}, nextId = 0
  const ensured = [], writes = [], drafts = [], opened = []
  const business = {projectRoot:'/media-project',topics:[{id:'t1',title:'选题一'}],campaigns:[{id:'c1',name:'Campaign 一'}],bindings}
  const frame = {contentWindow:{postMessage: value => replies.push(value)}}
  const replies = []
  const h = (type,props,...children) => ({type,props:props||{},children:children.flat()})
  const cleanups = []
  const React = { createElement:h, Fragment:'fragment', useSyncExternalStore:(_fn,get)=>{snapshotOfPanel=get;return get()}, useState:()=>[{},()=>{}],useRef:()=>({current:{}}),useEffect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup)} }
  const service = {getSnapshot:()=>({state:{active,added:[MARKET_ID],sessionBindings:owner}}),register:(d,p)=>{if(Object.hasOwn(d,'id'))throw Error('Invalid workbench registration');descriptor=d;Panel=p},leave:()=>{active=null},ensureSession:async args=>{
    ensured.push(args)
    if(args.sessionId && owner[args.sessionId] && owner[args.sessionId]!==MARKET_ID)throw Error('wrong owner')
    const id=args.sessionId||`new-${++nextId}`;owner[id]=MARKET_ID;current=id;opened.push(id);return id
  }}
  // Harness 0.1.6 drops list.current/sessions.open; Desktop exposes currentSession/showSession
  // ('desktop') or only the mainView retention on byId ('retention').
  if (harness === 'desktop') { service.currentSession = () => current; service.showSession = id => { current = id } }
  const summary = id => harness === 'retention' ? { retainedBy: id === current ? { mainView: 1 } : {} } : {}
  const snapshot = () => ({ ...(harness === '0.1.5' ? { current } : {}), byId: Object.fromEntries(business.bindings.map(b => [b.sessionId, summary(b.sessionId)])) })
  vm.runInNewContext(source.replace("import('/api/media-workbench/dock.js')",'Promise.resolve({createDock: fakeDock})'), {
    window:{__ModuleLoader__:{load:r=>{module=r.factory(name=>name==='react'?React:{createPortal:child=>child})}},addEventListener:(_name,fn)=>{message=fn},removeEventListener:()=>{}},
    document:{createElement:()=>({remove(){}}),head:{append(){}}},location:{origin:'http://localhost'},
    fakeDock:(_node,options)=>{options.onFrame(frame);return {frames:[frame],destroy(){}}},
    fetch:async (_path,options)=>{if(options?.body){const body=JSON.parse(options.body);writes.push(body);business.bindings=business.bindings.filter(b=>b.sessionId!==body.data.sessionId);business.bindings.push({...body.data,lastUsedAt:'2026-09-14'})}return {ok:true,json:async()=>business}}
  })
  const ctxForMarket={get:()=>service,inject:(_deps,fn)=>fn({desktopWorkbenches:service,effect:fn=>fn(),sessions:ctxForMarket.sessions}),desktopWorkbenches:service,effect:fn=>fn(),sessions:{refresh:async()=>{},list:{subscribe:()=>()=>{},getSnapshot:snapshot},scope:()=>({get:()=>({input:{for:()=>({state:{getSnapshot:()=>({draft,occurrences})},setDraft:value=>{drafts.push(value);draft=value}})}})})}}
  module.apply(ctxForMarket)
  await tick()
  function flatten(node){return !node||typeof node!=='object'?[]:[node,...(node.children||[]).flatMap(flatten)]}
  const entry = {id:MARKET_ID}
  const tree=Panel({conversation:h('native-conversation'),entry});await tick()
  return {descriptor,tree,flatten,render:()=>Panel({conversation:h('native-conversation'),entry}),getBinding:()=>snapshotOfPanel().binding,unmount:()=>cleanups.forEach(fn=>fn()),ensured,writes,drafts,replies,opened,Panel,frame,setOwner:(id,value)=>{owner[id]=value},setActive:value=>{active=value},send:async intent=>{await message({origin:'http://localhost',source:frame.contentWindow,data:{type:'media-workbench:session',...intent}});await tick()}}
}

test('restores a selected binding loaded before the first panel mount and releases identity on unmount', async()=>{
 const binding={sessionId:'saved',scope:'workbench',title:'Saved',lastUsedAt:'2026-09-14'}
 const f=await fixture({bindings:[binding],selected:'saved'})
 assert.equal(f.getBinding()?.sessionId,'saved')
 f.unmount()
 await f.send({intent:'new'})
 assert.equal(f.ensured.length,0)
})

test('registers a custom market frame, immediately shows business dock, mounts one supplied conversation', async()=>{
  const f=await fixture()
  assert.equal(f.descriptor.customFrame,true)
  assert.equal(Object.hasOwn(f.descriptor,'id'),false,'register() throws if the descriptor carries an id; Desktop derives it from repository')
  assert.equal(f.descriptor.repository,'https://github.com/cinderzhan/dsh-media-workbench')
  assert.equal(f.ensured.length,0,'opening/creating business-only records must not force a session')
  assert.equal(f.flatten(f.tree).filter(n=>n.type==='native-conversation').length,1)
  const root=f.flatten(f.tree).find(n=>n.type==='section')
  assert.ok(root)
  assert.equal(root.props.style.display,'flex')
  assert.equal(root.props.style.flex,1)
  assert.equal(root.props.style.width,'100%')
  assert.equal(root.props.style.maxWidth,'100%')
  assert.equal(root.props.style.minWidth,0)
  assert.equal(root.props.style.minHeight,0)
  assert.equal(root.props.style.overflow,'hidden')
  assert.equal(root.props.style.boxSizing,'border-box')
  assert.equal(root.props.style.position,undefined)
  assert.equal(root.props.style.inset,undefined)
  assert.doesNotMatch(source.slice(0,source.indexOf('function applyLegacy')),/shell\.overlay|claimConversationHost|renderSlot|sidebar\.footer/)
})

test('explicit topic session action uses host ownership bridge, preserves business binding and original intro',async()=>{
 const f=await fixture();await f.send({scope:'topic',entityId:'t1',intent:'new'})
 assert.equal(f.ensured.length,1);assert.equal(f.ensured[0].folder,'/media-project')
 assert.equal(f.writes[0].data.entityId,'t1');assert.equal(f.writes[0].data.scope,'topic')
 assert.match(f.drafts[0],/选题一/);assert.match(f.drafts[0],/media_workbench_read/)
 assert.equal(f.replies[0].sessionId,'new-1')
})

test('new scoped session does not overwrite rich or existing draft',async()=>{
 for(const options of [{draft:'用户草稿'},{occurrences:[{id:'reference'}]}]){const f=await fixture(options);await f.send({scope:'campaign',entityId:'c1',intent:'new'});assert.equal(f.drafts.length,0);assert.equal(f.ensured.length,1)}
})

test('hidden workbench messages cannot create sessions',async()=>{
 const f=await fixture();f.setActive('ming-life');await f.send({intent:'new'});assert.equal(f.ensured.length,0)
})

test('saved session opens through host; foreign ownership never mutates binding',async()=>{
 const binding={sessionId:'saved',scope:'topic',entityId:'t1',title:'选题一',lastUsedAt:'2026-09-14'}
 const f=await fixture({bindings:[binding]});await f.send({scope:'topic',entityId:'t1',sessionId:'saved'})
 assert.equal(f.ensured[0].sessionId,'saved');assert.equal(f.drafts.length,0)
 const bad=await fixture({bindings:[binding]});bad.setOwner('saved','ming-life');await bad.send({scope:'topic',entityId:'t1',sessionId:'saved'})
 assert.equal(bad.writes.length,0);assert.equal(bad.replies[0].error,'wrong owner')
})
test('legacy hosts boot without market dependency and release fallback when market arrives', async()=>{
 let module, marketCallback, disposed=false, registered=false
 const slots=[],services={}
 vm.runInNewContext(source,{
  window:{__ModuleLoader__:{load:r=>{module=r.factory(name=>name==='react'?{createElement:()=>{}}:{})}},addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>null},fetch:async()=>({ok:true,json:async()=>({bindings:[]})})
 })
 const ctx={get:()=>registeredService,effect:fn=>fn(),sessions:{list:{subscribe:()=>()=>{},getSnapshot:()=>({current:null})}},
  slots:{inject:(_name,fn)=>fn(),register:definition=>slots.push(definition.name)},workspaces:{},
  inject:(deps,fn)=>{if(deps.includes('desktopWorkbenches'))marketCallback=fn;else fn(ctx)},
  plugin:plugin=>{plugin.apply(ctx);return {dispose:()=>{disposed=true}}}}
 let registeredService
 Object.defineProperty(ctx,'desktopWorkbenches',{get(){throw Error('cannot get property desktopWorkbenches without inject')}})
 assert.deepEqual(Array.from(module.inject),['sessions','conversation'])
 module.apply(ctx);await tick()
 assert.deepEqual(slots,['sidebar.footer.action','shell.overlay'])
 services.getSnapshot=()=>({state:{active:null,added:[],sessionBindings:{}}});services.register=()=>{registered=true}
 registeredService=services;marketCallback({effect:ctx.effect,sessions:ctx.sessions,desktopWorkbenches:services});await tick()
 assert.equal(disposed,true);assert.equal(registered,true)
 const manifest=JSON.parse(readFileSync(new URL('../packages/dsh-media-workbench/package.json',import.meta.url),'utf8'))
 // The client module loader skips injected packages a host does not have, so
 // naming the workbench service only orders it first where it exists; legacy
 // hosts without it still boot (asserted above).
 assert.ok(manifest.dsh.client.inject.includes('dsh-desktop-workbenches'))
 assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-workspace-controller'))
})

test('Harness 0.1.6: current session comes from Desktop service or mainView retention, never list.current', async()=>{
 const binding={sessionId:'saved',scope:'topic',entityId:'t1',title:'选题一',lastUsedAt:'2026-09-14'}
 for(const harness of ['desktop','retention','0.1.5']){
  const f=await fixture({bindings:[binding],harness});await f.send({scope:'topic',entityId:'t1',sessionId:'saved'})
  assert.equal(f.replies[0].error,undefined,harness)
  const select=f.flatten(f.render()).find(n=>n.type==='select')
  assert.equal(select.props.value,'saved',`${harness} must resolve the shown session`)
 }
})

async function legacyFixture(host){
 let module
 const binding={sessionId:'saved',scope:'workbench',title:'内容运营工作台',lastUsedAt:'2026-09-14'}
 vm.runInNewContext(source,{
  window:{__ModuleLoader__:{load:r=>{module=r.factory(name=>name==='react'?{createElement:()=>{}}:{})}},addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>'1',setItem(){}},fetch:async()=>({ok:true,json:async()=>({bindings:[binding]})})
 })
 const ctx={get:()=>undefined,effect:fn=>fn(),sessions:{refresh:async()=>{},list:{subscribe:()=>()=>{},getSnapshot:()=>({byId:{saved:{}}})},...host.sessions},
  slots:{inject(){},register(){}},workspaces:{},inject:(deps,fn)=>{if(!deps.includes('desktopWorkbenches'))fn(ctx)},plugin:plugin=>{plugin.apply(ctx);return {dispose(){}}}}
 Object.defineProperty(ctx,'desktopWorkbenches',{get(){throw Error('cannot get property desktopWorkbenches without inject')}})
 if(host.uiWorkspace)ctx.uiWorkspace=host.uiWorkspace
 else Object.defineProperty(ctx,'uiWorkspace',{get(){throw Error('cannot get property uiWorkspace without inject')}})
 module.apply(ctx);await tick();await tick();await tick()
}

test('legacy restore opens sessions via uiWorkspace on Harness 0.1.6 and sessions.open on 0.1.5', async()=>{
 const viaUi=[];await legacyFixture({uiWorkspace:{openSession:(id,source)=>viaUi.push([id,source])}})
 assert.deepEqual(viaUi,[['saved','workbench']])
 const viaSessions=[];await legacyFixture({sessions:{open:id=>viaSessions.push(id)}})
 assert.deepEqual(viaSessions,['saved'])
})
