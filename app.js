const paletteData = [
  { number: 1, color: "#ff6b6b", label: "Sunset peak" },
  { number: 2, color: "#ffa36c", label: "Sunset ridge" },
  { number: 3, color: "#8cd5ff", label: "Water" },
  { number: 4, color: "#f9d23c", label: "Sun" },
  { number: 5, color: "#82d173", label: "Sky glow" },
  { number: 6, color: "#3b82f6", label: "Boat" },
];

const cells = Array.from(document.querySelectorAll(".cell"));
const paletteContainer = document.getElementById("palette");
const statusText = document.getElementById("statusText");
const hintButton = document.getElementById("hintButton");
const resetButton = document.getElementById("resetButton");

const remainingCounts = paletteData.reduce((acc, item) => {
  acc[item.number] = cells.filter(
    (cell) => Number(cell.dataset.number) === item.number
  ).length;
  return acc;
}, {});

let activeColor = null;

function formatRemainingText(number) {
  const remaining = remainingCounts[number];
  return remaining === 0
    ? "All filled"
    : `${remaining} ${remaining === 1 ? "cell" : "cells"} left`;
}

function renderPalette() {
  paletteData.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette__item";
    button.dataset.number = item.number;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-pressed", "false");
    button.title = `${item.label} (Color ${item.number})`;
    button.innerHTML = `
      <span
        class="palette__swatch"
        style="background:${item.color}"
        aria-hidden="true"
      ></span>
      <span class="palette__label">
        <span class="palette__number">Color ${item.number}</span>
        <span class="palette__count" data-count>${formatRemainingText(
          item.number
        )}</span>
      </span>
    `;

    button.addEventListener("click", () => setActiveColor(item.number));

    paletteContainer.appendChild(button);
  });
}

function setActiveColor(number) {
  activeColor = number;
  const paletteItems = paletteContainer.querySelectorAll(".palette__item");
  paletteItems.forEach((item) => {
    const isSelected = Number(item.dataset.number) === number;
    item.classList.toggle("is-selected", isSelected);
    item.setAttribute("aria-pressed", String(isSelected));
  });

  updateStatus();
  clearHints();
}

function updateCounts(number) {
  const count = Math.max(0, remainingCounts[number] - 1);
  remainingCounts[number] = count;
  const paletteItem = paletteContainer.querySelector(
    `.palette__item[data-number="${number}"]`
  );
  const countLabel = paletteItem?.querySelector("[data-count]");
  if (countLabel) {
    countLabel.textContent = formatRemainingText(number);
  }

  if (count === 0 && Number(paletteItem?.dataset.number) === activeColor) {
    statusText.textContent = `Great! Color ${number} is complete.`;
  }
}

function updateStatus() {
  if (activeColor == null) {
    statusText.textContent = "Select a color to begin.";
    return;
  }
  statusText.textContent = `Color ${activeColor} selected. ${formatRemainingText(
    activeColor
  )}.`;
}

function clearHints() {
  cells.forEach((cell) => cell.classList.remove("hint"));
}

function fillCell(cell) {
  if (cell.dataset.filled === "true") {
    statusText.textContent = "That region is already filled.";
    return;
  }

  const cellNumber = Number(cell.dataset.number);
  const paletteItem = paletteData.find((item) => item.number === cellNumber);
  if (!paletteItem) return;

  cell.dataset.filled = "true";
  cell.setAttribute("aria-pressed", "true");
  cell.style.fill = paletteItem.color;
  updateCounts(cellNumber);

  const remainingCells = Object.values(remainingCounts).reduce(
    (total, count) => total + count,
    0
  );

  if (remainingCells === 0) {
    statusText.textContent = "Artwork complete!";
    hintButton.disabled = true;
  }
}

function handleCellClick(event) {
  if (!activeColor) {
    statusText.textContent = "Pick a color from the palette first.";
    return;
  }

  const cell = event.target.closest(".cell");
  if (!cell) return;

  const cellNumber = Number(cell.dataset.number);

  if (cellNumber !== activeColor) {
    statusText.textContent = `Region ${cellNumber} needs Color ${cellNumber}.`;
    cell.classList.add("hint");
    setTimeout(() => cell.classList.remove("hint"), 600);
    return;
  }

  fillCell(cell);
}

function provideHint() {
  if (!activeColor) {
    statusText.textContent = "Select a color before asking for a hint.";
    return;
  }

  const nextCell = cells.find(
    (cell) =>
      Number(cell.dataset.number) === activeColor && cell.dataset.filled !== "true"
  );

  if (!nextCell) {
    statusText.textContent = "Looks like that color is done!";
    return;
  }

  clearHints();
  nextCell.classList.add("hint");
  nextCell.scrollIntoView({ block: "center", behavior: "smooth" });
  statusText.textContent = `Here's a hint! Fill region ${activeColor}.`;
}

function resetPainting() {
  cells.forEach((cell) => {
    cell.dataset.filled = "false";
    cell.style.fill = "#ffffff";
    cell.setAttribute("aria-pressed", "false");
  });

  Object.keys(remainingCounts).forEach((key) => {
    const number = Number(key);
    remainingCounts[number] = cells.filter(
      (cell) => Number(cell.dataset.number) === number
    ).length;
  });

  paletteContainer
    .querySelectorAll("[data-count]")
    .forEach((label) => {
      const number = Number(label.closest(".palette__item").dataset.number);
      label.textContent = formatRemainingText(number);
    });

  hintButton.disabled = false;
  clearHints();
  updateStatus();
}

renderPalette();

cells.forEach((cell) => {
  cell.tabIndex = 0;
  cell.setAttribute("role", "button");
  cell.setAttribute("aria-pressed", "false");
  cell.addEventListener("click", handleCellClick);
  cell.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleCellClick(event);
    }
  });
});

hintButton.addEventListener("click", provideHint);
resetButton.addEventListener("click", resetPainting);

updateStatus();
