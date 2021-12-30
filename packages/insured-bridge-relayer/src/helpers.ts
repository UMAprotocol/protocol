export function isErrorOutput<T>(input: PromiseSettledResult<T>): input is PromiseRejectedResult {
  return input.status === "rejected";
}
