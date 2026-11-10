// Página del cliente: entra con su código, elige fotos por cuadro, las recorta
// a la forma de cada cuadro y manda las 2 hojas ya armadas para aprobación.

const $ = id => document.getElementById(id);
const el = Comun.el;

let codigo = null;      // el que puso al entrar
let info = null;        // respuesta de /api/estado
let lay = null;         // layout del mundo (espacios con su hoja y rectángulo)
const elegidas = {};    // id -> { img, z, cx, cy }
let pendientes = null;  // hojas del envío que espera revisión: [url0, url1], o null
let enRevision = [];    // cuadros de ese envío
let publicadas = null;  // hojas de lo último aprobado (copia del servidor, sin esperar a GitHub)

// ------------------------------------------------------------ entrar / salir

$("fEntrada").addEventListener("submit", async ev => {
  ev.preventDefault();
  const c = $("codigo").value.trim();
  if (c.length < 4) return mostrarError("Escribe el código completo.");
  const b = $("fEntrada").querySelector("button[type=submit]");
  if (b.disabled) return;
  b.disabled = true;
  try { await entrar(c); } finally { b.disabled = false; }
});
$("ver").addEventListener("click", () => {
  const i = $("codigo"), ver = i.type === "password";
  i.type = ver ? "text" : "password"; $("ver").textContent = ver ? "Ocultar" : "Ver"; i.focus();
});
$("salir").addEventListener("click", () => { Comun.guardar("codigo", null); location.reload(); });

// Mensaje en la página (sin ventanas emergentes, que algunos navegadores bloquean).
function avisar(t) {
  const d = el("div", { class: "aviso mal" }, t);
  $("estado").prepend(d);
  d.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => d.remove(), 12000);
}

function mostrarError(t) { const e = $("errEntrada"); e.textContent = t; e.classList.remove("oculto"); }

