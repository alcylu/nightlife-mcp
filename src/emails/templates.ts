export type BookingEmailData = {
  bookingRequestId: string;
  customerName: string;
  customerEmail: string;
  venueName: string;
  bookingDate: string;
  arrivalTime: string;
  partySize: number;
  statusMessage?: string;
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatJpy(amount: number): string {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(amount);
}

function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px auto"><tr><td style="border-radius:8px;background:#2563eb"><a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a></td></tr></table>`;
}

function detailsTable(data: BookingEmailData): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:16px 0">
    <tr><td style="padding:8px 0;color:#9da7b3;font-size:13px">Venue</td><td style="padding:8px 0;color:#e6edf3;font-size:14px;text-align:right">${escapeHtml(data.venueName)}</td></tr>
    <tr><td style="padding:8px 0;color:#9da7b3;font-size:13px;border-top:1px solid #30363d">Date</td><td style="padding:8px 0;color:#e6edf3;font-size:14px;text-align:right;border-top:1px solid #30363d">${escapeHtml(data.bookingDate)}</td></tr>
    <tr><td style="padding:8px 0;color:#9da7b3;font-size:13px;border-top:1px solid #30363d">Arrival Time</td><td style="padding:8px 0;color:#e6edf3;font-size:14px;text-align:right;border-top:1px solid #30363d">${escapeHtml(data.arrivalTime)}</td></tr>
    <tr><td style="padding:8px 0;color:#9da7b3;font-size:13px;border-top:1px solid #30363d">Party Size</td><td style="padding:8px 0;color:#e6edf3;font-size:14px;text-align:right;border-top:1px solid #30363d">${data.partySize}</td></tr>
    <tr><td style="padding:8px 0;color:#9da7b3;font-size:13px;border-top:1px solid #30363d">Booking ID</td><td style="padding:8px 0;color:#9da7b3;font-size:12px;text-align:right;border-top:1px solid #30363d;font-family:monospace">${escapeHtml(data.bookingRequestId)}</td></tr>
  </table>`;
}

export function emailLayout(content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#0d1117">
    <tr>
      <td style="padding:32px 16px">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:12px">
          <tr>
            <td style="padding:32px 28px">
              <div style="font-size:12px;color:#9da7b3;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:24px">Nightlife Tokyo VIP</div>
              ${content}
              <div style="margin-top:32px;padding-top:16px;border-top:1px solid #30363d;font-size:12px;color:#6e7681;text-align:center">
                Nightlife Tokyo &middot; nightlifetokyo.com
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function bookingSubmittedContent(data: BookingEmailData & { dashboardUrl?: string }): string {
  const dashboardLink = data.dashboardUrl ? ctaButton(data.dashboardUrl, "View in Dashboard") : "";
  return `<h1 style="margin:0 0 8px;font-size:22px;color:#e6edf3">VIP Request Received</h1>
<p style="margin:0 0 20px;color:#9da7b3;font-size:14px;line-height:1.5">Hi ${escapeHtml(data.customerName)}, your VIP table request has been submitted. Our team will review it and get back to you shortly.</p>
${detailsTable(data)}
${dashboardLink}`;
}

export function depositRequiredContent(data: BookingEmailData & { depositAmountJpy: number; checkoutUrl: string; expiresAt: string }): string {
  return `<h1 style="margin:0 0 8px;font-size:22px;color:#e6edf3">Table Available &mdash; Deposit Required</h1>
<p style="margin:0 0 20px;color:#9da7b3;font-size:14px;line-height:1.5">Great news, ${escapeHtml(data.customerName)}! Your requested table at ${escapeHtml(data.venueName)} is available. A deposit of <strong style="color:#e6edf3">${formatJpy(data.depositAmountJpy)}</strong> is required to confirm your reservation.</p>
${ctaButton(data.checkoutUrl, "Pay Deposit Now")}
<p style="margin:0 0 20px;color:#6e7681;font-size:12px;text-align:center">This payment link expires at ${escapeHtml(data.expiresAt)}</p>
${detailsTable(data)}`;
}

export function bookingConfirmedContent(data: BookingEmailData & { depositPaid?: boolean }): string {
  const depositLine = data.depositPaid
    ? `<p style="margin:0 0 16px;color:#3fb950;font-size:14px">&#10003; Deposit received</p>`
    : "";
  return `<h1 style="margin:0 0 8px;font-size:22px;color:#e6edf3">VIP Table Confirmed</h1>
${depositLine}
<p style="margin:0 0 20px;color:#9da7b3;font-size:14px;line-height:1.5">${escapeHtml(data.customerName)}, your VIP table at ${escapeHtml(data.venueName)} is confirmed. See you there!</p>
${detailsTable(data)}`;
}

