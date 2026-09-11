export const dailyMetrics = [
  {key:'downloads',label:'下载量',color:'#527a95'},
  {key:'stars',label:'新增 GitHub Star',color:'#bd9364'},
  {key:'groupJoins',label:'加群人数',color:'#6f8f7b'},
  {key:'leads',label:'线索人数',color:'#9180a6'},
]
const DAY=86400000
export function dailySeries(records,selected=dailyMetrics.map(m=>m.key),limit=30) {
 const rows=records.filter(r=>!r.archivedAt).slice().sort((a,b)=>a.date.localeCompare(b.date)).slice(-limit)
 const series=dailyMetrics.filter(m=>selected.includes(m.key)).map(metric=>{
  const segments=[];let segment=[],last
  for(const row of rows){const time=Date.parse(row.date+'T00:00:00Z'),value=row[metric.key];if(typeof value!=='number'||!Number.isFinite(value)){if(segment.length)segments.push(segment);segment=[];last=undefined;continue}
   if(last!==undefined&&time-last>DAY){if(segment.length)segments.push(segment);segment=[]}
   segment.push({date:row.date,time,value});last=time
  }
  if(segment.length)segments.push(segment)
  return {...metric,segments}
 })
 return {rows,series,max:Math.max(1,...series.flatMap(s=>s.segments.flatMap(points=>points.map(p=>p.value))))}
}
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node}
const sessions=new WeakMap()
const defaults=()=>dailyMetrics.map(metric=>({id:metric.key,title:metric.label,metrics:[metric.key],type:'line',range:'30',start:'',end:''}))
export function renderDailyChart(container,records,namespace='default'){
 const previous=sessions.get(container)?.()
 const storageKey=`dsh.daily-charts.v1:${namespace}`
 let charts=defaults()
 try{const saved=JSON.parse(localStorage.getItem(storageKey));if(Array.isArray(saved))charts=saved.filter(c=>c&&typeof c.id==='string'&&typeof c.title==='string'&&Array.isArray(c.metrics)).map(c=>({...c,metrics:c.metrics.filter(key=>dailyMetrics.some(m=>m.key===key)),type:c.type==='bar'?'bar':'line',range:['7','30','90','all','custom'].includes(c.range)?c.range:'30'}))}catch{}
 if(previous)charts=previous.charts
 const wrap=element('section','daily-trends');wrap.setAttribute('aria-label','北极星指标趋势')
 const toolbar=element('div','daily-chart-toolbar'),intro=element('div'),add=element('button','daily-chart-add','添加图表'),grid=element('div','daily-chart-grid')
 intro.append(element('h3','','指标趋势'),element('p','','按你的关注点组合指标，每张图表可独立设置。'));add.type='button';toolbar.append(intro,add);wrap.append(toolbar,grid);container.append(wrap)
 const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify(charts.filter(c=>!c.unsaved)))}catch{}}
 function drawGraph(target,config){
  const active=records.filter(r=>!r.archivedAt).slice().sort((a,b)=>a.date.localeCompare(b.date));const latest=active.at(-1)?.date
  const lower=config.range==='custom'?config.start:latest&&config.range!=='all'?new Date(Date.parse(latest+'T00:00:00Z')-(Number(config.range)-1)*DAY).toISOString().slice(0,10):''
  const filtered=active.filter(r=>(!lower||r.date>=lower)&&(config.range!=='custom'||!config.end||r.date<=config.end))
  const {rows,series,max}=dailySeries(filtered,config.metrics,Infinity)
  if(!rows.length||!series.some(m=>m.segments.length)){target.append(element('p','daily-chart-empty',!config.metrics.length?'请选择至少一项指标':'所选日期范围内暂无指标数据'));return}
  const node=(tag,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n}
  const width=600,height=250,left=52,right=24,top=16,bottom=38,pw=width-left-right,ph=height-top-bottom
  const axisMax=Math.ceil(max/4)*4,first=Date.parse(rows[0].date+'T00:00:00Z'),last=Date.parse(rows.at(-1).date+'T00:00:00Z'),bar=config.type==='bar'
  const padding=bar?Math.min(30,pw/Math.max(2,rows.length)):8
  const x=t=>left+padding+(first===last?(pw-2*padding)/2:(t-first)/(last-first)*(pw-2*padding)),y=v=>top+ph*(1-v/axisMax)
  const svg=node('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':`${config.title} · ${bar?'柱状图':'折线图'}`})
  for(let i=0;i<=4;i++){const value=axisMax*i/4;svg.append(node('line',{x1:left,x2:width-right,y1:y(value),y2:y(value),stroke:'#eceeec'}),node('text',{x:left-10,y:y(value)+4,'text-anchor':'end',fill:'#737b73','font-size':11},value.toLocaleString('zh-CN')))}
  const count=Math.min(4,rows.length);for(const index of new Set(Array.from({length:count},(_,i)=>Math.round(i*(rows.length-1)/Math.max(1,count-1)))))svg.append(node('text',{x:x(Date.parse(rows[index].date+'T00:00:00Z')),y:height-12,'text-anchor':'middle',fill:'#737b73','font-size':11},rows[index].date.slice(5)))
  const barWidth=Math.min(22,(pw-2*padding)/Math.max(1,(last-first)/DAY+1)/Math.max(1,series.length)*.7)
  series.forEach((metric,mi)=>{const group=node('g',{'data-daily-series':metric.key});for(const points of metric.segments){if(!bar&&points.length>1)group.append(node('polyline',{points:points.map(p=>`${x(p.time)},${y(p.value)}`).join(' '),fill:'none',stroke:metric.color,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));for(const p of points){const mark=bar&&p.value!==0?node('rect',{x:x(p.time)+(mi-series.length/2)*barWidth,y:y(p.value),width:Math.max(1,barWidth-1),height:Math.max(0,y(0)-y(p.value)),rx:2,fill:metric.color}):node('circle',{cx:x(p.time)+(bar?(mi-(series.length-1)/2)*barWidth:0),cy:y(p.value),r:2.5,fill:metric.color});mark.setAttribute('tabindex','0');mark.setAttribute('aria-label',`${p.date} ${metric.label}：${p.value}`);mark.append(node('title',{},`${p.date} · ${metric.label}：${p.value.toLocaleString('zh-CN')}`));group.append(mark)}}svg.append(group)})
  target.append(svg)
 }
 function render(editId){
  grid.replaceChildren()
  if(!charts.length)grid.append(element('p','daily-chart-empty','还没有图表。添加图表，开始关注你的关键指标。'))
  for(const config of charts){
   const card=element('article','daily-chart-card'),head=element('div','daily-chart-head'),title=element('h4','',config.title),actions=element('div','daily-chart-actions'),edit=element('button','','编辑'),remove=element('button','','删除')
   edit.type=remove.type='button';edit.setAttribute('aria-label',`编辑${config.title}`);remove.setAttribute('aria-label',`删除${config.title}`);actions.append(edit,remove);head.append(title,actions);card.append(head)
   const legend=element('div','daily-chart-legend');for(const metric of dailyMetrics.filter(m=>config.metrics.includes(m.key))){const label=element('span','',metric.label),dot=element('i');dot.style.background=metric.color;label.prepend(dot);legend.append(label)}card.append(legend)
   const graph=element('div','daily-chart-plot');drawGraph(graph,config);card.append(graph)
   card.append(element('p','daily-chart-note',`${config.range==='custom'?`${config.start||'起始'} 至 ${config.end||'最新'}`:config.range==='all'?'全部日期':`截至最新记录的 ${config.range} 天`} · 每日新增值 · 缺失数据断开显示`))
   const settings=element('form','daily-chart-settings');settings.dataset.chartId=config.id;settings.hidden=config.id!==editId
   const field=(text,input)=>{const label=element('label','daily-chart-field');label.append(element('span','',text),input);settings.append(label)}
   const input=element('input');input.value=config.title;input.required=true;input.maxLength=60;field('图表名称',input)
   const type=element('select');for(const[value,text]of [['line','折线图'],['bar','柱状图']]){const option=element('option','',text);option.value=value;type.append(option)}type.value=config.type;field('图表类型',type)
   const metrics=element('fieldset');metrics.append(element('legend','','选择指标'));const checks=[];for(const metric of dailyMetrics){const label=element('label'),check=element('input');check.type='checkbox';check.value=metric.key;check.checked=config.metrics.includes(metric.key);checks.push(check);label.append(check,document.createTextNode(metric.label));metrics.append(label)}settings.append(metrics)
   const range=element('select');for(const[value,text]of [['7','最近 7 天'],['30','最近 30 天'],['90','最近 90 天'],['all','全部日期'],['custom','自定义日期']]){const option=element('option','',text);option.value=value;range.append(option)}range.value=config.range;field('日期范围',range)
   const dates=element('div','daily-chart-dates'),start=element('input'),end=element('input');start.type=end.type='date';start.value=config.start||'';end.value=config.end||'';start.setAttribute('aria-label','开始日期');end.setAttribute('aria-label','结束日期');dates.append(start,end);dates.hidden=range.value!=='custom';range.onchange=()=>{dates.hidden=range.value!=='custom'};settings.append(dates)
   const error=element('p','daily-chart-error');error.setAttribute('role','alert');const buttons=element('div','daily-chart-form-actions'),save=element('button','','保存图表'),cancel=element('button','','取消');save.type='submit';cancel.type='button';buttons.append(save,cancel);settings.append(error,buttons);card.append(settings)
   edit.onclick=()=>{settings.hidden=!settings.hidden;edit.setAttribute('aria-expanded',String(!settings.hidden));if(!settings.hidden)input.focus()};edit.setAttribute('aria-expanded',String(!settings.hidden));cancel.onclick=()=>{if(config.unsaved){charts=charts.filter(c=>c.id!==config.id)}render()};remove.onclick=()=>{charts=charts.filter(c=>c.id!==config.id);persist();render()}
   settings.onsubmit=event=>{event.preventDefault();if(!input.value.trim()){error.textContent='请填写图表名称';return}if(!checks.some(c=>c.checked)){error.textContent='请选择至少一项指标';return}if(range.value==='custom'&&start.value&&end.value&&start.value>end.value){error.textContent='结束日期不能早于开始日期';return}delete config.unsaved;Object.assign(config,{title:input.value.trim(),type:type.value,metrics:checks.filter(c=>c.checked).map(c=>c.value),range:range.value,start:start.value,end:end.value});persist();render()};grid.append(card)
  }
 }
 add.onclick=()=>{const id=globalThis.crypto?.randomUUID?.()||`chart-${Date.now()}-${Math.random()}`;charts.push({id,unsaved:true,title:'自定义图表',metrics:['downloads'],type:'line',range:'30',start:'',end:''});render(id)}
 render(previous?.editId)
 if(previous?.values){const form=[...grid.querySelectorAll('form')].find(f=>f.dataset.chartId===previous.editId);if(form){[...form.elements].forEach((el,i)=>{const saved=previous.values[i];if(saved&&'value' in el){el.value=saved.value;if(el.type==='checkbox')el.checked=saved.checked}});form.querySelector('.daily-chart-dates').hidden=form.querySelectorAll('select')[1].value!=='custom'}}
 sessions.set(container,()=>{const form=[...grid.querySelectorAll('form')].find(f=>!f.hidden);return {charts,editId:form?.dataset.chartId,values:form?[...form.elements].map(el=>({value:el.value,checked:el.checked})):null}})
 return wrap
}
