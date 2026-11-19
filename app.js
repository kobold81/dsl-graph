const COLORS = {
  file: "#8aa0b8",
  group: "#f0c14b",
  item: "#3d8bfd",
  thing: "#2ecc71",
  rule: "#e67e22",
  sitemap: "#9b59b6",
};

const EDGE_COLORS = {
  defines: "#445566",
  member: "#f0c14b88",
  channel: "#2ecc7188",
  triggers: "#e74c3c",
  memberTrigger: "#c0392b",
  commands: "#e67e22",
  reads: "#95a5a688",
  shows: "#9b59b688",
};

let DATA = { nodes: [], edges: [], meta: {} };
let engine = "3d";
let visNetwork = null;
let cy = null;
let fg = null;
let focusId = null;
let subgraphRoot = null;
let last3dTap = { id: null, t: 0 };
let hover3dNode = null;
let rotateMode = false;
const cam = { theta: 0.55, phi: 0.38, radius: 900 };

const graphEl = document.getElementById("graph");
const spinEl = document.getElementById("graph-spin");

function kindsOn() {
  const on = new Set();
  document.querySelectorAll(".checks input[data-kind]").forEach((el) => {
    if (el.checked) on.add(el.dataset.kind);
  });
  return on;
}

function filtered() {
  const kinds = kindsOn();
  const q = document.getElementById("search").value.trim().toLowerCase();
  const file = document.getElementById("fileFilter").value;
  let nodes = DATA.nodes.filter((n) => kinds.has(n.kind));
  if (file) nodes = nodes.filter((n) => n.file === file || n.id === "file:" + file);
  if (q) nodes = nodes.filter((n) => (n.label || "").toLowerCase().includes(q) || (n.id || "").toLowerCase().includes(q));
  if (subgraphRoot) {
    const neigh = new Set([subgraphRoot]);
    DATA.edges.forEach((e) => {
      if (e.from === subgraphRoot) neigh.add(e.to);
      if (e.to === subgraphRoot) neigh.add(e.from);
    });
    nodes = DATA.nodes.filter((n) => neigh.has(n.id));
  }
  const idSet = new Set(nodes.map((n) => n.id));
  const edges = DATA.edges.filter((e) => idSet.has(e.from) && idSet.has(e.to));
  return { nodes, edges };
}

function visShape(kind) {
  return { file: "box", group: "diamond", item: "dot", thing: "hexagon", rule: "triangle", sitemap: "star" }[kind] || "dot";
}

function nodeById(id) {
  return DATA.nodes.find((n) => n.id === id);
}

function emphasizeNeighbors(id) {
  if (engine === "vis" && visNetwork) {
    const nodes = visNetwork.getConnectedNodes(id) || [];
    const edges = visNetwork.getConnectedEdges(id) || [];
    visNetwork.setSelection({ nodes: [id, ...nodes], edges });
  } else if (engine === "cy" && cy) {
    cy.elements().unselect();
    const core = cy.getElementById(id);
    core.select();
    core.connectedEdges().select();
    core.neighborhood().select();
  }
}

