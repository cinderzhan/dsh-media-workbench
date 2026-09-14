window.__ModuleLoader__.load({ id: 'dsh-media-workbench', factory: require => {
  const React = require('react')
  const h = React.createElement
  const { createPortal } = require('react-dom')
  function apply(ctx) {
    let current = { binding: null, error: '', busy: false }
    const listeners = new Set()
    const frames = new Set()
    let bindings = new Map()
    let lastCurrent
    const workbenchId = 'media-workbench'
    const service = ctx.desktopWorkbenches
    const isActive = () => service.getSnapshot().state.active === workbenchId && service.getSnapshot().state.added.includes(workbenchId)
    const owns = id => service.getSnapshot().state.sessionBindings[id] === workbenchId
    const change = patch => { current = { ...current, ...patch }; listeners.forEach(fn => fn()) }
    const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
    const request = async (path, data) => {
      const response = await fetch(`/api/media-workbench/${path}`, data ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : {})
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '工作台服务暂时不可用')
      if (Array.isArray(result.bindings)) bindings = new Map(result.bindings.filter(b => !b.archivedAt).map(b => [b.sessionId, b]))
      return result
    }
    async function bind(intent) {
      if (current.busy) return
      if (!isActive()) throw new Error('请先打开内容运营工作台。')
      change({ busy: true, error: '' })
      try {
        const state = await request('state')
        const scope = intent.scope || 'workbench'
        if (!['workbench', 'topic', 'campaign'].includes(scope)) throw new Error('无效的会话范围')
        const entityId = scope === 'workbench' ? undefined : intent.entityId
        const entity = scope === 'topic' ? state.topics.find(t => t.id === entityId && !t.archivedAt) : scope === 'campaign' ? state.campaigns.find(c => c.id === entityId && !c.archivedAt) : null
        if (scope !== 'workbench' && !entity) throw new Error('绑定对象不存在或已归档')
        const candidates = state.bindings.filter(b => b.scope === scope && (b.entityId || undefined) === entityId && !b.archivedAt).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
        let binding = intent.sessionId ? candidates.find(b => b.sessionId === intent.sessionId) : intent.intent === 'new' ? null : candidates[0]
        if (intent.sessionId && !binding) throw new Error('该会话不属于此对象')
        let sessionId = binding?.sessionId
        const title = entity?.title || entity?.name || '内容运营工作台'
        if (!sessionId) {
          if (!isActive()) throw new Error('工作台已切换，请返回后重试。')
          sessionId = await service.ensureSession({ workbenchId, folder: state.projectRoot })
          const next = await request('mutate', { action: 'bindSession', data: { sessionId, scope, ...(entityId ? { entityId } : {}), title } })
          binding = next.bindings.find(b => b.sessionId === sessionId)
          const scoped = ctx.sessions.scope(sessionId)
          const conversation = scoped?.get('conversation')
          if (conversation && owns(sessionId)) {
            const input = conversation.input.for(scoped)
            const draft = input.state.getSnapshot().draft || ''
            if (!draft.trim() && !(input.state.getSnapshot().occurrences?.length) && (!input.state.getSnapshot().phase || input.state.getSnapshot().phase === 'plain')) input.setDraft(`这是内容运营工作台的${scope === 'topic' ? '选题' : scope === 'campaign' ? 'Campaign' : '全局'}会话，绑定对象：${title}。请先调用 media_workbench_read 读取最新业务记录。只负责记录、分析和录入整理，不发布或产出营销内容。`)
          }
        } else {
          await ctx.sessions.refresh()
          const known = ctx.sessions.list.getSnapshot().byId
          if (!known?.[sessionId]) throw new Error('此会话已删除或不可用，请新建会话。业务数据仍保留。')
          if (!isActive()) throw new Error('工作台已切换，请返回后重试。')
          await service.ensureSession({ workbenchId, folder: state.projectRoot, sessionId })
          await request('mutate', { action: 'bindSession', data: { sessionId, scope, ...(entityId ? { entityId } : {}), title, lastUsedAt: new Date().toISOString() } })
        }
        // Desktop ensures ownership and opens only if navigation is still current.
        const selected = ctx.sessions.list.getSnapshot().current
        change({ binding: owns(selected) ? bindings.get(selected) || null : null })
        return { sessionId, scope, entityId }
      } finally { change({ busy: false }) }
    }
    const message = async event => {
      if (!isActive() || event.origin !== location.origin || ![...frames].some(frame => frame.contentWindow === event.source) || event.data?.type !== 'media-workbench:session') return
      try { const result = await bind(event.data); event.source.postMessage({ type: 'media-workbench:session-result', ...result }, event.origin) }
      catch (error) { change({ error: error.message }); event.source.postMessage({ type: 'media-workbench:session-result', error: error.message }, event.origin) }
    }
    ctx.effect(() => { window.addEventListener('message', message); return () => window.removeEventListener('message', message) })
    ctx.effect(() => ctx.sessions.list.subscribe(() => {
      const id = ctx.sessions.list.getSnapshot().current
      if (id === lastCurrent) return
      lastCurrent = id
      const binding = owns(id) ? bindings.get(id) || null : null
      change({ binding })
      if (binding) request('mutate', { action: 'bindSession', data: { sessionId: binding.sessionId, scope: binding.scope, ...(binding.entityId ? { entityId: binding.entityId } : {}), title: binding.title, lastUsedAt: new Date().toISOString() } }).catch(error => change({ error: error.message }))
    }))
    request('state').then(() => change({ binding: owns(ctx.sessions.list.getSnapshot().current) ? bindings.get(ctx.sessions.list.getSnapshot().current) || null : null })).catch(error => change({ error: error.message }))
    function Panel({ conversation }) {
      const state = React.useSyncExternalStore(subscribe, () => current)
      const [chat, setChat] = React.useState(null)
      const dockRef = React.useRef(null)
      React.useEffect(() => {
        if (!dockRef.current) return
        let cancelled = false, dock
        const style = document.createElement('link'); style.rel='stylesheet';style.href='/api/media-workbench/dock.css';document.head.append(style)
        import('/api/media-workbench/dock.js').then(({createDock}) => {
          if (cancelled) return
          dock = createDock(dockRef.current, { hosted:true, onFrame:frame=>frames.add(frame), onChat:node=>setChat(node), onClose:()=>service.leave() })
        }).catch(error=>change({error:error.message}))
        return () => { cancelled=true; if(dock){for(const frame of dock.frames)frames.delete(frame);dock.destroy()} style.remove();setChat(null) }
      }, [])
      return h(React.Fragment, null,
        h('section', { 'aria-label':'内容运营工作台', style:{position:'absolute',inset:0,display:'flex',flexDirection:'column',background:'#ffffff',pointerEvents:'auto',overflow:'auto'} },
          state.error && h('p',{role:'alert',style:{color:'#a12a25',margin:'6px 12px'}},state.error),
          h('div',{ref:dockRef,style:{flex:1,minHeight:0,height:'100%'}})),
        chat && createPortal(h('div',{style:{height:'100%',minHeight:0,display:'flex',flexDirection:'column'}},
          h('div',{style:{padding:'6px 10px',display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid #ededeb',fontSize:11}},
            h('select',{'aria-label':'工作台会话',value:state.binding?.sessionId||'',style:{flex:1,minWidth:0,maxWidth:'100%',fontSize:11},disabled:state.busy,onChange:event=>{const b=bindings.get(event.target.value);if(b)bind({scope:b.scope,entityId:b.entityId,sessionId:b.sessionId,intent:'resume'}).catch(error=>change({error:error.message}))}},
              h('option',{value:'',disabled:true},'选择工作台会话'),
              [...bindings.values()].sort((a,b)=>b.lastUsedAt.localeCompare(a.lastUsedAt)).map(b=>h('option',{key:b.sessionId,value:b.sessionId},`${b.title} · ${b.sessionId.slice(-6)}`))),
            h('button',{type:'button',onClick:()=>bind({intent:'new',scope:state.binding?.scope||'workbench',entityId:state.binding?.entityId}).catch(error=>change({error:error.message})),disabled:state.busy},'新建会话')),
          h('div',{'data-media-native-conversation':true,style:{position:'relative',flex:1,minHeight:0,minWidth:0,display:'flex',flexDirection:'column'}},conversation)
        ),chat)
      )
    }
    ctx.effect(() => service.register({ id: workbenchId, version: '0.12.0', author: 'cinderzhan', title: '内容运营工作台', icon: '▦', description: '管理选题、达人、Campaign、营销日历和数据，保留四窗口布局与原生会话。', audience: '内容与自媒体运营', requirements: '业务资料可独立使用；会话使用 Desktop 模型配置。', initialization: 'empty', customFrame: true }, Panel))
  }
  return { inject: ['desktopWorkbenches', 'sessions', 'conversation'], apply }
} })
