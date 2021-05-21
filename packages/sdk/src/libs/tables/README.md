# UMA SDK Tables
These tables give you an API for dealing with data of a certain type which can be keyed into tables. Tables should
give you useful methods for manipulating and querying data in each table. Tables rely on [stores](../stores/README.md).

## Tables
- [base](./base/README.md) - Some basic table functionality which most tables can inherit from
- [blocks](./blocks/README.md) - For storing blocks 

## Relationship to Stores
Tables consume a store, which expose a CRUD like way to manipulate data in a persistent store or cache. Tables will consume
and wrap store functionality and potentially add data specific ways to manipulate that particular table. Each table should 
represent a type of data, but they may expose multiple implementations based on the type of store used. 

## Queries
Tables may require data store specific ways of querying data, ie ability to access underlying database client in many cases.

## Adding a Table
Create a new folder named after the type of data you are storing in the tables directory with the following files:
- README.md: Add some notes on what the table is for and any stores it can use
- index.ts: Expose your tables based on the name type of store it uses, for example `export {default as JsMap} from './js-map'`
- ${store-type}.ts: Create a table file named for the store its compatible with, for example `js-map.ts`
- ${store-type}.test.ts: Any tests you want to run
- index.d.ts: in case you want to expose any data types

See the [blocks table](./blocks/README.md] as an example.


