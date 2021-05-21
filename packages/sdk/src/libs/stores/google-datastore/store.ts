import type { Store} from '../index.d'
import type { Datastore, Key } from "@google-cloud/datastore"

export default function<D> (kind:string, store:Datastore):Store<string,D>{
  function makeKey(id:string){
    return store.key([kind,id])
  }
  async function get(id:string){
    try{
      const [first] = await store.get(makeKey(id))
      return first
    }catch(err){
      return 
    }
  }
  async function set(id:string,data:D){
    await store.save({
      key:makeKey(id),
      method:'insert',
      data,
    })
  }
  async function has(id:string){
    try{
      await get(id)
      return true
    }catch(err){
      return false
    }
  }
  async function del(id:string){
    await store.delete(makeKey(id))
  }
  async function entries(){
    return []
  }
  async function values(){
    return []
  }
  async function keys(){
    return []
  }

  return {
    get,
    set,
    has,
    delete:del,
    entries,
    values,
    keys
  }

}