async function entrar(c, silencioso) {
  try {
    const r = await fetch("/api/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo: c }) });
    const d = await r.json();
    if (!r.ok) { if (!silencioso) mostrarError(d.error || "No se pudo entrar"); Comun.guardar("codigo", null); return; }
    if (d.admin) {   // era la clave del panel
      $("codigo").value = "";
      Comun.guardar("codigo", null); Comun.guardar("clave", c);
      location.href = "/admin";
      return;
    }
    $("codigo").value = "";
    codigo = c; info = d;
    Comun.guardar("codigo", c);
    lay = await Comun.datos(info.mundo);
    $("vEntrada").classList.add("oculto");
    $("vPerfil").classList.remove("oculto");
    $("barra").classList.remove("oculto");
    await cargarPendientes();
    pintarEstado(); pintarPlano(); pintarEspacios(); actualizarCuenta();
  } catch (e) { mostrarError("No hay conexión con el servidor. Intenta otra vez."); }
}

async function refrescar() {
  const r = await fetch("/api/estado", { headers: { "x-codigo": codigo } });
  if (r.ok) { info = await r.json(); await cargarPendientes(); pintarEstado(); pintarPlano(); pintarEspacios(); }
}

/** Si hay un envío esperando revisión, baja sus hojas para mostrar qué foto quedó en cada cuadro. */
async function cargarPendientes() {
  // lo aprobado: copia del servidor; si no hay (perfiles viejos), se usa GitHub Pages
  if (publicadas) publicadas.forEach(u => URL.revokeObjectURL(u));
  publicadas = null;
  if (info.publicado) {
    try {
      const urls = [];
      for (let h = 0; h < lay.hojas; h++) {
        const r = await fetch(`/api/publicada/${h}`, { headers: { "x-codigo": codigo } });
        if (!r.ok) { urls.forEach(u => URL.revokeObjectURL(u)); urls.length = 0; break; }
        urls.push(URL.createObjectURL(await r.blob()));
      }
      if (urls.length === lay.hojas) publicadas = urls;
    } catch (e) { publicadas = null; }
  }
  if (pendientes) pendientes.forEach(u => URL.revokeObjectURL(u));
  pendientes = null; enRevision = [];
  const u = info.ultimo;
  if (!u || u.estado !== "pendiente") return;
  try {
    const urls = [];
    for (let h = 0; h < lay.hojas; h++) {
      const r = await fetch(`/api/envio/hoja/${h}`, { headers: { "x-codigo": codigo } });
      if (!r.ok) return;
      urls.push(URL.createObjectURL(await r.blob()));
    }
    pendientes = urls; enRevision = u.espacios.slice();
  } catch (e) { pendientes = null; enRevision = []; }
}

// ------------------------------------------------------------ estado del último envío

function pintarEstado() {
  const u = info.ultimo, caja = $("estado");
  caja.innerHTML = "";
  const partes = [];
  if (u && u.estado === "pendiente")
    partes.push(el("div", { class: "aviso espera" },
      `Tus fotos del ${Comun.fecha(u.creado)} están esperando revisión: ${u.espacios.length === 1 ? "cuadro" : "cuadros"} ${u.espacios.join(", ")}. `,
      el("span", { class: "chico apagado" }, "Si cambias otros cuadros, se suman a este envío.")));
  else if (u && u.estado === "aprobado") {
    const no = u.rechazados || [], si = u.espacios.filter(n => !no.includes(n));
    partes.push(el("div", { class: "aviso bien" }, no.length
      ? `Se aprobaron ${si.length === 1 ? "el cuadro" : "los cuadros"} ${si.join(", ")} el ${Comun.fecha(u.revisado)}. Ya salen en las instancias nuevas que abras con tu código.`
      : `Tus fotos se aprobaron el ${Comun.fecha(u.revisado)}. Ya salen en las instancias nuevas que abras con tu código.`));
    if (no.length) partes.push(el("div", { class: "aviso mal" },
      `No se aprobó${no.length === 1 ? " el cuadro" : "n los cuadros"} ${no.join(", ")}: ${no.length === 1 ? "se queda como estaba" : "se quedan como estaban"}.`,
      u.nota ? el("div", {}, el("b", {}, "Motivo: "), u.nota) : null,
      el("div", { class: "chico apagado" }, "Puedes mandar otras fotos para esos cuadros.")));
  }
  else if (u && u.estado === "rechazado")
    partes.push(el("div", { class: "aviso mal" }, `Tus fotos del ${Comun.fecha(u.creado)} no se aprobaron.`, u.nota ? el("div", {}, el("b", {}, "Motivo: "), u.nota) : null, el("div", { class: "chico apagado" }, "Puedes mandar otras.")));
  if (info.vence) partes.push(el("div", { class: "chico apagado", style: "text-align:center; margin-bottom:8px" }, `Tu perfil está activo hasta el ${Comun.fecha(info.vence)}.`));
  caja.append(...partes);
}

// ------------------------------------------------------------ plano y cuadros

function pintarPlano() {
  const p = $("plano"); p.innerHTML = "";
  p.append(el("img", { src: lay.plano, alt: "Plano del club" }));
  for (const e of lay.espacios)
    p.append(el("button", {
      class: "punto" + (elegidas[e.id] ? " lista" : enRevision.includes(e.id) ? " espera" : ""), type: "button",
      title: "Cuadro " + e.id + (elegidas[e.id] ? " · foto nueva" : enRevision.includes(e.id) ? " · esperando revisión" : ""),
      style: `left:${e.u * 100}%; top:${e.v * 100}%`,
      onclick: () => document.getElementById("esp" + e.id).scrollIntoView({ behavior: "smooth", block: "center" }),
    }, String(e.id)));
}

function urlHoja(h) { return publicadas ? publicadas[h] : `${info.hojas}${h}.jpg?v=${encodeURIComponent(info.publicado || "")}`; }

/** Este cuadro tiene una foto aprobada (ya está en el mapa). */
function aprobada(id) {
  return !!info.publicado && (info.aprobados || []).includes(id);
}

function forma(e) {
  const r = e.w / e.h;
  return r > 1.15 ? "horizontal" : r < 0.87 ? "vertical" : "cuadrado";
}

/** Proporción con números chicos: 0.667 -> "2:3", 1.778 -> "16:9", 1.879 -> "15:8". */
function proporcion(r) {
  let mejor = null;
  for (let q = 1; q <= 16; q++) {
    const p = Math.round(r * q), err = Math.abs(p / q - r) / r;
    if (p > 0 && (!mejor || err < mejor.err - 0.004)) mejor = { p, q, err };
    if (mejor && mejor.err < 0.005) break;
  }
  return mejor;
}

/** Un ejemplo de tamaño con esa forma (el lado largo en unos 1500 px) y lo mínimo para que no se vea borrosa. */
function formato(e) {
  const r = e.w / e.h, { p, q } = proporcion(r);
  const k = p === 16 && q === 9 ? 120 : Math.ceil(1500 / Math.max(p, q));   // 16:9 -> 1920 x 1080
  const w = p * k, h = q * k;
  const f = forma(e);
  return {
    texto: `${f === "cuadrado" ? "Cuadrada" : f[0].toUpperCase() + f.slice(1)} ${p}:${q}`,
    ejemplo: `por ejemplo ${w} × ${h} px`,
    minimo: `mínimo ${e.w} × ${e.h} px`,
  };
}

function pintarEspacios() {
  const g = $("rejilla"); g.innerHTML = "";
  for (const e of lay.espacios) g.append(tarjeta(e));
}

function tarjeta(e) {
  const sel = elegidas[e.id];
  const vista = el("div", { class: "vista" });
  const espera = !sel && pendientes && enRevision.includes(e.id);
  if (sel) vista.append(previa(e, sel));
  else if (espera) vista.append(Comun.recorte(pendientes[e.hoja], e, lay.tam, 200, 330));
  else if (aprobada(e.id)) vista.append(Comun.recorte(urlHoja(e.hoja), e, lay.tam, 200, 330));
  else vista.append(el("div", { class: "vacio" }, "Todavía sin foto. Si lo dejas así, se verá con el logo del club."));
  const yaEnMapa = aprobada(e.id);
  const rechazada = !sel && !espera && noAprobado(e.id);
  const nota = sel && yaEnMapa ? "Este cuadro ya tiene una foto en el mapa. Si aprueban la nueva, la reemplaza; si no, se queda la de ahora."
    : rechazada && yaEnMapa ? "La última foto que mandaste para este cuadro no se aprobó. Se quedó esta, que ya está en el mapa."
    : !sel && !espera && yaEnMapa ? "Esta foto ya está en el mapa. Si mandas otra para este cuadro y se aprueba, la reemplaza."
    : null;

  const t = el("article", { class: "espacio" + (sel ? " lista" : espera ? " espera" : ""), id: "esp" + e.id },
    el("div", { class: "cab" },
      el("span", { class: "num" }, String(e.id)),
      sel ? el("span", { class: "etiqueta nueva" }, "Nueva")
        : espera ? el("span", { class: "etiqueta espera" }, "Esperando revisión")
        : yaEnMapa ? el("span", { class: "etiqueta si" }, "Aprobada · en el mapa")
        : rechazada ? el("span", { class: "etiqueta no" }, "No aprobada")
        : null),   // la forma va en su propia fila, debajo
    filaFormato(e),
    vista,
    nota ? el("div", { class: "nota-cuadro" }, nota) : null,
    el("div", { class: "lugar" },
      el("img", { src: "/" + e.foto, alt: "Dónde está el cuadro " + e.id, onclick: () => verGrande("/" + e.foto) }),
      el("span", {}, "Así se ve hoy en el club (sin perfil)")),
    el("div", { class: "acciones" },
      el("button", { type: "button", onclick: () => elegir(e) }, sel || yaEnMapa ? "Cambiar foto" : "Elegir foto"),
      sel ? el("button", { type: "button", onclick: () => abrirEditor(e, sel.img, sel) }, "Ajustar") : null,
      sel ? el("button", { type: "button", class: "peligro", onclick: () => { delete elegidas[e.id]; refrescarTarjeta(e); } }, "Quitar") : null));

  // arrastrar una foto encima
  t.addEventListener("dragover", ev => { ev.preventDefault(); t.classList.add("arrastre"); });
  t.addEventListener("dragleave", () => t.classList.remove("arrastre"));
  t.addEventListener("drop", ev => {
    ev.preventDefault(); t.classList.remove("arrastre");
    const f = [...(ev.dataTransfer.files || [])].find(f => f.type.startsWith("image/"));
    if (f) cargarArchivo(e, f);
  });
  return t;
}

/** La forma del cuadro, siempre a la vista: un dibujito con su proporción y los tamaños. */
function filaFormato(e) {
  const f = formato(e), r = e.w / e.h, k = 22 / Math.max(r, 1);
  const icono = el("span", { class: "icono-forma", "aria-hidden": "true" });
  icono.style.width = Math.round(k * r) + "px"; icono.style.height = Math.round(k) + "px";
  return el("div", { class: "formato", title: "Si tu foto tiene otra forma, lo que no cabe se recorta" },
    icono,
    el("span", {}, el("b", {}, f.texto), " · ", f.ejemplo, el("span", { class: "apagado" }, ` (${f.minimo})`)));
}

/** El último envío revisado no aprobó este cuadro. */
function noAprobado(id) {
  const u = info.ultimo;
  if (!u) return false;
  if (u.estado === "rechazado") return u.espacios.includes(id);
  if (u.estado === "aprobado") return (u.rechazados || []).includes(id);
  return false;
}

function refrescarTarjeta(e) {
  document.getElementById("esp" + e.id).replaceWith(tarjeta(e));
  pintarPlano(); actualizarCuenta();
}

function previa(e, sel) {
  const c = el("canvas"); c.width = e.w; c.height = e.h;
  const alto = Math.min(200, 330 * e.h / e.w);
  c.style.height = Math.round(alto) + "px"; c.style.width = Math.round(alto * e.w / e.h) + "px";
  dibujar(c.getContext("2d"), e.w, e.h, sel);
  return c;
}

function verGrande(src) {
  const v = $("veloFoto"); v.querySelector("img").src = src; v.classList.remove("oculto");
  v.onclick = () => v.classList.add("oculto");
}

function actualizarCuenta() {
  const n = Object.keys(elegidas).length;
  $("cuenta").textContent = n === 1 ? "1 foto" : n + " fotos";
  $("cuentaNota").textContent = n ? "listas para enviar" : "elige al menos una";
  $("enviar").disabled = n === 0;
}

// ------------------------------------------------------------ elegir y recortar

let _destino = null;
function elegir(e) { _destino = e; $("archivo").value = ""; $("archivo").click(); }
$("archivo").addEventListener("change", () => { const f = $("archivo").files[0]; if (f && _destino) cargarArchivo(_destino, f); });

async function cargarArchivo(e, f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return avisar("Usa una foto JPG, PNG o WEBP.");
  const url = URL.createObjectURL(f);
  const img = await Comun.imagen(url);
  if (!img) return avisar("No pude abrir esa foto. Prueba con otra (JPG o PNG).");
  abrirEditor(e, img, null);
}

/** Dibuja la foto cubriendo un marco W x H con su zoom y centro. */
function dibujar(ctx, W, H, s) {
  const iw = s.img.naturalWidth, ih = s.img.naturalHeight;
  const k = Math.max(W / iw, H / ih) * s.z;
  const mx = W / (2 * k), my = H / (2 * k);
  s.cx = Math.min(Math.max(s.cx, mx), iw - mx);
  s.cy = Math.min(Math.max(s.cy, my), ih - my);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(s.img, W / 2 - s.cx * k, H / 2 - s.cy * k, iw * k, ih * k);
}

let ed = null;   // { e, s }
function abrirEditor(e, img, previo) {
  const s = previo ? { ...previo } : { img, z: 1, cx: img.naturalWidth / 2, cy: img.naturalHeight / 2 };
  ed = { e, s };
  const c = $("edLienzo"); c.width = e.w; c.height = e.h;
  $("edTitulo").textContent = `Cuadro ${e.id} · ${formato(e).texto}`;
  // si la foto tiene otra forma, avisar qué se va a recortar
  const rf = img.naturalWidth / img.naturalHeight, rc = e.w / e.h, dif = rf / rc;
  const av = $("edAviso");
  if (dif > 1.12 || dif < 0.89) {
    const ff = rf > 1.15 ? "horizontal" : rf < 0.87 ? "vertical" : "cuadrada";
    av.textContent = `Tu foto es ${ff} y este cuadro es ${formato(e).texto.toLowerCase()}: se van a recortar ${dif > 1 ? "los lados" : "arriba y abajo"}. ` +
      `Mueve la foto para elegir qué parte se ve, o manda una con forma ${proporcion(rc).p}:${proporcion(rc).q} para que salga completa.`;
    av.classList.remove("oculto");
  } else av.classList.add("oculto");
  $("edZoom").value = s.z;
  $("velo").classList.remove("oculto");
  pintarEditor();
}
function pintarEditor() { dibujar($("edLienzo").getContext("2d"), ed.e.w, ed.e.h, ed.s); }

$("edZoom").addEventListener("input", () => { ed.s.z = +$("edZoom").value; pintarEditor(); });
$("edCancelar").addEventListener("click", () => { $("velo").classList.add("oculto"); ed = null; });
$("edListo").addEventListener("click", () => {
  elegidas[ed.e.id] = ed.s;
  $("velo").classList.add("oculto");
  const e = ed.e; ed = null; refrescarTarjeta(e);
});
$("edLienzo").addEventListener("wheel", ev => {
  ev.preventDefault();
  ed.s.z = Math.min(4, Math.max(1, ed.s.z * Math.exp(-ev.deltaY * 0.0015)));
  $("edZoom").value = ed.s.z; pintarEditor();
}, { passive: false });

// mover con el dedo o el ratón; pellizcar para acercar
const toques = new Map();
let pellizco = 0;
const lienzo = $("edLienzo");
lienzo.addEventListener("pointerdown", ev => { lienzo.setPointerCapture(ev.pointerId); toques.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); pellizco = 0; });
lienzo.addEventListener("pointerup", ev => { toques.delete(ev.pointerId); pellizco = 0; });
lienzo.addEventListener("pointercancel", ev => { toques.delete(ev.pointerId); pellizco = 0; });
lienzo.addEventListener("pointermove", ev => {
  if (!ed || !toques.has(ev.pointerId)) return;
  const antes = toques.get(ev.pointerId);
  toques.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const r = lienzo.getBoundingClientRect();
  if (toques.size === 2) {
    const [a, b] = [...toques.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pellizco) { ed.s.z = Math.min(4, Math.max(1, ed.s.z * d / pellizco)); $("edZoom").value = ed.s.z; }
    pellizco = d; pintarEditor(); return;
  }
  const iw = ed.s.img.naturalWidth, ih = ed.s.img.naturalHeight;
  const k = Math.max(ed.e.w / iw, ed.e.h / ih) * ed.s.z * (r.width / lienzo.width);
  ed.s.cx -= (ev.clientX - antes.x) / k;
  ed.s.cy -= (ev.clientY - antes.y) / k;
  pintarEditor();
});

