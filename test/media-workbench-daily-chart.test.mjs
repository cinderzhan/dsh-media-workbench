// @vitest-environment jsdom
import {it,expect,beforeEach,vi} from 'vitest'
import {dailySeries,renderDailyChart} from '../packages/dsh-media-workbench/public/daily-chart.js'
beforeEach(()=>{const saved=new Map();vi.stubGlobal('localStorage',{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)});document.body.replaceChildren()})
const records=[{date:'2026-09-01',downloads:0,stars:2,groupJoins:3,leads:4},{date:'2026-09-02',downloads:10,stars:null,groupJoins:4,leads:5},{date:'2026-09-04',downloads:20,stars:8,groupJoins:5,leads:6}]
const mount=(rows=records,namespace)=>{const root=document.createElement('div');document.body.append(root);renderDailyChart(root,rows,namespace);return root}
it('keeps four separate default charts, real zero and missing-data segments',()=>{
 const {series}=dailySeries(records);expect(series).toHaveLength(4);expect(series[0].segments.map(s=>s.length)).toEqual([2,1]);expect(series[0].segments[0][0].value).toBe(0);expect(series[1].segments.map(s=>s.length)).toEqual([1,1])
 const root=mount();expect(root.querySelectorAll('.daily-chart-card')).toHaveLength(4);expect(root.querySelectorAll('[data-daily-series]')).toHaveLength(4);expect([...root.querySelectorAll('form')].every(f=>f.hidden)).toBe(true)
 expect(root.querySelector('circle').getAttribute('aria-label')).toContain('：0')
})
it('saves custom title, multiple metrics, bars and date range; restores and deletes charts',()=>{
 const root=mount();root.querySelector('.daily-chart-add').click();let card=root.querySelectorAll('.daily-chart-card')[4];const form=card.querySelector('form');expect(form.hidden).toBe(false)
 form.querySelector('input').value='增长组合';const selects=form.querySelectorAll('select');selects[0].value='bar';selects[1].value='custom';form.querySelectorAll('[type=checkbox]')[1].checked=true;const dates=form.querySelectorAll('[type=date]');dates[0].value='2026-09-02';dates[1].value='2026-09-04';form.dispatchEvent(new Event('submit',{cancelable:true}))
 card=root.querySelectorAll('.daily-chart-card')[4];expect(card.querySelector('h4').textContent).toBe('增长组合');expect(card.querySelectorAll('rect').length).toBeGreaterThan(0);expect(card.querySelector('[aria-label^="2026-09-01"]')).toBeNull();expect(card.querySelectorAll('[data-daily-series]')).toHaveLength(2)
 const restored=mount();expect(restored.querySelectorAll('.daily-chart-card')).toHaveLength(5);restored.querySelector('[aria-label="删除增长组合"]').click();expect(mount().querySelectorAll('.daily-chart-card')).toHaveLength(4);expect(mount(records,'other').querySelectorAll('.daily-chart-card')).toHaveLength(4)
})
it('rejects empty metric selections and reversed dates without saving',()=>{
 const root=mount();root.querySelector('[aria-label="编辑下载量"]').click();const form=root.querySelector('form');form.querySelectorAll('[type=checkbox]').forEach(c=>c.checked=false);form.dispatchEvent(new Event('submit',{cancelable:true}));expect(form.textContent).toContain('请选择至少一项指标');form.querySelector('[type=checkbox]').checked=true;form.querySelectorAll('select')[1].value='custom';const dates=form.querySelectorAll('[type=date]');dates[0].value='2026-09-10';dates[1].value='2026-09-01';form.dispatchEvent(new Event('submit',{cancelable:true}));expect(form.textContent).toContain('结束日期不能早于开始日期')
})
it('handles empty/single-point data and leaves sorted latest30 model unchanged',()=>{
 const rows=Array.from({length:31},(_,i)=>({date:`2026-08-${String(31-i).padStart(2,'0')}`,downloads:i}));const copy=structuredClone(rows);expect(dailySeries(rows).rows).toHaveLength(30);expect(rows).toEqual(copy)
 const root=mount([{date:'2026-09-01',downloads:0}]);expect(root.querySelectorAll('circle')).toHaveLength(1);expect(root.innerHTML).not.toMatch(/NaN|Infinity/);expect(mount([]).textContent).toContain('所选日期范围内暂无指标数据')
})
it('retains unsaved edits across data refresh and cancels an unsaved added chart',()=>{
 const root=mount();root.querySelector('.daily-chart-add').click();let form=root.querySelectorAll('form')[4];form.querySelector('input').value='未完成编辑';form.querySelectorAll('select')[0].value='bar';root.replaceChildren();renderDailyChart(root,records);form=root.querySelectorAll('form')[4];expect(form.hidden).toBe(false);expect(form.querySelector('input').value).toBe('未完成编辑');expect(form.querySelector('select').value).toBe('bar');expect(mount().querySelectorAll('.daily-chart-card')).toHaveLength(4);form.querySelector('button[type=button]').click();expect(root.querySelectorAll('.daily-chart-card')).toHaveLength(4)
})
it('uses actual calendar range and includes more than thirty records for all dates',()=>{
 const rows=Array.from({length:50},(_,i)=>({date:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),downloads:i}));const root=mount(rows);const form=root.querySelector('form');form.querySelectorAll('select')[1].value='all';form.dispatchEvent(new Event('submit',{cancelable:true}));expect(root.querySelector('.daily-chart-card').querySelectorAll('circle')).toHaveLength(50)
 const refreshedForm=root.querySelector('form');refreshedForm.querySelectorAll('select')[1].value='7';refreshedForm.dispatchEvent(new Event('submit',{cancelable:true}));expect(root.querySelector('.daily-chart-card').querySelectorAll('circle')).toHaveLength(7)
})
