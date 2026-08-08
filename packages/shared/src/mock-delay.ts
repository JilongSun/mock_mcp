/**
 * Mock delay utility — simulates real API latency with jitter.
 * All mock tools call this before returning to mimic realistic processing time.
 */

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Simulates a network / processing delay with random jitter.
 * @param minMs Minimum delay in milliseconds (default 300)
 * @param maxMs Maximum delay in milliseconds (default 1500)
 */
export async function mockDelay(minMs = 300, maxMs = 1500): Promise<void> {
  const delay = randomBetween(minMs, maxMs);
  console.log(`[MockDelay] ${delay}ms`);
  return new Promise((resolve) => setTimeout(resolve, delay));
}
