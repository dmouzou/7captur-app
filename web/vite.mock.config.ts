// Screenshot harness: runs the real UI against an in-memory Firebase stand-in with demo data.
//   npm run dev:mock   (from web/), then open http://localhost:5199
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const m = (f: string) => path.resolve(__dirname, "dev-mock", f);
export default defineConfig({
  plugins: [react()],
  server: { port: 5199, host: "127.0.0.1" },
  resolve: { alias: {
    "firebase/app": m("firebase-app.ts"), "firebase/auth": m("firebase-auth.ts"), "firebase/firestore": m("firebase-firestore.ts"),
    "firebase/functions": m("firebase-functions.ts"), "firebase/storage": m("firebase-storage.ts"),
  } },
});
