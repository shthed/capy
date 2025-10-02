const { useEffect, useMemo, useRef, useState } = React;

// ---------- Sample Artwork ----------
const DEMO_ART = {
  id: "demo-fox",
  title: "Low‑poly Fox",
  width: 1000,
  height: 1000,
  palette: [
    { id: 1, name: "Light Fur", rgba: "#F7C68E" },
    { id: 2, name: "Mid Fur", rgba: "#EAA15E" },
    { id: 3, name: "Dark Fur", rgba: "#B65A37" },
    { id: 4, name: "White", rgba: "#F2F2F2" },
    { id: 5, name: "Nose", rgba: "#222" },
    { id: 6, name: "Shadow", rgba: "#8C3E28" },
    { id: 7, name: "Ear Inner", rgba: "#F7D9B5" },
  ],
  cells: [
    { id: "c1", colorId: 7, d: "M120 90 L230 260 L120 260 Z" },
    { id: "c2", colorId: 7, d: "M880 90 L770 260 L880 260 Z" },
    { id: "c3", colorId: 3, d: "M230 260 L350 300 L200 420 Z" },
    { id: "c4", colorId: 3, d: "M770 260 L650 300 L800 420 Z" },
    { id: "c5", colorId: 2, d: "M350 300 L500 360 L650 300 L500 150 Z" },
    { id: "c6", colorId: 2, d: "M200 420 L350 300 L500 520 L300 520 Z" },
    { id: "c7", colorId: 2, d: "M800 420 L650 300 L500 520 L700 520 Z" },
    { id: "c8", colorId: 1, d: "M300 520 L500 520 L460 700 L260 620 Z" },
    { id: "c9", colorId: 1, d: "M700 520 L500 520 L540 700 L740 620 Z" },
    { id: "c10", colorId: 4, d: "M260 620 L460 700 L500 760 L440 820 L280 740 Z" },
    { id: "c11", colorId: 4, d: "M740 620 L540 700 L500 760 L560 820 L720 740 Z" },
    { id: "c12", colorId: 4, d: "M440 820 L500 760 L560 820 L500 900 Z" },
    { id: "c13", colorId: 5, d: "M480 820 L520 820 L500 840 Z" },
    { id: "c14", colorId: 6, d: "M350 300 L420 380 L500 360 Z" },
    { id: "c15", colorId: 6, d: "M650 300 L580 380 L500 360 Z" },
    { id: "c16", colorId: 6, d: "M460 700 L500 640 L540 700 L500 760 Z" },
    { id: "c17", colorId: 6, d: "M440 820 L500 900 L420 880 Z" },
    { id: "c18", colorId: 6, d: "M560 820 L500 900 L580 880 Z" },
    { id: "c19", colorId: 1, d: "M300 520 L260 620 L220 560 Z" },
    { id: "c20", colorId: 1, d: "M700 520 L740 620 L780 560 Z" },
    { id: "c21", colorId: 2, d: "M420 380 L500 520 L500 360 Z" },
    { id: "c22", colorId: 2, d: "M580 380 L500 520 L500 360 Z" },
    { id: "c23", colorId: 7, d: "M170 220 L200 260 L140 260 Z" },
    { id: "c24", colorId: 7, d: "M830 220 L800 260 L860 260 Z" },
  ].map((cell) => ({ ...cell, area: estimatePathArea(cell.d) })),
};

// ---------- Utilities ----------
const SAVE_KEY = (artId) => `capybooper_save_${artId}`;

function estimatePathArea(d) {
  try {
    const tokens = d.split(/[ ,]/).filter(Boolean);
    const coords = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "M" || token === "L" || token === "Z") continue;
      const num = Number(token);
      if (!Number.isNaN(num)) coords.push(num);
    }
    const points = [];
    for (let i = 0; i + 1 < coords.length; i += 2) {
      points.push([coords[i], coords[i + 1]]);
    }
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area / 2);
  } catch (err) {
    return 1000;
  }
}

function loadSave(art) {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY(art.id));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed.artworkId !== art.id) return undefined;
    return parsed;
  } catch (err) {
    return undefined;
  }
}

function persistSave(art, state) {
  try {
    window.localStorage.setItem(SAVE_KEY(art.id), JSON.stringify(state));
  } catch (err) {
    // ignore
  }
}

