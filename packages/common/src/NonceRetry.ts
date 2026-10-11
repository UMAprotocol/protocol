/** Only explicit nonce rejections are safe to submit again; an uncertain broadcast is not. */
export function isNonceConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  let conflict = false;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const details = typeof current === "object" ? (current as Record<string, unknown>) : {};
    const messages = [typeof current === "string" ? current : details.message, details.reason]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    // A receipt, simulation failure, timeout, or already-known transaction is not a rejected send.
    // Ethers attaches a locally computed transactionHash even to rejected sends; it is not proof of acceptance.
    // Inspect only error metadata, never serialize transaction requests or their payloads.
    if (
      details.receipt ||
      details.type === "call" ||
      ["TIMEOUT", "NETWORK_ERROR", "CALL_EXCEPTION", "TRANSACTION_REPLACED"].includes(String(details.code)) ||
      /already known|known transaction|timed? out|timeout|revert/i.test(messages)
    )
      return false;
    if (
      details.code === "NONCE_EXPIRED" ||
      details.code === "REPLACEMENT_UNDERPRICED" ||
      /\bnonce too low\b|\breplacement transaction underpriced\b/i.test(messages)
    )
      conflict = true;
    current = details.error;
  }
  return conflict;
}

/**
 * At most three submission attempts. The operation must recheck logical completion and fetch a fresh
 * nonce each time. Keep receipt waiting outside this helper so an uncertain broadcast is never retried.
 * onRetry receives the failed attempt number (1 or 2), before a 15s/30s delay plus up to 250ms jitter.
 */
export async function retryOnNonceConflict<T>(
  operation: () => Promise<T>,
  onRetry?: (error: unknown, attempt: number) => void
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 3 || !isNonceConflict(error)) throw error;
      onRetry?.(error, attempt);
      await new Promise((resolve) => setTimeout(resolve, attempt * 15000 + Math.floor(Math.random() * 251)));
    }
  }
}
