import { GoogleAuthProvider, OAuthProvider, reauthenticateWithPopup, type AuthProvider, type User } from "firebase/auth";

/** Apple sign-in stays hidden until the Apple provider is configured in Firebase and VITE_APPLE_SIGNIN=true is set at build time. */
export const APPLE_SIGNIN_ENABLED = import.meta.env.VITE_APPLE_SIGNIN === "true";

export function appleProvider(): OAuthProvider {
  const p = new OAuthProvider("apple.com");
  p.addScope("email");
  p.addScope("name");
  return p;
}

/** Re-authenticates with the provider the user signed in with (Apple or Google). Password users are handled by the callers. */
export async function reauthWithSocial(user: User): Promise<void> {
  const ids = user.providerData.map((p) => p.providerId);
  const provider: AuthProvider = ids.includes("apple.com") && !ids.includes("google.com") ? appleProvider() : new GoogleAuthProvider();
  await reauthenticateWithPopup(user, provider);
}
