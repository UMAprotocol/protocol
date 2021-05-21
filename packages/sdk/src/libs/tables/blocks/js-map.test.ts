import assert from "assert";
import {JsMap} from '.'


const block = {
  number:0,
  timestamp:10,
  hash:'hash'
}
describe('block map table',function(){
  let table:any
  test('init',function(){
    table = JsMap()
    assert.ok(table)
  })
  test('create',async function(){
    const result = await table.create(block)
    assert.equal(result.id,block.number)
  })
  test('has',async function(){
    const has = table.has(block.number)
    assert.ok(has)
  })
})

