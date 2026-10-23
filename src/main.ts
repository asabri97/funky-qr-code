import { Diorama } from "./render/diorama";
import { SEASON_TINT, type Season, type Theme } from "./render/palette";
import { sampleHologram, samplePortrait } from "./render/portrait";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
const stage = document.querySelector<HTMLElement>("#stage");
const input = document.querySelector<HTMLInputElement>("#link");
const hint = document.querySelector<HTMLButtonElement>("#hint");
const status = document.querySelector<HTMLElement>("#status");
const empty = document.querySelector<HTMLElement>("#empty");
const download = document.querySelector<HTMLButtonElement>("#download");
const lede = document.querySelector<HTMLElement>("#lede");
const seasons = document.querySelectorAll<HTMLButtonElement>("[data-season]");
const tints = document.querySelectorAll<HTMLButtonElement>("[data-tint]");
const themes = document.querySelectorAll<HTMLButtonElement>("[data-theme]");
const picture = document.querySelector<HTMLInputElement>("#picture");
const clearPicture = document.querySelector<HTMLButtonElement>("#clear-picture");

if (!canvas || !stage || !input || !hint || !status || !empty || !download || !lede || !picture || !clearPicture) {
  throw new Error("Missing page structure");
}

const view = canvas;
const stageEl = stage;
const linkField = input;
const hintButton = hint;
const statusEl = status;
const emptyEl = empty;
const downloadButton = download;
const ledeEl = lede;
const pictureField = picture;
const clearPictureButton = clearPicture;
let theme: Theme = "day";

function hintCopy(flat: boolean) {
  if (!flat) return "Scroll down for the code";
  if (diorama.hasPortrait) return theme === "night" ? "Scroll up for the hologram" : "Scroll up for the picture";
  return theme === "night" ? "Scroll up for the system" : "Scroll up for the tree";
}

const diorama = new Diorama(view, (flat) => {
  hintButton.textContent = hintCopy(flat);
  stageEl.classList.toggle("flat", flat);
  fitStage();
});

function showMessage(message: string, overlay: boolean) {
  const nightEmpty = theme === "night" && message === "Add a link and the tree will grow.";
  const text = nightEmpty ? "Add a link and the system will form." : message;
  emptyEl.hidden = !overlay;
  statusEl.hidden = overlay || !message;
  if (overlay) emptyEl.textContent = text;
  else statusEl.textContent = text;
}

function selectTheme(next: Theme) {
  theme = next;
  document.body.classList.toggle("night", next === "night");
  ledeEl.textContent =
    next === "night"
      ? "A small solar system, turning on its own. Scroll down and it lies flat as a QR code."
      : "The plaza turns on its own. Scroll down and it lies flat as a QR code.";
  view.setAttribute(
    "aria-label",
    diorama.hasPortrait
      ? next === "night"
        ? "Toggle between the hologram and the QR code"
        : "Toggle between the picture and the QR code"
      : next === "night"
        ? "Toggle between the solar system and the QR code"
        : "Toggle between the tree and the QR code",
  );
  themes.forEach((button) => {
    const on = button.dataset.theme === next;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  diorama.setTheme(next);
  hintButton.textContent = hintCopy(diorama.isFlat);
  refreshPictureClear();
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

themes.forEach((button) => {
  button.addEventListener("click", () => selectTheme(button.dataset.theme === "night" ? "night" : "day"));
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

function imagePixels(image: HTMLImageElement) {
  const scale = Math.min(1, 256 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const buffer = document.createElement("canvas");
  buffer.width = width;
  buffer.height = height;
  const context = buffer.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function usePortrait(file: File) {
  if (!file.type.startsWith("image/")) {
    showMessage("Drop an image file.", false);
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const pixels = imagePixels(image);
    URL.revokeObjectURL(url);
    if (!pixels) {
      showMessage("That image could not be read.", false);
      return;
    }
    const cells = samplePortrait(pixels.data, pixels.width, pixels.height);
    const wire = sampleHologram(pixels.data, pixels.width, pixels.height);
    if (!cells.length) {
      showMessage("That image is empty.", false);
      return;
    }
    diorama.setPortrait(cells, wire);
    refreshPictureClear();
    hintButton.textContent = hintCopy(diorama.isFlat);
    view.setAttribute(
      "aria-label",
      theme === "night" ? "Toggle between the hologram and the QR code" : "Toggle between the picture and the QR code",
    );
    statusEl.hidden = true;
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    showMessage("That image could not be read.", false);
  };
  image.src = url;
}

function refreshPictureClear() {
  clearPictureButton.hidden = !diorama.hasPortrait;
  clearPictureButton.textContent = theme === "night" ? "Remove hologram" : "Remove picture";
}

function clearPortrait() {
  diorama.setPortrait(null);
  pictureField.value = "";
  refreshPictureClear();
  hintButton.textContent = hintCopy(diorama.isFlat);
  view.setAttribute(
    "aria-label",
    theme === "night" ? "Toggle between the solar system and the QR code" : "Toggle between the tree and the QR code",
  );
}

pictureField.addEventListener("change", () => {
  const file = pictureField.files?.[0];
  if (file) usePortrait(file);
});

clearPictureButton.addEventListener("click", clearPortrait);

let dragDepth = 0;
stageEl.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  stageEl.classList.add("dropping");
});
stageEl.addEventListener("dragover", (event) => {
  event.preventDefault();
});
stageEl.addEventListener("dragleave", () => {
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    stageEl.classList.remove("dropping");
  }
});
stageEl.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  stageEl.classList.remove("dropping");
  const file = event.dataTransfer?.files?.[0];
  if (file) usePortrait(file);
});

function fitStage() {
  const rect = stageEl.getBoundingClientRect();
  const wide = Math.max(1, rect.width);
  const tall = Math.max(1, rect.height);
  if (stageEl.classList.contains("flat")) {
    const side = Math.floor(Math.min(wide, tall));
    view.style.width = `${side}px`;
    view.style.height = `${side}px`;
    diorama.resize(side, side);
    return;
  }
  view.style.width = "100%";
  view.style.height = "100%";
  diorama.resize(wide, tall);
}

const observer = new ResizeObserver(() => fitStage());
observer.observe(stageEl);

grow(linkField.value);
