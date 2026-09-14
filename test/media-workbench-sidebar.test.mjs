import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../packages/dsh-media-workbench/client.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
async function fixture({ draft = '', occurrences = [], bindings = [] } = {}) {
  let module, Panel, descriptor, message
  let active = 'media-workbench', current = null, owner = {}, nextId = 0
  const ensured = [], writes = [], drafts = [], opened = []
  const business = {projectRoot:'/media-project',topics:[{id:'t1',title:'选题一'}],campaigns:[{id:'c1',name:'Campaign 一'}],bindings}
  const frame = {contentWindow:{postMessage: value => replies.push(value)}}
  const replies = []
  const h = (type,props,...children) => ({type,props:props||{},children:children.flat()})
  const React = { createElement:h, Fragment:'fragment', useSyncExternalStore:(_fn,get)=>get(), useState:()=>[{},()=>{}],useRef:()=>({current:{}}),useEffect:fn=>fn() }
  const service = {getSnapshot:()=>({state:{active,added:['media-workbench'],sessionBindings:owner}}),register:(d,p)=>{descriptor=d;Panel=p},leave:()=>{active=null},ensureSession:async args=>{
    ensured.push(args)
    if(args.sessionId && owner[args.sessionId] && owner[args.sessionId]!=='media-workbench')throw Error('wrong owner')
    const id=args.sessionId||`new-${++nextId}`;owner[id]='media-workbench';current=id;opened.push(id);return id
  }}
  vm.runInNewContext(source.replace("import('/api/media-workbench/dock.js')",'Promise.resolve({createDock: fakeDock})'), {
    window:{__ModuleLoader__:{load:r=>{module=r.factory(name=>name==='react'?React:{createPortal:child=>child})}},addEventListener:(_name,fn)=>{message=fn},removeEventListener:()=>{}},
    document:{createElement:()=>({remove(){}}),head:{append(){}}},location:{origin:'http://localhost'},
    fakeDock:(_node,options)=>{options.onFrame(frame);return {frames:[frame],destroy(){}}},
    fetch:async (_path,options)=>{if(options?.body){const body=JSON.parse(options.body);writes.push(body);business.bindings=business.bindings.filter(b=>b.sessionId!==body.data.sessionId);business.bindings.push({...body.data,lastUsedAt:'2026-09-14'})}return {ok:true,json:async()=>business}}
  })
  module.apply({desktopWorkbenches:service,effect:fn=>fn(),sessions:{refresh:async()=>{},list:{subscribe:()=>()=>{},getSnapshot:()=>({current,byId:Object.fromEntries(business.bindings.map(b=>[b.sessionId,{}]))})},scope:()=>({get:()=>({input:{for:()=>({state:{getSnapshot:()=>({draft,occurrences})},setDraft:value=>{drafts.push(value);draft=value}})}})})}})
  await tick()
  function flatten(node){return !node||typeof node!=='object'?[]:[node,...(node.children||[]).flatMap(flatten)]}
  const tree=Panel({conversation:h('native-conversation')});await tick()
  return {descriptor,tree,flatten,ensured,writes,drafts,replies,opened,Panel,frame,setOwner:(id,value)=>{owner[id]=value},setActive:value=>{active=value},send:async intent=>{await message({origin:'http://localhost',source:frame.contentWindow,data:{type:'media-workbench:session',...intent}});await tick()}}
}

test('registers a custom market frame, immediately shows business dock, mounts one supplied conversation', async()=>{
  const f=await fixture()
  assert.equal(f.descriptor.customFrame,true)
  assert.equal(f.descriptor.id,'media-workbench')
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
  assert.doesNotMatch(source,/shell\.overlay|claimConversationHost|renderSlot|sidebar\.footer/)
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
