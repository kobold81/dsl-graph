const ITEM_TYPES =
  /^(Group|Switch|Number:[A-Za-z]+|Number|String|DateTime|Contact|Dimmer|Color|Rollershutter|Player|Location|Call|Image)\s+(\S+)/;
const JUNK = new Set([
  "ON", "OFF", "OPEN", "CLOSED", "NULL", "UNDEF", "UP", "DOWN", "STOP",
  "INCREASE", "DECREASE", "PLAY", "PAUSE", "NEXT", "PREVIOUS", "REWIND", "FASTFORWARD",
  "cmd", "alle", "mitteUndRechts",
]);

function stripBlocks(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseItems(text, file) {
  const items = [];
  stripBlocks(text).split(/\n/).forEach((line, i) => {
    line = line.trim();
    if (!line || line.startsWith("//")) return;
    const m = line.match(ITEM_TYPES);
    if (!m) return;
    const type = m[1];
    const name = m[2];
    const lm = line.match(/"([^"]*)"/);
    const gm = line.match(/\(([^)]+)\)/);
    const cm = line.match(/channel\s*=\s*"([^"]+)"/);
    items.push({
      name,
      type,
      label: lm ? lm[1] : "",
      groups: gm ? gm[1].split(",").map((s) => s.trim()).filter(Boolean) : [],
      channel: cm ? cm[1] : null,
      file,
      line: i + 1,
    });
  });
  return items;
}

function parseThings(text, file) {
  const things = [];
  const t = stripBlocks(text);
  const re = /(Bridge|Thing)\s+([A-Za-z0-9_.:-]+)\s*(?:"([^"]*)")?(?:\s+@\s+"([^"]*)")?/g;
  let m;
  while ((m = re.exec(t))) {
    things.push({ uid: m[2], label: m[3] || "", location: m[4] || "", file, kind: m[1] });
  }
  return things;
}

function parseRules(text, file) {
  const rules = [];
  const re = /rule\s+"([^"]+)"(?:[ \t]*\/\/[^\n]*)?\s*(when[\s\S]*?\bend\b)/gi;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    const body = m[2];
    const pick = (rx) => [...body.matchAll(rx)].map((x) => x[1]);
    const commands = pick(/\b([A-Za-z0-9_]+)\.(?:sendCommand|postUpdate)\s*\(/g)
      .concat(pick(/\b(?:sendCommand|postUpdate)\s*\(\s*([A-Za-z0-9_]+)/g))
      .filter((x) => !JUNK.has(x) && !/^\d/.test(x));
    const reads = pick(/\b([A-Za-z0-9_]+)\.state\b/g).filter((x) => !JUNK.has(x));
    const cronExprs = pick(/Time\s+cron\s+"([^"]+)"/gi);
    rules.push({
      name,
      file,
      triggers: [...new Set(pick(/\bItem\s+([A-Za-z0-9_]+)/g))],
      memberOf: [...new Set(pick(/\bMember of\s+([A-Za-z0-9_]+)/g))],
      commands: [...new Set(commands)],
      reads: [...new Set(reads)],
      cron: cronExprs.length > 0 || /Time\s+cron/i.test(body),
      cronExprs,
    });
  }
  return rules;
}

function parseSitemaps(text, file) {
  const name = (text.match(/sitemap\s+(\S+)/) || [null, file.split("/").pop()])[1];
  const items = [...new Set([...text.matchAll(/\bitem\s*=\s*([A-Za-z0-9_]+)/g)].map((x) => x[1]))];
  return { name, file, items };
}

