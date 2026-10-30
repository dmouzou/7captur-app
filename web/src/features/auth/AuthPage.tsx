import { useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../services/firebase";
import { Logo } from "../../components/Logo";
import { ThemeToggle } from "../../components/ThemeContext";

type Mode = "signin" | "signup" | "reset";

function friendly(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Use a password of at least 8 characters.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later.";
    case "auth/operation-not-allowed":
      return "This sign-in provider is not enabled in Firebase Console (Authentication > Sign-in method).";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Console (Authentication > Settings > Authorized domains).";
    case "auth/popup-closed-by-user":
      return "Sign-in popup was closed before completing.";
    case "auth/popup-blocked":
      return "Sign-in popup was blocked by your browser. Please allow popups.";
    case "auth/network-request-failed":
      return "Network connection error. Check your connection.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    default:
      return "";
  }
}

function getErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "terms") return "Accept the terms and privacy policy to continue.";
  const f = friendly(code);
  if (f) return f;
  const msg = (err as { message?: string })?.message;
  if (msg) return msg;
  return "Something went wrong. Try again.";
}

export function AuthPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!accepted) throw { code: "terms" };
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(
          doc(db, "users", cred.user.uid),
          {
            email,
            status: "active",
            createdAt: serverTimestamp(),
            notificationPrefs: { weeklyEmail: true },
          },
          { merge: true }
        );
        try {
          await sendEmailVerification(cred.user);
        } catch (warn) {
          console.warn("Could not send email verification link:", warn);
        }
        setInfo("Account created. Check your inbox to verify your email.");
      } else if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await sendPasswordResetEmail(auth, email);
        setInfo("If an account exists for that email, a reset link is on its way.");
      }
    } catch (err: unknown) {
      console.error("Auth error:", err);
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError("");
    setBusy(true);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const uRef = doc(db, "users", cred.user.uid);
      const snap = await getDoc(uRef);
      if (!snap.exists()) {
        await setDoc(uRef, {
          email: cred.user.email,
          displayName: cred.user.displayName ?? "",
          status: "active",
          createdAt: serverTimestamp(),
          notificationPrefs: { weeklyEmail: true },
        });
      }
    } catch (err: unknown) {
      console.error("Google sign-in error:", err);
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        position: "relative",
      }}
    >
      {/* Top bar with logo and theme toggle */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "20px 28px",
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <Logo size={34} subtitle="Intelligence & Decision Platform" />
        <ThemeToggle />
      </header>

      {/* Main card */}
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 16px 48px",
        }}
      >
        <div
          className="card"
          style={{
            width: "100%",
            maxWidth: 440,
            padding: "36px 32px",
            boxShadow: "var(--shadow-lg)",
            border: "1px solid var(--border)",
            borderRadius: 18,
          }}
        >
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ display: "inline-block", marginBottom: 16 }}>
              <Logo size={46} showText={false} />
            </div>
            <h2 style={{ fontSize: "1.45rem", marginBottom: 6 }}>
              {mode === "signup"
                ? "Create your account"
                : mode === "reset"
                ? "Reset your password"
                : "Welcome to 7Captur"}
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {mode === "signup"
                ? "Get automated marketing intelligence in minutes."
                : mode === "reset"
                ? "We'll send a secure reset link to your email."
                : "Sign in to manage your recommendations and data."}
            </p>
          </div>

          {/* Social login (Google) */}
          {mode !== "reset" && (
            <>
              <button
                type="button"
                onClick={google}
                disabled={busy}
                className="btn-secondary"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  margin: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Continue with Google
              </button>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  margin: "20px 0 16px",
                  color: "var(--text-dim)",
                  fontSize: 12.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span>or continue with email</span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
            </>
          )}

          {/* Form */}
          <form onSubmit={submit} noValidate>
            <div>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="name@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {mode !== "reset" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <label htmlFor="password">Password</label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setMode("reset");
                        setError("");
                        setInfo("");
                      }}
                      style={{ fontSize: 12 }}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Enter your password"}
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            )}

            {mode === "signup" && (
              <label
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  margin: "18px 0 6px",
                  cursor: "pointer",
                  fontWeight: 400,
                  color: "var(--text-secondary)",
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: "auto", marginTop: 3 }}
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                <span>
                  I accept the{" "}
                  <a href="#terms" onClick={(e) => e.preventDefault()}>
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="#privacy" onClick={(e) => e.preventDefault()}>
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                marginTop: 22,
                padding: "12px 16px",
                fontSize: 14,
                borderRadius: 10,
              }}
            >
              {busy
                ? "Please wait…"
                : mode === "signup"
                ? "Create account"
                : mode === "reset"
                ? "Send reset link"
                : "Sign in"}
            </button>

            {error && (
              <div
                role="alert"
                className="error"
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "var(--danger-bg)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  marginTop: 14,
                }}
              >
                {error}
              </div>
            )}

            {info && (
              <div
                role="status"
                style={{
                  color: "var(--success)",
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "var(--success-bg)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  fontSize: 13.5,
                  marginTop: 14,
                }}
              >
                {info}
              </div>
            )}

            <div
              style={{
                textAlign: "center",
                marginTop: 24,
                paddingTop: 18,
                borderTop: "1px solid var(--border)",
                fontSize: 13.5,
                color: "var(--muted)",
              }}
            >
              {mode === "signin" && (
                <>
                  Don't have an account?{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setMode("signup");
                      setError("");
                      setInfo("");
                    }}
                  >
                    Create account
                  </button>
                </>
              )}
              {mode === "signup" && (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setMode("signin");
                      setError("");
                      setInfo("");
                    }}
                  >
                    Sign in
                  </button>
                </>
              )}
              {mode === "reset" && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setMode("signin");
                    setError("");
                    setInfo("");
                  }}
                >
                  ← Back to Sign in
                </button>
              )}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
