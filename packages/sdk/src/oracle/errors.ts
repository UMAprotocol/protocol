import { exists } from "../utils";

// This error should be thrown if an expected value does not exist
export class ExistenceError extends Error {
  constructor(message = "") {
    super(message);
    this.name = "ExistenceError";
    // if this isnt included, we cannot use instanceof to check the type
    Object.setPrototypeOf(this, ExistenceError.prototype);
  }
}

// Special assert which checks for existence and throw existence error
export function assertExists<T>(condition: T, message = ""): asserts condition is NonNullable<T> {
  if (!exists(condition)) throw new ExistenceError(message);
}

// Ignore only existence errors. If thrown properly this can be used to convert a non existent value to undefined.
export function ignoreExistenceError<X>(call: () => X): X | undefined {
  try {
    return call();
  } catch (err) {
    if (err instanceof ExistenceError) return undefined;
    throw err;
  }
}

// same function but for async calls
export async function ignoreExistenceErrorAsync<X>(call: () => X): Promise<X | undefined> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ExistenceError) return undefined;
    throw err;
  }
}
