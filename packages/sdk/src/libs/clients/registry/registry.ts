import assert from "assert";
import {Registry__factory} from "@uma/core/contract-types/ethers"
import Registry from "@uma/core/build/contracts/Registry.json"
import type { SignerOrProvider} from '../../index.d'
import {EventFragment, Result} from '@ethersproject/abi'
import { BlockTag} from "@ethersproject/abstract-provider";
import {EventFilter,Event} from 'ethers'

export interface TypedEvent<EventArgs extends Result> extends Event {
  args: EventArgs;
}
type NewContractRegisteredEvent = TypedEvent< [string, string, string[]] & { contractAddress: string; creator: string; parties: string[] } >;  

export interface EventState {
  contracts?:{[key:string]:NewContractRegisteredEvent}
}

type Network = keyof typeof Registry.networks

export function getAddress(network:Network){
  const address =  Registry?.networks?.[network]?.address
  assert(address,'no address found for network: ' + network)
  return address
}

export function connect(provider:SignerOrProvider,network:Network = '1'){
  const address = getAddress(network)
  return Registry__factory.connect(address,provider)
}

// experimenting with a generalized way of handling events and returning state, inspired from react style reducers
export function reduceEvents(state:EventState={},event:Event,index?:number):EventState{
  switch(event.event){
    // event NewContractRegistered(address indexed contractAddress, address indexed creator, address[] parties);
    case "NewContractRegistered":{
      // this TypedEventFilter was copied from the typechain file. Dont know a better way to get this.
      const typedEvent = event as NewContractRegisteredEvent
      const contracts = state?.contracts || {}
      assert(event.args,`event ${event.event} missing args`)
      return {
        ...state,
        contracts: {
          ...contracts,
          [event.args.contractAddress]:event
        }
      }
    }
  }
  return state
}
export function getEventState(events:Event[]){
  return events.reduce(reduceEvents,{})
}