// ------------------------------------------------------------ armar las hojas y enviar

async function armarHoja(h) {
  const c = document.createElement("canvas"); c.width = c.height = lay.tam;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, lay.tam, lay.tam);
  const enHoja = lay.espacios.filter(e => e.hoja === h);
  if (pendientes) {
    // hay un envío esperando revisión: se parte de él, así sus fotos no se pierden
    const base = await Comun.imagen(pendientes[h]);
    if (!base) throw new Error("No pude cargar las fotos que tienes en revisión. Recarga la página e intenta otra vez.");
    ctx.drawImage(base, 0, 0, lay.tam, lay.tam);
  } else if (info.publicado) {
    // lo que no cambia se queda como está ahora (la copia del servidor, o GitHub si no hay)
    const base = await Comun.imagen(publicadas ? publicadas[h] : `${info.hojas}${h}.jpg?t=${Date.now()}`, !publicadas);
    if (!base) throw new Error("No pude cargar tus fotos actuales para conservar las que no cambias. Intenta otra vez en un momento.");
    ctx.drawImage(base, 0, 0, lay.tam, lay.tam);
  } else {
    for (const e of enHoja) Comun.relleno(ctx, e);
  }
  for (const e of enHoja) {
    const s = elegidas[e.id]; if (!s) continue;
    const t = document.createElement("canvas"); t.width = e.w; t.height = e.h;
    dibujar(t.getContext("2d"), e.w, e.h, s);
    ctx.drawImage(t, e.x, e.y);
  }
  return Comun.jpeg(c);
}

$("enviar").addEventListener("click", async () => {
  const ids = Object.keys(elegidas).map(Number).sort((a, b) => a - b);
  if (!ids.length) return;
  const b = $("enviar"); b.disabled = true; b.textContent = "Preparando...";
  try {
    // lo último del servidor (quizá ya aprobaron o rechazaron algo mientras la página estaba abierta)
    await refrescar();
    await document.fonts.ready;
    const f = new FormData();
    f.append("espacios", JSON.stringify([...new Set([...ids, ...enRevision])].sort((a, b) => a - b)));
    for (let h = 0; h < lay.hojas; h++) f.append("hoja" + h, await armarHoja(h), `hoja${h}.jpg`);
    b.textContent = "Enviando...";
    const r = await fetch("/api/envio", { method: "POST", headers: { "x-codigo": codigo }, body: f });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "No se pudo enviar");
    for (const k of ids) delete elegidas[k];
    await refrescar(); pintarPlano(); actualizarCuenta();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    avisar(e.message);
  } finally {
    b.textContent = "Enviar para aprobación"; actualizarCuenta();
  }
});

// si ya había entrado en esta pestaña
const guardado = Comun.leer("codigo");
if (guardado) entrar(guardado, true);
