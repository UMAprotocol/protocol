const test = require('tape')
const lodash = require("lodash");
const Processor = require('../libs/processors')

test('processor',t=>{
  let processor  
  t.test('init',t=>{
    processor = Processor()
    t.ok(processor)
    t.end()
  })
  t.test('insertBalance',t=>{
    processor.insertBalance('a',1,1)
    processor.insertBalance('b',2,1)
    t.end()
  })
  t.test('insertAttribution',t=>{
    processor.insertAttribution('c','a',2)
    processor.insertAttribution('d','b',2)
    t.end()
  })
  t.test('shares',t=>{
    const result = processor.shares()
    t.equal(result.c,1/3)
    t.equal(result.d,2/3)
    t.end()
  })

})
