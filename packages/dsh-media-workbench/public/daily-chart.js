export const dailyMetrics = [
  {key:'downloads',label:'下载量',color:'#426b9b'},
  {key:'stars',label:'新增 GitHub Star',color:'#937044'},
  {key:'groupJoins',label:'加群人数',color:'#478471'},
  {key:'leads',label:'线索人数',color:'#84699a'},
]
const DAY=86400000
export function dailySeries(records,selected=dailyMetrics.map(m=>m.key)) {
 const rows=records.filter(r=>!r.archivedAt).slice().sort((a,b)=>a.date.localeCompare(b.date)).slice(-30)
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
export function renderDailyChart(container,records){
 const wrap=document.createElement('section');wrap.className='daily-trends';wrap.setAttribute('aria-label','北极星指标趋势')
 const legend=document.createElement('div');legend.className='daily-legend';legend.setAttribute('role','group');legend.setAttribute('aria-label','显示的北极星指标')
 const graph=document.createElement('div'),note=document.createElement('p');note.className='table-footnote';note.textContent='最近 30 个记录日 · 每日新增值；缺失数据断开显示。'
 const selected=new Set(dailyMetrics.map(m=>m.key));const ns='http://www.w3.org/2000/svg'
 const svgNode=(tag,attributes={},text)=>{const node=document.createElementNS(ns,tag);for(const[key,value]of Object.entries(attributes))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;return node}
 function draw(){
  const {rows,series,max}=dailySeries(records,[...selected]);graph.replaceChildren()
  if(!series.length||!rows.length){const message=document.createElement('p');message.textContent=rows.length?'请选择至少一项指标':'还没有每日指标记录';graph.append(message);return}
  const axisMax=Math.ceil(max/4)*4;const width=720,height=290,left=48,right=18,top=20,bottom=44,plotWidth=width-left-right,plotHeight=height-top-bottom
  const first=Date.parse(rows[0].date+'T00:00:00Z'),last=Date.parse(rows.at(-1).date+'T00:00:00Z')
  const x=time=>left+(first===last?plotWidth/2:(time-first)/(last-first)*plotWidth),y=value=>top+plotHeight*(1-value/axisMax)
  const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':`${series.map(s=>s.label).join('、')}每日新增折线图`});svg.style.cssText='width:100%;height:auto;display:block;min-width:340px'
  for(let i=0;i<=4;i++){const value=axisMax*i/4,py=y(value);svg.append(svgNode('line',{x1:left,x2:width-right,y1:py,y2:py,stroke:'#ececec'}),svgNode('text',{x:left-7,y:py+4,'text-anchor':'end',fill:'#777','font-size':11},Number(value.toFixed(1)).toLocaleString('zh-CN')))}
  const tickIndices=[...new Set(Array.from({length:Math.min(5,rows.length)},(_,i)=>Math.round(i*(rows.length-1)/Math.max(1,Math.min(5,rows.length)-1))))]
  for(const i of tickIndices)svg.append(svgNode('text',{x:x(Date.parse(rows[i].date+'T00:00:00Z')),y:height-19,'text-anchor':'middle',fill:'#777','font-size':11},rows[i].date.slice(5)))
  for(const metric of series){const group=svgNode('g',{'data-daily-series':metric.key});for(const points of metric.segments){if(points.length>1)group.append(svgNode('polyline',{points:points.map(p=>`${x(p.time)},${y(p.value)}`).join(' '),fill:'none',stroke:metric.color,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));for(const point of points){const circle=svgNode('circle',{cx:x(point.time),cy:y(point.value),r:3.5,fill:metric.color,tabindex:0,'aria-label':`${point.date} ${metric.label}：${point.value}`});circle.append(svgNode('title',{},`${point.date} · ${metric.label}：${point.value.toLocaleString('zh-CN')}`));group.append(circle)}}svg.append(group)}
  graph.append(svg)
 }
 for(const metric of dailyMetrics){const label=document.createElement('label'),input=document.createElement('input'),dot=document.createElement('span');input.type='checkbox';input.checked=true;input.setAttribute('aria-label',`显示${metric.label}`);dot.textContent='●';dot.style.color=metric.color;label.append(input,dot,document.createTextNode(metric.label));input.onchange=()=>{if(input.checked)selected.add(metric.key);else selected.delete(metric.key);draw()};legend.append(label)}
 graph.style.overflowX='auto';wrap.append(legend,graph,note);container.append(wrap);draw();return wrap
}