function buildGraph(parsed) {
  const { items, things, rules, sitemaps } = parsed;
  const nodes = [];
  const seen = new Set();
  const edges = [];
  function addNode(id, extra) {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, ...extra });
  }
  function addEdge(a, b, etype) {
    if (!seen.has(a) || !seen.has(b)) return;
    edges.push({ from: a, to: b, source: a, target: b, etype });
  }
  const files = new Set();
  [...items, ...things, ...rules, ...sitemaps].forEach((x) => {
    if (x.file) files.add(x.file);
  });
  [...files].sort().forEach((f) => {
    addNode("file:" + f, { label: f.split("/").pop(), title: f, kind: "file", fileKind: f.split("/")[0], file: f });
  });
  items.forEach((i) => {
    const kind = i.type === "Group" ? "group" : "item";
    addNode("item:" + i.name, {
      label: i.name,
      title: `${i.type} ${i.name}\n${i.label}\n${i.file}`,
      kind,
      itype: i.type,
      file: i.file,
      itemLabel: i.label,
    });
  });
  things.forEach((t) => {
    addNode("thing:" + t.uid, {
      label: t.label || t.uid.split(":").pop(),
      title: `${t.kind} ${t.uid}\n${t.file}`,
      kind: "thing",
      file: t.file,
      uid: t.uid,
    });
  });
  rules.forEach((r) => {
    addNode("rule:" + (r.file || "rest") + ":" + r.name, {
      label: r.name,
      title: `rule ${r.name}\n${r.file || "REST"}` + (r.cronExprs && r.cronExprs.length ? "\n" + r.cronExprs.join("\n") : ""),
      kind: "rule",
      file: r.file,
      cron: r.cron,
      cronExprs: r.cronExprs || [],
    });
  });
  sitemaps.forEach((s) => {
    addNode("sitemap:" + s.name, { label: s.name, title: `sitemap ${s.name}\n${s.file}`, kind: "sitemap", file: s.file });
  });
  const cronRules = rules.filter((r) => r.cron);
  if (cronRules.length) {
    addNode("cron:Time", {
      label: "cron",
      title: "Time cron\n" + cronRules.length + " rules",
      kind: "cron",
    });
  }
  items.forEach((i) => {
    if (i.file) addEdge("file:" + i.file, "item:" + i.name, "defines");
    i.groups.forEach((g) => addEdge("item:" + i.name, "item:" + g, "member"));
    if (i.channel) {
      let matched = null;
      things.forEach((t) => {
        if (i.channel.startsWith(t.uid) && (!matched || t.uid.length > matched.length)) matched = t.uid;
      });
      if (matched) addEdge("item:" + i.name, "thing:" + matched, "channel");
    }
  });
  things.forEach((t) => {
    if (t.file) addEdge("file:" + t.file, "thing:" + t.uid, "defines");
  });
  rules.forEach((r) => {
    const rid = "rule:" + (r.file || "rest") + ":" + r.name;
    if (r.file) addEdge("file:" + r.file, rid, "defines");
    r.triggers.forEach((n) => addEdge("item:" + n, rid, "triggers"));
    r.memberOf.forEach((n) => addEdge("item:" + n, rid, "memberTrigger"));
    if (r.cron) addEdge("cron:Time", rid, "triggers");
    r.commands.forEach((n) => addEdge(rid, "item:" + n, "commands"));
    r.reads.forEach((n) => addEdge(rid, "item:" + n, "reads"));
  });
  sitemaps.forEach((s) => {
    const sid = "sitemap:" + s.name;
    if (s.file) addEdge("file:" + s.file, sid, "defines");
    s.items.forEach((n) => addEdge(sid, "item:" + n, "shows"));
  });
  return {
    meta: {
      items: items.length,
      things: things.length,
      rules: rules.length,
      sitemaps: sitemaps.length,
      nodes: nodes.length,
      edges: edges.length,
      files: [...files].sort(),
    },
    nodes,
    edges,
  };
}

function getApiToken() {
  return (window.__dslGraphApiToken || localStorage.getItem("dsl-graph-api-token") || "").trim();
}

function setApiToken(token) {
  const t = (token || "").trim();
  window.__dslGraphApiToken = t;
  if (t) localStorage.setItem("dsl-graph-api-token", t);
  else localStorage.removeItem("dsl-graph-api-token");
}

