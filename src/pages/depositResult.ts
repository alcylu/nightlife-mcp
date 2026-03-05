export function renderDepositSuccessPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Deposit Received</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #e6edf3; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { text-align: center; max-width: 420px; padding: 40px 32px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; margin: 0 0 12px; }
    p { color: #9da7b3; font-size: 15px; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Deposit Received</h1>
    <p>Your VIP table deposit has been processed. You can close this tab and return to your chat — your reservation is confirmed.</p>
  </div>
</body>
</html>`;
}

export function renderDepositCancelledPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment Not Completed</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #e6edf3; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { text-align: center; max-width: 420px; padding: 40px 32px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; margin: 0 0 12px; }
    p { color: #9da7b3; font-size: 15px; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#8617;</div>
    <h1>Payment Not Completed</h1>
    <p>Your deposit payment was not completed. Return to your chat to request a new payment link if needed.</p>
  </div>
</body>
</html>`;
}
