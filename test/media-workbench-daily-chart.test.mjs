// @vitest-environment jsdom
import {it,expect} from 'vitest'
import {dailySeries,renderDailyChart} from '../packages/dsh-media-workbench/public/daily-chart.js'
it('plots four daily metrics and retains true zero while gaps break lines',()=>{
 const records=[{date:'2026-09-01',downloads:0,stars:2,groupJoins:3,leads:4},{date:'2026-09-02',downloads:10,stars:null,groupJoins:4,leads:5},{date:'2026-09-04',downloads:20,stars:8,groupJoins:5,leads:6}]
 const {series}=dailySeries(records);expect(series).toHaveLength(4);expect(series[0].segments.map(s=>s.length)).toEqual([2,1]);expect(series[0].segments[0][0].value).toBe(0);expect(series[1].segments.map(s=>s.length)).toEqual([1,1])
 const root=document.createElement('div');document.body.append(root);renderDailyChart(root,records);expect(root.querySelectorAll('[data-daily-series]')).toHaveLength(4);expect(root.querySelectorAll('input:checked')).toHaveLength(4)
 const toggle=root.querySelector('input');toggle.click();expect(root.querySelectorAll('[data-daily-series]')).toHaveLength(3);toggle.click();expect(root.querySelectorAll('[data-daily-series]')).toHaveLength(4)
})
it('handles single point, missing metrics and sorted latest30 without mutating data',()=>{
 const records=Array.from({length:31},(_,i)=>({date:`2026-08-${String(31-i).padStart(2,'0')}`,downloads:i}));const copy=structuredClone(records);expect(dailySeries(records).rows).toHaveLength(30);expect(records).toEqual(copy)
 const root=document.createElement('div');document.body.append(root);renderDailyChart(root,[{date:'2026-09-01',downloads:0}]);expect(root.querySelectorAll('circle')).toHaveLength(1);expect(root.innerHTML).not.toMatch(/NaN|Infinity/)
 root.querySelectorAll('input').forEach(input=>input.click());expect(root.textContent).toContain('请选择至少一项指标')
})
