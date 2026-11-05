import { USER } from "./seed";
const auth = { currentUser: USER } as Record<string, unknown>;
export const getAuth = () => auth;
export const connectAuthEmulator = () => undefined;
export const onAuthStateChanged = (_a: unknown, cb: (u: unknown) => void) => { setTimeout(() => cb(USER), 0); return () => undefined; };
export const signOut = async () => undefined;
export const signInWithPopup = async () => ({ user: USER });
export const signInWithEmailAndPassword = async () => ({ user: USER });
export const createUserWithEmailAndPassword = async () => ({ user: USER });
export const sendEmailVerification = async () => undefined;
export const sendPasswordResetEmail = async () => undefined;
export const reauthenticateWithPopup = async () => undefined;
export const reauthenticateWithCredential = async () => undefined;
export class GoogleAuthProvider {}
export class OAuthProvider { constructor(public id: string) {} addScope() {} }
export const EmailAuthProvider = { credential: () => ({}) };
export type User = typeof USER;
export type AuthProvider = unknown;
