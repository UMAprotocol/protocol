require('dotenv').config()
import assert from "assert";
import * as RegistryClient from './registry'
import { ethers } from 'ethers'

describe('emp factory', function(){
  let client:any
  test('inits',function(){
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL)
    client = RegistryClient.connect(provider,'1')
    assert.ok(client)
  })
  test('getEventState between',async function(){
    const events = await client.queryFilter( client.filters.NewContractRegistered(null,null,null),0,12477952)
    assert.ok(events.length)
  })
  test('getEventState',async function(){
    const events = await client.queryFilter({})
    const state = await RegistryClient.getEventState(events)
    assert.ok(state.contracts)
  })
})

