"use strict";

const STORAGE_KEY = "ecocampus-demo-v1";
const LOW_STOCK_THRESHOLD = 10;
let storageLoadWarning = false;

const initialData = {
  students: [
    { id: 1, name: "Aarav Sharma", email: "aarav.sharma@ecocampus.edu", balance: 1500 },
    { id: 2, name: "Mira Patel", email: "mira.patel@ecocampus.edu", balance: 800 },
    { id: 3, name: "Ishaan Rao", email: "ishaan.rao@ecocampus.edu", balance: 1200 }
  ],
  products: [
    { id: 1, name: "Filtered Water Refill", category: "REFILL", price: 20, stock: 120, refillable: true, emoji: "💧" },
    { id: 2, name: "Reusable Steel Bottle", category: "DRINKWARE", price: 250, stock: 35, refillable: false, emoji: "🥤" },
    { id: 3, name: "Bamboo Toothbrush", category: "PERSONAL CARE", price: 80, stock: 45, refillable: false, emoji: "🪥" },
    { id: 4, name: "Recycled Notebook", category: "STATIONERY", price: 60, stock: 8, refillable: false, emoji: "📓" },
    { id: 5, name: "Laundry Liquid Refill", category: "REFILL", price: 90, stock: 6, refillable: true, emoji: "🫧" }
  ],
  activity: [
    { studentId: 1, kind: "purchase", title: "Water refill", detail: "Reusable bottle · Today", amount: -18.4, at: Date.now() - 3600000, refill: true, containers: 2, discount: 1.6 },
    { studentId: 1, kind: "transfer-in", title: "Wallet top-up", detail: "From Mira Patel · Yesterday", amount: 200, at: Date.now() - 86400000, refill: false, containers: 0, discount: 0 },
    { studentId: 2, kind: "purchase", title: "Bamboo toothbrush", detail: "Campus essentials · Yesterday", amount: -80, at: Date.now() - 86400000, refill: false, containers: 0, discount: 0 },
    { studentId: 3, kind: "purchase", title: "Laundry liquid refill", detail: "Refill station · 2 days ago", amount: -88.2, at: Date.now() - 172800000, refill: true, containers: 1, discount: 1.8 },
    { studentId: 1, kind: "purchase", title: "Recycled notebook", detail: "Campus essentials · 4 days ago", amount: -60, at: Date.now() - 345600000, refill: false, containers: 0, discount: 0 }
  ]
};

let data = loadData();
let activeStudentId = 1;
let toastTimer;
let oracleMode = false;
let oracleUnavailable = false;
let dashboardStats = null;

function cloneInitialData() {
  return JSON.parse(JSON.stringify(initialData));
}

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return cloneInitialData();

    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.students) || !Array.isArray(parsed.products) || !Array.isArray(parsed.activity)) {
      throw new Error("Saved demo data has an invalid structure.");
    }
    return parsed;
  } catch (error) {
    console.error("Unable to load EcoCampus demo data.", error);
    storageLoadWarning = true;
    return cloneInitialData();
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("Unable to save EcoCampus demo data.", error);
    return false;
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers
    }
  });
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error("The EcoCampus API returned an invalid response.");
  }
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return body;
}

async function loadOracleDashboard() {
  const dashboard = await apiRequest(`/api/dashboard?studentId=${encodeURIComponent(activeStudentId)}`);
  data = {
    students: dashboard.students,
    products: dashboard.products,
    activity: dashboard.activity
  };
  dashboardStats = dashboard.stats;
  oracleUnavailable = false;
  document.getElementById("connection-alert").hidden = true;
  document.querySelectorAll("#transfer-form input, #transfer-form select, #transfer-form button, #reusable-container")
    .forEach((control) => { control.disabled = false; });
  render();
}

function setModeBadge(mode, label) {
  const badge = document.getElementById("mode-badge");
  badge.classList.toggle("oracle-mode", mode === "oracle");
  badge.classList.toggle("offline-mode", mode === "offline");
  badge.lastChild.textContent = ` ${label}`;
}

