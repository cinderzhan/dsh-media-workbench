const labels = { library: '资料', calendar: '营销日历', data: '数据', chat: 'DSH 会话' }
const groups = { library: [['topics','选题池'],['creators','达人池'],['campaigns','Campaign']], calendar: [['calendar','营销日历']], data: [['publications','数据采集'],['analytics','数据监控'],['daily','北极星指标']], chat: [] }
const defaults = () => ({ order: ['library','calendar','data','chat'], x: 69, y: 54, inner: 42, tabs: { library:'topics', data:'analytics', calendar:'calendar' }, minimized: {} })
export function windowLayout(order,minimized={},ratios={x:69,y:54,inner:42}) {
  const [a,b,c,d]=order,shown=key=>!minimized[key]
  const top=shown(a)||shown(b),left=top||shown(c)
  const x=left?(shown(d)?ratios.x:100):0
  const y=top?(shown(c)?ratios.y:100):0
  const inner=shown(a)?(shown(b)?ratios.inner:100):0
  const rects={}
  if(shown(a))rects[a]=[0,0,x*inner/100,y]
  if(shown(b))rects[b]=[x*inner/100,0,x*(100-inner)/100,y]
  if(shown(c))rects[c]=[0,y,x,100-y]
  if(shown(d))rects[d]=[x,0,100-x,100]
  return {rects,x,y,inner,dividers:{x:left&&shown(d),y:top&&shown(c),inner:shown(a)&&shown(b)}}
}
export function createDock(root, { hosted = false, onFrame = () => {}, onChat = () => {}, onClose = () => {} } = {}) {
  let layout = defaults()
  try { const saved = JSON.parse(localStorage.getItem('media-dock-v2')); if (saved && Array.isArray(saved.order) && saved.order.length === 4 && new Set(saved.order).size === 4 && saved.order.every(k => labels[k])) layout = { ...layout, ...saved, tabs:{...layout.tabs,...saved.tabs}, minimized:{...(saved.minimized||{})} } } catch {}
  for(const key of ['library','calendar','data'])if(!groups[key].some(([id])=>id===layout.tabs[key]))layout.tabs[key]=defaults().tabs[key]
  for (const [key,min,max] of [['x',40,80],['y',28,75],['inner',28,70]]) layout[key] = Math.max(min,Math.min(max,Number(layout[key])||defaults()[key]))
  const element = (tag,cls,text) => { const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n }
  const shell=element('div','media-dock'), top=element('div','dock-toolbar'), title=element('strong','','内容运营'), hint=element('span','dock-hint',''), reset=element('button','','重置布局')
  reset.type='button';reset.onclick=()=>{layout=defaults();apply();save();for(const key of Object.keys(frames))setTab(key,layout.tabs[key])}
  top.append(title,hint,reset)
  if(hosted){const close=element('button','','退出工作台');close.onclick=onClose;top.append(close)}
  const board=element('div','dock-board'); shell.append(top,board);root.replaceChildren(shell)
  const panes={}, frames={}, restoreButtons={}
  const restoreBar=element('div','dock-restore');top.insertBefore(restoreBar,hint)
  for(const key of Object.keys(labels)){const b=element('button','',labels[key]);b.type='button';b.setAttribute('aria-label',`展开${labels[key]}窗口`);b.title=`展开${labels[key]}窗口`;b.onclick=()=>{layout.minimized[key]=false;apply();save()};restoreButtons[key]=b;restoreBar.append(b)}
  let dragging=null
  const save=()=>{try{localStorage.setItem('media-dock-v2',JSON.stringify(layout))}catch{}}
  function apply(){
    const width=Math.max(800,board.clientWidth)
    layout.x=Math.max(486/width*100,Math.min((width-286)/width*100,layout.x))
    const business=width*layout.x/100
    layout.inner=Math.max(220/business*100,Math.min((business-260)/business*100,layout.inner))
    const view=windowLayout(layout.order,layout.minimized,layout)
    board.style.setProperty('--split-x',`${view.x}%`);board.style.setProperty('--split-y',`${view.y}%`);board.style.setProperty('--upper-left',`${view.x*view.inner/100}%`)
    for(const bar of board.querySelectorAll('[data-axis]')){const axis=bar.dataset.axis;bar.hidden=!view.dividers[axis];bar.setAttribute('aria-valuenow',String(Math.round(view[axis])));bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100')}
    for(const [key,pane] of Object.entries(panes)){
      const rect=view.rects[key];pane.hidden=!rect;pane.querySelector('select').value=key
      if(rect){pane.style.left=`calc(${rect[0]}% + 4px)`;pane.style.top=`calc(${rect[1]}% + 4px)`;pane.style.width=`calc(${rect[2]}% - 8px)`;pane.style.height=`calc(${rect[3]}% - 8px)`}
      restoreButtons[key].hidden=Boolean(rect)
    }
    restoreBar.hidden=!Object.values(layout.minimized).some(Boolean)
  }
  function swap(from,to){if(from===to)return;const a=layout.order.indexOf(from),b=layout.order.indexOf(to);[layout.order[a],layout.order[b]]=[layout.order[b],layout.order[a]];apply();save()}
  function setTab(key,tab){if(!groups[key].some(([id])=>id===tab))return;layout.tabs[key]=tab;for(const b of panes[key].querySelectorAll('[role=tab]')){b.setAttribute('aria-selected',String(b.dataset.tab===tab));b.tabIndex=b.dataset.tab===tab?0:-1}frames[key]?.contentWindow?.postMessage({type:'media-workbench:tab',tab},location.origin);apply();save()}
  for(const key of Object.keys(labels)){
    const pane=element('section','dock-pane');pane.setAttribute('aria-label',labels[key]);panes[key]=pane
    const header=element('div','dock-pane-heading'),handle=element('button','dock-drag');handle.type='button';handle.title=`拖动${labels[key]}区域换位`;handle.setAttribute('aria-label',handle.title);handle.draggable=false
    handle.innerHTML='<svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="9" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="9" cy="13" r="1.2"/></svg>'
    handle.addEventListener('dragstart',e=>{dragging=key;e.dataTransfer.setData('application/x-media-pane',key);e.dataTransfer.effectAllowed='move';board.classList.add('moving')})
    handle.addEventListener('dragend',()=>{dragging=null;board.classList.remove('moving');Object.values(panes).forEach(p=>p.classList.remove('drop-target'))})
    pane.addEventListener('dragover',e=>{if(!dragging)return;e.preventDefault();pane.classList.add('drop-target')})
    pane.addEventListener('dragleave',e=>{if(!pane.contains(e.relatedTarget))pane.classList.remove('drop-target')})
    pane.addEventListener('drop',e=>{if(!dragging)return;e.preventDefault();swap(dragging,key);dragging=null;board.classList.remove('moving');Object.values(panes).forEach(p=>p.classList.remove('drop-target'))})
    handle.onpointerdown=e=>{
      if(e.button!==0)return;e.preventDefault();handle.setPointerCapture(e.pointerId)
      const startX=e.clientX,startY=e.clientY;let target=null,moved=false
      const move=e=>{if(!moved&&Math.hypot(e.clientX-startX,e.clientY-startY)<5)return;moved=true;board.classList.add('moving');target=null;for(const [other,p] of Object.entries(panes)){const r=p.getBoundingClientRect();const hit=other!==key&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;p.classList.toggle('drop-target',hit);if(hit)target=other}}
      const end=e=>{if(e.type==='pointerup'&&moved&&target)swap(key,target);board.classList.remove('moving');Object.values(panes).forEach(p=>p.classList.remove('drop-target'));handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end)}
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end)
    }
    const nav=element('div','dock-tabs');nav.setAttribute('role','tablist');nav.setAttribute('aria-label',`${labels[key]}视图`)
    for(const [tab,label] of groups[key]){const b=element('button','',label);b.type='button';b.dataset.tab=tab;b.setAttribute('role','tab');b.onclick=()=>setTab(key,tab);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const all=[...nav.children],i=all.indexOf(b),next=e.key==='Home'?0:e.key==='End'?all.length-1:(i+(e.key==='ArrowRight'?1:-1)+all.length)%all.length;setTab(key,all[next].dataset.tab);all[next].focus()};nav.append(b)}
    if(key==='chat')nav.append(element('strong','chat-title','DSH 会话'))
    const move=element('select','dock-move');move.setAttribute('aria-label',`${labels[key]}区域换位`);for(const other of Object.keys(labels)){const o=element('option','',other===key?'换位':`与${labels[other]}换位`);o.value=other;move.append(o)}move.value=key;move.onchange=()=>swap(key,move.value)
    const minimize=element('button','dock-minimize');minimize.type='button';minimize.title=`收起${labels[key]}窗口`;minimize.setAttribute('aria-label',minimize.title);minimize.innerHTML='<svg width=12 height=12 viewBox="0 0 12 12" fill=none stroke=currentColor stroke-width=1.3 aria-hidden=true><path d="M2 6h8"/></svg>';minimize.onclick=()=>{layout.minimized[key]=true;apply();save();restoreButtons[key].focus()}
    header.append(handle,nav,move,minimize);pane.append(header)
    const body=element('div','dock-pane-body');pane.append(body)
    if(key!=='chat'){
      const frame=element('iframe');frame.title=`${labels[key]}工作面板`;frame.src=`/api/media-workbench/app?pane=${key}&tab=${layout.tabs[key]}`;frames[key]=frame;frame.onload=()=>setTab(key,layout.tabs[key]);body.append(frame);onFrame(frame)
    }else if(hosted)onChat(body)
    else { const empty=element('div','dock-chat-empty');empty.append(element('strong','','DSH 会话'),element('p','','在 DSH Desktop 中继续对话。'),element('p','dock-muted','独立预览暂不显示会话。'));body.append(empty) }
    board.append(pane)
  }
  const resize=(axis,label)=>{const bar=element('div',`dock-resize resize-${axis}`);bar.dataset.axis=axis;bar.tabIndex=0;bar.setAttribute('role','separator');bar.setAttribute('aria-label',label);bar.setAttribute('aria-orientation',axis==='y'?'horizontal':'vertical');const range=axis==='x'?[40,80]:axis==='y'?[28,75]:[28,70];const update=value=>{layout[axis]=Math.max(range[0],Math.min(range[1],value));apply();save()};bar.setAttribute('aria-valuemin',range[0]);bar.setAttribute('aria-valuemax',range[1]);bar.setAttribute('aria-valuenow',layout[axis]);bar.onkeydown=e=>{if(['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(e.key)){e.preventDefault();update(layout[axis]+(['ArrowLeft','ArrowUp'].includes(e.key)?-2:2))}};bar.onpointerdown=e=>{e.preventDefault();bar.setPointerCapture(e.pointerId);board.classList.add('resizing');const move=e=>{const r=board.getBoundingClientRect();update(axis==='y'?(e.clientY-r.top)/r.height*100:axis==='inner'?(e.clientX-r.left)/(r.width*windowLayout(layout.order,layout.minimized,layout).x/100)*100:(e.clientX-r.left)/r.width*100)};const end=()=>{board.classList.remove('resizing');bar.removeEventListener('pointermove',move);bar.removeEventListener('pointerup',end);bar.removeEventListener('pointercancel',end)};bar.addEventListener('pointermove',move);bar.addEventListener('pointerup',end);bar.addEventListener('pointercancel',end)};board.append(bar)}
  resize('x','业务区与右侧区域宽度');resize('inner','上方两个区域宽度');resize('y','上下区域高度');apply();for(const key of Object.keys(frames))setTab(key,layout.tabs[key])
  const relay=e=>{if(e.origin!==location.origin||!Object.values(frames).some(f=>f.contentWindow===e.source))return;if(e.data?.type==='media-workbench:changed'){for(const f of Object.values(frames))if(f.contentWindow!==e.source)f.contentWindow.postMessage({type:'media-workbench:refresh'},location.origin)}}
  window.addEventListener('message',relay)
  const resizeObserver=new ResizeObserver(()=>apply());resizeObserver.observe(board)
  return { frames:Object.values(frames), destroy(){resizeObserver.disconnect();window.removeEventListener('message',relay);shell.remove()} }
}
