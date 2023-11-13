// Wrapper class for errors that occur while logging to an extended transport
export class TransportError extends Error {
  public readonly originalError: unknown;
  public readonly originalInfo: unknown;

  constructor(transportName: string, originalError: unknown, originalInfo: unknown) {
    super(`Error occurred while logging to ${transportName} transport`);

    if (originalError instanceof Error) {
      // Some libraries might throw error that adds sensitive properties (e.g. Axios config). We only want to keep the
      // original message and stack trace.
      this.originalError = {
        message: originalError.message,
        stack: originalError.stack,
      };
    } else {
      // If it's not an Error instance, we just keep the original value.
      this.originalError = originalError;
    }

    this.originalInfo = originalInfo;
  }
}
