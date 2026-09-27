const PUBLIC = document.documentElement.dataset.public === "true";
const state = { cards: [], folders: [], releaseDates: {}, activeCard: null, search: "", view: "all", folder: null, company: "", sort: "set", visitor: PUBLIC || localStorage.getItem("collection-visitor") === "true" };
const $ = (selector) => document.querySelector(selector);
const grid = $("#card-grid");
const status = $("#status");
const template = $("#card-template");
const dialog = $("#card-dialog");
const folderForm = $("#folder-form");
const folderName = $("#folder-name");
const newFolder = $("#new-folder");
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const textCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
let dialogTrigger = null;

async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json().catch(() => null);
  if (!response.ok || result === null) throw new Error(result?.error || `HTTP ${response.status}`);
  return result;
}

function sendJson(path, method, body) {
  return api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const cardPath = (card) => `/api/cards/${card.company}/${card.certNumber}`;

function syncThemeControl() {
  const dark = document.documentElement.dataset.theme === "dark";
  const label = dark ? "Use light theme" : "Use dark theme";
  const button = $("#theme-toggle");
  button.setAttribute("aria-label", label);
  button.title = label;
  $('meta[name="theme-color"]').content = dark ? "#09111e" : "#f3f4f6";
}

function syncVisitorControl() {
  const button = $("#visitor-toggle");
  const label = state.visitor ? "Exit visitor mode" : "Enter visitor mode";
  document.documentElement.dataset.visitor = state.visitor;
  button.setAttribute("aria-pressed", state.visitor);
  button.setAttribute("aria-label", label);
  button.title = label;
  $("#search").placeholder = state.visitor ? "Card or set" : "Card, set, or certificate";
  const priceSort = $('#sort-order option[value="price"]');
  priceSort.disabled = state.visitor;
  priceSort.hidden = state.visitor;
  if (state.visitor && state.sort === "price") {
    state.sort = "set";
    $("#sort-order").value = "set";
  }
  if (state.visitor && dialog.open) dialog.close();
}

function cardImage(card) {
  if (!card.images.length) return "assets/placeholder.svg";
  if (state.visitor && !PUBLIC) return `visitor-cache/${card.company.toLowerCase()}/${card.certNumber}/front.jpg`;
  return card.images[0];
}

async function uploadScan(card, file, button) {
  button.disabled = true;
  button.textContent = "Uploading…";
  try {
    const result = await api(`/api/scans/${card.company}/${card.certNumber}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    card.images = [result.image];
    render();
  } catch (error) {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = "Try again";
      button.title = `Upload failed: ${error.message}`;
    }
    status.textContent = `Could not upload scan for ${card.name}: ${error.message}`;
  }
}

async function saveCard(card, price, folder) {
  const result = await sendJson(cardPath(card), "PATCH", { price, folder });
  card.price = result.price;
  card.folder = result.folder;
}

async function removeCard(card) {
  if (!confirm(`Remove ${card.name} from the collection?`)) return false;
  await api(cardPath(card), { method: "DELETE" });
  state.cards = state.cards.filter((candidate) => candidate !== card);
  render();
  return true;
}

async function createFolder(name) {
  const result = await sendJson("/api/folders", "POST", { name });
  state.folders = result.folders;
  state.view = "folders";
  state.folder = result.folder;
  render();
}

async function importCsv(file) {
  const button = $("#import-csv");
  const label = button.querySelector("span");
  button.disabled = true;
  label.textContent = "Updating…";
  status.textContent = "Updating collection…";
  try {
    const result = await api("/api/import", { method: "POST", headers: { "Content-Type": "text/csv" }, body: file });
    setCards(await api(`cards.json?v=${Date.now()}`, { cache: "no-store" }));
    status.textContent = `${result.added} added · ${result.updated} updated · ${result.unchanged} unchanged`;
  } catch (error) {
    status.textContent = `Could not update collection: ${error.message}`;
  } finally {
    button.disabled = false;
    label.textContent = "Update CSV";
  }
}

function openCardDialog(card, trigger) {
  state.activeCard = card;
  dialogTrigger = trigger;
  $("#dialog-status").textContent = "";
  $("#dialog-title").textContent = card.name;
  $("#dialog-set").textContent = `${card.year} · ${card.set}`;
  $("#dialog-grade").textContent = `${card.grade} · Pop ${card.population.toLocaleString()}`;
  const cert = $("#dialog-cert");
  cert.textContent = `Certification ${card.certNumber} ↗`;
  cert.hidden = !card.certUrl;
  if (card.certUrl) cert.href = card.certUrl;
  $("#dialog-price").value = card.price.toFixed(2);
  const folder = $("#dialog-folder");
  folder.replaceChildren(new Option("Unfiled", ""));
  state.folders.forEach((name) => folder.add(new Option(name, name)));
  folder.value = card.folder || "";
  dialog.showModal();
}

function closeFolderForm() {
  folderForm.hidden = true;
  folderName.value = "";
  newFolder.hidden = false;
}

function populateSelect(id, values) {
  const select = $(id);
  const currentValue = select.value;
  select.replaceChildren(select.options[0]);
  values.forEach((value) => select.add(new Option(value, value)));
  select.value = values.includes(currentValue) ? currentValue : "";
}

function setCards(cards) {
  state.cards = cards;
  populateSelect("#company-filter", [...new Set(cards.map((card) => card.company))].sort());
  render();
}

function compareCardNumbers(a, b) {
  const aNumber = a.cardNumber?.trim();
  const bNumber = b.cardNumber?.trim();
  if (aNumber && !bNumber) return -1;
  if (!aNumber && bNumber) return 1;
  return textCollator.compare(aNumber || "", bNumber || "");
}

function visibleCards() {
  const query = state.search.toLowerCase();
  const cards = state.cards.filter((card) => {
    const searchable = `${card.name} ${card.set}${state.visitor ? "" : ` ${card.certNumber}`}`.toLowerCase();
    return (!query || searchable.includes(query))
      && (state.view === "all" || card.folder === state.folder)
      && (!state.company || card.company === state.company);
  });
  if (state.sort === "price") return cards.sort((a, b) => b.price - a.price);
  return cards.sort((a, b) => (state.releaseDates[a.set] || `${a.year}-01-01`)
    .localeCompare(state.releaseDates[b.set] || `${b.year}-01-01`)
    || textCollator.compare(a.set, b.set)
    || a.set.localeCompare(b.set)
    || compareCardNumbers(a, b)
    || textCollator.compare(a.name, b.name));
}

function renderFolders() {
  const bar = $("#folder-bar");
  bar.hidden = state.view !== "folders";
  if (bar.hidden) return;
  const count = (name) => state.cards.filter((card) => card.folder === name).length;
  const folders = count(null) ? [null, ...state.folders] : state.folders;
  const select = $("#folder-select");
  select.replaceChildren(...folders.map((name) => new Option(`${name ?? "Unfiled"} (${count(name)})`, name ?? "")));
  select.value = state.folder ?? "";
}

function renderViewSwitch() {
  document.querySelectorAll(".view-switch button").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active);
  });
}

function renderCard(card, index) {
  const node = template.content.cloneNode(true);
  node.querySelector(".card").style.animationDelay = `${Math.min(index, 16) * 20}ms`;
  const image = node.querySelector(".card-image");
  image.src = cardImage(card);
  image.alt = card.images.length ? `${card.name} graded card scan` : `${card.name} card scan unavailable`;
  image.addEventListener("error", () => { image.src = "assets/placeholder.svg"; }, { once: true });
  const addScan = node.querySelector(".add-scan");
  const scanInput = node.querySelector(".scan-input");
  if (card.images.length) {
    addScan.remove();
    scanInput.remove();
  } else {
    addScan.addEventListener("click", () => scanInput.click());
    scanInput.addEventListener("change", () => {
      if (scanInput.files[0]) uploadScan(card, scanInput.files[0], addScan);
    });
  }
  const setName = node.querySelector(".set-name");
  setName.textContent = setName.title = `${card.year} · ${card.set}`;
  const heading = node.querySelector("h2");
  heading.textContent = heading.title = card.name;
  node.querySelector(".price").textContent = state.visitor ? "" : currency.format(card.price);
  node.querySelector(".grade").textContent = card.grade;
  node.querySelector(".population").textContent = `Pop ${card.population.toLocaleString()}`;
  const manageButton = node.querySelector(".manage-card");
  manageButton.dataset.cardId = `${card.company}:${card.certNumber}`;
  manageButton.setAttribute("aria-label", `Manage ${card.name}`);
  manageButton.title = `Manage ${card.name}`;
  manageButton.addEventListener("click", () => openCardDialog(card, manageButton));
  return node;
}

function render() {
  if (state.view === "folders") {
    const available = state.cards.some((card) => card.folder === null) ? [null, ...state.folders] : state.folders;
    if (!available.includes(state.folder)) state.folder = available[0] ?? null;
  }
  const cards = visibleCards();
  grid.replaceChildren(...cards.map(renderCard));
  status.textContent = cards.length ? "" : "No cards match these filters.";
  $("#visible-count").textContent = cards.length.toLocaleString();
  $("#visible-value").textContent = state.visitor ? "" : currency.format(cards.reduce((sum, card) => sum + card.price * card.quantity, 0));
  renderFolders();
  renderViewSwitch();
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

$("#theme-toggle").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("collection-theme", theme);
  syncThemeControl();
});

$("#visitor-toggle").addEventListener("click", () => {
  state.visitor = !state.visitor;
  localStorage.setItem("collection-visitor", state.visitor);
  syncVisitorControl();
  render();
});

[["#search", "search", "input"], ["#company-filter", "company", "change"], ["#sort-order", "sort", "change"]].forEach(([id, key, event]) => {
  $(id).addEventListener(event, ({ target }) => {
    state[key] = target.value;
    render();
  });
});

document.querySelectorAll(".view-switch button").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    state.folder = null;
    if (state.view !== "folders") closeFolderForm();
    render();
  });
});

$("#folder-select").addEventListener("change", ({ target }) => {
  state.folder = target.value || null;
  render();
});

newFolder.addEventListener("click", () => {
  newFolder.hidden = true;
  folderForm.hidden = false;
  folderName.focus();
});

$("#cancel-folder").addEventListener("click", () => {
  closeFolderForm();
  newFolder.focus();
});

folderForm.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("#cancel-folder").click();
});

folderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await createFolder(folderName.value);
    closeFolderForm();
  } catch (error) {
    status.textContent = `Could not create folder: ${error.message}`;
  }
});

$("#close-dialog").addEventListener("click", () => dialog.close());

dialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    dialog.close();
  }
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  state.activeCard = null;
  const trigger = dialogTrigger;
  dialogTrigger = null;
  requestAnimationFrame(() => {
    if (state.visitor) {
      $("#visitor-toggle").focus();
      return;
    }
    const replacement = [...document.querySelectorAll(".manage-card")]
      .find((button) => button.dataset.cardId === trigger?.dataset.cardId);
    (trigger?.isConnected ? trigger : replacement || $("#search")).focus();
  });
});

$("#card-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const card = state.activeCard;
  if (!card) {
    dialog.close();
    return;
  }
  const submit = event.currentTarget.querySelector(".primary-button");
  submit.disabled = true;
  try {
    const price = Number($("#dialog-price").value);
    const folder = $("#dialog-folder").value || null;
    if (price !== card.price || folder !== card.folder) await saveCard(card, price, folder);
    dialog.close();
    render();
  } catch (error) {
    $("#dialog-status").textContent = `Could not save card: ${error.message}`;
  } finally {
    submit.disabled = false;
  }
});

$("#dialog-delete").addEventListener("click", async (event) => {
  if (!state.activeCard) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    if (await removeCard(state.activeCard)) dialog.close();
  } catch (error) {
    $("#dialog-status").textContent = `Could not remove card: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

const csvInput = $("#csv-input");
$("#import-csv").addEventListener("click", () => csvInput.click());
csvInput.addEventListener("change", () => {
  if (csvInput.files[0]) importCsv(csvInput.files[0]);
  csvInput.value = "";
});

syncThemeControl();
syncVisitorControl();

Promise.all(["cards.json", PUBLIC ? "folders.json" : "/api/folders", "set-release-dates.json"].map((path) => api(path)))
  .then(([cards, folderData, releaseDates]) => {
    state.folders = folderData.folders;
    state.releaseDates = releaseDates;
    setCards(cards);
  })
  .catch((error) => {
    status.textContent = `Could not load collection: ${error.message}`;
  });
