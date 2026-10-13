import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBishengServer } from '../deploy/bisheng/server.mjs'
import { SQLiteDatabase } from '../deploy/bisheng/sqlite-store.mjs'

const topic = title => ({action:'upsert',entity:'topics',data:{title}})
const origin='https://platform.example'
function request(path, {user='alice',tenant='company',body,requestOrigin=origin}={}) {
  return new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{
    'x-bisheng-user-id':user,'x-bisheng-tenant-id':tenant,'x-forwarded-host':'platform.example','x-forwarded-proto':'https',
    ...(body?{'content-type':'application/json',origin:requestOrigin}:{})
  },...(body?{body:JSON.stringify(body)}:{})})
}
test('hosted transport protects data and shares only within the tenant', async()=>{
  const database=new SQLiteDatabase(':memory:')
  const app=createBishengServer({database,env:{BISHENG_APP_BASE_PATH:'/apps/media'},tickIntervalMs:0,collectorFactory:()=>({collect:async()=>({metrics:{views:1}}),close(){}})})
  try {
    assert.equal((await app.handle(request('/',{user:''}))).status,200)
    assert.equal((await app.handle(request('/api/media-workbench/state',{user:''}))).status,401)
    assert.equal((await app.handle(request('/api/media-workbench/state',{tenant:''}))).status,401)
    assert.equal((await app.handle(request('/unknown/state'))).status,404)
    assert.equal((await app.handle(request('/api/media-workbench/mutate',{body:topic('blocked'),requestOrigin:'https://evil.example'}))).status,403)
    assert.equal((await app.handle(request('/api/media-workbench/mutate',{body:topic('shared')}))).status,200)
    const same=await(await app.handle(request('/api/media-workbench/state',{user:'bob'}))).json()
    assert.equal(same.topics[0].title,'shared');assert.equal(same.projectRoot,undefined)
    assert.equal(same.capabilities.desktopSessions,false)
    const other=await(await app.handle(request('/api/media-workbench/state',{tenant:'other-company'}))).json()
    assert.equal(other.topics.length,0)
    assert.equal((await app.handle(request('/api/media-workbench/mutate',{body:{...topic('stale'),expectedRevision:0}}))).status,409)
    const home=await app.handle(request('/'));assert.equal(home.headers.get('location'),'/apps/media/api/media-workbench/app')
    const html=await(await app.handle(request('/api/media-workbench/app'))).text()
    assert.match(html, /name="media-base-path" content="\/apps\/media"/)
    assert.match(html, /name="media-host" content="bisheng"/)
    for(const asset of ['app.js','dock.js','app.css','analytics.js','daily-chart.js']) assert.equal((await app.handle(request('/api/media-workbench/'+asset))).status,200)
    assert.equal((await app.handle(request('/api/media-workbench/browser/open',{body:{}}))).status,404)
  } finally {await app.close()}
})
test('SQLite survives restart and rejects stale edits across two live database connections',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bisheng-store-')),file=join(dir,'app.db')
  let a=new SQLiteDatabase(file),b=new SQLiteDatabase(file)
  try {
    await a.store('company').mutate({...topic('first'),expectedRevision:0})
    await assert.rejects(b.store('company').mutate({...topic('stale'),expectedRevision:0}),/Revision conflict/)
    await b.store('company').mutate({...topic('second'),expectedRevision:1})
    assert.equal((await a.store('company').read()).topics.length,2)
    assert.equal(a.claim('company','old'),true);assert.equal(b.claim('company','new'),false)
    a.release('company','old');assert.equal(b.claim('company','new'),true)
    a.close();a=new SQLiteDatabase(file)
    assert.equal((await a.store('company').read()).topics.length,2)
    assert.equal((await a.store('different').read()).topics.length,0)
  } finally {a.close();b.close();await rm(dir,{recursive:true,force:true})}
})

test('restarted scheduler discovers persisted work without a browser visit',async()=>{
  const database=new SQLiteDatabase(':memory:'),store=database.store('company')
  await store.mutate({action:'upsert',entity:'topics',id:'topic',data:{title:'Scheduled collection'}})
  await store.mutate({action:'upsert',entity:'publications',id:'pub',data:{topicId:'topic',title:'Video',platform:'bilibili',url:'https://www.bilibili.com/video/BV1niYu6LEtX/',publishedAt:new Date(Date.now()-25*3600000).toISOString()}})
  let calls=0
  const app=createBishengServer({database,env:{},tickIntervalMs:0,collectorFactory:()=>({collect:async()=>{calls++;return {source:'direct',metrics:{views:10}}},close(){}})})
  try {await app.tick();assert.equal(calls,1);assert.ok((await store.read()).snapshots.some(s=>s.metrics.views===10))}finally{await app.close()}
})
