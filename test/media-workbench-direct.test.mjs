import {describe,it,expect,vi} from 'vitest'
import {DirectCollector,HybridCollector,embeddedState,parsePublication} from '../packages/dsh-media-workbench/direct-collector.mjs'
const id='6aa28fb5000000002502d4de', bvid='BV1niYu6LEtX'
const note={noteId:id,time:1700000000000,lastUpdateTime:1750000000000,interactInfo:{likedCount:'25',collectedCount:'0',commentCount:'3',shareCount:'1.2万'}}
const html=value=>`<script>window.__INITIAL_STATE__=${JSON.stringify(value)};</script>`
const xhs=html({note:{noteDetailMap:{[id]:{note}}}})
describe('direct page data collector',()=>{
 it('reads exact counts, preserves zero and uses publication time rather than update time',()=>{
  expect(parsePublication(xhs,'xiaohongshu',id)).toEqual({source:'direct',publishedAt:new Date(note.time).toISOString(),metrics:{likes:25,favorites:0,comments:3}})
 })
 it('does not select the first unrelated note or execute page scripts',()=>{
  expect(()=>parsePublication(xhs,'xiaohongshu','77aabbccddeeff0011223344')).toThrow('对应')
  expect(embeddedState('<script>window.__INITIAL_STATE__=(()=>{throw Error("executed")})()</script>','__INITIAL_STATE__')).toBeNull()
 })
 it('normalizes bare undefined but preserves quoted data and nested braces',()=>{
  expect(embeddedState('window.__INITIAL_STATE__={"x":undefined,"y":"undefined } \\\"", "z":NaN};','__INITIAL_STATE__')).toEqual({x:null,y:'undefined } "',z:null})
 })
 it('reads B站 stats and pubdate for the exact bvid',()=>{
  const result=parsePublication(html({videoData:{bvid,pubdate:1700000000,stat:{view:100,reply:0,like:5}}}),'bilibili',bvid)
  expect(result).toMatchObject({metrics:{views:100,comments:0,likes:5},publishedAt:new Date(1700000000000).toISOString()})
  expect(()=>parsePublication(html({videoData:{bvid:'other'}}),'bilibili',bvid)).toThrow('对应')
 })
 it('does not fabricate metrics for metadata-only pages or future dates',()=>{
  expect(parsePublication(html({note:{noteDetailMap:{[id]:{note:{...note,interactInfo:{}}}}}}),'xiaohongshu',id).metrics).toEqual({})
  expect(parsePublication(html({note:{noteDetailMap:{[id]:{note:{...note,time:Date.now()+3600000}}}}}),'xiaohongshu',id).publishedAt).toBeUndefined()
 })
 it('preserves share query parameters and expands allowlisted short links',async()=>{
  const url=`https://www.xiaohongshu.com/explore/${id}?xsec_token=fixture&xsec_source=pc_share`
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:url}})).mockResolvedValueOnce(new Response(xhs))
  const c=new DirectCollector(fetcher);expect((await c.collect({platform:'xiaohongshu',url:'https://xhslink.com/a/sample'})).metrics.likes).toBe(25)
  expect(fetcher.mock.calls[1][0]).toBe(url);await c.close()
 })
 it('rejects off-platform redirects before sending another request',async()=>{
  const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}));const c=new DirectCollector(fetcher)
  await expect(c.collect({platform:'bilibili',url:`https://www.bilibili.com/video/${bvid}`})).rejects.toThrow('仅支持');expect(fetcher).toHaveBeenCalledOnce();await c.close()
 })
 it('rejects redirection to a different work and oversized HTML',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://www.bilibili.com/video/BV1xx411c7mD/'}})).mockResolvedValueOnce(new Response('not read'))
  const c=new DirectCollector(fetcher);await expect(c.collect({platform:'bilibili',url:`https://www.bilibili.com/video/${bvid}`})).rejects.toThrow('不一致');await c.close()
  const large=new DirectCollector(async()=>new Response('x'.repeat(2_000_001)));await expect(large.collect({platform:'bilibili',url:`https://www.bilibili.com/video/${bvid}`})).rejects.toThrow('过大');await large.close()
 })
 it('uses direct first and only falls back to an already open browser',async()=>{
  const direct={collect:vi.fn(async()=>({source:'direct',metrics:{likes:2}})),close:vi.fn()}
  const browser={ready:true,collect:vi.fn(async()=>({metrics:{likes:3}})),open:vi.fn(),close:vi.fn()}
  const c=new HybridCollector('/unused',{direct,browser});const p={platform:'bilibili'}
  expect((await c.collect(p)).source).toBe('direct');expect(browser.collect).not.toHaveBeenCalled()
  direct.collect.mockRejectedValue(new Error('login'));expect((await c.collect(p)).source).toBe('browser')
  browser.ready=false;await expect(c.collect(p)).rejects.toThrow('采集浏览器');expect(browser.open).not.toHaveBeenCalled();await c.close()
 })
})
