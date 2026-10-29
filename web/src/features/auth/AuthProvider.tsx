import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../../services/firebase";

interface AuthState { user: User | null; loading: boolean }
const Ctx = createContext<AuthState>({ user: null, loading: true });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, loading: false })), []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
