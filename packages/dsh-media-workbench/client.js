window.__ModuleLoader__.load({ id: 'dsh-media-workbench', factory: require => {
  const React = require('react')
  const h = React.createElement
  const { createPortal } = require('react-dom')
  function apply(ctx) {
    let current = { open: false, binding: null, error: '', busy: false }
    const listeners = new Set()
    const frames = new Set()
    let bindings = new Map()
    let lastCurrent
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
          ctx.sessions.open(sessionId)
          const next = await request('mutate', { action: 'bindSession', data: { sessionId, scope, ...(entityId ? { entityId } : {}), title } })
          binding = next.bindings.find(b => b.sessionId === sessionId)
          const scoped = ctx.sessions.scope(sessionId)
          const conversation = scoped?.get('conversation')
          if (conversation) {
            const input = conversation.input.for(scoped)
            const draft = input.state.getSnapshot().draft || ''
            if (!draft.trim()) input.setDraft(`这是内容运营工作台的${scope === 'topic' ? '选题' : scope === 'campaign' ? 'Campaign' : '全局'}会话，绑定对象：${title}。请先调用 media_workbench_read 读取最新业务记录。只负责记录、分析和录入整理，不发布或产出营销内容。`)
          }
        } else {
          await ctx.sessions.refresh()
          const known = ctx.sessions.list.getSnapshot().byId
          if (!known?.[sessionId]) throw new Error('此会话已删除或不可用，请新建会话。业务数据仍保留。')
          await request('mutate', { action: 'bindSession', data: { sessionId, scope, ...(entityId ? { entityId } : {}), title, lastUsedAt: new Date().toISOString() } })
        }
        ctx.sessions.open(sessionId)
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
        if (restoreConversation && recent) { ctx.sessions.open(recent.sessionId); change({ binding: recent, open: true }) }
        else change({ open: true, binding: bindings.get(ctx.sessions.list.getSnapshot().current) || null })
      } catch (error) { change({ error: error.message, open: true }) }
    }
    const message = async event => {
      if (event.origin !== location.origin || ![...frames].some(frame => frame.contentWindow === event.source) || event.data?.type !== 'media-workbench:session') return
      try { const result = await bind(event.data); event.source.postMessage({ type: 'media-workbench:session-result', ...result }, event.origin) }
      catch (error) { change({ error: error.message }); event.source.postMessage({ type: 'media-workbench:session-result', error: error.message }, event.origin) }
    }
    ctx.effect(() => { window.addEventListener('message', message); return () => window.removeEventListener('message', message) })
    ctx.effect(() => ctx.sessions.list.subscribe(() => {
      const id = ctx.sessions.list.getSnapshot().current
      if (id === lastCurrent) return
      lastCurrent = id
      const binding = bindings.get(id) || null
      change({ binding, open: current.open && (current.busy || !!binding) })
      if (binding) request('mutate', { action: 'bindSession', data: { sessionId: binding.sessionId, scope: binding.scope, ...(binding.entityId ? { entityId: binding.entityId } : {}), title: binding.title, lastUsedAt: new Date().toISOString() } }).catch(error => change({ error: error.message }))
    }))
    request('state').then(() => {
      const id = ctx.sessions.list.getSnapshot().current
      lastCurrent = id
      change({ binding: bindings.get(id) || null })
    }).catch(error => change({ error: error.message }))
    function SidebarButton({ wide }) {
      const state = React.useSyncExternalStore(subscribe, () => current)
      return h('button', { type: 'button', title: '内容运营工作台', 'aria-label': '内容运营工作台', onClick: () => openWorkbench(true), style: { width: '100%', minHeight: 34, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: 0, borderRadius: 7, background: state.open ? 'var(--dsw-alias-interactive-bg-hover,#eef2f7)' : 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' } }, h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('rect', { x: 3, y: 4, width: 18, height: 17, rx: 2 }), h('path', { d: 'M3 9h18M8 2v4m8-4v4M7 13h3m4 0h3m-10 4h3' })), wide !== false && '内容运营')
    }
    function Panel({ conversationHost, claimConversationHost, renderConversation }) {
      const state = React.useSyncExternalStore(subscribe, () => current)
      const [left, setLeft] = React.useState(280)
      const [chat, setChat] = React.useState(null)
      const dockRef = React.useRef(null)
      React.useEffect(() => {
        const overlay = document.querySelector('[data-shell-overlay]')
        const frame = overlay?.parentElement
        if (!frame) return
        const measure = () => { const width = Number.parseFloat(getComputedStyle(frame).gridTemplateColumns.split(' ')[0]); if (Number.isFinite(width)) setLeft(width) }
        const resize = new ResizeObserver(measure); resize.observe(frame)
        const mutations = new MutationObserver(measure); mutations.observe(frame, { attributes: true, attributeFilter: ['style'] }); measure()
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
            h('span',{style:{flex:1}},state.binding ? `归属：${state.binding.title}` : '选择或新建工作台会话'),
            h('button',{type:'button',onClick:()=>bind({intent:'new'}).catch(error=>change({error:error.message})),disabled:state.busy},'新建会话')),
          h('div',{style:{position:'relative',flex:1,minHeight:0,minWidth:0,display:'flex',flexDirection:'column'}},!state.binding ? h('p',{style:{padding:20,fontSize:12,lineHeight:1.8,color:'#777670'}},'先新建工作台会话，或从选题、Campaign 中选择关联会话。普通会话不会自动归属此工作台。') : conversationHost==='dsh-media-workbench' && renderConversation ? renderConversation() : h('p',{style:{padding:16}},'当前宿主尚未提供常驻会话接口，请更新 Desktop 的布局插件。'))
        ),chat),
        !state.open && state.binding && h('button',{type:'button',onClick:()=>openWorkbench(false),style:{position:'absolute',top:48,right:20,border:'1px solid #e3e3e0',background:'#f7f7f5',color:'#37352f',borderRadius:6,padding:'7px 12px',cursor:'pointer',fontSize:12}},`内容运营 · ${state.binding.title} · 返回工作台`)
      )
    }
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'media-workbench-open', order: 16 }, SidebarButton))
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'media-workbench-panel', order: 6 }, Panel))
  }
  return { inject: ['slots', 'sessions', 'conversation', 'workspaces'], apply }
} })
