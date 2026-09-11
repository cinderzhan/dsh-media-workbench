// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { deriveChartModel, renderAnalytics } from '../packages/dsh-media-workbench/public/analytics.js'
const pub = (id, platform='bilibili', topicId='t') => ({id,title:'同名内容',platform,topicId})
const snap = (publicationId, capturedAt, metrics, checkpoint='current', source='manual') => ({publicationId,capturedAt,metrics,checkpoint,source})
const config = {view:'content',xAxis:'content',metric:'views',overlayMetrics:[],checkpoint:'current',platform:'',owner:'',source:'',chartType:'bar'}
const state = {topics:[{id:'t',title:'桌面端介绍'}],publications:[pub('b'),pub('d','douyin')], snapshots:[snap('b','2026-09-01T00:00:00Z',{views:10,likes:1},'24h'),snap('b','2026-09-02T00:00:00Z',{views:null,likes:2}),snap('b','2026-09-04T00:00:00Z',{views:40,likes:4}),snap('d','2026-09-01T12:00:00Z',{views:0,likes:0}),snap('d','2026-09-03T00:00:00Z',{views:20,likes:3})]}
const model = (patch={}, data=state, ids=['b','d']) => deriveChartModel(data,{...config,...patch},ids)
const values = m => m.series.flatMap(s=>s.points.map(p=>p.value)).filter(v=>v!==null)
describe('configurable analytics views',()=>{
 it('compares latest publication values without summing snapshots',()=>{expect(values(model()).sort((a,b)=>a-b)).toEqual([20,40])})
 it('retains each selected publication history and missing values',()=>{const m=model({view:'history',xAxis:'time',checkpoint:'24h',chartType:'line'});expect(m.series).toHaveLength(2);expect(m.series.flatMap(s=>s.points)).toHaveLength(5);expect(m.series.flatMap(s=>s.points).some(p=>p.value===null)).toBe(true);expect(values(m)).toContain(0)})
 it('uses actual, nonuniform capture timestamps on the time axis',()=>{const m=model({view:'history',xAxis:'time'});const points=m.series.find(s=>s.publication?.id==='b').points;expect(points.map(p=>p.x)).toEqual(['2026-09-01T00:00:00Z','2026-09-02T00:00:00Z','2026-09-04T00:00:00Z'].map(Date.parse))})
 it('keeps overlay metrics independent with original counts',()=>{const m=model({overlayMetrics:['likes']});expect(m.metrics).toEqual(['views','likes']);expect(values(m).sort((a,b)=>a-b)).toEqual([3,4,20,40])})
 it('joins cross-platform records only through topic identity',()=>{const m=model({view:'platform',xAxis:'platform'});expect(m.categories.map(c=>c.key).sort()).toEqual(['bilibili','douyin']);expect(m.series).toHaveLength(1);expect(m.series[0].topicId).toBe('t');expect(values(m).sort((a,b)=>a-b)).toEqual([20,40])})
 it('never adds two publications on the same platform',()=>{const data=structuredClone(state);data.publications.push(pub('b2'));data.snapshots.push(snap('b2','2026-09-03T00:00:00Z',{views:7}));const m=model({view:'platform',xAxis:'platform'},data,['b','b2','d']);expect(values(m).sort((a,b)=>a-b)).toEqual([7,20,40]);expect(m.series.length).toBeGreaterThan(1)})
 it('does not merge unrelated identical titles',()=>{const data=structuredClone(state);data.publications.forEach(p=>delete p.topicId);const m=model({view:'platform',xAxis:'platform'},data);expect(m.series).toHaveLength(2)})
 it('filters source and ownership before deriving history',()=>{const data=structuredClone(state);data.publications[1].creatorId='creator';data.snapshots.push(snap('b','2026-09-05T00:00:00Z',{views:9},'current','browser'));const m=model({view:'history',xAxis:'time',owner:'official',source:'browser'},data);expect(values(m)).toEqual([9]);expect(m.series).toHaveLength(1)})
 it('does not backfill a missing latest metric; archives and input remain intact',()=>{const data=structuredClone(state);data.snapshots.push(snap('b','2026-09-06T00:00:00Z',{likes:5}));data.publications[1].archivedAt='2026-09-07';const before=structuredClone(data);expect(values(model({},data))).toEqual([]);expect(data).toEqual(before)})
 it('handles no selection without phantom zero values',()=>{expect(model({},state,[]).series.flatMap(s=>s.points)).toEqual([])})
})

describe('analytics view controls',()=>{
 it('keeps per-view metrics and chart types, supports overlay, and preserves selected publications on refresh',()=>{
  const root=document.createElement('section');document.body.append(root);renderAnalytics(root,state);
  const card=()=>root.querySelector('.analytics-chart-card');
  const choose=(suffix,value)=>{const el=card().querySelector(`select[id$="${suffix}"]`);el.value=value;el.dispatchEvent(new Event('change'))};
  const view=name=>choose('view', {'历史趋势':'history','多内容对比':'content','多平台对比':'platform'}[name]);
  choose('metric','likes');view('历史趋势');expect(card().querySelector('select[id$="metric"]').value).toBe('views');expect(card().querySelector('select[id$="chart-type"]').value).toBe('line');expect(card().querySelectorAll('.analytics-series-chart path')).toHaveLength(2);
  const overlay=[...card().querySelectorAll('.analytics-overlay-list label')].find(l=>l.textContent==='点赞').querySelector('input');overlay.click();expect(card().querySelectorAll('.analytics-series-chart path')).toHaveLength(4);
  card().querySelector('[data-publication-id="d"]').click();expect(card().querySelectorAll('.analytics-series-chart path')).toHaveLength(2);
  renderAnalytics(root,state);expect(card().querySelectorAll('.analytics-picker-row input:checked')).toHaveLength(1);expect(card().querySelectorAll('.analytics-series-chart path')).toHaveLength(2);
  view('多内容对比');expect(card().querySelector('select[id$="metric"]').value).toBe('likes');expect(card().querySelector('select[id$="chart-type"]').value).toBe('bar');
  view('多平台对比');expect(card().querySelector('select[id$="x-axis"]').value).toBe('platform');expect(card().querySelectorAll('.analytics-series-chart')).toHaveLength(1);root.remove();
 });
 it('renders negative, missing and invalid timestamp values without invalid SVG coordinates',()=>{const root=document.createElement('section');document.body.append(root);const data=structuredClone(state);data.snapshots.push(snap('b','bad-date',{views:100}));data.snapshots.push(snap('d','2026-09-05T00:00:00Z',{views:-5}));renderAnalytics(root,data);const card=()=>root.querySelectorAll('.analytics-chart-card')[1];expect(card().querySelector('.analytics-svg').outerHTML).not.toMatch(/NaN|Infinity/);expect(root.textContent).toContain('-5');root.remove()});
});
