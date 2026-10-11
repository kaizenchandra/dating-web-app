import type { paths } from "../../../packages/generated-clients/schema";
type Checkout =
  paths["/premium/checkout"]["post"]["responses"][200]["content"]["application/json"];
type Result = { razorpay_payment_id: string; razorpay_signature: string };
type Instance = { open(): void; close(): void };
type Constructor = new (options: Record<string, unknown>) => Instance;
declare global {
  interface Window {
    Razorpay?: Constructor;
  }
}
let loading: Promise<Constructor> | undefined;
export function loadCheckout(): Promise<Constructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise<Constructor>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => fail(), 15000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      reject(
        new Error(
          "Razorpay Checkout could not load. Check your connection and retry.",
        ),
      );
    }
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => {
      clearTimeout(timer);
      if (window.Razorpay) resolve(window.Razorpay);
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}
export function openCheckout(
  Constructor: Constructor,
  checkout: Checkout,
  onInstance: (instance: Instance) => void,
) {
  return new Promise<Result | null>((resolve) => {
    const instance = new Constructor({
      key: checkout.keyId,
      ...(checkout.subscriptionId
        ? { subscription_id: checkout.subscriptionId }
        : {
            order_id: checkout.orderId,
            amount: checkout.amount,
            currency: checkout.currency,
          }),
      name: "Raahi",
      description: `${checkout.tier} · ${checkout.billingMode === "recurring" ? "Monthly membership" : "30-day pass"}`,
      theme: { color: "#f87570" },
      handler: (result: Result) => resolve(result),
      modal: { ondismiss: () => resolve(null), confirm_close: true },
    });
    onInstance(instance);
    instance.open();
  });
}
