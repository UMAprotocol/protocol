import { Signer } from "@ethersproject/abstract-signer";
import { Provider } from "@ethersproject/abstract-provider";
export type SignerOrProvider = Signer | Provider

export {Store} from './stores/index.d'
import {BlockType} from './tables/blocks/index.d'

export interface MakeId<I,D> {
  (d:D)=>I
}
export interface MaybeId<I> {
  id?:I
}
export interface HasId<I> {
  id:I
}
