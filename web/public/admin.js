// Panel del dueño: aprobar o rechazar envíos y manejar perfiles.

const $ = id => document.getElementById(id);
const el = Comun.el;
let clave = Comun.leer("clave");
let R = null;                 // último resumen
const lays = {};              // layouts por mundo
const urls = [];              // object URLs de hojas pendientes

async function api(metodo, ruta, cuerpo) {
  const r = await fetch("/api/admin/" + ruta, {
    method: metodo,
    headers: { authorization: "Bearer " + clave, ...(cuerpo ? { "content-type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 401) { salir("La clave no es correcta."); throw new Error("401"); }
  const d = r.headers.get("content-type")?.includes("json") ? await r.json() : r;
  if (!r.ok) throw new Error(d.error || "Error " + r.status);
  return d;
}

function aviso(t, tipo = "bien") {
  const m = $("msg"); m.innerHTML = "";
  if (t) m.append(el("div", { class: "aviso " + tipo }, t));
  if (t) setTimeout(() => { if (m.textContent === t) m.innerHTML = ""; }, 9000);
}

// ------------------------------------------------------------ entrar

$("fClave").addEventListener("submit", async ev => {
  ev.preventDefault();
  clave = $("clave").value;
  try { await cargar(); Comun.guardar("clave", clave); } catch (e) { if (e.message !== "401") { $("errClave").textContent = e.message; $("errClave").classList.remove("oculto"); } }
});
$("salir").addEventListener("click", () => salir());
$("recargar").addEventListener("click", () => cargar());

function salir(motivo) {
  Comun.guardar("clave", null); clave = null;
  $("vPanel").classList.add("oculto"); $("vClave").classList.remove("oculto");
  if (motivo) { $("errClave").textContent = motivo; $("errClave").classList.remove("oculto"); }
}

document.querySelectorAll(".pestanas button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".pestanas button").forEach(x => x.classList.toggle("activa", x === b));
  for (const p of ["pEnvios", "pPerfiles", "pHistorial"]) $(p).classList.toggle("oculto", p !== b.dataset.p);
}));

async function cargar() {
  R = await api("GET", "resumen");
  $("vClave").classList.add("oculto"); $("errClave").classList.add("oculto");
  $("vPanel").classList.remove("oculto");
  for (const m of new Set(R.perfiles.map(p => p.mundo))) if (!lays[m]) lays[m] = await Comun.datos(m);
  pintarEnvios(); pintarPerfiles(); pintarHistorial();
}

// ------------------------------------------------------------ envíos por aprobar

async function hojaPendiente(id, h) {
  const r = await api("GET", `envio/${id}/hoja/${h}`);
  const u = URL.createObjectURL(await r.blob());
  urls.push(u); return u;
}

async function pintarEnvios() {
  while (urls.length) URL.revokeObjectURL(urls.pop());
  const pend = R.envios.filter(e => e.estado === "pendiente");
  $("nPend").textContent = pend.length;
  const caja = $("pEnvios"); caja.innerHTML = "";
  if (!pend.length) { caja.append(el("div", { class: "panel apagado", style: "text-align:center" }, "No hay fotos esperando aprobación.")); return; }
  for (const e of pend) caja.append(await tarjetaEnvio(e));
}

async function tarjetaEnvio(e) {
  const lay = lays[e.mundo], per = R.perfiles.find(p => p.id === e.perfil);
  const nuevas = [];
  for (let h = 0; h < lay.hojas; h++) nuevas.push(await hojaPendiente(e.id, h));
  const ahora = per && per.publicado ? h => `${R.pagesBase}${e.mundo}/p/${String(e.perfil).padStart(4, "0")}_${h}.jpg?v=${encodeURIComponent(per.publicado)}` : null;

  const celda = (s, cambio) => el("div", { class: "celda" + (cambio ? " cambio" : "") },
    el("div", { class: "fila", style: "justify-content:space-between; margin-bottom:6px" },
      el("b", { style: "color:var(--oro)" }, String(s.id)), cambio ? el("span", { class: "etiqueta nueva" }, "Nueva") : el("span", { class: "etiqueta" }, "igual")),
    el("div", { class: "par" },
      el("div", {}, Comun.recorte(nuevas[s.hoja], s, lay.tam, 110), el("div", {}, cambio ? "nueva" : "")),
      cambio && ahora ? el("div", {}, Comun.recorte(ahora(s.hoja), s, lay.tam, 70), el("div", {}, "ahora")) : null));

  const cambiados = lay.espacios.filter(s => e.espacios.includes(s.id));
  const iguales = lay.espacios.filter(s => !e.espacios.includes(s.id));
  const motivo = el("textarea", { rows: 2, placeholder: "Motivo (lo verá el cliente)", class: "oculto", style: "margin-top:10px" });

  const aprobar = el("button", { class: "primario", type: "button" }, "Aprobar y publicar");
  const rechazar = el("button", { type: "button" }, "Rechazar");
  aprobar.onclick = async () => {
    aprobar.disabled = rechazar.disabled = true; aprobar.textContent = "Publicando...";
    try { await api("POST", `envio/${e.id}/aprobar`); aviso(`Perfil ${e.perfil} publicado. Sale en las instancias nuevas en unos minutos.`); await cargar(); }
    catch (x) { aviso(x.message, "mal"); aprobar.disabled = rechazar.disabled = false; aprobar.textContent = "Aprobar y publicar"; }
  };
  rechazar.onclick = async () => {
    if (motivo.classList.contains("oculto")) { motivo.classList.remove("oculto"); motivo.focus(); rechazar.textContent = "Confirmar rechazo"; return; }
    rechazar.disabled = aprobar.disabled = true;
    try { await api("POST", `envio/${e.id}/rechazar`, { nota: motivo.value.trim() }); aviso(`Envío del perfil ${e.perfil} rechazado.`, "espera"); await cargar(); }
    catch (x) { aviso(x.message, "mal"); rechazar.disabled = aprobar.disabled = false; }
  };

  return el("div", { class: "panel" },
    el("div", { class: "fila", style: "justify-content:space-between" },
      el("div", {},
        el("h2", { style: "margin:0" }, `Perfil ${e.perfil} · ${e.nombre}`),
        el("div", { class: "apagado chico" }, `Mandado el ${Comun.fecha(e.creado)} · cambió ${cambiados.length === 1 ? "el cuadro" : "los cuadros"} ${e.espacios.join(", ")}` + (per && per.publicado ? "" : " · primera vez (los que no mandó salen con el logo)"))),
      el("div", { class: "fila" }, rechazar, aprobar)),
    motivo,
    el("h3", { style: "margin-top:14px" }, "Lo que cambia"),
    el("div", { class: "comparar" }, cambiados.map(s => celda(s, true))),
    iguales.length ? el("details", { style: "margin-top:12px" },
      el("summary", { class: "apagado chico", style: "cursor:pointer" }, `Ver los otros ${iguales.length} cuadros (se quedan como están)`),
      el("div", { class: "comparar", style: "margin-top:10px" }, iguales.map(s => celda(s, false)))) : null);
}

// ------------------------------------------------------------ perfiles

$("fNuevo").addEventListener("submit", async ev => {
  ev.preventDefault();
  try {
    const d = await api("POST", "perfil", { nombre: $("nNombre").value, vence: $("nVence").value || null, nota: $("nNota").value || null });
    $("fNuevo").reset();
    mostrarCodigo(d.perfil, d.codigo, "Perfil creado");
    await cargar();
  } catch (x) { aviso(x.message, "mal"); }
});

function mostrarCodigo(perfil, codigo, titulo) {
  const texto = `Tu código de perfil de fotos: ${codigo}\nSube tus fotos aquí: ${location.origin}/\nEn el mapa, ponlo en el teclado que te sale al abrir la instancia.`;
  const copiar = el("button", { type: "button" }, "Copiar mensaje para el cliente");
  copiar.onclick = async () => { try { await navigator.clipboard.writeText(texto); copiar.textContent = "Copiado"; } catch (e) { copiar.textContent = "No se pudo copiar"; } };
  $("nuevoCodigo").innerHTML = "";
  $("nuevoCodigo").append(el("div", { class: "aviso bien", style: "margin-top:14px" },
    el("div", { class: "fila", style: "justify-content:space-between" }, el("b", {}, `${titulo}: perfil ${perfil}`), copiar),
    el("div", { class: "codigo-grande", style: "margin:10px 0" }, codigo),
    el("div", { class: "chico apagado" }, "Apúntalo ahora: no se guarda en ningún lado y no se puede volver a ver (solo sacar uno nuevo).")));
  $("nuevoCodigo").scrollIntoView({ behavior: "smooth", block: "center" });
}

function pintarPerfiles() {
  const t = $("tPerfiles"); t.innerHTML = "";
  t.append(el("tr", {}, ["#", "Nombre", "Estado", "Vence", "Fotos publicadas", ""].map(h => el("th", {}, h))));
  for (const p of R.perfiles) {
    const vencido = p.vence && p.vence < R.hoy;
    const estado = !p.activo ? el("span", { class: "etiqueta" }, "desactivado")
      : vencido ? el("span", { class: "etiqueta" }, "vencido")
      : p.publicado ? el("span", { class: "etiqueta", style: "color:#9fe0b4" }, "en el mapa")
      : el("span", { class: "etiqueta" }, "sin fotos aún");
    const vence = el("input", { type: "date", value: p.vence || "", style: "width:auto; padding:5px 8px" });
    vence.onchange = () => editar(p.id, { vence: vence.value || null }, "Fecha guardada");
    t.append(el("tr", {},
      el("td", {}, String(p.id)),
      el("td", {}, el("div", {}, p.nombre), p.nota ? el("div", { class: "chico apagado" }, p.nota) : null),
      el("td", {}, estado, p.pendientes ? el("span", { class: "etiqueta nueva", style: "margin-left:4px" }, "por aprobar") : null),
      el("td", {}, vence),
      el("td", { class: "chico apagado" }, p.publicado ? Comun.fecha(p.publicado) : "—"),
      el("td", {}, el("div", { class: "fila", style: "justify-content:flex-end; flex-wrap:nowrap" },
        el("button", { type: "button", onclick: () => nuevoCodigo(p) }, "Código nuevo"),
        el("button", { type: "button", onclick: () => editar(p.id, { activo: !p.activo }, p.activo ? "Perfil desactivado" : "Perfil activado") }, p.activo ? "Desactivar" : "Activar")))));
  }
}

async function editar(id, cambios, ok) {
  try { const d = await api("POST", `perfil/${id}/editar`, cambios); aviso(ok + (d.listaCambiada ? " · lista del mapa actualizada" : "")); await cargar(); }
  catch (x) { aviso(x.message, "mal"); }
}

async function nuevoCodigo(p) {
  if (!confirm(`¿Sacar un código nuevo para el perfil ${p.id} (${p.nombre})? El código viejo deja de servir, en la página y en el mapa.`)) return;
  try {
    const d = await api("POST", `perfil/${p.id}/codigo`);
    document.querySelector('[data-p="pPerfiles"]').click();
    mostrarCodigo(p.id, d.codigo, "Código nuevo");
    await cargar();
  } catch (x) { aviso(x.message, "mal"); }
}

$("rehacerLista").addEventListener("click", async () => {
  try { const d = await api("POST", "lista"); aviso(d.cambio ? "Lista publicada de nuevo." : "La lista ya estaba al día."); }
  catch (x) { aviso(x.message, "mal"); }
});

// ------------------------------------------------------------ historial

function pintarHistorial() {
  const t = $("tHistorial"); t.innerHTML = "";
  t.append(el("tr", {}, ["Envío", "Perfil", "Cuadros", "Mandado", "Estado", "Nota"].map(h => el("th", {}, h))));
  for (const e of R.envios)
    t.append(el("tr", {},
      el("td", {}, "#" + e.id), el("td", {}, `${e.perfil} · ${e.nombre}`), el("td", {}, e.espacios.join(", ")),
      el("td", { class: "chico" }, Comun.fecha(e.creado)), el("td", {}, el("span", { class: "etiqueta" + (e.estado === "pendiente" ? " nueva" : "") }, e.estado)),
      el("td", { class: "chico apagado" }, e.nota || "")));
}

if (clave) cargar().catch(() => {});
