import { BrowserCollector, counter } from './collector.mjs'

const hosts = { bilibili: ['www.bilibili.com','bilibili.com','b23.tv'], xiaohongshu: ['www.xiaohongshu.com','xiaohongshu.com','xhslink.com','www.xhslink.com'] }
function address(value, platform) {
  let url
  try { url = new URL(value) } catch { throw new Error('请填写完整的平台作品链接。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts[platform]?.includes(url.hostname)) throw new Error('仅支持 B站、小红书的 HTTPS 作品或分享链接。')
  return url
}
function identity(url, platform) {
  return platform === 'bilibili' ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)\/?$/)?.[1] : url.pathname.match(/^\/(?:explore|discovery\/item)\/([a-fA-F0-9]{24})\/?$/)?.[1]
}
// Parse a balanced JSON object without executing scripts. Only bare undefined/NaN are normalized.
export function embeddedState(html, marker) {
  const match = new RegExp('window\\.' + marker + '\\s*=\\s*').exec(html)
  if (!match) return null
  const start = match.index + match[0].length
  if (html[start] !== '{') return null
  let depth = 0, quoted = false, escaped = false, json = ''
  for (let i=start;i<html.length;i++) {
    const char=html[i]
    if (quoted) { json+=char; if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue }
    if(char==='"'){quoted=true;json+=char;continue}
    const bare=html.slice(i).match(/^(undefined|NaN)\b/)
    if(bare){json+='null';i+=bare[0].length-1;continue}
    json+=char
    if(char==='{')depth++
    if(char==='}'&&--depth===0){try{return JSON.parse(json)}catch{return null}}
  }
  return null
}
function timestamp(value, milliseconds=false) {
  if(value===null || value===undefined || value==='')return undefined
  const number=Number(value), ms=milliseconds?number:number*1000
  return Number.isFinite(ms)&&ms>0&&ms<=Date.now()?new Date(ms).toISOString():undefined
}
export function parsePublication(html, platform, workId) {
  if(!workId)throw new Error('分享链接未展开为可确认的作品链接。')
  const data=embeddedState(html,'__INITIAL_STATE__')||embeddedState(html,'__INITIAL_SSR_STATE__')
  let fields,publishedAt
  if(platform==='bilibili') {
    const video=data?.videoData
    if(!video || (workId.startsWith('BV')?video.bvid!==workId:String(video.aid)!==workId.slice(2)))throw new Error('网页未返回对应 B站作品数据。')
    fields=Object.fromEntries(Object.entries({views:'view',likes:'like',comments:'reply',favorites:'favorite',shares:'share',coins:'coin',danmaku:'danmaku'}).map(([k,v])=>[k,video.stat?.[v]]))
    publishedAt=timestamp(video.pubdate)
  } else {
    const note=data?.note?.noteDetailMap?.[workId]?.note
    if(!note || note.noteId!==workId)throw new Error('网页未返回对应小红书笔记数据，请保留完整分享参数；必要时使用已登录浏览器。')
    fields=Object.fromEntries(Object.entries({likes:'likedCount',favorites:'collectedCount',comments:'commentCount',shares:'shareCount'}).map(([k,v])=>[k,note.interactInfo?.[v]]))
    // time is publication time; lastUpdateTime must never replace it.
    publishedAt=timestamp(note.time,true)
  }
  const metrics={}
  for(const [key,value] of Object.entries(fields)){const count=counter(value);if(count!==null)metrics[key]=count}
  if(!Object.keys(metrics).length&&!publishedAt)throw new Error('网页没有可确认的精确指标或发布时间。')
  return {metrics, ...(publishedAt?{publishedAt}:{}), source:'direct'}
}
export class DirectCollector {
  constructor(fetcher=fetch){this.fetcher=fetcher;this.controller=new AbortController()}
  async collect(publication) {
    let url=address(publication.url,publication.platform)
    const original=identity(url,publication.platform)
    const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(20000)])
    for(let hop=0;hop<6;hop++) {
      const response=await this.fetcher(url.href,{redirect:'manual',signal,headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36','accept':'text/html','accept-language':'zh-CN,zh;q=0.9'}})
      if([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get('location');await response.body?.cancel()
        if(!location)throw new Error('分享链接跳转缺少目标地址。')
        url=address(new URL(location,url).href,publication.platform);continue
      }
      if(!response.ok){await response.body?.cancel();throw new Error(`直接读取失败（HTTP ${response.status}）。`)}
      const finalId=identity(url,publication.platform)
      if(!finalId || original&&original!==finalId){await response.body?.cancel();throw new Error('页面跳转后的作品与输入链接不一致。')}
      if(Number(response.headers.get('content-length'))>2_000_000){await response.body?.cancel();throw new Error('作品页面过大，已停止读取。')}
      const reader=response.body.getReader();const chunks=[];let size=0
      try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw new Error('作品页面过大，已停止读取。');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
      return parsePublication(new TextDecoder().decode(bytes),publication.platform,finalId)
    }
    throw new Error('分享链接跳转过多。')
  }
  async close(){this.controller.abort()}
}
export class HybridCollector {
  constructor(directory,{direct=new DirectCollector(),browser=new BrowserCollector(directory)}={}){this.direct=direct;this.browser=browser;this.closed=false}
  get ready(){return !this.closed}
  get browserReady(){return this.browser.ready}
  open(){return this.browser.open()}
  async collect(publication){
    if(this.closed)throw new Error('工作台已停止。')
    if(!hosts[publication.platform])throw new Error('此平台尚未接入可靠的自动采集，请手动补录。')
    let result,reason
    try{result=await this.direct.collect(publication);if(Object.keys(result.metrics).length)return result}catch(error){reason=error.message}
    if(this.closed)throw new Error('工作台已停止。')
    if(this.browser.ready){try{return {...result,...await this.browser.collect(publication),source:'browser'}}catch(error){reason=error.message}}
    if(result?.publishedAt)return result
    throw new Error(`${reason||'直接读取未取得指标'} 可打开采集浏览器登录后重试，或手动补录。`)
  }
  async close(){this.closed=true;await this.direct.close();await this.browser.close()}
}
