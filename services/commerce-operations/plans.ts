export const tierIds = ["gold", "diamond", "platinum"] as const;
export type Tier = (typeof tierIds)[number];
const defaults = { gold: 499, diamond: 999, platinum: 1499 };
export const discoveryModes: Record<Tier, string[]> = {
  gold: ["interests"],
  diamond: ["interests", "intent"],
  platinum: ["interests", "intent", "city"],
};
export function features(tier: Tier | null) {
  const allowances = {
    free: [0, 3],
    gold: [5, 10],
    diamond: [15, 25],
    platinum: [30, 50],
  };
  const [superLikesPerDay, directIntroductionsPerDay] =
    allowances[tier || "free"];
  return {
    superLikesPerDay,
    directIntroductionsPerDay,
    hideAge: true,
    hideLocation: true,
  };
}
export function plans() {
  return tierIds.map((id) => {
    const price = Number(
      process.env[`PREMIUM_${id.toUpperCase()}_INR`] || defaults[id],
    );
    if (!Number.isSafeInteger(price) || price < 1 || price > 15000)
      throw Error("Invalid membership price configuration");
    return {
      id,
      name: id[0].toUpperCase() + id.slice(1),
      priceInr: price,
      amount: price * 100,
      currency: "INR" as const,
      discoveryModes: discoveryModes[id],
      features: features(id),
      providerPlanId:
        process.env[`RAZORPAY_${id.toUpperCase()}_PLAN_ID`] ||
        (id === "gold" ? process.env.RAZORPAY_PLAN_ID : "") ||
        "",
    };
  });
}
export function credentialsReady() {
  return (
    !!(
      process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET &&
      process.env.RAZORPAY_WEBHOOK_SECRET
    ) &&
    (process.env.APP_ENV !== "local" ||
      process.env.RAZORPAY_KEY_ID.startsWith("rzp_test_"))
  );
}
