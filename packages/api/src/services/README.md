# Api Services

These are classes which do a specific task. Services all maintain the same creation signature so they can be
instantiated predictably.

## Function signature

`type Service = (config:Json, libs:Libs, emit?:(...args:any[]):void):Promise<any>{}`

## Return types

Services can return anything really, but typically you want them to be class-like, ie returning an object or collection
of functions that can call into the service.
