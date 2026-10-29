import { useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup,
} from "firebase/auth";
import { auth } from "../../services/firebase";

type Mode = "signin" | "signup" | "reset";

function friendly(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Email or password is incorrect.";
    case "auth/email-already-in-use": return "An account with this email already exists.";
    case "auth/weak-password": return "Use a password of at least 8 characters.";
    case "auth/invalid-email": return "Enter a valid email address.";
    case "auth/too-many-requests": return "Too many attempts. Try again later.";
    default: return "Something went wrong. Try again.";
  }
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
    setError(""); setInfo(""); setBusy(true);
    try {
      if (mode === "signup") {
        if (!accepted) throw { code: "terms" };
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(cred.user);
        setInfo("Check your inbox to verify your email.");
      } else if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await sendPasswordResetEmail(auth, email);
        setInfo("If an account exists for that email, a reset link is on its way.");
      }
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      setError(code === "terms" ? "Accept the terms and privacy policy to continue." : friendly(code));
    } finally { setBusy(false); }
  }

  async function google() {
    setError(""); setBusy(true);
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (err) { setError(friendly((err as { code?: string }).code ?? "")); }
    finally { setBusy(false); }
  }

  return (
    <main className="page">
      <h1>7Captur</h1>
      <p className="muted">Know what's working. Decide what to do next.</p>
      <form className="card" onSubmit={submit} noValidate>
        <h2>{mode === "signup" ? "Create your account" : mode === "reset" ? "Reset password" : "Sign in"}</h2>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {mode !== "reset" && (<>
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </>)}
        {mode === "signup" && (
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            I accept the terms and privacy policy
          </label>
        )}
        <button type="submit" disabled={busy}>{mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
        {mode !== "reset" && <button type="button" onClick={google} disabled={busy} style={{ marginLeft: 8, background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>Continue with Google</button>}
        <div role="alert" className="error">{error}</div>
        <div role="status" className="muted">{info}</div>
        <p className="muted">
          {mode !== "signin" && <button type="button" className="link" onClick={() => setMode("signin")}>Sign in</button>}{" "}
          {mode !== "signup" && <button type="button" className="link" onClick={() => setMode("signup")}>Create account</button>}{" "}
          {mode !== "reset" && <button type="button" className="link" onClick={() => setMode("reset")}>Forgot password</button>}
        </p>
      </form>
    </main>
  );
}
