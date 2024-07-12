/**
 * Retries an async function if it errors up to N times with M delay between retries.
 * @param fn - The async function to retry.
 * @param retries - Number of times to retry the function.
 * @param delayMs - Delay between retries in milliseconds.
 * @returns A promise that resolves with the result of the async function.
 */
export async function retryAsync<T>(fn: () => Promise<T>, retries: number, delayMs: number): Promise<T> {
  let attempts = 0;

  do {
    try {
      return await fn();
    } catch (error) {
      attempts++;
      if (attempts >= retries) {
        throw error;
      }
      await new Promise((res) => setTimeout(res, delayMs));
    }
  } while (attempts < retries);

  // Should never actually reach this, but for the sake of typescript
  throw new Error(`React a maximum of ${retries} retries.`);
}