async function restGet(path) {
  const headers = { Accept: "application/json" };
  const token = getApiToken();
  if (token) {
    headers.Authorization = "Bearer " + token;
    headers["X-OPENHAB-TOKEN"] = token;
  }
  const r = await fetch(path, {
    credentials: "same-origin",
    headers,
  });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

function cfgItemNames(mod) {
  const c = (mod && mod.configuration) || {};
  const names = [];
  ["itemName", "item", "groupName"].forEach((k) => {
    if (typeof c[k] === "string" && c[k]) names.push(c[k]);
  });
  if (Array.isArray(c.items)) names.push(...c.items.filter((x) => typeof x === "string"));
  return names;
}

function collectSitemapItems(node, into, pages) {
  if (!node) return;
  const widgets = Array.isArray(node) ? node : node.widgets || [];
  widgets.forEach((w) => {
    const it = w.item;
    if (it && typeof it === "object" && it.name) into.add(it.name);
    else if (typeof it === "string") into.add(it);
    if (w.widgets) collectSitemapItems(w, into, pages);
    const lp = w.linkedPage;
    if (lp) {
      if (lp.widgets) collectSitemapItems(lp, into, pages);
      if (lp.link && pages) pages.add(lp.link);
    }
  });
}

function restRuleToDsl(rule) {
  const triggers = [];
  const memberOf = [];
  const commands = [];
  const reads = [];
  const cronExprs = [];
  let cron = false;
  (rule.triggers || []).forEach((t) => {
    const type = t.type || "";
    const expr = t.configuration && t.configuration.cronExpression;
    if (/[Cc]ron/.test(type) || expr) {
      cron = true;
      if (expr) cronExprs.push(expr);
    }
    cfgItemNames(t).forEach((n) => {
      if (/[Gg]roup/.test(type)) memberOf.push(n);
      else triggers.push(n);
    });
  });
  (rule.actions || []).forEach((a) => {
    const type = a.type || "";
    cfgItemNames(a).forEach((n) => {
      if (/Command|Action/i.test(type)) commands.push(n);
      else commands.push(n);
    });
  });
  (rule.conditions || []).forEach((c) => {
    cfgItemNames(c).forEach((n) => reads.push(n));
  });
  return {
    name: rule.name || rule.uid,
    file: "",
    triggers: [...new Set(triggers)],
    memberOf: [...new Set(memberOf)],
    commands: [...new Set(commands)],
    reads: [...new Set(reads)],
    cron,
    cronExprs: [...new Set(cronExprs)],
  };
}

async function loadFromRest() {
  const [rawItems, rawThings, rawRules, rawSitemaps, rawLinks] = await Promise.all([
    restGet("/rest/items"),
    restGet("/rest/things"),
    restGet("/rest/rules"),
    restGet("/rest/sitemaps"),
    restGet("/rest/links"),
  ]);
  if (!rawItems) throw new Error("REST /rest/items not available");

  const items = rawItems.map((i) => ({
    name: i.name,
    type: i.type || "String",
    label: i.label || "",
    groups: i.groupNames || [],
    channel: null,
    file: "",
  }));

  const things = (rawThings || []).map((t) => ({
    uid: t.UID || t.uid,
    label: t.label || "",
    location: (t.location || "") + "",
    file: "",
    kind: t.bridgeUID ? "Thing" : "Thing",
  }));

  const itemByName = Object.fromEntries(items.map((i) => [i.name, i]));
  (rawThings || []).forEach((t) => {
    const uid = t.UID || t.uid;
    (t.channels || []).forEach((ch) => {
      const linked = ch.linkedItems || [];
      linked.forEach((name) => {
        if (itemByName[name] && !itemByName[name].channel) itemByName[name].channel = ch.uid || uid;
      });
    });
  });
  (rawLinks || []).forEach((l) => {
    const name = l.itemName;
    const ch = l.channelUID || l.channelUid;
    if (name && ch && itemByName[name]) itemByName[name].channel = ch;
  });

  const rules = (rawRules || []).map(restRuleToDsl);

  const sitemaps = [];
  for (const sm of rawSitemaps || []) {
    const names = new Set();
    const pages = new Set();
    let data = sm;
    try {
      data = (await restGet("/rest/sitemaps/" + encodeURIComponent(sm.name))) || sm;
    } catch (e) {
      data = sm;
    }
    collectSitemapItems(data.homepage || data, names, pages);
    for (const link of [...pages]) {
      try {
        const path = link.replace(/^https?:\/\/[^/]+/, "");
        const page = await restGet(path);
        if (page) collectSitemapItems(page, names, null);
      } catch (e) {}
    }
    sitemaps.push({ name: sm.name, file: "", items: [...names] });
  }

  const g = buildGraph({ items, things, rules, sitemaps });
  g.meta.rest = {
    things: !!rawThings,
    rules: !!rawRules,
    links: !!rawLinks,
    sitemaps: !!rawSitemaps,
  };
  return g;
}

async function loadFromConfigFiles() {
  const man = await fetch("src/manifest.json?t=" + Date.now()).then((r) => r.json());
  const items = [];
  const things = [];
  const rules = [];
  const sitemaps = [];
  for (const f of man.files) {
    const text = await fetch("src/" + f + "?t=" + Date.now()).then((r) => {
      if (!r.ok) throw new Error("failed " + f);
      return r.text();
    });
    const label = f.replace(/^src\//, "").replace(/\.txt$/, "");
    if (label.endsWith(".items")) items.push(...parseItems(text, label));
    else if (label.endsWith(".things")) things.push(...parseThings(text, label));
    else if (label.endsWith(".rules")) rules.push(...parseRules(text, label));
    else if (label.endsWith(".sitemap")) sitemaps.push(parseSitemaps(text, label));
  }
  return buildGraph({ items, things, rules, sitemaps });
}

function nodeCompareKey(n) {
  if (n.kind === "rule") return "rule:" + (n.label || n.id);
  return n.id;
}

function summarizeGraph(g) {
  const kinds = {};
  const etypes = {};
  const nodeKeys = {
    item: new Set(),
    group: new Set(),
    thing: new Set(),
    rule: new Set(),
    sitemap: new Set(),
    file: new Set(),
    cron: new Set(),
  };
  const allNodes = new Set();
  const idToKey = {};
  (g.nodes || []).forEach((n) => {
    kinds[n.kind] = (kinds[n.kind] || 0) + 1;
    const k = nodeCompareKey(n);
    idToKey[n.id] = k;
    allNodes.add(k);
    if (nodeKeys[n.kind]) nodeKeys[n.kind].add(k);
  });
  const edgeKeys = {};
  (g.edges || []).forEach((e) => {
    etypes[e.etype] = (etypes[e.etype] || 0) + 1;
    const k = (idToKey[e.from] || e.from) + "|" + e.etype + "|" + (idToKey[e.to] || e.to);
    if (!edgeKeys[e.etype]) edgeKeys[e.etype] = new Set();
    edgeKeys[e.etype].add(k);
  });
  const itemGroup = new Set([...nodeKeys.item, ...nodeKeys.group]);
  const ruleIo = new Set([
    ...(edgeKeys.triggers || []),
    ...(edgeKeys.commands || []),
    ...(edgeKeys.reads || []),
  ]);
  const allEdges = new Set();
  Object.values(edgeKeys).forEach((s) => s.forEach((k) => allEdges.add(k)));
  return {
    items: g.meta.items || 0,
    things: g.meta.things || 0,
    rules: g.meta.rules || 0,
    sitemaps: g.meta.sitemaps || 0,
    files: (g.meta.files || []).length,
    nodes: (g.nodes || []).length,
    edges: (g.edges || []).length,
    kinds,
    etypes,
    rest: g.meta.rest || null,
    nodeKeys,
    allNodes,
    edgeKeys,
    itemGroupKeys: itemGroup,
    ruleIoKeys: ruleIo,
    allEdges,
  };
}

async function loadDslFiles(source) {
  if (source === "files") return loadFromConfigFiles();
  return loadFromRest();
}
