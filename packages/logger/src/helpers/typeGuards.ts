// Helper type guard for dictionary objects. Useful when dealing with any info type passed to log method.
export const isDictionary = (arg: unknown): arg is Record<string, unknown> => {
  return typeof arg === "object" && arg !== null && !Array.isArray(arg);
};