function openDetail(id) {
  const n = nodeById(id);
  const panel = document.getElementById("detail");
  const body = document.getElementById("detail-body");
  if (!n || !panel) return;
  focusId = id;
  document.getElementById("detail-title").textContent = n.label || id;
  const rows = [
    ["Kind", n.kind],
    ["Type", n.itype],
    ["Name", n.label],
    ["Label", n.itemLabel],
    ["File", n.file],
    ["UID", n.uid],
    ["Cron", n.cron ? "yes" : ""],
  ].filter(([, v]) => v);
  const rel = DATA.edges.filter((e) => e.from === id || e.to === id);
  const relHtml = rel
    .map((e) => {
      const other = e.from === id ? e.to : e.from;
      const on = nodeById(other);
      const dir = e.from === id ? "→" : "←";
      return `<li>${e.etype} ${dir} ${on ? on.label : other}</li>`;
    })
    .join("");
  body.innerHTML =
    rows.map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/</g, "&lt;")}</dd>`).join("") +
    (n.title ? `<dt>Info</dt><dd>${String(n.title).replace(/</g, "&lt;").replace(/\n/g, "<br>")}</dd>` : "") +
    (relHtml ? `<dt>Relations (${rel.length})</dt><dd><ul>${relHtml}</ul></dd>` : "");
  panel.classList.add("open");
  emphasizeNeighbors(id);
}

function closeDetail() {
  const panel = document.getElementById("detail");
  if (!focusId && !panel.classList.contains("open")) return;
  focusId = null;
  panel.classList.remove("open");
  if (engine === "vis" && visNetwork) visNetwork.unselectAll();
  else if (engine === "cy" && cy) cy.elements().unselect();
}

document.getElementById("detail-close").onclick = () => closeDetail();

function showNeighborhood(id) {
  if (!nodeById(id)) return;
  subgraphRoot = id;
  const btn = document.getElementById("btn-full-graph");
  if (btn) btn.hidden = false;
  render();
  openDetail(id);
}

function clearNeighborhood() {
  if (!subgraphRoot) return;
  subgraphRoot = null;
  const btn = document.getElementById("btn-full-graph");
  if (btn) btn.hidden = true;
  render();
}

function applyOrientation() {
  const globe = document.getElementById("nav-globe");
  const knob = document.getElementById("nav-knob");
  if (globe) {
    globe.style.transform = `rotateX(${-cam.phi}rad) rotateY(${cam.theta}rad)`;
  }
  if (knob) {
    const k = 28;
    knob.style.transform = `translate(${Math.sin(cam.theta) * Math.cos(cam.phi) * k}px, ${-Math.sin(cam.phi) * k}px)`;
  }
  if (engine === "3d" && fg) {
    spinEl.style.transform = "none";
    const r = cam.radius;
    const x = r * Math.cos(cam.phi) * Math.sin(cam.theta);
    const y = r * Math.sin(cam.phi);
    const z = r * Math.cos(cam.phi) * Math.cos(cam.theta);
    fg.cameraPosition({ x, y, z }, { x: 0, y: 0, z: 0 }, 0);
  } else {
    spinEl.style.transform = "none";
  }
}

function renderVis(payload) {
  destroyCy();
  destroyFg();
  const nodes = payload.nodes.map((n) => {
    const bg = COLORS[n.kind] || "#888";
    return {
      id: n.id,
      label: n.label,
      title: n.title || n.label,
      color: {
        background: bg,
        border: bg,
        hover: { background: bg, border: "#ffffff" },
        highlight: { background: bg, border: "#ffffff" },
      },
      shape: visShape(n.kind),
      font: { color: "#e7eef7", size: 12 },
      borderWidth: 0,
      size: 14,
    };
  });
  const edges = payload.edges.map((e, i) => ({
    id: "e" + i,
    from: e.from,
    to: e.to,
    arrows: "to",
    color: { color: EDGE_COLORS[e.etype] || "#556" },
    title: e.etype,
    smooth: { type: "continuous" },
  }));
  const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
  const options = {
    physics: {
      solver: "forceAtlas2Based",
      forceAtlas2Based: { gravitationalConstant: -40, springLength: 90, springConstant: 0.04 },
      stabilization: { iterations: 200 },
    },
    interaction: {
      hover: true,
      hoverConnectedEdges: true,
      tooltipDelay: 80,
      navigationButtons: false,
      keyboard: true,
      dragView: false,
      dragNodes: true,
      zoomView: true,
      selectable: true,
      selectConnectedEdges: true,
    },
    nodes: {
      borderWidth: 0,
      borderWidthSelected: 4,
      size: 14,
      chosen: {
        node(values) {
          values.borderWidth = 4;
          values.borderColor = "#ffffff";
          values.size = 22;
        },
      },
    },
    edges: { width: 1 },
  };
  visNetwork = new vis.Network(graphEl, data, options);
  let visHoverId = null;
  const paintHover = (id) => {
    const resets = [];
    if (visHoverId && visHoverId !== id) {
      const prev = data.nodes.get(visHoverId);
      if (prev) resets.push({ id: visHoverId, borderWidth: 0, size: 14 });
    }
    visHoverId = id || null;
    if (id) resets.push({ id, borderWidth: 4, size: 22 });
    if (resets.length) data.nodes.update(resets);
  };
  visNetwork.on("hoverNode", (p) => {
    paintHover(p.node);
    graphEl.style.cursor = "pointer";
  });
  visNetwork.on("blurNode", () => {
    paintHover(null);
    graphEl.style.cursor = "";
  });
  visNetwork.on("click", (p) => {
    if (p.nodes && p.nodes.length) openDetail(p.nodes[0]);
    else closeDetail();
  });
  visNetwork.on("selectNode", (p) => {
    if (p.nodes && p.nodes.length) openDetail(p.nodes[0]);
  });
  visNetwork.on("doubleClick", (p) => {
    if (p.nodes && p.nodes.length) showNeighborhood(p.nodes[0]);
    else clearNeighborhood();
  });
  applyOrientation();
}

function destroyVis() {
  if (visNetwork) {
    visNetwork.destroy();
    visNetwork = null;
  }
}

function destroyCy() {
  if (cy) {
    cy.destroy();
    cy = null;
  }
}

function destroyFg() {
  if (fg) {
    try {
      fg.pauseAnimation();
    } catch (e) {}
    fg = null;
  }
}

function renderCy(payload) {
  destroyVis();
  destroyFg();
  graphEl.innerHTML = "";
  const elements = [
    ...payload.nodes.map((n) => ({
      data: { id: n.id, label: n.label, kind: n.kind, title: n.title || n.label },
    })),
    ...payload.edges.map((e, i) => ({
      data: { id: "e" + i, source: e.source, target: e.target, etype: e.etype },
    })),
  ];
  cy = cytoscape({
    container: graphEl,
    elements,
    minZoom: 0.05,
    maxZoom: 4,
    userPanningEnabled: true,
    userZoomingEnabled: true,
    boxSelectionEnabled: false,
    autoungrabify: false,
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          color: "#e7eef7",
          "font-size": 9,
          "text-wrap": "ellipsis",
          "text-max-width": 90,
          "background-color": (ele) => COLORS[ele.data("kind")] || "#888",
          width: 16,
          height: 16,
        },
      },
      { selector: 'node[kind = "file"]', style: { shape: "round-rectangle", width: 28, height: 16 } },
      { selector: 'node[kind = "group"]', style: { shape: "diamond" } },
      { selector: 'node[kind = "thing"]', style: { shape: "hexagon" } },
      { selector: 'node[kind = "rule"]', style: { shape: "triangle" } },
      { selector: 'node[kind = "sitemap"]', style: { shape: "star" } },
      {
        selector: "edge",
        style: {
          width: 1,
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.7,
          "line-color": (ele) => EDGE_COLORS[ele.data("etype")] || "#556",
          "target-arrow-color": (ele) => EDGE_COLORS[ele.data("etype")] || "#556",
        },
      },
    ],
    layout: { name: "cose", animate: false, nodeRepulsion: 8000, gravity: 0.4, numIter: 400 },
  });
  cy.on("tap", "node", (evt) => openDetail(evt.target.id()));
  cy.on("tap", (evt) => {
    if (evt.target === cy) closeDetail();
  });
  cy.on("dbltap", "node", (evt) => {
    evt.preventDefault();
    showNeighborhood(evt.target.id());
  });
  cy.on("dbltap", (evt) => {
    if (evt.target === cy) clearNeighborhood();
  });
  applyOrientation();
}

function makeNameSprite(n, large) {
  const text = n.label || String(n.id).replace(/^[^:]+:/, "");
  const Sprite = typeof SpriteText === "function" ? SpriteText : window.SpriteText;
  if (typeof Sprite === "function") {
    const sprite = new Sprite(text);
    sprite.color = "#f4f8fc";
    sprite.textHeight = large ? 16 : 5;
    sprite.fontFace = "system-ui, sans-serif";
    sprite.fontWeight = "700";
    sprite.backgroundColor = "rgba(12,18,26,0.82)";
    sprite.padding = large ? 2.5 : 1.5;
    sprite.borderRadius = 3;
    sprite.position.y = large ? 18 : 10;
    return sprite;
  }
  const THREEObj = window.THREE;
  if (!THREEObj || !THREEObj.CanvasTexture) return undefined;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const fontPx = large ? 42 : 22;
  ctx.font = "700 " + fontPx + "px system-ui,sans-serif";
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  canvas.width = w;
  canvas.height = fontPx + 20;
  ctx.font = "700 " + fontPx + "px system-ui,sans-serif";
  ctx.fillStyle = "rgba(12,18,26,0.85)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f4f8fc";
  ctx.fillText(text, 12, fontPx + 2);
  const map = new THREEObj.CanvasTexture(canvas);
  const mat = new THREEObj.SpriteMaterial({ map, depthTest: false });
  const sprite = new THREEObj.Sprite(mat);
  const scale = large ? 48 : 22;
  sprite.scale.set(scale * (w / canvas.height), scale, 1);
  sprite.position.y = large ? 18 : 10;
  return sprite;
}

function render3d(payload) {
  destroyVis();
  destroyCy();
  graphEl.innerHTML = "";
  const named = !!subgraphRoot;
  const gData = {
    nodes: payload.nodes.map((n) => ({ ...n })),
    links: payload.edges.map((e) => ({ source: e.source, target: e.target, etype: e.etype })),
  };
  fg = ForceGraph3D()(graphEl)
    .backgroundColor("#0b1016")
    .graphData(gData)
    .nodeId("id")
    .nodeLabel((n) => (n.title || n.label || "").replace(/\n/g, "<br/>"))
    .nodeColor((n) => COLORS[n.kind] || "#888")
    .nodeThreeObject((n) => makeNameSprite(n, named))
    .nodeThreeObjectExtend(true)
    .nodeRelSize(5)
    .nodeOpacity(0.95)
    .linkColor((l) => EDGE_COLORS[l.etype] || "#556")
    .linkOpacity(0.45)
    .linkDirectionalArrowLength(3.5)
    .linkDirectionalArrowRelPos(1)
    .onNodeClick((n) => {
      if (rotateMode) {
        setRotateMode(false);
        return;
      }
      const now = Date.now();
      if (last3dTap.id === n.id && now - last3dTap.t < 450) {
        last3dTap = { id: null, t: 0 };
        showNeighborhood(n.id);
        return;
      }
      last3dTap = { id: n.id, t: now };
      openDetail(n.id);
    })
    .onBackgroundClick(() => {
      const now = Date.now();
      if (last3dTap.id === "__bg__" && now - last3dTap.t < 450) {
        last3dTap = { id: null, t: 0 };
        clearNeighborhood();
        return;
      }
      last3dTap = { id: "__bg__", t: now };
      closeDetail();
    })
    .onNodeHover((n) => {
      hover3dNode = n || null;
    });
  fg.d3Force("charge").strength(named ? -180 : -80);
  if (named) {
    cam.radius = Math.max(220, Math.min(900, 140 + payload.nodes.length * 28));
  }
  applyOrientation();
  fg.enableNavigationControls(false);
}

function render() {
  const payload = filtered();
  document.getElementById("meta").textContent =
    `${payload.nodes.length} nodes · ${payload.edges.length} edges` +
    (subgraphRoot ? " · neighborhood of " + (nodeById(subgraphRoot)?.label || subgraphRoot) : "") +
    (focusId ? " · detail open" : "") +
    ` · ${DATA.meta.items || 0} items, ${DATA.meta.rules || 0} rules, ${DATA.meta.things || 0} things`;
  if (engine === "vis") renderVis(payload);
  else if (engine === "cy") renderCy(payload);
  else render3d(payload);
}

function setRotateMode(on) {
  rotateMode = !!on;
  document.getElementById("stage").classList.toggle("rotate-mode", rotateMode);
  if (!rotateMode) document.getElementById("stage").classList.remove("rotating");
}

function setEngine(name) {
  setRotateMode(false);
  engine = name;
  document.getElementById("btn-vis").classList.toggle("active", name === "vis");
  document.getElementById("btn-cy").classList.toggle("active", name === "cy");
  document.getElementById("btn-3d").classList.toggle("active", name === "3d");
  destroyVis();
  destroyCy();
  destroyFg();
  graphEl.innerHTML = "";
  render();
}

function fillFileFilter(files) {
  const sel = document.getElementById("fileFilter");
  const current = sel.value;
  sel.innerHTML = '<option value="">all files</option>';
  (files || []).forEach((f) => {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f;
    sel.appendChild(o);
  });
  if (current && files && files.includes(current)) sel.value = current;
}

let dataSource = localStorage.getItem("dsl-graph-source") || "rest";
let summaryRest = null;
let summaryFiles = null;

function setSourceButtons() {
  document.getElementById("btn-source-rest").classList.toggle("active", dataSource === "rest");
  document.getElementById("btn-source-files").classList.toggle("active", dataSource === "files");
}

async function reloadFiles(source) {
  const tokenInput = document.getElementById("api-token");
  if (tokenInput) setApiToken(tokenInput.value);
  if (source) dataSource = source;
  localStorage.setItem("dsl-graph-source", dataSource);
  setSourceButtons();
  const restBtn = document.getElementById("btn-source-rest");
  const filesBtn = document.getElementById("btn-source-files");
  restBtn.disabled = true;
  filesBtn.disabled = true;
  const active = dataSource === "files" ? filesBtn : restBtn;
  const prev = active.textContent;
  active.textContent = "Reloading…";
  try {
    DATA = await loadDslFiles(dataSource);
    fillFileFilter(DATA.meta.files);
    focusId = null;
    subgraphRoot = null;
    const full = document.getElementById("btn-full-graph");
    if (full) full.hidden = true;
    if (dataSource === "rest") summaryRest = summarizeGraph(DATA);
    else summaryFiles = summarizeGraph(DATA);
    render();
    renderDeviation();
    refreshOtherSummary(dataSource);
    const rest = DATA.meta.rest || {};
    if (dataSource === "rest" && (rest.things === false || rest.rules === false)) {
      restBtn.title =
        "Things/rules still 401. Create an API token in Main UI (Profile → API tokens) and Save it here, then Reload REST.";
    }
  } catch (err) {
    console.error(err);
    active.title = String(err);
  }
  restBtn.textContent = "Reload REST";
  filesBtn.textContent = "Config files";
  restBtn.disabled = false;
  filesBtn.disabled = false;
}

function row(label, a, b, note) {
  const av = a == null ? "—" : a;
  const bv = b == null ? "—" : b;
  const miss = typeof av === "number" && typeof bv === "number" && av !== bv;
  return `<tr><th>${label}</th><td class="num">${av}</td><td class="num">${bv}</td><td>${miss ? note || "differs" : note || ""}</td></tr>`;
}

function renderDeviation() {
  const el = document.getElementById("deviation");
  const body = document.getElementById("deviation-body");
  if (!el || !body) return;
  if (!summaryRest && !summaryFiles) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (localStorage.getItem("dsl-graph-deviation-open") === "1") el.open = true;
  const r = summaryRest || {};
  const f = summaryFiles || {};
  const rk = r.kinds || {};
  const fk = f.kinds || {};
  const re = r.etypes || {};
  const fe = f.etypes || {};
  const restAuth = r.rest || {};
  const thingsBlocked = restAuth.things === false;
  const rulesBlocked = restAuth.rules === false;
  const linksBlocked = restAuth.links === false;
  let causes = [];
  if (thingsBlocked) {
    causes.push(
      "<strong>Things missing in REST:</strong> <code>/rest/things</code> returned 401. Save an API token (Main UI → Profile → API tokens) and Reload REST."
    );
  }
  if (rulesBlocked) {
    causes.push(
      "<strong>Rules missing in REST:</strong> <code>/rest/rules</code> returned 401 without a token. File Rules DSL may still be absent: that API lists JSON automation rules, not <code>*.rules</code>."
    );
  }
  if (linksBlocked) {
    causes.push(
      "<strong>Channel links missing in REST:</strong> <code>/rest/links</code> returned 401, so channel edges from config files are absent."
    );
  }
  causes.push(
    "<strong>File nodes only exist for config files:</strong> REST has no <code>.items</code> / <code>.rules</code> / <code>.things</code> file identity, so those nodes and <code>defines</code> edges disappear."
  );
  causes.push(
    "<strong>Sitemaps:</strong> both sources list the same sitemaps, but REST widgets omit some <code>item=</code> entries from the DSL (visibility, nested pages, or widgets not expanded), so <code>shows</code> edges are fewer."
  );
  if (summaryRest && summaryFiles && r.items === f.items) {
    causes.unshift("<strong>Items match:</strong> REST and config files both see the same item/group names. The smaller REST graph is missing things, rules, files, and some sitemap links — not missing items.");
  }
  body.innerHTML =
    `<table>
      <tr><th></th><th>REST</th><th>Config files</th><th></th></tr>
      ${row("Items/groups", r.items, f.items, r.items === f.items ? "same item registry" : "")}
      ${row("Things", r.things, f.things, thingsBlocked ? "needs API token" : "")}
      ${row("Rules", r.rules, f.rules, rulesBlocked ? "needs API token; DSL files may still be absent" : "")}
      ${row("Sitemaps", r.sitemaps, f.sitemaps, "")}
      ${row("File nodes", rk.file || 0, fk.file || 0, "only from DSL files")}
      ${row("Graph nodes", r.nodes, f.nodes, "")}
      ${row("Graph edges", r.edges, f.edges, "")}
      ${row("member edges", re.member || 0, fe.member || 0, "")}
      ${row("channel edges", re.channel || 0, fe.channel || 0, linksBlocked || thingsBlocked ? "needs things/links" : "")}
      ${row("rule trigger/command/read", (re.triggers || 0) + (re.commands || 0) + (re.reads || 0), (fe.triggers || 0) + (fe.commands || 0) + (fe.reads || 0), rulesBlocked ? "needs rules" : "")}
      ${row("sitemap shows", re.shows || 0, fe.shows || 0, "REST widget tree is incomplete vs item= in .sitemap")}
      ${row("defines", re.defines || 0, fe.defines || 0, "file→element edges")}
    </table>
    <div class="cause">${causes.map((c) => `<p>${c}</p>`).join("")}</div>
    ${!summaryRest || !summaryFiles ? "<p>Loading the other source for a full comparison…</p>" : ""}`;
}

async function refreshOtherSummary(current) {
  try {
    if (current === "rest" && !summaryFiles) {
      summaryFiles = summarizeGraph(await loadFromConfigFiles());
    } else if (current === "files" && !summaryRest) {
      summaryRest = summarizeGraph(await loadFromRest());
    }
    renderDeviation();
  } catch (err) {
    console.warn("Could not load the other source for comparison", err);
  }
}

(function setupApiToken() {
  const input = document.getElementById("api-token");
  const saved = localStorage.getItem("dsl-graph-api-token") || "";
  if (saved) {
    input.value = saved;
    setApiToken(saved);
  }
  document.getElementById("btn-token-save").onclick = () => {
    setApiToken(input.value);
    input.value = getApiToken();
    if (dataSource === "rest") reloadFiles("rest");
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      setApiToken(input.value);
      reloadFiles("rest");
    }
  });
})();

document.getElementById("deviation").addEventListener("toggle", (e) => {
  localStorage.setItem("dsl-graph-deviation-open", e.target.open ? "1" : "0");
});

document.getElementById("btn-source-rest").onclick = () => reloadFiles("rest");
document.getElementById("btn-source-files").onclick = () => reloadFiles("files");
document.getElementById("btn-full-graph").onclick = () => clearNeighborhood();
document.getElementById("btn-vis").onclick = () => setEngine("vis");
document.getElementById("btn-cy").onclick = () => setEngine("cy");
document.getElementById("btn-3d").onclick = () => setEngine("3d");
document.getElementById("search").addEventListener("input", () => {
  focusId = null;
  render();
});
document.getElementById("fileFilter").addEventListener("change", () => {
  focusId = null;
  render();
});
document.querySelectorAll(".checks input").forEach((el) => el.addEventListener("change", render));

function panGraph(dx, dy) {
  if (engine === "vis" && visNetwork) {
    const scale = visNetwork.getScale() || 1;
    const pos = visNetwork.getViewPosition();
    visNetwork.moveTo({
      position: { x: pos.x - dx / scale, y: pos.y - dy / scale },
      animation: false,
    });
  } else if (engine === "cy" && cy) {
    cy.panBy({ x: dx, y: dy });
  } else if (engine === "3d" && fg) {
    const camera = fg.camera();
    const target = fg.controls().target;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const k = (cam.radius || 900) * 0.0015;
    const mx = (-dx * e[0] + dy * e[4]) * k;
    const my = (-dx * e[1] + dy * e[5]) * k;
    const mz = (-dx * e[2] + dy * e[6]) * k;
    camera.position.x += mx;
    camera.position.y += my;
    camera.position.z += mz;
    target.x += mx;
    target.y += my;
    target.z += mz;
    fg.controls().update();
  }
}

(function setupGraphPan() {
  const stage = document.getElementById("stage");
  let down = null;
  let last = null;
  let ignoreUp = false;
  const CLICK_PX = 8;

  function inGraph(t) {
    return t instanceof Node && stage.contains(t) && !t.closest("#nav-sphere") && !t.closest("header");
  }

  function visNodeAt(e) {
    if (!visNetwork) return null;
    const r = graphEl.getBoundingClientRect();
    return visNetwork.getNodeAt({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (!inGraph(e.target)) return;
      if (engine === "vis") {
        down = { x: e.clientX, y: e.clientY, node: visNodeAt(e) || null };
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (engine !== "3d") return;
      if (rotateMode) {
        setRotateMode(false);
        ignoreUp = true;
        down = null;
        last = null;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (hover3dNode) return;
      down = { x: e.clientX, y: e.clientY };
      last = { x: e.clientX, y: e.clientY };
    },
    true
  );

  window.addEventListener(
    "pointermove",
    (e) => {
      if (engine === "vis" && down && visNetwork) {
        if (down.node) return;
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        panGraph(dx, dy);
        return;
      }
      if (engine !== "3d") return;
      if (rotateMode && last) {
        rotateBy(e.clientX - last.x, e.clientY - last.y);
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!down || rotateMode) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      if (moved >= CLICK_PX) panGraph(dx, dy);
    },
    true
  );

  window.addEventListener(
    "pointerup",
    (e) => {
      if (e.button !== 0) return;
      if (engine === "vis") {
        const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 99;
        const nid = down && down.node;
        down = null;
        last = null;
        if (nid && moved < CLICK_PX) openDetail(nid);
        return;
      }
      if (engine !== "3d") return;
      if (ignoreUp) {
        ignoreUp = false;
        down = null;
        return;
      }
      if (rotateMode) {
        down = null;
        return;
      }
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (!inGraph(e.target) && !(e.target === stage)) {
        last = null;
        return;
      }
      if (moved < CLICK_PX && !hover3dNode) {
        setRotateMode(true);
        last = { x: e.clientX, y: e.clientY };
      } else {
        last = null;
      }
    },
    true
  );
})();

function rotateBy(dx, dy) {
  cam.theta -= dx * 0.008;
  cam.phi = Math.max(-1.2, Math.min(1.2, cam.phi + dy * 0.008));
  applyOrientation();
}

function zoomBy(factor, origin) {
  if (engine === "3d") {
    cam.radius = Math.max(120, Math.min(4000, cam.radius / factor));
    applyOrientation();
    return;
  }
  if (engine === "vis" && visNetwork) {
    const scale = visNetwork.getScale() || 1;
    visNetwork.moveTo({ scale: Math.max(0.05, Math.min(4, scale * factor)), animation: { duration: 120 } });
  } else if (engine === "cy" && cy) {
    cy.zoom({
      level: Math.max(0.05, Math.min(4, cy.zoom() * factor)),
      renderedPosition: origin || { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }
}

function fitView() {
  cam.theta = 0.55;
  cam.phi = 0.38;
  cam.radius = 900;
  applyOrientation();
  if (engine === "vis" && visNetwork) visNetwork.fit({ animation: { duration: 250 } });
  else if (engine === "cy" && cy) cy.fit(undefined, 40);
}

(function setupSphere() {
  const sphere = document.getElementById("nav-sphere");
  let dragging = false;
  let last = null;

  function onMove(e) {
    if (!dragging) return;
    const x = e.clientX;
    const y = e.clientY;
    if (last) rotateBy(x - last.x, y - last.y);
    last = { x, y };
  }

  function stop() {
    dragging = false;
    last = null;
    sphere.classList.remove("dragging");
  }

  sphere.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true;
    sphere.classList.add("dragging");
    last = { x: e.clientX, y: e.clientY };
    sphere.setPointerCapture(e.pointerId);
  });
  sphere.addEventListener("pointermove", onMove);
  sphere.addEventListener("pointerup", stop);
  sphere.addEventListener("pointercancel", stop);
  sphere.addEventListener("dblclick", (e) => {
    e.preventDefault();
    fitView();
  });
  sphere.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false }
  );
  document.getElementById("zoom-in").onclick = () => zoomBy(1.2);
  document.getElementById("zoom-out").onclick = () => zoomBy(1 / 1.2);
  document.getElementById("zoom-fit").onclick = () => fitView();
})();

setSourceButtons();
reloadFiles(dataSource).catch((err) => {
  graphEl.textContent = "Failed to load graph data: " + err;
});
