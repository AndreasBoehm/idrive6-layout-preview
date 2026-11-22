// iDrive 6 layout preview: parses a plugin XML (+ optional images ZIP) and draws its hmiStates at several panel sizes.
// Plain script, no modules or fetch, so it also works when index.html is opened from file://.

const $ = (id) => document.getElementById(id);
let images = {}; // imageId -> blob url
// property ids used in the XML: x/y/width/height in design units, visible flag
const PROP = { x: 20, y: 21, w: 9, h: 10, visible: 3 };

// --- minimal ZIP reader (stored + deflate), no dependency ---
async function readZip(buf) {
  const v = new DataView(buf),
    u = new Uint8Array(buf),
    out = {};
  let e = u.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw Error("not a zip");
  let n = v.getUint16(e + 10, true),
    p = v.getUint32(e + 16, true);
  for (; n--;) {
    const method = v.getUint16(p + 10, true),
      csize = v.getUint32(p + 20, true),
      nl = v.getUint16(p + 28, true),
      xl = v.getUint16(p + 30, true),
      cl = v.getUint16(p + 32, true),
      lo = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl));
    const ds = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
    let data = u.subarray(ds, ds + csize);
    if (method === 8)
      data = new Uint8Array(
        await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer(),
      );
    else if (method !== 0) throw Error("zip method " + method + " unsupported");
    out[name] = data;
    p += 46 + nl + xl + cl;
  }
  return out;
}

// --- file inputs: images ZIP, XML file, unload ---
let zipBuf = null; // raw ZIP bytes, kept so save() can persist them
let xmlName = "",
  zipName = ""; // names of the loaded files, saved so the file inputs can show them again after a reload
