// Paddle.js loader and checkout. The browser never decides plan state: the verified webhook does.
declare global { interface Window { Paddle?: any } }

export const paddleEnv = (import.meta.env.VITE_PADDLE_ENV as string) === "production" ? "production" : "sandbox";
const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
export const priceIds: Record<string, string> = (() => { try { return JSON.parse((import.meta.env.VITE_PADDLE_PRICES as string) || "{}"); } catch { return {}; } })();
export const billingConfigured = Boolean(token) && Object.keys(priceIds).length > 0;

let loading: Promise<void> | null = null;
export function loadPaddle(onCompleted: () => void): Promise<void> {
  if (!token) return Promise.reject(new Error("Paddle is not configured"));
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    s.onload = () => {
      if (paddleEnv === "sandbox") window.Paddle.Environment.set("sandbox");
      window.Paddle.Initialize({ token, eventCallback: (e: { name?: string }) => { if (e.name === "checkout.completed") onCompleted(); } });
      resolve();
    };
    s.onerror = () => { loading = null; reject(new Error("Could not load checkout")); };
    document.head.appendChild(s);
  });
  return loading;
}

export function openCheckout(priceId: string, email: string | null, workspaceId: string) {
  window.Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: email ? { email } : undefined,
    customData: { workspaceId },
    settings: { displayMode: "overlay", theme: "dark" },
  });
}
