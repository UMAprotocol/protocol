const test = require('tape')
const lodash = require("lodash");
const {AttributionHistory} = require('../libs/processors')

test('AttributionHistory',t=>{
  let processor
  t.test('init',t=>{
    processor = AttributionHistory()
    t.ok(processor)
    t.ok(processor.history)
    t.ok(processor.attributions)
    t.end()
  })
  t.test('process events',t=>{
    const events = lodash.times(100,i=>{
      return {
        blockNumber:i+1,
        args:[
         'useraddr ' + i % 13,
         'affiliateaddr ' + i % 3,
          (i * 100).toString()
        ]
      }
    })
    events.forEach(e=>processor.handleEvent(e.blockNumber,e.args))

    console.log(processor.history)
    // console.log(processor.attributions.snapshot())

    lodash.times(100,i=>{
      const snapshot = processor.history.lookup(i+1)
      t.ok(snapshot.attributions)
      t.equal(snapshot.blockNumber,i+1)
    })

    t.end()
  })
})
