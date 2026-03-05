import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function getStripe(secretKey: string): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(secretKey);
  }
  return stripeInstance;
}

export interface CreateCheckoutSessionInput {
  amountJpy: number;
  customerEmail: string;
  bookingRequestId: string;
  venueName: string;
  bookingDate: string;
  expiryMinutes: number;
  successUrl: string;
  cancelUrl: string;
}

export async function createDepositCheckoutSession(
  stripe: Stripe,
  input: CreateCheckoutSessionInput,
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: input.customerEmail,
    line_items: [
      {
        price_data: {
          currency: "jpy",
          unit_amount: input.amountJpy,
          product_data: {
            name: `VIP Table Deposit — ${input.venueName}`,
            description: `Booking date: ${input.bookingDate}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      booking_request_id: input.bookingRequestId,
    },
    expires_at: Math.floor(Date.now() / 1000) + input.expiryMinutes * 60,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
}

export async function createDepositRefund(
  stripe: Stripe,
  paymentIntentId: string,
  amountJpy: number,
): Promise<Stripe.Refund> {
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: amountJpy,
  });
}

export function constructWebhookEvent(
  stripe: Stripe,
  rawBody: Buffer,
  signature: string,
  secret: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