export function bookingRejectedContent(data: BookingEmailData & { reason?: string }): string {
  const reasonLine = data.reason
    ? `<p style="margin:0 0 16px;color:#9da7b3;font-size:14px;line-height:1.5">${escapeHtml(data.reason)}</p>`
    : "";
  return `<h1 style="margin:0 0 8px;font-size:22px;color:#e6edf3">VIP Booking Update</h1>
<p style="margin:0 0 16px;color:#9da7b3;font-size:14px;line-height:1.5">Hi ${escapeHtml(data.customerName)}, unfortunately we were unable to accommodate your VIP table request at ${escapeHtml(data.venueName)}.</p>
${reasonLine}
${detailsTable(data)}`;
}

export function bookingCancelledContent(data: BookingEmailData & { depositOutcome?: string }): string {
  const depositLine = data.depositOutcome
    ? `<p style="margin:0 0 16px;color:#9da7b3;font-size:13px">Deposit status: ${escapeHtml(data.depositOutcome)}</p>`
    : "";
  return `<h1 style="margin:0 0 8px;font-size:22px;color:#e6edf3">VIP Booking Cancelled</h1>
<p style="margin:0 0 16px;color:#9da7b3;font-size:14px;line-height:1.5">${escapeHtml(data.customerName)}, your VIP booking at ${escapeHtml(data.venueName)} has been cancelled.</p>
${depositLine}
${detailsTable(data)}`;
}

export function depositExpiredContent(data: BookingEmailData): string {
  return `<h1 style="margin:0 0 8px;font-size:22px;color:#e6edf3">Payment Link Expired</h1>
<p style="margin:0 0 20px;color:#9da7b3;font-size:14px;line-height:1.5">Hi ${escapeHtml(data.customerName)}, the payment link for your VIP deposit at ${escapeHtml(data.venueName)} has expired. Please contact the concierge to request a new link.</p>
${detailsTable(data)}`;
}

export function depositRefundedContent(data: BookingEmailData & { refundAmountJpy: number; isPartial: boolean }): string {
  const refundType = data.isPartial ? "Partial Refund" : "Full Refund";
  return `<h1 style="margin:0 0 8px;font-size:22px;color:#e6edf3">Deposit ${refundType} Processed</h1>
<p style="margin:0 0 20px;color:#9da7b3;font-size:14px;line-height:1.5">${escapeHtml(data.customerName)}, a ${data.isPartial ? "partial" : "full"} refund of <strong style="color:#e6edf3">${formatJpy(data.refundAmountJpy)}</strong> has been processed for your VIP booking at ${escapeHtml(data.venueName)}. Please allow a few business days for the refund to appear on your statement.</p>
${detailsTable(data)}`;
}

export function depositLinkRegeneratedContent(data: BookingEmailData & { checkoutUrl: string; expiresAt: string }): string {
  return `<h1 style="margin:0 0 8px;font-size:22px;color:#e6edf3">New Payment Link</h1>
<p style="margin:0 0 20px;color:#9da7b3;font-size:14px;line-height:1.5">Hi ${escapeHtml(data.customerName)}, here is your new deposit payment link for ${escapeHtml(data.venueName)}.</p>
${ctaButton(data.checkoutUrl, "Pay Deposit Now")}
<p style="margin:0 0 20px;color:#6e7681;font-size:12px;text-align:center">This payment link expires at ${escapeHtml(data.expiresAt)}</p>
${detailsTable(data)}`;
}
