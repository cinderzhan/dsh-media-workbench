import {describe,it,expect} from 'vitest'
import {parseDelimited,parseCreators,decodeCreatorFile} from '../packages/dsh-media-workbench/public/creator-import.js'
import {applyMutation,createEmptyState} from '../packages/dsh-media-workbench/model.mjs'
describe('creator CSV imports',()=>{
 it('handles BOM, quoted commas/newlines, escaped quotes and preserves unrecognized fields',()=>{
  const result=parseCreators('\uFEFF达人名称,粉丝量,报价,建联时间,备注\r\n"甲,乙",3.5万,"5000起，含税",11月5日,"第一行\n第二行"\r\n')
  expect(result.errors).toEqual([]);expect(result.rows[0]).toMatchObject({name:'甲,乙',platform:'bilibili',followers:35000});expect(result.rows[0].quote).toBeUndefined();expect(result.rows[0].notes).toContain('5000起，含税');expect(result.rows[0].notes).toContain('建联时间：11月5日')
  expect(parseDelimited('名称,备注\n甲,"有""引号"""')[1][1]).toBe('有"引号"')
 })
 it('supports TSV, semicolon CSV and Excel sep header',()=>{
  for(const delimiter of ['\t',';'])expect(parseCreators(`名称${delimiter}平台\n甲${delimiter}小红书`).rows[0].platform).toBe('xiaohongshu')
  expect(parseCreators('sep=;\n名称;平台\n甲;B站').rows).toHaveLength(1)
 })
 it('reads UTF8 BOM, UTF16 and GBK Chinese',()=>{
  expect(decodeCreatorFile(new TextEncoder().encode('\uFEFF名称,平台').buffer)).toBe('名称,平台')
  const b=Buffer.from('\uFEFF名称,平台','utf16le');expect(decodeCreatorFile(b)).toBe('名称,平台')
  expect(decodeCreatorFile(Uint8Array.from([0xc3,0xfb,0xb3,0xc6,0x2c,0xc6,0xbd,0xcc,0xa8]))).toBe('名称,平台')
 })
 it('reports invalid rows and never guesses multi-platform membership',()=>{
  const r=parseCreators('名称,平台\n甲,B站/小红书\n乙,B站,多余列\n,抖音');expect(r.errors).toHaveLength(3);expect(r.rows).toEqual([])
  expect(()=>parseDelimited('名称,备注\n甲,"未闭合')).toThrow('未闭合')
 })
 it('lets custom columns map and preserves existing numbers when source is blank or uncertain',()=>{
  let state=applyMutation(createEmptyState(),{action:'importCreators',rows:[{name:'甲',platform:'bilibili',followers:50,quote:500}]})
  const result=parseCreators('博主,粉丝,报价\n甲,,待定','bilibili',{name:0,followers:1,quote:2})
  state=applyMutation(state,{action:'importCreators',rows:result.rows});expect(state.creators).toHaveLength(1);expect(state.creators[0]).toMatchObject({followers:50,quote:500});expect(state.creators[0].notes).toContain('待定')
 })
})

it('merges generated notes without erasing prior contact history or duplicating on reimport',()=>{
 let state=applyMutation(createEmptyState(),{action:'importCreators',rows:[{name:'甲',platform:'bilibili',notes:'已签约，勿重复联系'}]})
 const {rows}=parseCreators('名称,报价\n甲,私聊')
 state=applyMutation(state,{action:'importCreators',rows});const notes=state.creators[0].notes
 expect(notes).toBe('已签约，勿重复联系\n报价：私聊')
 state=applyMutation(state,{action:'importCreators',rows});expect(state.creators[0].notes).toBe(notes)
})
it('keeps accepted Douyin alternate-domain account identities',()=>{
 const {rows,errors}=parseCreators('名称,平台,主页\n甲,抖音,http://www.iesdouyin.com/share/user/123')
 expect(errors).toEqual([]);expect(rows[0].accountUrl).toBe('http://www.iesdouyin.com/share/user/123')
 let state=applyMutation(createEmptyState(),{action:'importCreators',rows});state=applyMutation(state,{action:'importCreators',rows});expect(state.creators).toHaveLength(1)
})

it('automatically accepts multi-platform rows and preserves their original platform description',()=>{
 const result=parseCreators('名称,平台,粉丝量,报价\n甲,B站、抖音、视频号,b1.4w,定制1500起\n乙,抖音/小红书,,\n丙,待确认,,','bilibili',undefined,{lenient:true})
 expect(result.errors).toEqual([]);expect(result.rows).toHaveLength(3)
 expect(result.rows[0]).toMatchObject({platform:'bilibili'});expect(result.rows[0].notes).toContain('B站、抖音、视频号');expect(result.rows[0].notes).toContain('b1.4w')
 expect(result.rows[1].platform).toBe('douyin');expect(result.rows[2].notes).toContain('待确认')
})
it('keeps valid rows available when another row is missing its identity',()=>{
 const result=parseCreators('名称,平台\n甲,B站\n,抖音','bilibili',undefined,{lenient:true})
 expect(result.rows).toHaveLength(1);expect(result.errors).toHaveLength(1)
})
