const PUBLIC = document.documentElement.dataset.public === "true";
const state = { cards: [], folders: [], releaseDates: {}, activeCard: null, search: "", view: "all", folder: null, company: "", sort: "set", visitor: PUBLIC || localStorage.getItem("collection-visitor") === "true" };
const grid = document.querySelector("#card-grid");
const status = document.querySelector("#status");
const template = document.querySelector("#card-template");
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const textCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
let dialogTrigger = null;
const PRIVATE_SCAN_COMPANIES = new Set(["PSA", "BGS", "BRG", "CCC", "CGC"]);

function syncThemeControl() {
  const dark = document.documentElement.dataset.theme === "dark";
  const label = dark ? "Use light theme" : "Use dark theme";
  const button = document.querySelector("#theme-toggle");
  button.setAttribute("aria-label", label);
  button.title = label;
  document.querySelector('meta[name="theme-color"]').content = dark ? "#09111e" : "#f3f4f6";
}

document.querySelector("#theme-toggle").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("collection-theme", theme);
  syncThemeControl();
});

syncThemeControl();

function visitorImage(card) {
  if (PUBLIC || !state.visitor || !PRIVATE_SCAN_COMPANIES.has(card.company) || !card.images.length) {
    return card.images[0];
  }
  return `visitor-cache/${card.company.toLowerCase()}/${card.certNumber}/front.jpg`;
}

function syncVisitorControl() {
  const button = document.querySelector("#visitor-toggle");
  const label = state.visitor ? "Exit visitor mode" : "Enter visitor mode";
  document.documentElement.dataset.visitor = state.visitor;
  button.setAttribute("aria-pressed", state.visitor);
  button.setAttribute("aria-label", label);
  button.title = label;
  document.querySelector("#search").placeholder = state.visitor ? "Card or set" : "Card, set, or certificate";
  const priceSort = document.querySelector('#sort-order option[value="price"]');
  priceSort.disabled = state.visitor;
  priceSort.hidden = state.visitor;
  if (state.visitor && state.sort === "price") {
    state.sort = "set";
    document.querySelector("#sort-order").value = "set";
  }
  const dialog = document.querySelector("#card-dialog");
  if (state.visitor && dialog.open) dialog.close();
}

document.querySelector("#visitor-toggle").addEventListener("click", () => {
  state.visitor = !state.visitor;
  localStorage.setItem("collection-visitor", state.visitor);
  syncVisitorControl();
  render();
});

syncVisitorControl();