function computeRemaining(art, filled) {
  const remaining = {};
  for (const swatch of art.palette) {
    remaining[swatch.id] = 0;
  }
  for (const cell of art.cells) {
    if (!filled[cell.id]) {
      remaining[cell.colorId] = (remaining[cell.colorId] || 0) + 1;
    }
  }
  return remaining;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ---------- React App ----------
function App() {
  const art = DEMO_ART;
  const initialState = useMemo(() => {
    const saved = loadSave(art);
    return (
      saved || {
        artworkId: art.id,
        filled: {},
        activeColor: art.palette[0].id,
        viewport: { scale: 0.9, x: 50, y: 50 },
        lastSaved: Date.now(),
      }
    );
  }, [art]);

  const [filled, setFilled] = useState(initialState.filled || {});
  const [activeColor, setActiveColor] = useState(
    initialState.activeColor || art.palette[0].id
  );
  const [scale, setScale] = useState(initialState.viewport?.scale || 0.9);
  const [offset, setOffset] = useState({
    x: initialState.viewport?.x || 0,
    y: initialState.viewport?.y || 0,
  });
  const [lastAction, setLastAction] = useState(null);
  const [hintPulse, setHintPulse] = useState(new Set());
  const [showTests, setShowTests] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      persistSave(art, {
        artworkId: art.id,
        filled,
        activeColor,
        viewport: { scale, x: offset.x, y: offset.y },
        lastSaved: Date.now(),
      });
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [art, filled, activeColor, scale, offset]);

  const remaining = useMemo(() => computeRemaining(art, filled), [art, filled]);
  const totalCells = art.cells.length;
  const filledCount = useMemo(
    () => Object.values(filled).filter(Boolean).length,
    [filled]
  );
  const progress = Math.round((filledCount / totalCells) * 100);

  useEffect(() => {
    if (filledCount === totalCells && totalCells > 0) {
      const frame = document.getElementById("artframe");
      if (!frame) return;
      frame.animate(
        [
          { boxShadow: "0 0 0px rgba(148, 163, 184, 0)" },
          { boxShadow: "0 0 30px rgba(56, 189, 248, 0.6)" },
          { boxShadow: "0 0 0px rgba(148, 163, 184, 0)" },
        ],
        { duration: 900 }
      );
    }
  }, [filledCount, totalCells]);

  const svgRef = useRef(null);
  const isPanningRef = useRef(false);
  const isPaintingRef = useRef(false);
  const lastPosRef = useRef(null);
  const movedRef = useRef(0);
  const eyedropCandidateRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);

  function cssToArt(svg, clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const sx = art.width / rect.width;
    const sy = art.height / rect.height;
    const pxArt = (clientX - rect.left) * sx;
    const pyArt = (clientY - rect.top) * sy;
    return { pxArt, pyArt };
  }

  function onWheel(event) {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    const newScale = clamp(scale * factor, 0.3, 4);

    const svg = svgRef.current;
    if (svg) {
      const { pxArt, pyArt } = cssToArt(svg, event.clientX, event.clientY);
      const artX = (pxArt - offset.x) / scale;
      const artY = (pyArt - offset.y) / scale;
      setOffset({ x: pxArt - artX * newScale, y: pyArt - artY * newScale });
    }
    setScale(newScale);
  }

  function onPointerDown(event) {
    const svg = svgRef.current;
    if (!svg) return;

    if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const target = event.target;
    const cellId = target?.dataset?.cellId;
    movedRef.current = 0;

    if (pointersRef.current.size === 2 && !pinchRef.current) {
      const ids = Array.from(pointersRef.current.keys());
      const p1 = pointersRef.current.get(ids[0]);
      const p2 = pointersRef.current.get(ids[1]);
      const d0 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      pinchRef.current = { id1: ids[0], id2: ids[1], d0, s0: scale, mid0: mid };
      isPanningRef.current = false;
      isPaintingRef.current = false;
      eyedropCandidateRef.current = null;
      return;
    }

    if (cellId) {
      if (filled[cellId]) {
        eyedropCandidateRef.current = cellId;
        isPanningRef.current = true;
        lastPosRef.current = { x: event.clientX, y: event.clientY };
        return;
      }
      isPaintingRef.current = true;
      onCellTap(cellId);
      return;
    }

    isPanningRef.current = true;
    lastPosRef.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event) {
    const svg = svgRef.current;
    if (!svg) return;

    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinchRef.current) {
      const { id1, id2, d0, s0, mid0 } = pinchRef.current;
      const p1 = pointersRef.current.get(id1);
      const p2 = pointersRef.current.get(id2);
      if (p1 && p2) {
        const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const factor = d0 > 0 ? distance / d0 : 1;
        const newScale = clamp(s0 * factor, 0.3, 4);
        const { pxArt, pyArt } = cssToArt(svg, mid0.x, mid0.y);
        const artX = (pxArt - offset.x) / scale;
        const artY = (pyArt - offset.y) / scale;
        setOffset({ x: pxArt - artX * newScale, y: pyArt - artY * newScale });
        setScale(newScale);
      }
      return;
    }

    if (isPaintingRef.current) {
      const target = event.target;
      const id = target?.dataset?.cellId;
      if (id) onCellTap(id);
      return;
    }

    if (isPanningRef.current && lastPosRef.current) {
      const rect = svg.getBoundingClientRect();
      const sx = art.width / rect.width;
      const sy = art.height / rect.height;
      const dxPx = event.clientX - lastPosRef.current.x;
      const dyPx = event.clientY - lastPosRef.current.y;
      movedRef.current += Math.hypot(dxPx, dyPx);
      lastPosRef.current = { x: event.clientX, y: event.clientY };
      setOffset((prev) => ({ x: prev.x + dxPx * sx, y: prev.y + dyPx * sy }));
    }
  }

  function onPointerUp(event) {
    const svg = svgRef.current;
    if (!svg) return;
    if (svg.releasePointerCapture) svg.releasePointerCapture(event.pointerId);

    if (eyedropCandidateRef.current && movedRef.current < 6) {
      const cell = art.cells.find((c) => c.id === eyedropCandidateRef.current);
      if (cell && (remaining[cell.colorId] || 0) > 0) {
        setActiveColor(cell.colorId);
      }
    }

    pointersRef.current.delete(event.pointerId);
    if (
      pinchRef.current &&
      (event.pointerId === pinchRef.current.id1 || event.pointerId === pinchRef.current.id2)
    ) {
      pinchRef.current = null;
    }

    isPanningRef.current = false;
    isPaintingRef.current = false;
    lastPosRef.current = null;
    eyedropCandidateRef.current = null;
    movedRef.current = 0;
  }

  function onCellTap(cellId) {
    const cell = art.cells.find((c) => c.id === cellId);
    if (!cell || filled[cellId]) return;

    if (cell.colorId !== activeColor) {
      const el = document.getElementById(cellId);
      if (el) {
        el.setAttribute("stroke", "#f97316");
        el.setAttribute("stroke-width", "4");
        window.setTimeout(() => {
          el.setAttribute("stroke", "#475569");
          el.setAttribute("stroke-width", "2");
        }, 220);
      }
      return;
    }

    const willComplete = (remaining[activeColor] || 0) === 1;
    setFilled((prev) => ({ ...prev, [cellId]: true }));
    setLastAction(cellId);
    if (willComplete) nextColor();
  }

  function undo() {
    if (!lastAction) return;
    setFilled((prev) => ({ ...prev, [lastAction]: false }));
    setLastAction(null);
  }

  function hint() {
    const candidates = art.cells
      .filter((cell) => cell.colorId === activeColor && !filled[cell.id])
      .sort((a, b) => (a.area || 0) - (b.area || 0))
      .slice(0, 3);
    const ids = new Set(candidates.map((c) => c.id));
    setHintPulse(ids);
    window.setTimeout(() => setHintPulse(new Set()), 1000);
  }

  function resetView() {
    setScale(0.9);
    setOffset({ x: 50, y: 50 });
  }

  function nextColor() {
    const order = art.palette.map((swatch) => swatch.id);
    const startIndex = order.indexOf(activeColor);
    for (let i = 1; i <= order.length; i++) {
      const id = order[(startIndex + i) % order.length];
      if ((remaining[id] || 0) > 0) {
        setActiveColor(id);
        return;
      }
    }
  }

  useEffect(() => {
    function onKey(event) {
      if (event.key === "0") resetView();
      if (event.key === "+" || event.key === "=") setScale((s) => clamp(s * 1.1, 0.3, 4));
      if (event.key === "-" || event.key === "_") setScale((s) => clamp(s / 1.1, 0.3, 4));
      if (event.key.toLowerCase() === "h") hint();
      if (event.key.toLowerCase() === "n") nextColor();
      if (event.key.toLowerCase() === "u") undo();
      if (event.key.toLowerCase() === "t") setShowTests((value) => !value);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isComplete = filledCount === totalCells;

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <button
          aria-label="Back to gallery"
          style={styles.back}
          onClick={() => window.alert("Back to gallery (demo)")}
        >
          ←
        </button>
        <div style={{ fontWeight: 600 }}>{art.title}</div>
        <div style={styles.headerRight}>
          <span aria-live="polite" style={styles.progressLabel}>
            Progress: {progress}%
          </span>
          <button style={styles.iconBtn} onClick={resetView} title="Fit to screen">
            ⤢
          </button>
          <button style={styles.iconBtn} onClick={undo} title="Undo last fill" disabled={!lastAction}>
            ↶
          </button>
          <button
            style={styles.iconBtn}
            onClick={hint}
            title="Hint"
            disabled={isComplete || (remaining[activeColor] || 0) === 0}
          >
            💡
          </button>
          <button
            style={styles.iconBtn}
            onClick={nextColor}
            title="Next color"
            disabled={isComplete}
          >
            ➡
          </button>
          <button style={styles.iconBtn} onClick={() => setShowTests((v) => !v)} title="Toggle tests">
            ✔
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <div id="artframe" style={styles.artframe}>
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${art.width} ${art.height}`}
            style={styles.svg}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
              <rect x={0} y={0} width={art.width} height={art.height} fill="#f8fafc" stroke="#334155" />

              {art.cells.map((cell) => {
                const isFilled = !!filled[cell.id];
                const swatch = art.palette.find((p) => p.id === cell.colorId);
                const showPulse = hintPulse.has(cell.id);
                return (
                  <g key={cell.id}>
                    {isFilled && (
                      <path d={cell.d} fill={swatch?.rgba || "#fff"} pointerEvents="none" />
                    )}

                    <path
                      id={cell.id}
                      data-cell-id={cell.id}
                      data-color-id={cell.colorId}
                      d={cell.d}
                      fill={isFilled ? "transparent" : "rgba(15, 23, 42, 0.75)"}
                      stroke={showPulse ? "#facc15" : "#475569"}
                      strokeWidth={showPulse ? 4 : 2}
                      style={{
                        cursor: isFilled ? "grab" : "pointer",
                        opacity: isFilled ? 0.3 : 1,
                        transition: "stroke 180ms ease, opacity 180ms ease",
                      }}
                      aria-label={`Cell ${cell.id}. Target color ${cell.colorId}. ${
                        isFilled ? "Filled" : "Unfilled"
                      }`}
                    />

                    {!isFilled && scale >= 0.6 && <NumberLabel d={cell.d} text={`${cell.colorId}`} />}
                    {!isFilled && scale < 0.6 && <HeatDot d={cell.d} />}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {showTests && <SmokeTests art={art} filled={filled} />}
      </main>

      <footer style={styles.footer}>
        <Palette
          palette={art.palette}
          remaining={remaining}
          activeColor={activeColor}
          onSelect={setActiveColor}
        />
      </footer>
    </div>
  );
}

// ---------- Helpers ----------
function centroidFromPath(d) {
  const tokens = d.split(/[ ,]/).filter(Boolean);
  const coords = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "M" || token === "L" || token === "Z") continue;
    const num = Number(token);
    if (!Number.isNaN(num)) coords.push(num);
  }
  const points = [];
  for (let i = 0; i + 1 < coords.length; i += 2) {
    points.push([coords[i], coords[i + 1]]);
  }
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-5) {
    const [firstX = 0, firstY = 0] = points[0] || [];
    return { x: firstX, y: firstY };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function NumberLabel({ d, text }) {
  const { x, y } = centroidFromPath(d);
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={18} fill="rgba(248, 250, 252, 0.9)" />
      <text
        x={x}
        y={y + 6}
        fontSize={26}
        textAnchor="middle"
        fill="#0f172a"
        fontFamily="inherit"
        fontWeight="700"
      >
        {text}
      </text>
    </g>
  );
}

function HeatDot({ d }) {
  const { x, y } = centroidFromPath(d);
  return <circle pointerEvents="none" cx={x} cy={y} r={6} fill="#94a3b8" />;
}

function Palette({ palette, remaining, activeColor, onSelect }) {
  return (
    <div style={styles.paletteWrap} role="list" aria-label="Color palette">
      {palette.map((swatch) => {
        const left = remaining[swatch.id] || 0;
        const isActive = swatch.id === activeColor;
        const disabled = left === 0 && !isActive;
        return (
          <button
            key={swatch.id}
            role="listitem"
            onClick={() => onSelect(swatch.id)}
            disabled={disabled}
            aria-pressed={isActive}
            style={{
              ...styles.swatch,
              borderColor: isActive ? "#38bdf8" : "rgba(148, 163, 184, 0.3)",
              boxShadow: isActive ? "0 0 0 2px rgba(56, 189, 248, 0.4)" : undefined,
              opacity: disabled ? 0.35 : 1,
            }}
            title={`${swatch.name || "Color"} #${swatch.id} • Remaining ${left}`}
          >
            <div style={{ ...styles.swatchChip, background: swatch.rgba }}>
              <span style={styles.swatchNumber}>{swatch.id}</span>
            </div>
            <div style={styles.swatchMeta}>
              <span style={styles.swatchCountLabel}>Remaining</span>
              <span style={styles.swatchCount}>{left}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SmokeTests({ art, filled }) {
  const results = useMemo(() => runSmokeTests(art, filled), [art, filled]);
  const allPass = results.every((r) => r.pass);
  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        bottom: 112,
        background: allPass ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
        border: `1px solid ${allPass ? "rgba(34, 197, 94, 0.4)" : "rgba(239, 68, 68, 0.4)"}`,
        borderRadius: 12,
        padding: 10,
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.3)",
        maxWidth: 360,
        fontSize: 12,
        color: "#e2e8f0",
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        {allPass ? "Smoke tests passed" : "Smoke tests failed"}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {results.map((result) => (
          <li key={result.name} style={{ color: result.pass ? "#86efac" : "#fca5a5" }}>
            {result.pass ? "✔" : "✖"} {result.name}
            {result.msg ? ` – ${result.msg}` : ""}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 6, color: "#cbd5f5" }}>Press T to hide/show.</div>
    </div>
  );
}

function runSmokeTests(art, filled) {
  const tests = [];
  const rem = computeRemaining(art, filled);
  const sum = Object.values(rem).reduce((total, value) => total + value, 0);
  const expected = art.cells.filter((cell) => !filled[cell.id]).length;
  tests.push({
    name: "Remaining matches unfilled count",
    pass: sum === expected,
    msg: `${sum}/${expected}`,
  });
  const first = art.cells[0];
  const { x, y } = centroidFromPath(first.d);
  tests.push({
    name: "Centroid in bounds",
    pass: x >= 0 && y >= 0 && x <= art.width && y <= art.height,
  });
  const ids = new Set(art.palette.map((swatch) => swatch.id));
  tests.push({ name: "Palette IDs unique", pass: ids.size === art.palette.length });
  return tests;
}

const styles = {
  app: {
    height: "100vh",
    display: "grid",
    gridTemplateRows: "60px 1fr 110px",
    fontFamily: "inherit",
    color: "#e2e8f0",
    background: "linear-gradient(180deg, rgba(15,23,42,0.9) 0%, rgba(2,6,23,0.95) 100%)",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "48px 1fr auto",
    alignItems: "center",
    padding: "0 16px",
    borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
    background: "rgba(15, 23, 42, 0.85)",
    backdropFilter: "blur(12px)",
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 12,
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.9)",
    color: "#e2e8f0",
    cursor: "pointer",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  progressLabel: {
    fontSize: 14,
    color: "#94a3b8",
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.9)",
    color: "#e2e8f0",
    cursor: "pointer",
    transition: "transform 150ms ease, box-shadow 150ms ease",
  },
  main: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    padding: 20,
  },
  artframe: {
    width: "min(100%, 960px)",
    height: "min(100%, 720px)",
    maxHeight: "calc(100vh - 210px)",
    background: "rgba(15, 23, 42, 0.7)",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    borderRadius: 20,
    overflow: "hidden",
    boxShadow: "0 30px 80px rgba(2, 6, 23, 0.55)",
  },
  svg: {
    background: "#0f172a",
    touchAction: "none",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.85)",
    borderTop: "1px solid rgba(148, 163, 184, 0.15)",
  },
  paletteWrap: {
    display: "flex",
    gap: 16,
    padding: "18px 24px",
    overflowX: "auto",
  },
  swatch: {
    minWidth: 110,
    height: 72,
    borderRadius: 16,
    border: "1px solid rgba(148, 163, 184, 0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 14,
    padding: "0 16px",
    background: "rgba(15, 23, 42, 0.8)",
    color: "#cbd5f5",
    cursor: "pointer",
  },
  swatchChip: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    boxShadow: "0 0 0 2px rgba(15, 23, 42, 0.6)",
  },
  swatchNumber: {
    fontWeight: 700,
    color: "#020617",
  },
  swatchMeta: {
    display: "grid",
    gap: 2,
    fontSize: 12,
  },
  swatchCountLabel: {
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#64748b",
    fontSize: 10,
  },
  swatchCount: {
    fontSize: 18,
    fontWeight: 700,
    color: "#e2e8f0",
  },
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