function showOracleUnavailable(message) {
  oracleUnavailable = true;
  data = { students: [], products: [], activity: [] };
  dashboardStats = { refillCount: 0, containersAvoided: 0, discountSavings: 0 };
  setModeBadge("offline", "ORACLE OFFLINE");
  const alert = document.getElementById("connection-alert");
  alert.textContent = `Oracle mode is enabled, but the database is unavailable. ${message}`;
  alert.hidden = false;
  document.getElementById("reset-demo").hidden = true;
  document.getElementById("open-add-account").disabled = true;
  document.querySelectorAll("#transfer-form input, #transfer-form select, #transfer-form button, #reusable-container")
    .forEach((control) => { control.disabled = true; });
  render();
}

async function initializeDashboard() {
  let healthResponse;
  try {
    healthResponse = await fetch("/api/health", { headers: { Accept: "application/json" } });
  } catch (error) {
    console.warn("EcoCampus API is not available; opening the browser demo.", error);
    setModeBadge("demo", "DEMO MODE");
    render();
    if (storageLoadWarning) showToast("Saved demo data could not be read. Showing fresh sample data.", true);
    return;
  }

  if (healthResponse.status === 404 || !healthResponse.headers.get("content-type")?.includes("application/json")) {
    setModeBadge("demo", "DEMO MODE");
    render();
    if (storageLoadWarning) showToast("Saved demo data could not be read. Showing fresh sample data.", true);
    return;
  }

  oracleMode = true;
  document.getElementById("reset-demo").hidden = true;
  let health;
  try {
    health = await healthResponse.json();
  } catch (error) {
    showOracleUnavailable("The server health response could not be read.");
    return;
  }
  if (!healthResponse.ok || !health.database) {
    showOracleUnavailable(health.error || "Check the Oracle connection settings.");
    return;
  }

  setModeBadge("oracle", "ORACLE LIVE");
  try {
    await loadOracleDashboard();
  } catch (error) {
    showOracleUnavailable(error.message);
  }
}

function currentStudent() {
  return data.students.find((student) => student.id === activeStudentId);
}

function formatMoney(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  }).format(amount);
}

