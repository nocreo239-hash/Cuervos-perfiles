// Página del cliente: entra con su código, elige fotos por cuadro, las recorta
// a la forma de cada cuadro y manda las 2 hojas ya armadas para aprobación.

const $ = id => document.getElementById(id);
const el = Comun.el;

let codigo = null;      // el que puso al entrar
let info = null;        // respuesta de /api/estado
let lay = null;         // layout del mundo (espacios con su hoja y rectángulo)
const elegidas = {};    // id -> { img, z, cx, cy }

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
    pintarEstado(); pintarPlano(); pintarEspacios(); actualizarCuenta();
  } catch (e) { mostrarError("No hay conexión con el servidor. Intenta otra vez."); }
}

async function refrescar() {
  const r = await fetch("/api/estado", { headers: { "x-codigo": codigo } });
  if (r.ok) { info = await r.json(); pintarEstado(); pintarEspacios(); }
}

// ------------------------------------------------------------ estado del último envío

function pintarEstado() {
  const u = info.ultimo, caja = $("estado");
  caja.innerHTML = "";
  const partes = [];
  if (u && u.estado === "pendiente")
    partes.push(el("div", { class: "aviso espera" }, `Tus fotos del ${Comun.fecha(u.creado)} están esperando aprobación. Si mandas otras, reemplazan a esas.`));
  else if (u && u.estado === "aprobado")
    partes.push(el("div", { class: "aviso bien" }, `Tus fotos se aprobaron el ${Comun.fecha(u.revisado)}. Ya salen en las instancias nuevas que abras con tu código.`));
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
      class: "punto" + (elegidas[e.id] ? " lista" : ""), type: "button", title: "Cuadro " + e.id,
      style: `left:${e.u * 100}%; top:${e.v * 100}%`,
      onclick: () => document.getElementById("esp" + e.id).scrollIntoView({ behavior: "smooth", block: "center" }),
    }, String(e.id)));
}

function urlHoja(h) { return `${info.hojas}${h}.jpg?v=${encodeURIComponent(info.publicado || "")}`; }

function forma(e) {
  const r = e.w / e.h;
  return r > 1.15 ? "horizontal" : r < 0.87 ? "vertical" : "cuadrado";
}

function pintarEspacios() {
  const g = $("rejilla"); g.innerHTML = "";
  for (const e of lay.espacios) g.append(tarjeta(e));
}

function tarjeta(e) {
  const sel = elegidas[e.id];
  const vista = el("div", { class: "vista" });
  if (sel) vista.append(previa(e, sel));
  else if (info.publicado) vista.append(Comun.recorte(urlHoja(e.hoja), e, lay.tam, 200, 330));
  else vista.append(el("div", { class: "vacio" }, "Todavía sin foto. Si lo dejas así, se verá con el logo del club."));

  const t = el("article", { class: "espacio" + (sel ? " lista" : ""), id: "esp" + e.id },
    el("div", { class: "cab" },
      el("span", { class: "num" }, String(e.id)),
      sel ? el("span", { class: "etiqueta nueva" }, "Nueva") : el("span", { class: "forma" }, forma(e) + (info.publicado ? " · la de ahora" : ""))),
    vista,
    el("div", { class: "lugar" },
      el("img", { src: "/" + e.foto, alt: "Dónde está el cuadro " + e.id, onclick: () => verGrande("/" + e.foto) }),
      el("span", {}, "Así se ve hoy en el club (sin perfil)")),
    el("div", { class: "acciones" },
      el("button", { type: "button", onclick: () => elegir(e) }, sel ? "Cambiar foto" : "Elegir foto"),
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
  $("edTitulo").textContent = "Cuadro " + e.id;
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

function relleno(ctx, e) {
  const g = ctx.createLinearGradient(e.x, e.y, e.x, e.y + e.h);
  g.addColorStop(0, "#1b1016"); g.addColorStop(1, "#0b080a");
  ctx.fillStyle = g; ctx.fillRect(e.x, e.y, e.w, e.h);
  ctx.strokeStyle = "#5a4227"; ctx.lineWidth = 6; ctx.strokeRect(e.x + 18, e.y + 18, e.w - 36, e.h - 36);
  ctx.fillStyle = "#c9a464"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const t = Math.round(Math.min(e.w, e.h) * 0.075);
  ctx.font = `700 ${t}px Cinzel, Georgia, serif`;
  ctx.fillText("LA CORTE", e.x + e.w / 2, e.y + e.h / 2 - t * 0.9);
  ctx.fillText("DE LOS CUERVOS", e.x + e.w / 2, e.y + e.h / 2 + t * 0.5);
}

async function armarHoja(h) {
  const c = document.createElement("canvas"); c.width = c.height = lay.tam;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, lay.tam, lay.tam);
  const enHoja = lay.espacios.filter(e => e.hoja === h);
  if (info.publicado) {
    // lo que no cambia se queda como está ahora
    const base = await Comun.imagen(`${info.hojas}${h}.jpg?t=${Date.now()}`, true);
    if (!base) throw new Error("No pude cargar tus fotos actuales para conservar las que no cambias. Intenta otra vez en un momento.");
    ctx.drawImage(base, 0, 0, lay.tam, lay.tam);
  } else {
    for (const e of enHoja) relleno(ctx, e);
  }
  for (const e of enHoja) {
    const s = elegidas[e.id]; if (!s) continue;
    const t = document.createElement("canvas"); t.width = e.w; t.height = e.h;
    dibujar(t.getContext("2d"), e.w, e.h, s);
    ctx.drawImage(t, e.x, e.y);
  }
  for (const q of [0.9, 0.82, 0.74]) {
    const b = await new Promise(r => c.toBlob(r, "image/jpeg", q));
    if (b && b.size < 5.5 * 1024 * 1024) return b;
  }
  throw new Error("Las fotos quedaron demasiado pesadas.");
}

$("enviar").addEventListener("click", async () => {
  const ids = Object.keys(elegidas).map(Number).sort((a, b) => a - b);
  if (!ids.length) return;
  const b = $("enviar"); b.disabled = true; b.textContent = "Preparando...";
  try {
    await document.fonts.ready;
    const f = new FormData();
    f.append("espacios", JSON.stringify(ids));
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
