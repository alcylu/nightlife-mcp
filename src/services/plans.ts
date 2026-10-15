export const paidPlans = {
  starter: { name: "Starter", amount: 500, currency: "usd", monthly_quota: 500, per_minute_quota: 10 },
  pro: { name: "Pro", amount: 1900, currency: "usd", monthly_quota: 5000, per_minute_quota: 30 },
} as const;
export type PaidPlan = keyof typeof paidPlans;
export function parsePaidPlan(value: unknown): PaidPlan {
  if (value !== "starter" && value !== "pro") throw new Error("Select Starter or Pro.");
  return value;
}