// Browsers forbid setting a file input's value, but a DataTransfer can hand it a File (shows the name instead of "No file chosen").
const showFile = (input, name, data) => {
  try {
    const dt = new DataTransfer();
    dt.items.add(new File([data], name));
    input.files = dt.files;
  } catch (e) {}
};
// Images are matched by the trailing number in the file name (e.g. "foo_123.png" -> id 123).
async function loadZip(buf) {
  const z = await readZip(buf);
  zipBuf = buf;
  images = {};
  for (const [k, d] of Object.entries(z)) {
    const m = k.match(/(\d+)\.png$/i);
    if (m) images[m[1]] = URL.createObjectURL(new Blob([d], { type: "image/png" }));
  }
  render();
  catalog();
  save();
}
$("fz").onchange = async (e) => {
  const f = e.target.files[0];
  if (f) {
    zipName = f.name;
    loadZip(await f.arrayBuffer());
  }
};
$("fx").onchange = async (e) => {
  const f = e.target.files[0];
  if (f) {
    xmlName = f.name;
    $("xml").value = await f.text();
    hl();
    parse();
    save();
  }
};
$("unload").onclick = () => {
  $("xml").value = SAMPLE;
  zipBuf = null;
  xmlName = zipName = "";
  images = {};
  $("fx").value = $("fz").value = "";
  hl();
  parse();
  render();
  catalog();
  save();
};
// --- XML editor: syntax highlighting is a <pre id="hl"> behind a transparent textarea, kept in scroll sync ---
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function hl() {
  const x = $("xml"),
    h = esc(x.value).replace(
      /(&lt;!--[\s\S]*?--&gt;)|(&lt;\?[\s\S]*?\?&gt;)|(&lt;\/?)([\w:.-]+)((?:[^&>]|&amp;|"[^"]*")*?)(\/?>)/g,
      (m, c, pi, o, tag, rest, end) =>
        c
          ? `<span class="m">${c}</span>`
          : pi
            ? `<span class="p">${pi}</span>`
            : `<span class="t">${o}${tag}</span>` +
              rest.replace(/([\w:.-]+)(=)("[^"]*")/g, '<span class="a">$1</span>$2<span class="v">$3</span>') +
              `<span class="t">${end}</span>`,
    );
  $("hl").innerHTML = h + "\n";
  $("hl").scrollTop = x.scrollTop;
  $("hl").scrollLeft = x.scrollLeft;
}
$("xml").onscroll = () => {
  $("hl").scrollTop = $("xml").scrollTop;
  $("hl").scrollLeft = $("xml").scrollLeft;
};
$("xml").oninput = () => {
  hl();
  parse();
  save();
};
// --- image catalog: thumbnails of all ZIP images, optionally filtered by id or to those used in the selected state ---
async function catalog() {
  const g = $("grid");
  g.innerHTML = "";
  const q = $("catq").value.trim(),
    only = $("usedonly").checked;
  const used = new Set();
  if (doc) {
    const st = doc.querySelector(`hmiState[id="${$("state").value.split(":")[0]}"]`);
    const m = {};
    doc.querySelectorAll("imageIdModel").forEach((e) => (m[e.getAttribute("id")] = e.getAttribute("imageId")));
    st && st.querySelectorAll("image, button[imageModel]").forEach((i) => used.add(m[i.getAttribute("imageModel") || i.getAttribute("model")]));
  }
  const ids = Object.keys(images)
    .sort((a, b) => a - b)
    .filter((i) => (!q || i.includes(q)) && (!only || used.has(i)));
  $("catsum").textContent = Object.keys(images).length
    ? `Image catalog (${Object.keys(images).length} images, ${used.size} used in this state)`
    : "Image catalog (load an images ZIP)";
  for (const id of ids) {
    const d = document.createElement("div");
    d.className = "th" + (used.has(id) ? " used" : "");
    d.innerHTML = `<i><img src="${images[id]}" alt="${id}"></i>${id}<br><span class="sz">…</span>`;
    d.querySelector("img").onload = (e) =>
      (d.querySelector(".sz").textContent = `${e.target.naturalWidth}×${e.target.naturalHeight}`);
    g.append(d);
  }
}
$("catq").oninput = $("usedonly").onchange = catalog;
["zoom", "sizes"].forEach((i) => ($(i).oninput = render));
$("state").oninput = () => {
  render();
  catalog();
};
$("outlines").onchange = () => {
  $("panels").classList.toggle("outlines", $("outlines").checked);
  save();
};

// --- XML parsing and state selection ---
let doc = null; // last successfully parsed document; kept on parse errors so the preview does not go blank
function parse() {
  const d = new DOMParser().parseFromString($("xml").value, "application/xml");
  if (d.querySelector("parsererror")) {
    $("warn").textContent = "XML error: " + d.querySelector("parsererror").textContent.slice(0, 200);
    return;
  }
  doc = d;
  const sel = $("state"),
    prev = sel.value;
  sel.innerHTML = "";
  d.querySelectorAll("hmiState").forEach((s) => {
    const id = s.getAttribute("id"),
      t = s.getAttribute("text") || "";
    sel.add(new Option(`${id} ${t}`, id));
    if (s.querySelector(":scope > optionComponents > *")) sel.add(new Option(`${id} ${t} + options menu`, id + ":opt"));
  });
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  hl();
  render();
  catalog();
}

// A property may carry <condition conditionType="LAYOUTBAG"> with per-case values (conditionValue 0..3).
// Only cases 0/2 are used; what the other cases mean (e.g. split-screen) is not known yet.
// Returns {propertyId: value} for a component, with LAYOUTBAG conditions resolved.
const props = (el) => {
  const r = {};
  el.querySelectorAll(":scope > properties > property").forEach((p) => {
    let v = p.getAttribute("value");
    const c = p.querySelector(':scope > condition[conditionType="LAYOUTBAG"]');
    if (c)
      for (const w of ["0", "2"]) {
        const a = c.querySelector(`assignment[conditionValue="${w}"]`);
        if (a) {
          v = a.getAttribute("value");
          break;
        }
      }
    r[p.getAttribute("id")] = v;
  });
  return r;
};
// null = property absent (component has no absolute geometry)
const num = (p, id) => (p[id] === undefined ? null : Number(p[id]));

// HMI geometry in design units. The HMI's logical canvas is always 540 high and 540*W/H wide (1440 on 1280x480, 1440x540, 1920x720;
// 900 on 800x480), scaled uniformly by s=H/540. Verified on real screenshots: 1280x480 (cards 8/9) and 800x480 (clock right edge at
// (900-18)*8/9 = 784 px, strip edge 72 px, title line y=55 px). Chrome: title bar 63, edge strip 81, back-arrow column to 180, content 180..LW,
// Origin of content = (180,63).
function area(W, H) {
  const s = H / 540,
    LW = (540 * W) / H;
  return { x: 180 * s, y: 63 * s, w: (LW - 180) * s, h: 477 * s, s, LW };
}

// XML values are HMI design units (1440x540 space); the HMI scales them by s = min(W/1440,H/540), origin = top-left of the content area.
// Verified by measuring the repo's real 1280x480 screenshot (images/01-boostdeck.png): cards are 8/9 of their asset size.
// --- rendering: one scaled "screen" div per requested size; components are absolutely positioned divs ---
function render() {
  if (!doc) return;
  const st = doc.querySelector(`hmiState[id="${$("state").value.split(":")[0]}"]`);
  if (!st) return;
  const imgOf = {};
  doc.querySelectorAll("imageIdModel").forEach((m) => (imgOf[m.getAttribute("id")] = m.getAttribute("imageId")));
  const warns = new Set(),
    z = +$("zoom").value,
    host = $("panels");
  host.innerHTML = "";
  const sizes = $("sizes")
    .value.split(/[\s,]+/)
    .map((s) => s.match(/^(\d+)x(\d+)$/i))
    .filter(Boolean)
    .map((m) => [+m[1], +m[2]]);
  for (const [W, H] of sizes) {
    const a = area(W, H),
      pw = document.createElement("div");
    pw.className = "pw";
    const zz = Math.min(z, (host.clientWidth - 2) / W); // never wider than the column
    pw.innerHTML = `<h2>${W}×${H} — logical ${Math.round(a.LW)}×540, content ${Math.round(a.w / a.s)}×477 units</h2><div class="box" style="width:${W * zz}px;height:${H * zz}px"><div class="screen" style="width:${W}px;height:${H}px;transform:scale(${zz})"></div></div>`;
    const scr = pw.querySelector(".screen");
    // box(): absolutely positioned div in screen pixels (used for chrome); put() below takes design units instead
    const box = (cls, l, t, w, h, txt) => {
      const e = document.createElement("div");
      e.className = cls;
      Object.assign(e.style, { left: l + "px", top: t + "px", width: w + "px", height: h + "px" });
      if (txt) e.textContent = txt;
      scr.append(e);
      return e;
    };
    {
      // HMI chrome (always on, above content), measured on real HMI screenshots (bimmulator 006.027.001, 1440x540 units)
      const u = a.s,
        F = (n) => `;font-size:${n * u}px`;
      box("pagebg", 89 * u, 0, (a.LW - 89) * u, 540 * u, ""); // page background gradient
      const strip = box("chrome strip", 0, 0, 90 * u, 540 * u, "⌂");
      strip.style.cssText += F(46) + `;line-height:${62 * u}px`; // edge strip + home icon
      const tb = box("chrome tband", 90 * u, 0, 485 * u, 59 * u, "");
      tb.textContent = st.getAttribute("text") || "";
      tb.style.cssText += F(36) + `;line-height:${64 * u}px;padding-left:${28 * u}px`;
      box("chrome tline", 140 * u, 58 * u, 435 * u, 2 * u, "");
      box("chrome tline2", 575 * u, 62 * u, (a.LW - 575) * u, Math.max(1, u), ""); // thin line continuing to the right edge
      const ck = box("chrome clock", (a.LW - 210) * u, 0, 192 * u, 64 * u, "12:34");
      ck.style.cssText += F(36) + `;line-height:${64 * u}px`;
      const ar = box("chrome arrow", 90 * u, a.y, 90 * u, 477 * u, ""); // back arrow
      ar.style.backgroundImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 70'%3E%3Cpolyline points='32,4 6,35 32,66' fill='none' stroke='white' stroke-width='6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
      ar.style.backgroundSize = `${40 * u}px ${70 * u}px`;
      ar.style.backgroundPosition = `${25 * u}px center`;
    }
    const areaBox = box("area", a.x, a.y, a.w, a.h, "");
    let outN = 0;
    const put = (cls, x, y, w, h, txt, bg) => {
      const e = document.createElement("div");
      e.className = "c " + cls;
      const px = a.x + x * a.s,
        py = a.y + y * a.s,
        pwid = w * a.s,
        phei = h * a.s;
      Object.assign(e.style, { left: px + "px", top: py + "px", width: pwid + "px", height: phei + "px" });
      if (txt) e.textContent = txt;
      if (bg) {
        const im = document.createElement("img");
        im.src = bg;
        im.style.transform = `scale(${a.s})`;
        e.append(im);
      } // the HMI crops images to the box, it does not resize
      if (px < a.x - 0.5 || py < a.y - 0.5 || px + pwid > a.x + a.w + 0.5 || py + phei > a.y + a.h + 0.5) {
        e.classList.add("out");
        outN++;
      }
      scr.append(e);
      return e;
    };
    // Labels have no font property: regular label font (fontSizeRegular = 40 units). Measured in bimmulator (labs/font-lab, 1280x480):
    // a label hard-clips at its width (no "..."), CUTTYPE (37) and ALIGNMENT (17) had no visible effect, text is vertically centred, left aligned.
    const styleLabel = (e) => {
      const sp = document.createElement("span");
      sp.textContent = e.textContent;
      e.textContent = "";
      e.append(sp);
      Object.assign(e.style, {
        display: "flex",
        justifyContent: "flex-start",
        alignItems: "center",
        fontSize: 40 * a.s + "px",
        lineHeight: 1.15,
        overflow: "hidden",
      });
      sp.style.whiteSpace = "nowrap";
    };
    // <widget widgetName="LT_..."> = BMW template picked by name. Measured in bimmulator (labs/font-lab, 1280x480, cap height of "R"):
    // font in design units (40 = regular, cap 26px), colour, alignment. A FontSize binding to a text model gave ONE fixed size (36u, value ignored).
    const TPL = {
      LT_Label_ID6L_Pad_1Row_1TextCentered: { f: 36, c: "#fff", al: "center" },
      LT_Label_2Lines_1BigText: { f: 66, wrap: 1 },
      LT_TouchLabel_1Row: { f: 40, bold: 1 },
      LT_Text_TextWithIcons: { f: 40, c: "#f00" },
      LT_Label_MyV_BoardComputer_Entry: { f: 36 },
      LT_Text_Small_Unfocusable: { f: 36 },
      LT_Text_Small_Focusable: { f: 36, c: "#fff" },
      LT_Text_Small_TouchableOnly: { f: 36 },
      LT_Text_Unit_Unfocusable: { f: 32 },
      LT_Text_Unit_Focusable: { f: 32, c: "#fff" },
      LT_Text_Regular_Unfocusable: { f: 40, bold: 1 },
      LT_Text_Regular_Focusable: { f: 40, bold: 1 },
      LT_Text_Variable: { f: 40, bold: 1 },
      LT_Text_Emphasizable_Variable: { f: 40, bold: 1 },
      LT_Text_RegularSmall_Unfocusable: { f: 24 },
      LT_Label_1Text_65: { f: 30 },
      LT_Label_1Text_SuperSmall: { f: 17 },
      LT_Label_1Text: { f: 40 },
      LT_Label_Headline_Variable: { f: 40 },
      LT_Label_1Row: { f: 40 },
      LT_Label_2Row_1TextDyn: { f: 40 },
      LT_Label_3Row_1TextDyn: { f: 40 },
      LT_Label_4Row_1TextDyn: { f: 40 },
      LT_Label_5Row_1TextDyn: { f: 40 },
      LT_Label_SearchResult_Info: { f: 40 },
      LT_Label_1Text_Rating: { f: 40 },
    };
    // Widgets: look up the template's measured font/colour in TPL; unknown templates are flagged and drawn as a regular label.
    const styleWidget = (e, c) => {
      const nm = c.getAttribute("widgetName"),
        t = TPL[nm],
        bd = {};
      c.querySelectorAll(":scope > bindings > binding").forEach(
        (b) => (bd[b.getAttribute("key")] = b.getAttribute("valueModel")),
      );
      if (!t) {
        e.classList.add("out");
        warns.add(`widget ${nm}: not measured (unknown to the preview, drawn as regular label)`);
      }
      let f = t ? t.f : 40;
      if (bd.FontSize && f === 40) {
        f = 36;
        warns.add(
          `widget ${nm}: FontSize bound to model ${bd.FontSize}: the HMI used a fixed 36u for a text model whatever the value (int models ignored)`,
        );
      }
      const sp = document.createElement("span");
      sp.textContent = bd.Text ? `model ${bd.Text}` : nm;
      e.textContent = "";
      e.append(sp);
      Object.assign(e.style, {
        display: "flex",
        justifyContent: t && t.al === "center" ? "center" : "flex-start",
        alignItems: "center",
        fontSize: f * a.s + "px",
        lineHeight: 1.15,
        overflow: "hidden",
        color: (t && t.c) || "",
        fontWeight: t && t.bold ? "600" : "",
        outline: "0",
      });
      sp.style.whiteSpace = t && t.wrap ? "normal" : "nowrap";
    };
    // Main loop over the state's components: draw those with x/y/w/h, collect the rest in nat[].
    const nat = [];
    let seenBtn = 0; // the first button gets the highlighted "focused" look
    for (const c of st.querySelectorAll(":scope > components > *, :scope > optionComponents > *")) {
      const tag = c.tagName,
        id = c.getAttribute("id"),
        p = props(c);
      if (c.parentElement.tagName === "optionComponents") continue; // option menu is native, not on the canvas
      if (p[PROP.visible] === "false") continue;
      const x = num(p, PROP.x),
        y = num(p, PROP.y),
        w = num(p, PROP.w),
        h = num(p, PROP.h);
      if ([x, y, w, h].includes(null)) {
        // a label with only a runtime text model is not drawn: the real list shows no row for it
        if (tag === "label" && !c.getAttribute("text")) continue;
        nat.push({
          btn: tag === "button" || tag === "radiobutton",
          lbl: tag === "label",
          radio: tag === "radiobutton",
          t:
            c.getAttribute("text") ||
            (c.getAttribute("textModel") ? `(runtime text, model ${c.getAttribute("textModel")})` : "") ||
            (c.getAttribute("model") ? `(runtime text, model ${c.getAttribute("model")})` : `${tag} ${id}`),
        });
        continue;
      }
      if (tag === "widget") {
        const e = put("label rt", x, y, w, h, "", null);
        styleWidget(e, c);
      } else if (tag === "image" || (tag === "button" && c.hasAttribute("imageModel"))) {
        // image buttons draw their picture (imageModel) instead of text
        const iid = imgOf[c.getAttribute(tag === "image" ? "model" : "imageModel")],
          u = images[iid];
        put("image" + (u ? "" : " missing"), x, y, w, h, u ? "" : `#${iid ?? "?"}`, u);
      } else if (tag === "label" && !c.getAttribute("text")) {
        // runtime text: small muted placeholder sized to its box
        const e = put("label rt", x, y, w, h, `model ${c.getAttribute("model") || "?"}`, null);
        styleLabel(e);
      } else {
        const e = put(
          tag === "label" ? "label" : "button" + (tag === "button" && !seenBtn++ ? " first" : ""),
          x,
          y,
          w,
          h,
          c.getAttribute("text") || `${tag} ${id}`,
          null,
        );
        if (tag === "label") styleLabel(e);
      }
    }
    if (nat.length) {
      // no geometry: the HMI lays these out natively; show stacked placeholders
      warns.add(
        `${nat.length} component(s) without geometry are placed by the HMI (shown as a placeholder list, real positions differ)`,
      );
      const fi = nat.findIndex((n) => n.btn);
      // scrollable list: rows keep the native 78u pitch, the HMI list scrolls when they do not fit
      const lst = document.createElement("div");
      lst.className = "natlist";
      Object.assign(lst.style, {
        left: a.x + "px",
        top: a.y + "px",
        width: Math.min(693 * a.s, a.w) + "px",
        height: a.h + "px",
      });
      nat.forEach((n, i) => {
        const e = document.createElement("div");
        e.className = "c native" + (i === fi ? " first" : "") + (n.lbl ? " title" : "") + (n.radio ? " radio" + (i === fi ? " sel" : "") : "");
        Object.assign(e.style, {
          left: 0,
          top: (17 + i * 78) * a.s + "px",
          width: "100%",
          height: 54 * a.s + "px",
          fontSize: 40 * a.s + "px",
          paddingLeft: (n.radio ? 76 : 20) * a.s + "px",
        });
        e.textContent = n.t;
        lst.append(e);
      });
      const end = document.createElement("div"); // spacer: the last row's bottom margin counts towards the scroll height
      Object.assign(end.style, { position: "absolute", top: (17 + nat.length * 78) * a.s + "px", height: "1px", width: "1px" });
      lst.append(end);
      scr.append(lst);
    }
    if ($("state").value.endsWith(":opt")) {
      // option menu: native list of optionComponents, slides in over the left side
      const oc = [...st.querySelectorAll(":scope > optionComponents > *")];
      const m = document.createElement("div");
      m.className = "optmenu";
      Object.assign(m.style, {
        left: a.x + "px",
        top: a.y + "px",
        bottom: "auto",
        height: a.h + "px",
        width: Math.round(Math.min(693 * a.s, a.w)) + "px",
      });
      if (!oc.length) warns.add("state has no optionComponents");
      oc.forEach((c, i) => {
        const e = document.createElement("div");
        e.className = "c native" + (i === 0 ? " first" : "");
        Object.assign(e.style, {
          top: (17 + i * 78) * a.s + "px",
          height: 54 * a.s + "px",
          fontSize: 40 * a.s + "px",
          lineHeight: 54 * a.s + "px",
          paddingLeft: 20 * a.s + "px",
        });
        e.textContent = c.getAttribute("text") || `${c.tagName} ${c.getAttribute("id")}`;
        m.append(e);
      });
      scr.append(m);
    }
    // layoutGroups (assumed to position native slots inside the content area)
    for (const g of st.querySelectorAll(":scope > layoutGroups > layoutGroup")) {
      const n = g.getAttribute("name"),
        A = (k) => (g.hasAttribute(k) ? Number(g.getAttribute(k)) : null);
      const ok = {
        Matrix: ["elementWidth", "elementHeight", "elementSpacingX", "elementSpacingY"],
        Bar: ["elementWidth", "elementSpacingX"],
        List: ["elementHeight", "elementSpacingY"],
      }[n];
      if (!ok) {
        warns.add(`layoutGroup name '${n}' invalid (Matrix|Bar|List)`);
        continue;
      }
      for (const k of ["elementWidth", "elementHeight", "elementSpacingX", "elementSpacingY"])
        if (g.hasAttribute(k) && !ok.includes(k)) warns.add(`layoutGroup ${n}: ${k} not supported for this slot`);
      if (n === "Matrix" && (A("elementWidth") === 0 || A("elementHeight") === 0))
        warns.add("layoutGroup Matrix: cell size must not be 0");
      if (A("alignmentX") !== null && ![0, 3, 4].includes(A("alignmentX")))
        warns.add(`layoutGroup ${n}: alignmentX ${A("alignmentX")} ignored (accepted 0,3,4)`);
      if (A("alignmentY") !== null && ![1, 3, 5].includes(A("alignmentY")))
        warns.add(`layoutGroup ${n}: alignmentY ${A("alignmentY")} ignored (accepted 1,3,5)`);
      put(
        "group",
        A("offsetX") ?? 0,
        A("offsetY") ?? 0,
        A("width") ?? a.w / a.s,
        A("height") ?? a.h / a.s,
        `${n} group`,
        null,
      );
    }
    if (outN) areaBox.classList.add("over");
    if (outN) warns.add(`${W}×${H}: ${outN} component(s) extend outside the content area (covered by the chrome)`);
    host.append(pw);
  }
  $("warn").textContent = [...warns].join("\n");
}

// --- persistence (IndexedDB: XML, images ZIP, settings) so a reload restores the session ---
const IDS = ["sizes", "zoom"]; // plain inputs saved by value; checkboxes and the editor size are handled in save()
$("panels").classList.add("hmi"); // always the HMI look; "Show outlines" only adds boxes on top
const idb = () =>
  new Promise((ok, no) => {
    const r = indexedDB.open("idrive6-layout-preview", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("s");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
let t;
// Debounced (300 ms). Failures (private mode, quota) are ignored: persistence is a convenience only.
function save() {
  clearTimeout(t);
  t = setTimeout(async () => {
    try {
      const st = {
        xml: $("xml").value,
        zip: zipBuf,
        xmlName,
        zipName,
        v: 12,
        outlines: $("outlines").checked,
        state: $("state").value,
        w: $("ed").style.height,
        ew: $("ed").style.width,
      };
      IDS.forEach((i) => (st[i] = $(i).value));
      (await idb()).transaction("s", "readwrite").objectStore("s").put(st, "last");
    } catch (e) {}
  }, 300);
}
["zoom", "sizes", "state"].forEach((i) => $(i).addEventListener("input", save));
new ResizeObserver(() => {
  document.querySelector("main").style.gridTemplateColumns = innerWidth > 900 ? $("ed").offsetWidth + "px 1fr" : "";
  save();
}).observe($("ed"));

const SAMPLE = `<?xml version='1.0' encoding='utf-8'?>
<pluginApps>
  <pluginApp text="Sample">
    <hmiStates>
      <hmiState id="100" text="Sample (built-in)">
        <components>
          <label id="1"><properties><property id="20" value="40"/><property id="21" value="20"/><property id="9" value="400"/><property id="10" value="40"/></properties></label>
          <button id="2" text="Button"><properties><property id="20" value="40"/><property id="21" value="100"/><property id="9" value="300"/><property id="10" value="60"/></properties></button>
          <label id="4" text="Long caption (clipped at the box width, as on the HMI)"><properties><property id="20" value="440"/><property id="21" value="20"/><property id="9" value="300"/><property id="10" value="50"/></properties></label>
          <label id="5" text="Long caption with CUTTYPE=DOTS (no effect on the HMI)"><properties><property id="20" value="440"/><property id="21" value="80"/><property id="9" value="300"/><property id="10" value="50"/><property id="37" value="0"/></properties></label>
          <button id="6" text="LAYOUTBAG: x=40 (case 0)"><properties><property id="20" value="40"><condition conditionType="LAYOUTBAG"><assignments><assignment conditionValue="0" value="40"/><assignment conditionValue="1" value="300"/></assignments></condition></property><property id="21" value="200"/><property id="9" value="300"/><property id="10" value="60"/></properties></button>
          <button id="3" text="Right edge"><properties><property id="20" value="900"/><property id="21" value="380"/><property id="9" value="340"/><property id="10" value="80"/></properties></button>
        </components>
        <layoutGroups>
          <layoutGroup name="Matrix" offsetX="440" offsetY="100" width="400" height="240" elementWidth="120" elementHeight="70"/>
        </layoutGroups>
      </hmiState>
    </hmiStates>
  </pluginApp>
</pluginApps>`;
// --- startup: restore the last session from IndexedDB, else show the built-in sample ---
(async () => {
  let st = null;
  try {
    st = await new Promise(async (ok, no) => {
      const r = (await idb()).transaction("s").objectStore("s").get("last");
      r.onsuccess = () => ok(r.result);
      r.onerror = no;
    });
  } catch (e) {}
  if (st) {
    IDS.forEach((i) => st[i] !== undefined && ($(i).value = st[i]));
    if (st.outlines !== undefined) {
      $("outlines").checked = st.outlines;
      $("panels").classList.toggle("outlines", st.outlines);
    }
    if (st.w) $("ed").style.height = st.w;
    if (st.ew) $("ed").style.width = st.ew;
  }
  $("xml").value = (st && st.xml) || SAMPLE;
  if (st && st.xml && st.xmlName) {
    xmlName = st.xmlName;
    showFile($("fx"), xmlName, st.xml);
  }
  hl();
  parse();
  if (st && st.state && [...$("state").options].some((o) => o.value === st.state)) {
    $("state").value = st.state;
    render();
    catalog();
  }
  if (st && st.zip) {
    try {
      zipName = st.zipName || "";
      await loadZip(st.zip);
      if (zipName) showFile($("fz"), zipName, st.zip);
    } catch (e) {}
  }
})();