async function uploadScan(card, file, button) {
  button.disabled = true;
  button.textContent = "Uploading…";
  try {
    const response = await fetch(`/api/scans/${card.company}/${card.certNumber}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
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
  const response = await fetch(`/api/cards/${card.company}/${card.certNumber}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ price, folder }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  card.price = result.price;
  card.folder = result.folder;
}

async function removeCard(card) {
  if (!confirm(`Remove ${card.name} from the collection?`)) return false;
  const response = await fetch(`/api/cards/${card.company}/${card.certNumber}`, {
    method: "DELETE",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  state.cards = state.cards.filter((candidate) => candidate !== card);
  render();
  return true;
}

function openCardDialog(card, trigger) {
  state.activeCard = card;
  dialogTrigger = trigger;
  document.querySelector("#dialog-status").textContent = "";
  document.querySelector("#dialog-title").textContent = card.name;
  document.querySelector("#dialog-set").textContent = `${card.year} · ${card.set}`;
  document.querySelector("#dialog-grade").textContent = `${card.grade} · Pop ${card.population.toLocaleString()}`;
  const cert = document.querySelector("#dialog-cert");
  cert.textContent = `Certification ${card.certNumber} ↗`;
  cert.hidden = !card.certUrl;
  if (card.certUrl) cert.href = card.certUrl;
  document.querySelector("#dialog-price").value = card.price.toFixed(2);
  const folder = document.querySelector("#dialog-folder");
  folder.replaceChildren(new Option("Unfiled", ""));
  state.folders.forEach((name) => folder.add(new Option(name, name)));
  folder.value = card.folder || "";
  document.querySelector("#card-dialog").showModal();
}

async function createFolder(name) {
  const response = await fetch("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  state.folders = result.folders;
  state.view = "folders";
  state.folder = result.folder;
  render();
}

function populateSelect(id, values) {
  const select = document.querySelector(id);
  const currentValue = select.value;
  const defaultOption = select.options[0].cloneNode(true);
  select.replaceChildren(defaultOption);
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

function renderFolders() {
  const bar = document.querySelector("#folder-bar");
  bar.hidden = state.view !== "folders";
  if (bar.hidden) return;
  const unfiledCount = state.cards.filter((card) => card.folder === null).length;
  const folders = [
    ...(unfiledCount ? [{ name: null, label: "Unfiled" }] : []),
    ...state.folders.map((name) => ({ name, label: name })),
  ];
  const select = document.querySelector("#folder-select");
  const options = folders.map(({ name, label }) => {
    const count = state.cards.filter((card) => card.folder === name).length;
    return new Option(`${label} (${count})`, name ?? "");
  });
  select.replaceChildren(...options);
  select.value = state.folder ?? "";
  select.onchange = () => {
    state.folder = select.value || null;
    render();
  };
}

function renderViewSwitch() {
  document.querySelectorAll(".view-switch button").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active);
  });
}

function renderIcons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

async function importCsv(file) {
  const button = document.querySelector("#import-csv");
  const label = button.querySelector("span");
  button.disabled = true;
  label.textContent = "Updating…";
  status.textContent = "Updating collection…";
  try {
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: file,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    const cardsResponse = await fetch(`cards.json?v=${Date.now()}`, { cache: "no-store" });
    if (!cardsResponse.ok) throw new Error(`HTTP ${cardsResponse.status}`);
    setCards(await cardsResponse.json());
    status.textContent = `${result.added} added · ${result.updated} updated · ${result.unchanged} unchanged`;
  } catch (error) {
    status.textContent = `Could not update collection: ${error.message}`;
  } finally {
    button.disabled = false;
    label.textContent = "Update CSV";
  }
}

function visibleCards() {
  const query = state.search.toLowerCase();
  const cards = state.cards.filter((card) => {
    const searchable = `${card.name} ${card.set}${state.visitor ? "" : ` ${card.certNumber}`}`.toLowerCase();
    return (!query || searchable.includes(query))
      && (state.view === "all" || card.folder === state.folder)
      && (!state.company || card.company === state.company);
  });
  if (state.sort === "set") {
    return cards.sort((a, b) => (state.releaseDates[a.set] || `${a.year}-01-01`)
      .localeCompare(state.releaseDates[b.set] || `${b.year}-01-01`)
      || textCollator.compare(a.set, b.set)
      || a.set.localeCompare(b.set)
      || compareCardNumbers(a, b)
      || textCollator.compare(a.name, b.name)
      || textCollator.compare(a.certNumber, b.certNumber));
  }
  return cards.sort((a, b) => b.price - a.price);
}

function render() {
  if (state.view === "folders") {
    const availableFolders = [
      ...(state.cards.some((card) => card.folder === null) ? [null] : []),
      ...state.folders,
    ];
    if (!availableFolders.includes(state.folder)) state.folder = availableFolders[0] ?? null;
  }
  const cards = visibleCards();
  const fragment = document.createDocumentFragment();
  cards.forEach((card, index) => {
    const node = template.content.cloneNode(true);
    const article = node.querySelector(".card");
    article.style.animationDelay = `${Math.min(index, 16) * 20}ms`;
    const image = node.querySelector(".card-image");
    image.src = visitorImage(card) || "assets/placeholder.svg";
    image.alt = card.images[0] ? `${card.name} graded card scan` : `${card.name} card scan unavailable`;
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
    setName.textContent = `${card.year} · ${card.set}`;
    setName.title = `${card.year} · ${card.set}`;
    const heading = node.querySelector("h2");
    heading.textContent = card.name;
    heading.title = card.name;
    node.querySelector(".price").textContent = state.visitor ? "" : currency.format(card.price);
    node.querySelector(".grade").textContent = card.grade;
    node.querySelector(".population").textContent = `Pop ${card.population.toLocaleString()}`;
    const manageButton = node.querySelector(".manage-card");
    manageButton.dataset.cardId = `${card.company}:${card.certNumber}`;
    manageButton.setAttribute("aria-label", `Manage ${card.name}`);
    manageButton.title = `Manage ${card.name}`;
    manageButton.addEventListener("click", (event) => openCardDialog(card, event.currentTarget));
    fragment.append(node);
  });
  grid.replaceChildren(fragment);
  status.textContent = cards.length ? "" : "No cards match these filters.";
  document.querySelector("#visible-count").textContent = cards.length.toLocaleString();
  document.querySelector("#visible-value").textContent = state.visitor ? "" : currency.format(cards.reduce((sum, card) => sum + card.price * card.quantity, 0));
  renderFolders();
  renderViewSwitch();
  renderIcons();
}

function bind(id, key, event = "change") {
  document.querySelector(id).addEventListener(event, ({ target }) => {
    state[key] = target.value;
    render();
  });
}

Promise.all([fetch("cards.json"), fetch(PUBLIC ? "folders.json" : "/api/folders"), fetch("set-release-dates.json")])
  .then(async ([cardsResponse, foldersResponse, releaseDatesResponse]) => {
    if (!cardsResponse.ok || !foldersResponse.ok || !releaseDatesResponse.ok) throw new Error("Could not load collection data");
    return [await cardsResponse.json(), await foldersResponse.json(), await releaseDatesResponse.json()];
  })
  .then(([cards, folderData, releaseDates]) => {
    state.folders = folderData.folders;
    state.releaseDates = releaseDates;
    setCards(cards);
    bind("#search", "search", "input");
    bind("#company-filter", "company");
    bind("#sort-order", "sort");
    document.querySelectorAll(".view-switch button").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.view;
        state.folder = null;
        if (state.view !== "folders") {
          folderForm.hidden = true;
          folderName.value = "";
          document.querySelector("#new-folder").hidden = false;
        }
        render();
      });
    });
    const folderForm = document.querySelector("#folder-form");
    const folderName = document.querySelector("#folder-name");
    document.querySelector("#new-folder").addEventListener("click", () => {
      document.querySelector("#new-folder").hidden = true;
      folderForm.hidden = false;
      folderName.focus();
    });
    document.querySelector("#cancel-folder").addEventListener("click", () => {
      folderForm.hidden = true;
      const newFolder = document.querySelector("#new-folder");
      newFolder.hidden = false;
      folderName.value = "";
      newFolder.focus();
    });
    folderForm.addEventListener("keydown", (event) => {
      if (event.key === "Escape") document.querySelector("#cancel-folder").click();
    });
    folderForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await createFolder(folderName.value);
        folderName.value = "";
        folderForm.hidden = true;
        document.querySelector("#new-folder").hidden = false;
      } catch (error) {
        status.textContent = `Could not create folder: ${error.message}`;
      }
    });
    const dialog = document.querySelector("#card-dialog");
    document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dialog.close();
      }
    });
    dialog.addEventListener("close", () => {
      state.activeCard = null;
      const trigger = dialogTrigger;
      const cardId = trigger?.dataset.cardId;
      dialogTrigger = null;
      requestAnimationFrame(() => {
        if (state.visitor) {
          document.querySelector("#visitor-toggle").focus();
          return;
        }
        const replacement = [...document.querySelectorAll(".manage-card")]
          .find((button) => button.dataset.cardId === cardId);
        (trigger?.isConnected ? trigger : replacement || document.querySelector("#search")).focus();
      });
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.querySelector("#card-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const card = state.activeCard;
      if (!card) {
        dialog.close();
        return;
      }
      const submit = event.currentTarget.querySelector(".primary-button");
      submit.disabled = true;
      try {
        const price = Number(document.querySelector("#dialog-price").value);
        const folder = document.querySelector("#dialog-folder").value || null;
        if (price !== card.price || folder !== card.folder) await saveCard(card, price, folder);
        dialog.close();
        state.activeCard = null;
        render();
      } catch (error) {
        document.querySelector("#dialog-status").textContent = `Could not save card: ${error.message}`;
      } finally {
        submit.disabled = false;
      }
    });
    document.querySelector("#dialog-delete").addEventListener("click", async () => {
      if (!state.activeCard) return;
      const button = document.querySelector("#dialog-delete");
      button.disabled = true;
      try {
        const removed = await removeCard(state.activeCard);
        if (removed) dialog.close();
      } catch (error) {
        document.querySelector("#dialog-status").textContent = `Could not remove card: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
    const csvInput = document.querySelector("#csv-input");
    document.querySelector("#import-csv").addEventListener("click", () => csvInput.click());
    csvInput.addEventListener("change", () => {
      if (csvInput.files[0]) importCsv(csvInput.files[0]);
      csvInput.value = "";
    });
  })
  .catch((error) => { status.textContent = `Could not load the collection: ${error.message}`; });