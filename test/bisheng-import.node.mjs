import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBishengServer } from '../deploy/bisheng/server.mjs'
import { SQLiteDatabase } from '../deploy/bisheng/sqlite-store.mjs'
import { createEmptyState } from '../deploy/bisheng/workbench/model.mjs'
const stamp = '2026-09-10T00:00:00.000Z'
function source() {
  const state = createEmptyState()
  state.revision = 19
  state.topics.push({id:'topic',createdAt:stamp,updatedAt:stamp,title:'Imported',status:'unselected'})
  state.publications.push({id:'pub',createdAt:stamp,updatedAt:stamp,title:'Video',platform:'bilibili',topicId:'topic'})
  state.snapshots.push({id:'snap',createdAt:stamp,updatedAt:stamp,publicationId:'pub',capturedAt:stamp,checkpoint:'current',source:'manual',metrics:{views:123}})
  state.bindings.push({id:'binding',createdAt:stamp,updatedAt:stamp,sessionId:'session-reference',scope:'topic',entityId:'topic',title:'Metadata only'})
  state.settings = {custom:'kept'}
  return state
}
test('import preserves records and metadata, advances revision, and retries without overwriting changes', async()=>{
  const db = new SQLiteDatabase(':memory:')
  try {
    const store=db.store('a'), input=source(), result=await store.importState(input,0)
    assert.equal(result.revision,20);assert.equal(result.counts.snapshots,1)
    assert.equal(result.migration.sourceRevision,19)
    assert.deepEqual(await store.read(), {...input,revision:20})
    assert.equal(input.revision,19)
    await store.mutate({action:'upsert',entity:'topics',id:'topic',data:{title:'Later edit'}})
    const retry=await store.importState(input,0)
    assert.equal(retry.alreadyImported,true);assert.equal(retry.revision,21)
    assert.equal((await store.read()).topics[0].title,'Later edit')
    assert.equal(db.store('b').summary().migration,null)
    await assert.rejects(store.importState({...input,settings:{}},21),{code:'IMPORT_TARGET_NOT_EMPTY'})
  }finally{db.close()}
})
test('validation, revision conflicts, populated targets and SQL failures leave target untouched', async()=>{
  const db=new SQLiteDatabase(':memory:')
  try {
    const store=db.store('a'), invalid=source();invalid.snapshots[0].publicationId='missing'
    await assert.rejects(store.importState(invalid,0),{code:'VALIDATION_ERROR'})
    await assert.rejects(store.importState(source(),1),{code:'REVISION_CONFLICT'})
    assert.deepEqual(await store.read(),createEmptyState())
    db.db.exec("CREATE TRIGGER reject_import BEFORE INSERT ON workbench_imports BEGIN SELECT RAISE(ABORT, 'test failure'); END;")
    await assert.rejects(store.importState(source(),0))
    assert.deepEqual(await store.read(),createEmptyState());assert.equal(store.summary().migration,null)
    db.db.exec('DROP TRIGGER reject_import')
    await store.mutate({action:'upsert',entity:'topics',data:{title:'Existing'}})
    const before=await store.read()
    await assert.rejects(store.importState(source(),1),{code:'IMPORT_TARGET_NOT_EMPTY'})
    assert.deepEqual(await store.read(),before)
  }finally{db.close()}
})
function request(path,body,{user='alice',tenant='a',origin='https://platform.example'}={}) {
  return new Request(`http://localhost${path}`,{method:body===undefined?'GET':'POST',headers:{'x-bisheng-user-id':user,'x-bisheng-tenant-id':tenant,'x-forwarded-host':'platform.example','x-forwarded-proto':'https',origin},...(body===undefined?{}:{body:JSON.stringify(body)})})
}
test('import requires platform identity and same origin, returns small summary, and accepts a 6MB source',async()=>{
  const database=new SQLiteDatabase(':memory:'),app=createBishengServer({database,tickIntervalMs:0,collectorFactory:()=>({})})
  const path='/api/media-workbench/import',body={state:source(),expectedRevision:0}
  try {
    assert.equal((await app.handle(request(path,body,{user:''}))).status,401)
    assert.equal((await app.handle(request(path,body,{tenant:''}))).status,401)
    assert.equal((await app.handle(request(path,body,{origin:''}))).status,403)
    assert.equal((await app.handle(request(path,body,{origin:'https://evil.example'}))).status,403)
    assert.equal((await app.handle(request(path))).status,405)
    const large=source();large.settings.padding='x'.repeat(6_000_000)
    const response=await app.handle(request(path,{state:large,expectedRevision:0}))
    assert.equal(response.status,200);assert.ok((await response.text()).length<1000)
    const summary=await(await app.handle(request('/api/media-workbench/summary'))).json()
    assert.equal(summary.counts.bindings,1);assert.match(summary.migration.digest,/^[a-f0-9]{64}$/)
    assert.equal((await app.handle(request(path,{state:{...large,settings:{padding:'x'.repeat(12_000_000)}},expectedRevision:0}))).status,413)
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve))
    const base=`http://127.0.0.1:${app.server.address().port}`
    assert.equal((await fetch(base+'/api/media-workbench/mutate',{method:'POST',body:'x'.repeat(2_000_001)})).status,413)
    assert.equal((await fetch(base+path,{method:'POST',body:'x'.repeat(12_000_001)})).status,413)
  }finally{await app.close()}
})
