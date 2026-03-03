function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderVipDashboardLoginPage(args: {
  error?: string;
  adminsConfigured: boolean;
}): string {
  const error = args.error ? `<div class="error">${escapeHtml(args.error)}</div>` : "";
  const disabled = args.adminsConfigured ? "" : "disabled";
  const hint = args.adminsConfigured
    ? "Sign in with your dashboard admin credentials."
    : "Dashboard login is disabled. Set VIP_DASHBOARD_ADMINS in environment.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VIP Ops Login</title>
  <style>
    :root {
      --bg: radial-gradient(120% 120% at 10% 0%, #e6f2ff 0%, #f7fafc 48%, #eef3f9 100%);
      --panel: #ffffff;
      --text: #0b1220;
      --muted: #526070;
      --border: #ced8e3;
      --accent: #0a66c2;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--text);
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 22px;
      box-shadow: 0 15px 50px rgba(10, 40, 80, 0.12);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 26px;
      letter-spacing: -0.02em;
    }
    .hint {
      margin: 0 0 16px;
      color: var(--muted);
      font-size: 14px;
    }
    label {
      display: block;
      margin: 0 0 6px;
      font-size: 13px;
      color: var(--muted);
    }
    input {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 12px;
      font-size: 14px;
      font-family: inherit;
    }
    button {
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 11px 14px;
      font-size: 14px;
      font-weight: 700;
      color: white;
      background: var(--accent);
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error {
      margin: 0 0 12px;
      padding: 10px;
      border: 1px solid rgba(180, 35, 24, 0.3);
      border-radius: 10px;
      color: var(--danger);
      background: rgba(180, 35, 24, 0.08);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>VIP Ops Dashboard</h1>
    <p class="hint">${escapeHtml(hint)}</p>
    ${error}
    <form method="post" action="/ops/login">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required ${disabled} />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required ${disabled} />
      <button type="submit" ${disabled}>Sign In</button>
    </form>
  </main>
</body>
</html>`;
}

export function renderVipDashboardPage(args: {
  username: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VIP Ops Dashboard</title>
  <style>
    :root {
      --bg: #f3f7fb;
      --panel: #ffffff;
      --text: #0f1728;
      --muted: #57667c;
      --border: #d2dcea;
      --accent: #0059b8;
      --ok: #067647;
      --danger: #b42318;
      --warning: #c96808;
      --submitted: #1e5fb3;
      --in-review: #875bf7;
      --confirmed: #067647;
      --rejected: #b42318;
      --cancelled: #667085;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(140% 80% at 100% 0%, #dbeaff 0%, rgba(219, 234, 255, 0) 65%),
        radial-gradient(130% 80% at 0% 10%, #edf7ff 0%, rgba(237, 247, 255, 0) 64%),
        var(--bg);
      color: var(--text);
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      min-height: 100vh;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(8px);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .topbar h1 {
      margin: 0;
      font-size: 22px;
      letter-spacing: -0.02em;
    }
    .topbar .meta {
      color: var(--muted);
      font-size: 13px;
      margin-top: 2px;
    }
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: var(--muted);
    }
    .topbar-right form {
      margin: 0;
    }
    button, .button {
      border: 0;
      border-radius: 10px;
      padding: 9px 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      background: var(--accent);
      color: white;
      font-family: inherit;
    }
    button.secondary {
      background: #314257;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .layout {
      padding: 16px;
      display: grid;
      grid-template-columns: minmax(520px, 1fr) minmax(340px, 420px);
      gap: 14px;
      align-items: start;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 10px 40px rgba(24, 41, 72, 0.08);
    }
    .panel-head {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .panel-head h2 {
      margin: 0;
      font-size: 16px;
    }
    .filters {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      display: grid;
      gap: 10px;
    }
    .row {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    label {
      display: block;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 13px;
      font-family: inherit;
      background: white;
      color: var(--text);
    }
    textarea {
      resize: vertical;
      min-height: 74px;
    }
    .statuses {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .view-modes {
      display: inline-flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .view-chip {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      background: #f8fafc;
      color: #324255;
      cursor: pointer;
      font-weight: 600;
    }
    .view-chip[data-active="true"] {
      background: #dbeafe;
      border-color: #7cb0ee;
      color: #003d85;
    }
    .status-chip {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 9px;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #f8fafc;
    }
    .status-chip input {
      width: auto;
      margin: 0;
    }
    .table-wrap {
      overflow: auto;
      max-height: calc(100vh - 300px);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 9px 10px;
      border-bottom: 1px solid #ebf0f6;
      text-align: left;
      vertical-align: top;
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: #f8fbff;
      z-index: 1;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
    }
    tr[data-selected="true"] {
      background: #eef5ff;
    }
    tr:hover {
      background: #f9fbff;
      cursor: pointer;
    }
    .status-pill {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 9px;
      color: white;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-submitted { background: var(--submitted); }
    .status-in_review { background: var(--in-review); }
    .status-confirmed { background: var(--confirmed); }
    .status-rejected { background: var(--rejected); }
    .status-cancelled { background: var(--cancelled); }
    .detail {
      padding: 12px 14px;
      display: grid;
      gap: 11px;
    }
    .grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .muted {
      color: var(--muted);
      font-size: 12px;
    }
    .field-guide {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #f8fbff;
      padding: 10px;
      display: grid;
      gap: 4px;
      font-size: 12px;
      color: #324255;
    }
    .field-guide-title {
      font-weight: 700;
      color: #152238;
      margin-bottom: 2px;
    }
    .field-help {
      margin-top: 5px;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.35;
    }
    .messages {
      padding: 10px 14px;
      font-size: 13px;
      border-top: 1px solid var(--border);
      min-height: 44px;
    }
    .messages.error { color: var(--danger); }
    .messages.success { color: var(--ok); }
    .messages.warning {
      color: var(--warning);
      font-weight: 600;
    }
    .confirm-overlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(15, 23, 40, 0.32);
      z-index: 100;
    }
    .confirm-overlay[data-open="true"] {
      display: flex;
    }
    .confirm-dialog {
      width: 100%;
      max-width: 420px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 24px 80px rgba(15, 23, 40, 0.24);
      padding: 14px;
      display: grid;
      gap: 10px;
    }
    .confirm-dialog[data-tone="success"] {
      border-color: #b7dfc7;
    }
    .confirm-dialog[data-tone="warning"] {
      border-color: #f4c89a;
    }
    .confirm-dialog[data-tone="error"] {
      border-color: #efb1ac;
    }
    .confirm-dialog h3 {
      margin: 0;
      font-size: 18px;
      letter-spacing: -0.01em;
    }
    .confirm-dialog p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.4;
    }
    .confirm-actions {
      display: flex;
      justify-content: flex-end;
    }
    .timeline {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px;
      background: #fbfdff;
      max-height: 185px;
      overflow: auto;
      display: grid;
      gap: 8px;
    }
    .timeline-item {
      border-left: 2px solid #ccd8e7;
      padding-left: 8px;
      font-size: 12px;
    }
    .timeline-item strong { display: inline-block; margin-right: 6px; }
    .meta-line { font-size: 11px; color: var(--muted); margin-top: 2px; }
    @media (max-width: 1180px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .table-wrap {
        max-height: 420px;
      }
    }
    @media (max-width: 760px) {
      .row, .grid2 { grid-template-columns: 1fr; }
      .topbar { padding: 12px; }
      .layout { padding: 12px; }
      th, td { font-size: 12px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div>
      <h1>VIP Ops Dashboard</h1>
      <div class="meta">Manage all VIP booking requests and status workflow.</div>
    </div>
    <div class="topbar-right">
      <span>Signed in as <strong>${escapeHtml(args.username)}</strong></span>
      <form method="post" action="/ops/logout">
        <button class="secondary" type="submit">Sign Out</button>
      </form>
    </div>
  </header>

  <main class="layout">
    <section class="panel">
      <div class="panel-head">
        <h2>Booking Requests</h2>
        <div>
          <button id="refreshBtn" type="button">Refresh</button>
        </div>
      </div>
      <div class="filters">
        <div>
          <label>Reservation View</label>
          <div class="view-modes" id="reservationViewFilters"></div>
        </div>
        <div>
          <label>Statuses</label>
          <div class="statuses" id="statusFilters"></div>
        </div>
        <div class="row">
          <div>
            <label for="bookingDateFrom">Booking Date From (auto)</label>
            <input id="bookingDateFrom" type="date" disabled />
          </div>
          <div>
            <label for="bookingDateTo">Booking Date To (auto)</label>
            <input id="bookingDateTo" type="date" disabled />
          </div>
          <div>
            <label for="searchTerm">Search</label>
            <input id="searchTerm" placeholder="name/email/phone" />
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Booking Date</th>
              <th>Status</th>
              <th>Venue</th>
              <th>Customer</th>
              <th>Party</th>
            </tr>
          </thead>
          <tbody id="bookingRows"></tbody>
        </table>
      </div>
      <div class="messages" id="listMeta">Loading...</div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>Booking Detail</h2>
      </div>
      <div class="detail">
        <div class="muted" id="detailHeader">Select a booking request.</div>
        <div class="field-guide">
          <div class="field-guide-title">Field Guide</div>
          <div><strong>Status Message:</strong> Customer-facing status text.</div>
          <div><strong>Internal Note:</strong> Private ops note (not shown to customer).</div>
          <div><strong>Special Requests:</strong> Guest preference details for venue handling.</div>
          <div><strong>Edit Note:</strong> Optional reason for this specific update (audit trail).</div>
        </div>

        <div class="grid2">
          <div>
            <label for="fieldStatus">Status</label>
            <select id="fieldStatus">
              <option value="submitted">submitted</option>
              <option value="in_review">in_review</option>
              <option value="confirmed">confirmed</option>
              <option value="rejected">rejected</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>
          <div>
            <label for="fieldPartySize">Party Size</label>
            <input id="fieldPartySize" type="number" min="1" max="30" />
          </div>
        </div>

        <div class="grid2">
          <div>
            <label for="fieldBookingDate">Booking Date</label>
            <input id="fieldBookingDate" type="date" />
          </div>
          <div>
            <label for="fieldArrivalTime">Arrival Time</label>
            <input id="fieldArrivalTime" type="time" />
          </div>
        </div>

        <div>
          <label for="fieldStatusMessage">Status Message</label>
          <input id="fieldStatusMessage" />
          <div class="field-help">Shown to the guest when they check booking status.</div>
        </div>

        <div>
          <label for="fieldInternalNote">Internal Note</label>
          <textarea id="fieldInternalNote"></textarea>
          <div class="field-help">Ops-only note for handoff/context; never exposed in guest status lookup.</div>
        </div>

        <div>
          <label for="fieldSpecialRequests">Special Requests</label>
          <textarea id="fieldSpecialRequests"></textarea>
          <div class="field-help">Guest request details (birthday, table preference, location requests, etc.).</div>
        </div>

        <div>
          <label for="fieldEditNote">Edit Note (optional)</label>
          <input id="fieldEditNote" placeholder="Reason for this update" />
          <div class="field-help">Saved in audit history when at least one booking field changes, and used as status-event note when status changes.</div>
        </div>

        <div style="display:flex; gap:8px;">
          <button id="saveBtn" type="button">Save Changes</button>
          <button id="reloadDetailBtn" type="button" class="secondary">Reload Detail</button>
        </div>

        <div>
          <label>Status History</label>
          <div class="timeline" id="historyTimeline"></div>
        </div>

        <div>
          <label>Edit Audits</label>
          <div class="timeline" id="auditTimeline"></div>
        </div>
      </div>
      <div class="messages" id="detailMessage"></div>
    </section>
  </main>

  <div class="confirm-overlay" id="saveConfirmOverlay" hidden>
    <div class="confirm-dialog" id="saveConfirmDialog" data-tone="success" role="dialog" aria-modal="true" aria-labelledby="saveConfirmTitle" aria-describedby="saveConfirmText">
      <h3 id="saveConfirmTitle">Notice</h3>
      <p id="saveConfirmText">Booking changes were saved successfully.</p>
      <div class="confirm-actions">
        <button type="button" id="saveConfirmOkBtn">OK</button>
      </div>
    </div>
  </div>

  <script>
    const ALL_STATUSES = ["submitted", "in_review", "confirmed", "rejected", "cancelled"];
    const RESERVATION_VIEW_MODES = [
      { value: "upcoming", label: "Upcoming" },
      { value: "all", label: "All" },
      { value: "past", label: "Past" },
    ];
    const state = {
      reservationView: "upcoming",
      statuses: new Set(ALL_STATUSES),
      bookingDateFrom: "",
      bookingDateTo: "",
      search: "",
      limit: 50,
      offset: 0,
      selectedId: null,
      selectedDetail: null,
      loadingList: false,
      loadingDetail: false,
    };

    const $ = (id) => document.getElementById(id);

    function escapeHtml(input) {
      return String(input ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function statusBadge(status) {
      return '<span class="status-pill status-' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';
    }

    function fmtTime(raw) {
      const value = String(raw || "");
      return value.length >= 5 ? value.slice(0, 5) : value;
    }

    function fmtBookingDate(raw) {
      const value = String(raw || "").trim();
      if (!value) return "";

      const match = value.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
      if (!match) return value;

      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      const date = new Date(year, month, day);
      if (Number.isNaN(date.getTime())) return value;

      const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return value + " (" + weekdays[date.getDay()] + ")";
    }

    function fmtDateTime(raw) {
      if (!raw) return "-";
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return String(raw);
      return d.toLocaleString();
    }

    function fmtDateInputValue(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + d;
    }

    function getTodayDate() {
      return fmtDateInputValue(new Date());
    }

    function getYesterdayDate() {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return fmtDateInputValue(d);
    }

    function applyReservationViewDateRange() {
      if (state.reservationView === "upcoming") {
        state.bookingDateFrom = getTodayDate();
        state.bookingDateTo = "";
      } else if (state.reservationView === "past") {
        state.bookingDateFrom = "";
        state.bookingDateTo = getYesterdayDate();
      } else {
        state.bookingDateFrom = "";
        state.bookingDateTo = "";
      }
      $("bookingDateFrom").value = state.bookingDateFrom;
      $("bookingDateTo").value = state.bookingDateTo;
    }

    function readFiltersFromDom() {
      state.search = $("searchTerm").value.trim();
    }

    function setListMessage(message, cls) {
      const el = $("listMeta");
      el.className = "messages" + (cls ? " " + cls : "");
      el.textContent = message;
    }

    function setDetailMessage(message, cls) {
      const el = $("detailMessage");
      el.className = "messages" + (cls ? " " + cls : "");
      el.textContent = message;
    }

    function openSaveConfirmDialog(args) {
      const overlay = $("saveConfirmOverlay");
      const dialog = $("saveConfirmDialog");
      const title = $("saveConfirmTitle");
      const text = $("saveConfirmText");
      if (!overlay || !dialog || !title || !text) return;

      const tone = args && args.tone ? String(args.tone) : "success";
      const heading = args && args.title ? String(args.title) : "Notice";
      const message = args && args.message ? String(args.message) : "Booking changes were saved successfully.";

      dialog.dataset.tone = tone;
      title.textContent = heading;
      text.textContent = message;
      overlay.dataset.open = "true";
      overlay.removeAttribute("hidden");
    }

    function closeSaveConfirmDialog() {
      const overlay = $("saveConfirmOverlay");
      if (!overlay) return;
      overlay.dataset.open = "false";
      overlay.setAttribute("hidden", "hidden");
    }

    async function requestJson(url, options) {
      const res = await fetch(url, options);
      const text = await res.text();
      let payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (_error) {
          payload = {};
        }
      }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          window.location.href = "/ops/login";
          throw new Error("Dashboard session expired. Please sign in again.");
        }
        const errMsg = payload && payload.error && payload.error.message
          ? payload.error.message
          : ("Request failed (" + String(res.status) + ").");
        throw new Error(errMsg);
      }
      return payload;
    }

    function renderStatusFilters() {
      const container = $("statusFilters");
      container.innerHTML = "";
      ALL_STATUSES.forEach((status) => {
        const checked = state.statuses.has(status) ? "checked" : "";
        container.insertAdjacentHTML(
          "beforeend",
          '<label class="status-chip">' +
            '<input type="checkbox" data-status-filter="' + escapeHtml(status) + '" ' + checked + ' />' +
            escapeHtml(status) +
          '</label>'
        );
      });

      container.querySelectorAll("input[data-status-filter]").forEach((input) => {
        input.addEventListener("change", () => {
          const status = input.getAttribute("data-status-filter");
          if (!status) return;
          if (input.checked) {
            state.statuses.add(status);
          } else {
            state.statuses.delete(status);
          }
          if (state.statuses.size === 0) {
            state.statuses = new Set(ALL_STATUSES);
            renderStatusFilters();
          }
          loadBookings(true);
        });
      });
    }

    function renderReservationViewFilters() {
      const container = $("reservationViewFilters");
      container.innerHTML = "";
      RESERVATION_VIEW_MODES.forEach((mode) => {
        const active = mode.value === state.reservationView ? "true" : "false";
        container.insertAdjacentHTML(
          "beforeend",
          '<button type="button" class="view-chip" data-view-mode="' + escapeHtml(mode.value) + '" data-active="' + active + '">' +
            escapeHtml(mode.label) +
          "</button>",
        );
      });

      container.querySelectorAll("button[data-view-mode]").forEach((button) => {
        button.addEventListener("click", () => {
          const nextMode = button.getAttribute("data-view-mode");
          if (!nextMode || nextMode === state.reservationView) return;
          state.reservationView = nextMode;
          applyReservationViewDateRange();
          renderReservationViewFilters();
          loadBookings(true);
        });
      });
    }

    function buildListQuery() {
      const params = new URLSearchParams();
      params.set("statuses", Array.from(state.statuses).join(","));
      params.set("limit", String(state.limit));
      params.set("offset", String(state.offset));
      if (state.bookingDateFrom) params.set("booking_date_from", state.bookingDateFrom);
      if (state.bookingDateTo) params.set("booking_date_to", state.bookingDateTo);
      if (state.search) params.set("search", state.search);
      return params.toString();
    }

    function renderRows(rows) {
      const tbody = $("bookingRows");
      tbody.innerHTML = "";

      if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">No bookings found for current filters.</td></tr>';
        return;
      }

      rows.forEach((row) => {
        const selected = row.booking_request_id === state.selectedId;
        const tr = document.createElement("tr");
        tr.dataset.bookingId = row.booking_request_id;
        tr.dataset.selected = selected ? "true" : "false";
        tr.innerHTML =
          '<td>' + escapeHtml(fmtDateTime(row.created_at)) + '</td>' +
          '<td>' + escapeHtml(fmtBookingDate(row.booking_date || "")) + '<br /><span class="muted">' + escapeHtml(fmtTime(row.arrival_time)) + '</span></td>' +
          '<td>' + statusBadge(row.status) + '</td>' +
          '<td>' + escapeHtml(row.venue_name || row.venue_id || "-") + '</td>' +
          '<td>' + escapeHtml(row.customer_name || "-") + '<br /><span class="muted">' + escapeHtml(row.customer_email || "") + '</span></td>' +
          '<td>' + escapeHtml(String(row.party_size || "-")) + '</td>';

        tr.addEventListener("click", () => {
          state.selectedId = row.booking_request_id;
          renderRows(rows);
          loadDetail(state.selectedId);
        });

        tbody.appendChild(tr);
      });
    }

    function setField(id, value) {
      const el = $(id);
      if (!el) return;
      el.value = value ?? "";
    }

    function normalizeTimeInput(value) {
      const v = String(value || "");
      if (!v) return "";
      return v.length >= 5 ? v.slice(0, 5) : v;
    }

    function renderDetail(payload) {
      const booking = payload && payload.booking ? payload.booking : null;
      state.selectedDetail = payload || null;
      if (!booking) {
        $("detailHeader").textContent = "Select a booking request.";
        $("historyTimeline").innerHTML = "";
        $("auditTimeline").innerHTML = "";
        return;
      }

      $("detailHeader").textContent =
        booking.booking_request_id + " | " + (booking.venue_name || booking.venue_id || "Unknown venue");

      setField("fieldStatus", booking.status);
      setField("fieldPartySize", booking.party_size);
      setField("fieldBookingDate", booking.booking_date);
      setField("fieldArrivalTime", normalizeTimeInput(booking.arrival_time));
      setField("fieldStatusMessage", booking.status_message || "");
      setField("fieldInternalNote", booking.agent_internal_note || "");
      setField("fieldSpecialRequests", booking.special_requests || "");
      setField("fieldEditNote", "");

      const history = Array.isArray(payload.history) ? payload.history : [];
      const historyHtml = history.length
        ? history.map((item) =>
            '<div class="timeline-item">' +
              '<strong>' + escapeHtml(item.status) + '</strong>' +
              '<span>' + escapeHtml(item.note || "No note") + '</span>' +
              '<div class="meta-line">' + escapeHtml(fmtDateTime(item.at)) + '</div>' +
            '</div>'
          ).join("")
        : '<div class="muted">No history available.</div>';
      $("historyTimeline").innerHTML = historyHtml;

      const audits = Array.isArray(payload.audits) ? payload.audits : [];
      const auditHtml = audits.length
        ? audits.map((item) =>
            '<div class="timeline-item">' +
              '<strong>' + escapeHtml(item.editor_username) + '</strong>' +
              '<span>' + escapeHtml((item.changed_fields || []).join(", ") || "-") + '</span>' +
              '<div class="meta-line">' + escapeHtml(fmtDateTime(item.created_at)) + '</div>' +
              '<div class="meta-line">' + escapeHtml(item.change_note || "No edit note") + '</div>' +
            '</div>'
          ).join("")
        : '<div class="muted">No edit audits yet.</div>';
      $("auditTimeline").innerHTML = auditHtml;
    }

    async function loadBookings(resetOffset) {
      if (state.loadingList) return;
      state.loadingList = true;
      if (resetOffset) state.offset = 0;
      readFiltersFromDom();

      try {
        const query = buildListQuery();
        const payload = await requestJson("/api/v1/admin/vip-bookings?" + query);
        renderRows(payload.bookings || []);
        setListMessage(
          'Showing ' + (payload.count || 0) + ' of ' + (payload.total_count || 0) + ' bookings. Last update: ' + fmtDateTime(payload.now),
          ""
        );

        if (state.selectedId) {
          const hasCurrent = Array.isArray(payload.bookings) && payload.bookings.some((row) => row.booking_request_id === state.selectedId);
          if (!hasCurrent) {
            state.selectedId = null;
            state.selectedDetail = null;
            renderDetail(null);
          }
        }
      } catch (error) {
        setListMessage(String(error.message || error), "error");
      } finally {
        state.loadingList = false;
      }
    }

    async function loadDetail(bookingId, options) {
      const silent = !!(options && options.silent);
      if (!bookingId || state.loadingDetail) return;
      state.loadingDetail = true;
      if (!silent) {
        setDetailMessage("Loading detail...", "");
      }

      try {
        const payload = await requestJson("/api/v1/admin/vip-bookings/" + encodeURIComponent(bookingId));
        renderDetail(payload);
        if (!silent) {
          setDetailMessage("Detail loaded.", "");
        }
      } catch (error) {
        setDetailMessage(String(error.message || error), "error");
      } finally {
        state.loadingDetail = false;
      }
    }

    function buildPatchPayload() {
      const detail = state.selectedDetail;
      const booking = detail && detail.booking ? detail.booking : null;
      if (!booking) {
        return null;
      }

      const patch = {};
      const newStatus = $("fieldStatus").value;
      const newPartySize = Number($("fieldPartySize").value || 0);
      const newBookingDate = $("fieldBookingDate").value;
      const newArrivalTime = $("fieldArrivalTime").value;
      const newStatusMessage = $("fieldStatusMessage").value;
      const newInternalNote = $("fieldInternalNote").value;
      const newSpecialRequests = $("fieldSpecialRequests").value;
      const newEditNote = $("fieldEditNote").value;

      if (newStatus !== (booking.status || "")) patch.status = newStatus;
      if (Number(booking.party_size || 0) !== newPartySize) patch.party_size = newPartySize;
      if (newBookingDate !== (booking.booking_date || "")) patch.booking_date = newBookingDate;
      if (normalizeTimeInput(newArrivalTime) !== normalizeTimeInput(booking.arrival_time || "")) {
        patch.arrival_time = normalizeTimeInput(newArrivalTime);
      }
      if (newStatusMessage !== (booking.status_message || "")) patch.status_message = newStatusMessage;
      if (newInternalNote !== (booking.agent_internal_note || "")) {
        patch.agent_internal_note = newInternalNote || null;
      }
      if (newSpecialRequests !== (booking.special_requests || "")) {
        patch.special_requests = newSpecialRequests || null;
      }

      const changedKeys = Object.keys(patch);
      if (changedKeys.length === 0) {
        return null;
      }

      return {
        patch,
        note: newEditNote ? newEditNote : undefined,
      };
    }

    async function saveDetail() {
      if (!state.selectedId) {
        setDetailMessage("Select a booking before saving.", "error");
        return;
      }

      const payload = buildPatchPayload();
      if (!payload) {
        setDetailMessage(
          "No editable field changed. Update at least one field to save. Edit Note only saves together with another field change.",
          "warning",
        );
        openSaveConfirmDialog({
          title: "No Changes Saved",
          message: "Update at least one booking field, then save again. Edit Note alone is not saved.",
          tone: "warning",
        });
        return;
      }

      const btn = $("saveBtn");
      btn.disabled = true;
      setDetailMessage("Saving changes...", "");

      try {
        await requestJson("/api/v1/admin/vip-bookings/" + encodeURIComponent(state.selectedId), {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        await loadDetail(state.selectedId, { silent: true });
        await loadBookings(false);
        setDetailMessage("Booking updated.", "success");
        openSaveConfirmDialog({
          title: "Changes Saved",
          message: "Booking changes saved successfully.",
          tone: "success",
        });
      } catch (error) {
        setDetailMessage(String(error.message || error), "error");
      } finally {
        btn.disabled = false;
      }
    }

    function bindEvents() {
      $("refreshBtn").addEventListener("click", () => loadBookings(false));
      $("reloadDetailBtn").addEventListener("click", () => loadDetail(state.selectedId));
      $("saveBtn").addEventListener("click", saveDetail);
      $("saveConfirmOkBtn").addEventListener("click", closeSaveConfirmDialog);
      $("saveConfirmOverlay").addEventListener("click", (event) => {
        if (event.target === $("saveConfirmOverlay")) {
          closeSaveConfirmDialog();
        }
      });

      $("searchTerm").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          loadBookings(true);
        }
      });
      $("searchTerm").addEventListener("blur", () => loadBookings(true));
    }

    async function init() {
      applyReservationViewDateRange();
      renderReservationViewFilters();
      renderStatusFilters();
      bindEvents();
      await loadBookings(true);
      setInterval(() => {
        loadBookings(false);
      }, 30000);
    }

    init();
  </script>
</body>
</html>`;
}