function hasAtMostTwoDecimalPlaces(amount) {
  return Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function renderStudents() {
  const studentSelect = document.getElementById("student-select");
  const recipientSelect = document.getElementById("transfer-recipient");
  studentSelect.replaceChildren();
  recipientSelect.replaceChildren();

  data.students.forEach((student) => {
    const option = document.createElement("option");
    option.value = String(student.id);
    option.textContent = student.name;
    option.selected = student.id === activeStudentId;
    studentSelect.append(option);

    if (student.id !== activeStudentId) {
      const recipient = document.createElement("option");
      recipient.value = String(student.id);
      recipient.textContent = student.name;
      recipientSelect.append(recipient);
    }
  });

  if (recipientSelect.options.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No other wallets available";
    recipientSelect.append(option);
    recipientSelect.disabled = true;
  } else {
    recipientSelect.disabled = false;
  }

  const student = currentStudent();
  document.getElementById("open-add-account").disabled = oracleUnavailable;
  if (!student) {
    document.getElementById("welcome-name").textContent = "";
    document.getElementById("profile-name").textContent = "";
    document.getElementById("profile-avatar").textContent = "";
    return;
  }
  const firstName = student.name.split(" ")[0];
  document.getElementById("welcome-name").textContent = firstName;
  document.getElementById("profile-name").textContent = student.name;
  document.getElementById("profile-avatar").textContent = student.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function calculateDiscount(subtotal, reusableContainer) {
  let percent = 0;
  if (subtotal >= 1000) percent = 10;
  else if (subtotal >= 500) percent = 5;
  if (reusableContainer) percent += 2;
  return Math.min(percent, 12);
}

async function addAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const name = document.getElementById("account-name").value.trim();
  const email = document.getElementById("account-email").value.trim().toLowerCase();
  const department = document.getElementById("account-department").value.trim();
  const balance = Number(document.getElementById("account-balance").value);

  if (!name || !email || !department) {
    showToast("Enter a name, email, and department.", true);
    return;
  }
  if (!Number.isFinite(balance) || balance < 100 || !hasAtMostTwoDecimalPlaces(balance)) {
    showToast("Opening balance must be at least ₹100 with up to two decimal places.", true);
    return;
  }

  submitButton.disabled = true;
  try {
    if (oracleMode) {
      const result = await apiRequest("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ name, email, department, balance })
      });
      activeStudentId = Number(result.studentId);
      await loadOracleDashboard();
    } else {
      if (data.students.some((student) => student.email?.toLowerCase() === email)) {
        throw new Error("An account already uses this email address.");
      }
      const studentId = Math.max(0, ...data.students.map((student) => student.id)) + 1;
      data.students.push({ id: studentId, name, email, department, balance });
      activeStudentId = studentId;
      if (!saveData()) {
        data.students.pop();
        activeStudentId = data.students[0]?.id || 1;
        throw new Error("This browser could not save the new account. Check browser storage and try again.");
      }
      render();
    }

    form.reset();
    document.getElementById("account-balance").value = "100";
    document.getElementById("account-dialog").close();
    showToast(`Account created for ${name}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
}

function renderProducts() {
  const grid = document.getElementById("product-grid");
  grid.replaceChildren();
  data.products.filter((product) => product.active !== false).forEach((product) => {
    const card = makeElement("article", "product-card");
    const categoryClass = product.category.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
    const art = makeElement("div", `product-art ${categoryClass}`);
    art.setAttribute("aria-hidden", "true");
    art.append(makeElement("span", "product-category", product.category));
    art.append(makeElement("span", "product-emoji", product.emoji || "♻"));
    const info = makeElement("div", "product-info");
    info.append(makeElement("p", "product-name", product.name));
    const bottom = makeElement("div", "product-bottom");
    bottom.append(makeElement("span", "product-price", formatMoney(product.price)));
    const button = makeElement("button", "buy-button", product.stock > 0 ? "Buy" : "Sold out");
    button.type = "button";
    button.disabled = product.stock < 1;
    button.setAttribute("aria-label", `Buy one ${product.name}`);
    button.addEventListener("click", () => {
      const reusableUsed = document.getElementById("reusable-container").checked;
      void purchaseProduct(product.id, reusableUsed);
    });
    bottom.append(button);
    info.append(bottom);
    const stockText = product.stock === 0 ? "Out of stock" : `${product.stock} in stock`;
    const stockClass = product.stock < LOW_STOCK_THRESHOLD ? "product-stock low" : "product-stock";
    info.append(makeElement("p", stockClass, stockText));
    card.append(art, info);
    grid.append(card);
  });
}

async function purchaseProduct(productId, broughtReusableContainer) {
  const product = data.products.find((item) => item.id === productId);
  const student = currentStudent();
  if (oracleUnavailable) {
    showToast("Oracle is offline. Reconnect the database before making purchases.", true);
    return;
  }
  if (oracleMode) {
    try {
      await apiRequest("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          studentId: activeStudentId,
          productId,
          quantity: 1,
          reusableContainerUsed: broughtReusableContainer
        })
      });
      await loadOracleDashboard();
      showToast("Purchase completed and saved to Oracle.");
    } catch (error) {
      showToast(error.message, true);
    }
    return;
  }
  if (!product || !student || product.stock < 1) {
    showToast("This product is currently unavailable.", true);
    return;
  }

  const reusableUsed = product.refillable && broughtReusableContainer;
  const subtotal = Math.round(product.price * 100) / 100;
  const discountPercent = calculateDiscount(subtotal, reusableUsed);
  const discount = Math.round(subtotal * discountPercent) / 100;
  const total = Math.round((subtotal - discount) * 100) / 100;
  if (student.balance < total) {
    showToast("Insufficient wallet balance for this purchase.", true);
    return;
  }

  product.stock -= 1;
  student.balance = Math.round((student.balance - total) * 100) / 100;
  data.activity.unshift({
    studentId: student.id,
    kind: "purchase",
    title: product.name,
    detail: reusableUsed
      ? "Refill with reusable container · Just now"
      : (product.refillable ? "Refill station · Just now" : "Campus essentials · Just now"),
    amount: -total,
    at: Date.now(),
    refill: product.refillable,
    containers: reusableUsed ? 1 : 0,
    discount
  });
  const saved = saveData();
  render();
  showToast(saved
    ? `Purchase complete. ${discount > 0 ? `${formatMoney(discount)} discount applied.` : "Enjoy!"}`
    : "Purchase complete, but this browser could not save the demo data.",
  !saved);
}

async function transferFunds(event) {
  event.preventDefault();
  const student = currentStudent();
  const recipientId = Number(document.getElementById("transfer-recipient").value);
  const recipient = data.students.find((item) => item.id === recipientId);
  const amountInput = document.getElementById("transfer-amount");
  const amount = Number(amountInput.value);
  if (oracleUnavailable) {
    showToast("Oracle is offline. Reconnect the database before transferring funds.", true);
    return;
  }
  if (oracleMode) {
    if (!Number.isFinite(amount) || amount <= 0 || !hasAtMostTwoDecimalPlaces(amount)) {
      showToast("Enter a positive amount with up to two decimal places.", true);
      return;
    }
    try {
      await apiRequest("/api/transfers", {
        method: "POST",
        body: JSON.stringify({
          senderStudentId: activeStudentId,
          receiverStudentId: recipientId,
          amount
        })
      });
      amountInput.value = "";
      await loadOracleDashboard();
      showToast(`Transfer of ${formatMoney(amount)} completed and saved to Oracle.`);
    } catch (error) {
      showToast(error.message, true);
    }
    return;
  }
  if (!student || !recipient) {
    showToast("Choose a valid recipient wallet.", true);
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0 || !hasAtMostTwoDecimalPlaces(amount)) {
    showToast("Enter a positive amount with up to two decimal places.", true);
    return;
  }
  if (student.balance < amount) {
    showToast("Insufficient wallet balance for this transfer.", true);
    return;
  }

  student.balance = Math.round((student.balance - amount) * 100) / 100;
  recipient.balance = Math.round((recipient.balance + amount) * 100) / 100;
  const now = Date.now();
  data.activity.unshift(
    {
      studentId: student.id,
      kind: "transfer-out",
      title: `Transfer to ${recipient.name}`,
      detail: "Wallet transfer · Just now",
      amount: -amount,
      at: now,
      refill: false,
      containers: 0,
      discount: 0
    },
    {
      studentId: recipient.id,
      kind: "transfer-in",
      title: `Transfer from ${student.name}`,
      detail: "Wallet transfer · Just now",
      amount,
      at: now,
      refill: false,
      containers: 0,
      discount: 0
    }
  );
  const saved = saveData();
  amountInput.value = "";
  render();
  showToast(saved
    ? `${formatMoney(amount)} sent to ${recipient.name}.`
    : "Transfer complete, but this browser could not save the demo data.",
  !saved);
}

function relativeTime(timestamp) {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60000) return "Just now";
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} min ago`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} hr ago`;
  if (elapsed < 172800000) return "Yesterday";
  return `${Math.floor(elapsed / 86400000)} days ago`;
}

function renderActivity() {
  const list = document.getElementById("activity-list");
  const studentActivity = data.activity
    .filter((item) => item.studentId === activeStudentId)
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  list.replaceChildren();
  if (studentActivity.length === 0) {
    list.append(makeElement("div", "empty-state", "No activity yet. Your first refill is waiting."));
    return;
  }

  studentActivity.forEach((item) => {
    const row = makeElement("div", "activity-item");
    const transfer = item.kind.startsWith("transfer");
    row.append(makeElement("span", `activity-symbol${transfer ? " transfer" : ""}`, transfer ? "⇄" : (item.refill ? "↻" : "♻")));
    const copy = makeElement("div", "activity-copy");
    copy.append(makeElement("strong", "", item.title));
    copy.append(makeElement("span", "", `${item.detail.split(" · ")[0]} · ${relativeTime(item.at)}`));
    row.append(copy);
    const isNegative = item.amount < 0;
    const amountText = `${isNegative ? "−" : "+"}${formatMoney(Math.abs(item.amount))}`;
    row.append(makeElement("span", `activity-amount${isNegative ? " negative" : ""}`, amountText));
    list.append(row);
  });
}

function renderStock() {
  const lowStock = data.products
    .filter((product) => product.active !== false && product.stock < LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.stock - b.stock);
  const stockList = document.getElementById("stock-list");
  stockList.replaceChildren();
  document.getElementById("low-stock-count").textContent = `${lowStock.length} low`;
  if (lowStock.length === 0) {
    stockList.append(makeElement("div", "empty-state", "All products are well stocked."));
    return;
  }
  lowStock.slice(0, 4).forEach((product) => {
    const row = makeElement("div", "stock-item");
    row.append(makeElement("span", "stock-name", product.name));
    row.append(makeElement("span", `stock-quantity${product.stock === 0 ? " out" : ""}`, `${product.stock} left`));
    stockList.append(row);
  });
}

function renderStats() {
  const student = currentStudent();
  if (!student) {
    document.getElementById("wallet-balance").textContent = formatMoney(0);
    document.getElementById("refill-count").textContent = "0";
    document.getElementById("containers-avoided").textContent = "0";
    document.getElementById("discount-savings").textContent = formatMoney(0);
    return;
  }
  if (oracleMode && dashboardStats) {
    document.getElementById("wallet-balance").textContent = formatMoney(student.balance);
    document.getElementById("refill-count").textContent = String(dashboardStats.refillCount);
    document.getElementById("containers-avoided").textContent = String(dashboardStats.containersAvoided);
    document.getElementById("discount-savings").textContent = formatMoney(dashboardStats.discountSavings);
    return;
  }
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const purchases = data.activity.filter((item) =>
    item.studentId === activeStudentId &&
    item.kind === "purchase" &&
    item.at >= monthStart.getTime()
  );
  const refills = purchases.filter((item) => item.refill);
  document.getElementById("wallet-balance").textContent = formatMoney(student.balance);
  document.getElementById("refill-count").textContent = String(refills.length);
  document.getElementById("containers-avoided").textContent = String(
    refills.reduce((total, item) => total + (item.containers || 0), 0)
  );
  document.getElementById("discount-savings").textContent = formatMoney(
    purchases.reduce((total, item) => total + (item.discount || 0), 0)
  );
}

function render() {
  document.getElementById("current-date").textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date()).toUpperCase();
  renderStudents();
  renderStats();
  renderProducts();
  renderActivity();
  renderStock();
}

document.getElementById("student-select").addEventListener("change", (event) => {
  activeStudentId = Number(event.target.value);
  if (oracleMode) {
    loadOracleDashboard().catch((error) => showOracleUnavailable(error.message));
  } else {
    render();
  }
});
document.getElementById("transfer-form").addEventListener("submit", transferFunds);
document.getElementById("open-add-account").addEventListener("click", () => {
  document.getElementById("account-dialog").showModal();
  document.getElementById("account-name").focus();
});
document.getElementById("account-form").addEventListener("submit", addAccount);
document.getElementById("close-account-dialog").addEventListener("click", () => {
  document.getElementById("account-dialog").close();
});
document.getElementById("cancel-account").addEventListener("click", () => {
  document.getElementById("account-dialog").close();
});
document.getElementById("reset-demo").addEventListener("click", () => {
  if (oracleMode) return;
  data = cloneInitialData();
  activeStudentId = 1;
  const saved = saveData();
  render();
  showToast(saved
    ? "Demo data has been reset."
    : "Demo data has been reset for this session, but could not be saved in this browser.",
  !saved);
});

void initializeDashboard();
