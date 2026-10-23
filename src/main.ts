import { Diorama } from "./render/diorama";
import { SEASON_TINT, type Season } from "./render/palette";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
const stage = document.querySelector<HTMLElement>("#stage");
const input = document.querySelector<HTMLInputElement>("#link");
const hint = document.querySelector<HTMLButtonElement>("#hint");
const status = document.querySelector<HTMLElement>("#status");
const empty = document.querySelector<HTMLElement>("#empty");
const download = document.querySelector<HTMLButtonElement>("#download");
const seasons = document.querySelectorAll<HTMLButtonElement>("[data-season]");
const tints = document.querySelectorAll<HTMLButtonElement>("[data-tint]");

if (!canvas || !stage || !input || !hint || !status || !empty || !download) {
  throw new Error("Missing page structure");
}

const view = canvas;
const stageEl = stage;
const linkField = input;
const hintButton = hint;
const statusEl = status;
const emptyEl = empty;
const downloadButton = download;

const diorama = new Diorama(view, (flat) => {
  hintButton.textContent = flat ? "Scroll up for the tree" : "Scroll down for the code";
});

function showMessage(message: string, overlay: boolean) {
  emptyEl.hidden = !overlay;
  statusEl.hidden = overlay || !message;
  if (overlay) emptyEl.textContent = message;
  else statusEl.textContent = message;
}

function grow(text: string) {
  const result = diorama.setText(text);
  if (result.ok) {
    showMessage("", false);
    statusEl.hidden = true;
    downloadButton.disabled = false;
    return;
  }
  if (result.reason === "empty") diorama.clear();
  const overlay = !diorama.hasModel;
  showMessage(result.message, overlay);
  downloadButton.disabled = !diorama.hasModel;
}

function selectSeason(season: Season) {
  seasons.forEach((button) => {
    const on = button.dataset.season === season;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const tint = SEASON_TINT[season].toLowerCase();
  tints.forEach((dot) => {
    const on = (dot.dataset.tint ?? "").toLowerCase() === tint;
    dot.classList.toggle("on", on);
    dot.setAttribute("aria-pressed", on ? "true" : "false");
  });
  diorama.setSeason(season);
}

let pending = 0;
linkField.addEventListener("input", () => {
  window.clearTimeout(pending);
  pending = window.setTimeout(() => grow(linkField.value), 220);
});

hintButton.addEventListener("click", (event) => {
  event.stopPropagation();
  diorama.toggle();
});

downloadButton.addEventListener("click", () => diorama.download());

seasons.forEach((button) => {
  button.addEventListener("click", () => selectSeason(button.dataset.season as Season));
});

tints.forEach((button) => {
  button.addEventListener("click", () => {
    tints.forEach((other) => {
      const on = other === button;
      other.classList.toggle("on", on);
      other.setAttribute("aria-pressed", on ? "true" : "false");
    });
    diorama.setTint(button.dataset.tint ?? SEASON_TINT.spring);
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    diorama.setFlat(false);
    return;
  }
  if (event.key === "Enter" && event.target === linkField) {
    event.preventDefault();
    window.clearTimeout(pending);
    grow(linkField.value);
    return;
  }
  if (event.key === "Enter" && event.target === view) {
    event.preventDefault();
    diorama.toggle();
    return;
  }
  if (event.code === "Space" && (event.target === view || event.target === document.body)) {
    event.preventDefault();
    diorama.toggle();
  }
});

const observer = new ResizeObserver(() => {
  const rect = stageEl.getBoundingClientRect();
  diorama.resize(rect.width, rect.height);
});
observer.observe(stageEl);

grow(linkField.value);
