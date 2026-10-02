import { cookies } from "next/headers";
import { configuredPasscode, SESSION_COOKIE, verifySession } from "./private-auth";

/** True when the request carries a valid holdings session for the current passcode. */
export async function hasHoldingsSession(): Promise<boolean> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value, configuredPasscode());
}
