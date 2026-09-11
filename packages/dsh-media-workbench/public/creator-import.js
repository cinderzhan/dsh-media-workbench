export const creatorFields = {name:['名称','达人名称','达人昵称','昵称','公众号名称','账号名称','博主名称','name'],platform:['平台','所在平台','主要发布平台','主要平台','platform'],followers:['粉丝','粉丝量','粉丝数','followers'],contact:['联系人','联系方式','contact','微信','微信号'],quote:['报价','参考报价','报价（元）','参考报价（元）','费用','quote'],accountUrl:['主页','主页链接','账号链接','账号主页','accounturl'],notes:['备注','基础信息','简介','notes']}
const clean = value => String(value ?? '').trim().replace(/^\uFEFF/,'')
const key = value => clean(value).toLowerCase().replace(/\s/g,'')
export function parseDelimited(source) {
  let text = String(source).replace(/^\uFEFF/, '')
  const separator = text.match(/^sep=([,;\t])\r?\n/i)
  if (separator) text = text.slice(separator[0].length)
  let quote=false;const counts={',':0,'\t':0,';':0}
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"')i++;else quote=!quote}else if(!quote){if(c==='\r'||c==='\n')break;if(c in counts)counts[c]++}}
  const delimiter=separator?.[1]||Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]
  const rows=[];let row=[],cell='',quoted=false,closed=false
  const push=()=>{row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';closed=false}
  for(let i=0;i<text.length;i++){
    const c=text[i]
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else if(quoted){quoted=false;closed=true}else if(!cell.trim()&&!closed){cell='';quoted=true}else throw new Error(`第 ${rows.length+1} 条记录的引号格式不正确，请检查 CSV 导出格式`)}
    else if(!quoted&&c===delimiter){row.push(cell);cell='';closed=false}
    else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;push()}
    else if(closed&&!/\s/.test(c))throw new Error('引号结束后出现了多余内容，请检查 CSV 分隔符')
    else if(!closed)cell+=c
  }
  if(quoted)throw new Error('CSV 引号未闭合，请检查文件')
  push();return rows
}
export function decodeCreatorFile(buffer){const bytes=new Uint8Array(buffer);if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes);if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be').decode(bytes);try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return new TextDecoder('gb18030',{fatal:true}).decode(bytes)}}
export function creatorMapping(headers){return Object.fromEntries(Object.entries(creatorFields).map(([field,aliases])=>[field,headers.findIndex(h=>aliases.map(key).includes(key(h)))]))}
const platforms={bilibili:'bilibili','b站':'bilibili','哔哩哔哩':'bilibili',douyin:'douyin','抖音':'douyin',xiaohongshu:'xiaohongshu','小红书':'xiaohongshu',weixin_channels:'weixin_channels','视频号':'weixin_channels','微信视频号':'weixin_channels',weixin_article:'weixin_article','微信公众号':'weixin_article','公众号':'weixin_article'}
function numeric(value){if(!value||/^(未知|暂无|不详|待定|—|-|n\/a)$/i.test(value))return null;const match=value.replace(/[,，¥￥元\s]/g,'').match(/^(\d+(?:\.\d+)?)(万|[wW]|千|[kK])?$/);return match?Number(match[1])*({万:10000,w:10000,W:10000,千:1000,k:1000,K:1000}[match[2]]||1):null}
export function parseCreators(text,defaultPlatform='bilibili',mapping){
 const [headers,...raw]=parseDelimited(text);if(!headers||!raw.length)throw new Error('请提供表头和至少一行达人数据')
 const indices=mapping||creatorMapping(headers);if(!(indices.name>=0))throw new Error('未找到达人名称列，请在字段对应关系中选择名称列')
 const rows=[],errors=[],warnings=[]
 raw.forEach((cells,i)=>{
  const line=i+2,row={},notes=[],used=new Set();if(cells.length!==headers.length){errors.push(`第 ${line} 行有 ${cells.length} 列，表头有 ${headers.length} 列；含逗号的文字需用双引号包围`);return}
  for(const [field,index]of Object.entries(indices)){if(index>=0){used.add(Number(index));const value=clean(cells[index]);if(value)row[field]=value}}
  if(!row.name){errors.push(`第 ${line} 行缺少达人名称`);return}
  const platformValue=row.platform||defaultPlatform;row.platform=platforms[key(platformValue)];if(!row.platform){errors.push(`第 ${line} 行平台「${platformValue}」无法识别，请将多平台账号分行填写`);return}
  for(const field of ['followers','quote']){if(!(field in row))continue;const original=row[field],value=numeric(original);if(value===null){delete row[field];notes.push(`${field==='followers'?'粉丝量':'报价'}：${original}`);warnings.push(`第 ${line} 行的${field==='followers'?'粉丝量':'报价'}保留在备注，未写入数值列`)}else row[field]=value}
  if(row.accountUrl){try{const url=new URL(row.accountUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();const allowed={bilibili:['bilibili.com','b23.tv'],douyin:['douyin.com','iesdouyin.com'],xiaohongshu:['xiaohongshu.com','xhslink.com'],weixin_channels:['weixin.qq.com','channels.weixin.qq.com'],weixin_article:['mp.weixin.qq.com']}[row.platform];if(!allowed.some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))throw Error()}catch{notes.push(`主页：${row.accountUrl}`);delete row.accountUrl;warnings.push(`第 ${line} 行主页不是对应平台的 HTTP(S) 链接，原文保留在备注`)}}
  headers.forEach((header,index)=>{if(!used.has(index)&&clean(cells[index]))notes.push(`${clean(header)||'未命名列'}：${clean(cells[index])}`)})
  if(notes.length)row.notes=[row.notes,...notes].filter(Boolean).join('\n')
  rows.push(row)
 })
 return {rows,errors,warnings,headers}
}
