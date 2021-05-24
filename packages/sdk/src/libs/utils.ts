// check if a value is not null or undefined, useful for numbers which could be 0.
// "is" syntax: https://stackoverflow.com/questions/40081332/what-does-the-is-keyword-do-in-typescript
/* eslint-disable-next-line @typescript-eslint/ban-types */
export function exists(value: any): value is {} {
  return value !== null && value !== undefined;
}
