window.__ModuleLoader__.load({ id: 'dsh-media-workbench', factory: require => {
  const React = require('react')
  const h = React.createElement
  const { createPortal } = require('react-dom')
  // Harness 0.1.6 removed sessions.open/clear and list.current. Prefer the
  // Desktop workbench service, then uiWorkspace, then the 0.1.5 session APIs.
  // Cordis throws when reading an uninjected service, so probe defensively.
  const peek = (ctx, name) => { try { return ctx[name] } catch { return undefined } }
  function currentSession(ctx) {
    const service = peek(ctx, 'desktopWorkbenches')
    if (typeof service?.currentSession === 'function') return service.currentSession()
    const snapshot = ctx.sessions.list.getSnapshot() || {}
    const byId = snapshot.byId || {}
    return Object.keys(byId).find(id => (byId[id]?.retainedBy?.mainView ?? 0) > 0) ?? snapshot.current
  }
  function showSession(ctx, sessionId) {
    const service = peek(ctx, 'desktopWorkbenches')
    if (typeof service?.showSession === 'function') return service.showSession(sessionId)
    const ui = peek(ctx, 'uiWorkspace')
    if (typeof ui?.openSession === 'function') return ui.openSession(sessionId, 'workbench')
    if (typeof ctx.sessions.open === 'function') return ctx.sessions.open(sessionId)
    throw new Error('当前 Desktop 不支持打开会话，请升级 Desktop。')
  }
  function applyMarket(ctx) {
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
        const selected = currentSession(ctx)
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
      const id = currentSession(ctx)
      if (id === lastCurrent) return
      lastCurrent = id
      const binding = owns(id) ? bindings.get(id) || null : null
      change({ binding })
      if (binding) request('mutate', { action: 'bindSession', data: { sessionId: binding.sessionId, scope: binding.scope, ...(binding.entityId ? { entityId: binding.entityId } : {}), title: binding.title, lastUsedAt: new Date().toISOString() } }).catch(error => change({ error: error.message }))
    }))
    request('state').then(() => { const id = currentSession(ctx); change({ binding: owns(id) ? bindings.get(id) || null : null }) }).catch(error => change({ error: error.message }))
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
        h('section', { 'aria-label':'内容运营工作台', style:{display:'flex',flexDirection:'column',flex:1,width:'100%',maxWidth:'100%',minWidth:0,minHeight:0,background:'#ffffff',pointerEvents:'auto',overflow:'hidden',boxSizing:'border-box'} },
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
    ctx.effect(() => service.register({ id: workbenchId, version: '0.12.3', author: 'cinderzhan', title: '内容运营工作台', icon: '▦', description: '管理选题、达人、Campaign、营销日历和数据，保留四窗口布局与原生会话。', audience: '内容与自媒体运营', requirements: '业务资料可独立使用；会话使用 Desktop 模型配置。', initialization: 'empty', customFrame: true }, Panel))
  }
  function applyLegacy(ctx) {
    let current = { open: false, binding: null, error: '', busy: false }
    const listeners = new Set()
    const frames = new Set()
    let bindings = new Map()
    let lastCurrent
    let canEmbedConversation = false
    const change = patch => { current = { ...current, ...patch }; if (Object.hasOwn(patch, 'open')) { try { localStorage.setItem('media-workbench-open', patch.open ? '1' : '0') } catch {} } listeners.forEach(fn => fn()) }
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
      if (!canEmbedConversation) throw new Error('当前 Desktop 缺少工作台会话承载接口。请先完成宿主适配；此状态不代表工作台会话接入已通过验收。')
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
          const workspace = await ctx.workspaces.create({ path: state.projectRoot })
          sessionId = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
          const next = await request('mutate', { action: 'bindSession', data: { sessionId, scope, ...(entityId ? { entityId } : {}), title } })
          binding = next.bindings.find(b => b.sessionId === sessionId)
          const scoped = ctx.sessions.scope(sessionId)
          const conversation = scoped?.get('conversation')
          if (conversation) {
            const input = conversation.input.for(scoped)
            const draft = input.state.getSnapshot().draft || ''
            if (!draft.trim() && !(input.state.getSnapshot().occurrences?.length) && (!input.state.getSnapshot().phase || input.state.getSnapshot().phase === 'plain')) input.setDraft(`这是内容运营工作台的${scope === 'topic' ? '选题' : scope === 'campaign' ? 'Campaign' : '全局'}会话，绑定对象：${title}。请先调用 media_workbench_read 读取最新业务记录。只负责记录、分析和录入整理，不发布或产出营销内容。`)
          }
        } else {
          await ctx.sessions.refresh()
          const known = ctx.sessions.list.getSnapshot().byId
          if (!known?.[sessionId]) throw new Error('此会话已删除或不可用，请新建会话。业务数据仍保留。')
          await request('mutate', { action: 'bindSession', data: { sessionId, scope, ...(entityId ? { entityId } : {}), title, lastUsedAt: new Date().toISOString() } })
        }
        showSession(ctx, sessionId)
        change({ binding, open: true })
        return { sessionId, scope, entityId }
      } finally { change({ busy: false }) }
    }
    async function openWorkbench(restoreConversation = false) {
      change({ error: '' })
      try {
        const state = await request('state')
        await ctx.sessions.refresh()
        const known = ctx.sessions.list.getSnapshot().byId || {}
        const recent = state.bindings.filter(b => !b.archivedAt && known[b.sessionId]).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0]
        if (restoreConversation && recent) { showSession(ctx, recent.sessionId); change({ binding: recent, open: true }) }
        else change({ open: true, binding: bindings.get(currentSession(ctx)) || null })
      } catch (error) { change({ error: error.message, open: true }) }
    }
    const message = async event => {
      if (event.origin !== location.origin || ![...frames].some(frame => frame.contentWindow === event.source) || event.data?.type !== 'media-workbench:session') return
      try { const result = await bind(event.data); event.source.postMessage({ type: 'media-workbench:session-result', ...result }, event.origin) }
      catch (error) { change({ error: error.message }); event.source.postMessage({ type: 'media-workbench:session-result', error: error.message }, event.origin) }
    }
    ctx.effect(() => { window.addEventListener('message', message); return () => window.removeEventListener('message', message) })
    ctx.effect(() => ctx.sessions.list.subscribe(() => {
      const id = currentSession(ctx)
      if (id === lastCurrent) return
      lastCurrent = id
      const binding = bindings.get(id) || null
      change({ binding, open: current.open && (current.busy || !!binding) })
      if (binding) request('mutate', { action: 'bindSession', data: { sessionId: binding.sessionId, scope: binding.scope, ...(binding.entityId ? { entityId: binding.entityId } : {}), title: binding.title, lastUsedAt: new Date().toISOString() } }).catch(error => change({ error: error.message }))
    }))
    request('state').then(async () => {
      if (localStorage.getItem('media-workbench-open') === '1') { await openWorkbench(true); return }
      const id = currentSession(ctx)
      lastCurrent = id
      change({ binding: bindings.get(id) || null })
    }).catch(error => change({ error: error.message }))
    function SidebarButton({ wide }) {
      const state = React.useSyncExternalStore(subscribe, () => current)
      return h('button', { type: 'button', title: '内容运营工作台', 'aria-label': '内容运营工作台', onClick: () => openWorkbench(true), style: { minWidth: wide === false ? 34 : 90, flexShrink: 0, whiteSpace: 'nowrap', minHeight: 34, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: 0, borderRadius: 7, background: state.open ? 'var(--dsw-alias-interactive-bg-hover,#eef2f7)' : 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' } }, h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('rect', { x: 3, y: 4, width: 18, height: 17, rx: 2 }), h('path', { d: 'M3 9h18M8 2v4m8-4v4M7 13h3m4 0h3m-10 4h3' })), wide !== false && '内容运营')
    }
    function Panel({ conversationHost, claimConversationHost, renderConversation }) {
      canEmbedConversation = typeof claimConversationHost === 'function' && typeof renderConversation === 'function'
      const state = React.useSyncExternalStore(subscribe, () => current)
      const [left, setLeft] = React.useState(280)
      const [chat, setChat] = React.useState(null)
      const dockRef = React.useRef(null)
      React.useEffect(() => {
        const overlay = document.querySelector('[data-shell-overlay]')
        const frame = overlay?.parentElement
        if (!frame) return
        // The grid animates without resizing its frame. Track the sidebar itself.
        const sidebar = frame.querySelector('[data-slot="sidebar"]')?.parentElement || frame.firstElementChild
        const measure = () => {
          const bounds = overlay.getBoundingClientRect()
          const scale = overlay.offsetWidth > 0 ? bounds.width / overlay.offsetWidth : 1
          const width = sidebar && sidebar !== overlay
            ? (sidebar.getBoundingClientRect().right - bounds.left) / (scale || 1)
            : Number.parseFloat(getComputedStyle(frame).gridTemplateColumns.split(' ')[0])
          if (Number.isFinite(width)) setLeft(Math.max(0, width))
        }
        const resize = new ResizeObserver(measure)
        resize.observe(frame); resize.observe(overlay)
        if (sidebar && sidebar !== overlay) resize.observe(sidebar)
        const mutations = new MutationObserver(measure)
        mutations.observe(frame, { attributes: true, attributeFilter: ['style', 'class', 'data-sidebar-collapsed'] })
        measure()
        return () => { resize.disconnect(); mutations.disconnect() }
      }, [])
      React.useEffect(() => {
        if (!state.open || !claimConversationHost) return
        const release = claimConversationHost('dsh-media-workbench')
        if (!release) change({ error: '另一个工作台正在使用会话区域，请先退出该工作台。' })
        return release || undefined
      }, [state.open, claimConversationHost])
      React.useEffect(() => {
        if (!state.open || !dockRef.current) return
        let cancelled = false, dock
        const style = document.createElement('link'); style.rel='stylesheet';style.href='/api/media-workbench/dock.css';document.head.append(style)
        import('/api/media-workbench/dock.js').then(({createDock}) => {
          if (cancelled) return
          dock = createDock(dockRef.current, { hosted:true, onFrame:frame=>frames.add(frame), onChat:node=>setChat(node), onClose:()=>change({open:false}) })
        }).catch(error=>change({error:error.message}))
        return () => { cancelled=true; if(dock){for(const frame of dock.frames)frames.delete(frame);dock.destroy()} style.remove();setChat(null) }
      }, [state.open])
      return h(React.Fragment, null,
        state.open && h('section', { 'aria-label':'内容运营工作台', style:{position:'absolute',inset:`0 0 0 ${left}px`,display:'flex',flexDirection:'column',background:'#ffffff',pointerEvents:'auto',overflow:'auto'} },
          state.error && h('p',{role:'alert',style:{color:'#a12a25',margin:'6px 12px'}},state.error),
          h('div',{ref:dockRef,style:{flex:1,minHeight:0,height:'100%'}})),
        state.open && chat && createPortal(h('div',{style:{height:'100%',minHeight:0,display:'flex',flexDirection:'column'}},
          h('div',{style:{padding:'6px 10px',display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid #ededeb',fontSize:11}},
            h('select',{'aria-label':'工作台会话',value:state.binding?.sessionId||'',style:{flex:1,minWidth:0,maxWidth:'100%',fontSize:11},disabled:state.busy||!canEmbedConversation,onChange:event=>{const b=bindings.get(event.target.value);if(b)bind({scope:b.scope,entityId:b.entityId,sessionId:b.sessionId,intent:'resume'}).catch(error=>change({error:error.message}))}},
              h('option',{value:'',disabled:true},'选择工作台会话'),
              [...bindings.values()].sort((a,b)=>b.lastUsedAt.localeCompare(a.lastUsedAt)).map(b=>h('option',{key:b.sessionId,value:b.sessionId},`${b.title} · ${b.sessionId.slice(-6)}`))),
            h('button',{type:'button',onClick:()=>bind({intent:'new',scope:state.binding?.scope||'workbench',entityId:state.binding?.entityId}).catch(error=>change({error:error.message})),disabled:state.busy||!canEmbedConversation},'新建会话')),
          h('div',{'data-media-native-conversation':true,style:{position:'relative',flex:1,minHeight:0,minWidth:0,display:'flex',flexDirection:'column'}},!canEmbedConversation ? h('div',{role:'status',style:{padding:16,fontSize:12,lineHeight:1.8}},h('p',null,'当前 Desktop 尚未提供工作台内会话接口。业务面板可用，会话接入待适配。'),state.binding&&h('button',{type:'button',onClick:()=>{showSession(ctx, state.binding.sessionId);change({open:false})}},'退出工作台并打开普通对话')) : !state.binding ? h('p',{style:{padding:20,fontSize:12,lineHeight:1.8,color:'#666'}},'新建工作台会话，或从选题、Campaign 中选择关联会话。') : conversationHost==='dsh-media-workbench' ? renderConversation() : h('p',{role:'status',style:{padding:16}},'会话区暂被其他工作台占用，请先退出该工作台。'))
        ),chat),
        !state.open && state.binding && h('button',{type:'button',onClick:()=>openWorkbench(false),style:{position:'absolute',top:48,right:20,border:'1px solid #e3e3e0',background:'#f7f7f5',color:'#37352f',borderRadius:6,padding:'7px 12px',cursor:'pointer',fontSize:12}},`内容运营 · ${state.binding.title} · 返回工作台`)
      )
    }
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'media-workbench-open', order: 16 }, SidebarButton))
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'media-workbench-panel', order: 6 }, Panel))
  }
  function apply(ctx) {
    // The market service does not exist in older Desktop builds. Never make it
    // a mandatory dependency of this client or the entire plugin stays pending.
    if (ctx.get('desktopWorkbenches')) return ctx.inject(['desktopWorkbenches'], applyMarket)
    let legacy
    ctx.inject(['slots', 'workspaces'], legacyCtx => {
      if (!ctx.get('desktopWorkbenches')) legacy = legacyCtx.plugin({ inject: ['slots', 'sessions', 'conversation', 'workspaces'], apply: applyLegacy })
    })
    ctx.inject(['desktopWorkbenches'], marketCtx => {
      if (legacy) { legacy.dispose(); legacy = null }
      applyMarket(marketCtx)
    })
  }
  return { inject: ['sessions', 'conversation'], apply }
} })
