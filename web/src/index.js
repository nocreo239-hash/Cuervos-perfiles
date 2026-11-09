// ============================================================
//  Cuervos perfiles — servidor (Cloudflare Worker)
//
//  Clientes:  entran con su código, mandan sus fotos (2 hojas de 2048x2048
//             ya compuestas en su navegador) y ven si se aprobaron.
//  Admin:     crea perfiles (sale un código nuevo), ve los envíos y los
//             aprueba o rechaza. Al aprobar se publican en GitHub Pages
//             (casa/p/NNNN_0.jpg, _1.jpg) y se rehace casa/lista.txt.
//
//  D1 (DB):        perfiles y envíos (nombres solo aquí, nunca en el repo)
//  R2 (ENVIOS):    hojas pendientes de aprobar
//  Secretos:       ADMIN_CLAVE, GITHUB_TOKEN  (los pone el dueño en Cloudflare)
// ============================================================

const PERFILES_MAX = 200;                     // direcciones que el mundo trae guardadas
const MUNDOS = { casa: { sal: "cuervos-casa", hojas: 2 } };
const MAX_HOJA_BYTES = 6 * 1024 * 1024;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      await prepararDB(env);
      return await api(req, env, url);
    } catch (e) {
      if (e instanceof Respuesta) return e.r;
      console.error(e);
      return json({ error: "Error del servidor: " + (e.message || e) }, 500);
    }
  },

  // Una vez al día: saca de la lista los perfiles vencidos.
  async scheduled(evento, env, ctx) {
    await prepararDB(env);
    ctx.waitUntil(publicarLista(env, "casa", "Lista diaria (vencimientos)"));
  },
};

// ------------------------------------------------------------ utilidades

class Respuesta { constructor(r) { this.r = r; } }
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fallo = (msg, status = 400) => { throw new Respuesta(json({ error: msg }, status)); };
const ahora = () => new Date().toISOString();
const hoy = () => new Date().toISOString().slice(0, 10);

/** FNV-1a de 64 bits de 'sal:codigo' en hex (16). Igual que el mundo (PerfilFotos.Cifrar). */
export function cifrar(sal, codigo) {
  const s = sal + ":" + codigo;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

function iguales(a, b) {
  const x = new TextEncoder().encode(a || ""), y = new TextEncoder().encode(b || "");
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

function codigoNuevo() {
  const b = new Uint32Array(1); crypto.getRandomValues(b);
  return String(b[0] % 100000000).padStart(8, "0");
}

/** Ancho y alto de un JPEG (marcador SOF), o null si no es un JPEG. */
function tamJpeg(buf) {
  const d = new Uint8Array(buf);
  if (d[0] !== 0xff || d[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < d.length) {
    if (d[i] !== 0xff) { i++; continue; }
    const m = d[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (d[i + 2] << 8) | d[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { alto: (d[i + 5] << 8) | d[i + 6], ancho: (d[i + 7] << 8) | d[i + 8] };
    i += 2 + len;
  }
  return null;
}

function b64(buf) {
  const d = new Uint8Array(buf); let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------ base de datos

let _lista = false;
async function prepararDB(env) {
  if (_lista) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS perfiles (
      id INTEGER PRIMARY KEY, mundo TEXT NOT NULL, nombre TEXT NOT NULL, cifrado TEXT NOT NULL UNIQUE,
      creado TEXT NOT NULL, vence TEXT, activo INTEGER NOT NULL DEFAULT 1, publicado TEXT, nota TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS envios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, perfil INTEGER NOT NULL, estado TEXT NOT NULL,
      espacios TEXT NOT NULL, creado TEXT NOT NULL, revisado TEXT, nota TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS intentos (ip TEXT NOT NULL, momento INTEGER NOT NULL)`),
    // los dos perfiles de prueba que ya están publicados
    env.DB.prepare(`INSERT OR IGNORE INTO perfiles (id, mundo, nombre, cifrado, creado, activo, publicado, nota)
      VALUES (0, 'casa', 'Prueba A', '426c8292b9aa9859', ?1, 1, ?1, 'prueba'), (1, 'casa', 'Prueba B', 'f1b4607d152e9e79', ?1, 1, ?1, 'prueba')`).bind(ahora()),
  ]);
  // columna añadida después: cuadros que el dueño no aprobó de un envío
  try { await env.DB.prepare("ALTER TABLE envios ADD COLUMN rechazados TEXT").run(); } catch (e) { /* ya existe */ }
  // cuadros del perfil que tienen una foto aprobada (los demás muestran el logo)
  try { await env.DB.prepare("ALTER TABLE perfiles ADD COLUMN aprobados TEXT").run(); } catch (e) { /* ya existe */ }
  _lista = true;
}

// ------------------------------------------------------------ rutas

async function api(req, env, url) {
  const p = url.pathname, m = req.method;

  // ---- clientes
  if (p === "/api/entrar" && m === "POST") return entrar(req, env);
  if (p === "/api/estado" && m === "GET") return estado(req, env);
  if (p === "/api/envio" && m === "POST") return enviar(req, env);
  if (p.startsWith("/api/envio/hoja/") && m === "GET") return hojaPropia(req, env, +p.split("/").pop());
  if (p.startsWith("/api/publicada/") && m === "GET") { const per = await clienteDe(req, env); return hojaPublicada(env, per.id, +p.split("/").pop()); }

  // ---- admin
  if (p.startsWith("/api/admin/")) {
    const clave = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!env.ADMIN_CLAVE) fallo("Falta el secreto ADMIN_CLAVE en Cloudflare", 500);
    if (!iguales(clave, String(env.ADMIN_CLAVE).trim())) { await esperar(800); fallo("Clave incorrecta", 401); }
    const r = p.slice("/api/admin/".length).split("/");
    if (r[0] === "resumen" && m === "GET") return resumen(env);
    if (r[0] === "perfil" && r.length === 1 && m === "POST") return crearPerfil(req, env);
    if (r[0] === "perfil" && r[2] === "codigo" && m === "POST") return nuevoCodigo(env, +r[1]);
    if (r[0] === "perfil" && r[2] === "editar" && m === "POST") return editarPerfil(req, env, +r[1]);
    if (r[0] === "envio" && r[2] === "hoja" && m === "GET") return hojaEnvio(env, +r[1], +r[3]);
    if (r[0] === "perfil" && r[2] === "publicada" && m === "GET") return hojaPublicada(env, +r[1], +r[3]);
    if (r[0] === "envio" && r[2] === "aprobar" && m === "POST") return aprobar(req, env, +r[1]);
    if (r[0] === "envio" && r[2] === "rechazar" && m === "POST") return rechazar(req, env, +r[1]);
    if (r[0] === "lista" && m === "POST") return json({ ok: true, cambio: await publicarLista(env, "casa", "Lista rehecha a mano") });
  }
  fallo("No existe", 404);
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ clientes

async function limitar(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "?";
  const t = Date.now();
  await env.DB.prepare("DELETE FROM intentos WHERE momento < ?").bind(t - 15 * 60 * 1000).run();
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM intentos WHERE ip = ?").bind(ip).first()).n;
  if (n >= 20) fallo("Demasiados intentos. Espera unos minutos.", 429);
  await env.DB.prepare("INSERT INTO intentos (ip, momento) VALUES (?, ?)").bind(ip, t).run();
}

async function perfilPorCodigo(env, codigo) {
  codigo = String(codigo || "").replace(/\D/g, "");
  if (codigo.length < 4 || codigo.length > 8) return null;
  for (const [mundo, cfg] of Object.entries(MUNDOS)) {
    const fila = await env.DB.prepare("SELECT * FROM perfiles WHERE mundo = ? AND cifrado = ?").bind(mundo, cifrar(cfg.sal, codigo)).first();
    if (fila) return fila;
  }
  return null;
}

async function clienteDe(req, env) {
  const per = await perfilPorCodigo(env, req.headers.get("x-codigo"));
  if (!per) fallo("Código no válido", 401);
  if (!per.activo) fallo("Este perfil está desactivado. Habla con el dueño del mapa.", 403);
  if (per.vence && per.vence < hoy()) fallo("Este perfil venció el " + per.vence + ". Habla con el dueño del mapa.", 403);
  return per;
}

// Una sola entrada para todos: la clave del panel lleva al panel; un código, a su perfil.
async function entrar(req, env) {
  await limitar(req, env);
  const { codigo } = await req.json().catch(() => ({}));
  const texto = String(codigo || "").trim();
  if (env.ADMIN_CLAVE && iguales(texto, String(env.ADMIN_CLAVE).trim())) return json({ admin: true });
  const per = /^\d{4,8}$/.test(texto) ? await perfilPorCodigo(env, texto) : null;
  if (!per) { await esperar(600); fallo("Código no válido", 401); }
  return datosCliente(env, per);
}

async function estado(req, env) { return datosCliente(env, await clienteDe(req, env)); }

/** Cuadros con foto aprobada. Para perfiles aprobados antes de guardarlo, se rehace con el historial. */
async function aprobadosDe(env, per) {
  if (per.aprobados) return JSON.parse(per.aprobados);
  if (!per.publicado) return [];
  const filas = (await env.DB.prepare("SELECT espacios, rechazados FROM envios WHERE perfil = ? AND estado = 'aprobado'").bind(per.id).all()).results;
  const ya = new Set();
  for (const f of filas) { const no = JSON.parse(f.rechazados || "[]"); for (const n of JSON.parse(f.espacios)) if (!no.includes(n)) ya.add(n); }
  const lista = [...ya].sort((a, b) => a - b);
  if (filas.length) await env.DB.prepare("UPDATE perfiles SET aprobados = ? WHERE id = ?").bind(JSON.stringify(lista), per.id).run();
  return lista;
}

async function datosCliente(env, per) {
  if (!per.activo) fallo("Este perfil está desactivado. Habla con el dueño del mapa.", 403);
  if (per.vence && per.vence < hoy()) fallo("Este perfil venció el " + per.vence + ".", 403);
  const ult = await env.DB.prepare("SELECT id, estado, espacios, rechazados, creado, revisado, nota FROM envios WHERE perfil = ? ORDER BY id DESC LIMIT 1").bind(per.id).first();
  return json({
    perfil: per.id, mundo: per.mundo, vence: per.vence, publicado: per.publicado,
    aprobados: await aprobadosDe(env, per),
    hojas: (env.PAGES_BASE || "") + `${per.mundo}/p/${String(per.id).padStart(4, "0")}_`,
    ultimo: ult ? { ...ult, espacios: JSON.parse(ult.espacios), rechazados: JSON.parse(ult.rechazados || "[]") } : null,
  });
}

async function enviar(req, env) {
  const per = await clienteDe(req, env);
  const cfg = MUNDOS[per.mundo];
  const form = await req.formData();
  const espacios = JSON.parse(form.get("espacios") || "[]").map(Number).filter(n => n > 0 && n < 100);
  if (!espacios.length) fallo("No elegiste ninguna foto");
  const hojas = [];
  for (let h = 0; h < cfg.hojas; h++) {
    const f = form.get("hoja" + h);
    if (!f || typeof f === "string") fallo("Falta la hoja " + h);
    const buf = await f.arrayBuffer();
    if (buf.byteLength > MAX_HOJA_BYTES) fallo("La hoja " + h + " pesa demasiado");
    const t = tamJpeg(buf);
    if (!t || t.ancho !== 2048 || t.alto !== 2048) fallo("La hoja " + h + " no es un JPEG de 2048x2048");
    hojas.push(buf);
  }
  // un solo envío pendiente por perfil: el nuevo reemplaza al anterior
  const viejos = await env.DB.prepare("SELECT id FROM envios WHERE perfil = ? AND estado = 'pendiente'").bind(per.id).all();
  for (const v of viejos.results) {
    await env.DB.prepare("UPDATE envios SET estado = 'reemplazado', revisado = ? WHERE id = ?").bind(ahora(), v.id).run();
    for (let h = 0; h < cfg.hojas; h++) await env.ENVIOS.delete(`envios/${v.id}_${h}.jpg`);
  }
  const r = await env.DB.prepare("INSERT INTO envios (perfil, estado, espacios, creado) VALUES (?, 'pendiente', ?, ?)").bind(per.id, JSON.stringify(espacios), ahora()).run();
  const id = r.meta.last_row_id;
  for (let h = 0; h < cfg.hojas; h++)
    await env.ENVIOS.put(`envios/${id}_${h}.jpg`, hojas[h], { httpMetadata: { contentType: "image/jpeg" } });
  return json({ ok: true, envio: id });
}

/** Lo último que se aprobó de un perfil (copia en R2; 404 si es de antes de guardar copias). */
async function hojaPublicada(env, perfil, h) {
  const o = await env.ENVIOS.get(`publicadas/${perfil}_${h}.jpg`);
  if (!o) fallo("Sin copia", 404);
  return new Response(o.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
}

/** El cliente ve sus propias hojas pendientes (para recordar qué mandó y dónde). */
async function hojaPropia(req, env, h) {
  const per = await clienteDe(req, env);
  const e = await env.DB.prepare("SELECT id FROM envios WHERE perfil = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1").bind(per.id).first();
  if (!e) fallo("No tienes fotos esperando revisión", 404);
  const o = await env.ENVIOS.get(`envios/${e.id}_${h}.jpg`);
  if (!o) fallo("No encontré esa hoja", 404);
  return new Response(o.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
}

// ------------------------------------------------------------ admin

async function resumen(env) {
  const perfiles = (await env.DB.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM envios e WHERE e.perfil = p.id AND e.estado = 'pendiente') AS pendientes
      FROM perfiles p ORDER BY p.id`).all()).results;
  const envios = (await env.DB.prepare(`SELECT e.*, p.nombre, p.mundo FROM envios e JOIN perfiles p ON p.id = e.perfil
      WHERE e.estado = 'pendiente' OR e.id IN (SELECT id FROM envios ORDER BY id DESC LIMIT 15) ORDER BY e.id DESC`).all()).results
    .map(e => ({ ...e, espacios: JSON.parse(e.espacios), rechazados: JSON.parse(e.rechazados || "[]") }));
  return json({ perfiles, envios, hoy: hoy(), pagesBase: env.PAGES_BASE || "", maximo: PERFILES_MAX });
}

async function crearPerfil(req, env) {
  const { nombre, vence, mundo = "casa", nota } = await req.json();
  if (!nombre || !String(nombre).trim()) fallo("Ponle un nombre (solo lo ves tú)");
  const cfg = MUNDOS[mundo]; if (!cfg) fallo("Mundo desconocido");
  const usados = new Set((await env.DB.prepare("SELECT id FROM perfiles").all()).results.map(r => r.id));
  let id = -1;
  for (let i = 0; i < PERFILES_MAX; i++) if (!usados.has(i)) { id = i; break; }
  if (id < 0) fallo(`Ya hay ${PERFILES_MAX} perfiles: el mundo no tiene más direcciones guardadas`);
  const { codigo, cifrado } = await codigoLibre(env, cfg);
  await env.DB.prepare("INSERT INTO perfiles (id, mundo, nombre, cifrado, creado, vence, activo, nota) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
    .bind(id, mundo, String(nombre).trim().slice(0, 80), cifrado, ahora(), vence || null, nota ? String(nota).slice(0, 200) : null).run();
  return json({ ok: true, perfil: id, codigo });
}

async function codigoLibre(env, cfg) {
  for (let i = 0; i < 20; i++) {
    const codigo = codigoNuevo(), cifrado = cifrar(cfg.sal, codigo);
    const ya = await env.DB.prepare("SELECT id FROM perfiles WHERE cifrado = ?").bind(cifrado).first();
    if (!ya) return { codigo, cifrado };
  }
  fallo("No pude sacar un código libre, prueba otra vez", 500);
}

async function nuevoCodigo(env, id) {
  const per = await env.DB.prepare("SELECT * FROM perfiles WHERE id = ?").bind(id).first();
  if (!per) fallo("No existe ese perfil", 404);
  const { codigo, cifrado } = await codigoLibre(env, MUNDOS[per.mundo]);
  await env.DB.prepare("UPDATE perfiles SET cifrado = ? WHERE id = ?").bind(cifrado, id).run();
  // el código ya cambió: aunque falle GitHub hay que devolverlo, o nadie lo sabría
  let cambio = false, listaError = null;
  if (per.publicado) {
    try { cambio = await publicarLista(env, per.mundo, `Nuevo código para el perfil ${id}`); }
    catch (e) { listaError = String(e.message || e); }
  }
  return json({ ok: true, codigo, listaCambiada: cambio, listaError });
}

async function editarPerfil(req, env, id) {
  const per = await env.DB.prepare("SELECT * FROM perfiles WHERE id = ?").bind(id).first();
  if (!per) fallo("No existe ese perfil", 404);
  const b = await req.json();
  const nombre = b.nombre !== undefined ? String(b.nombre).trim().slice(0, 80) || per.nombre : per.nombre;
  const vence = b.vence !== undefined ? (b.vence || null) : per.vence;
  const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : per.activo;
  const nota = b.nota !== undefined ? (b.nota ? String(b.nota).slice(0, 200) : null) : per.nota;
  await env.DB.prepare("UPDATE perfiles SET nombre = ?, vence = ?, activo = ?, nota = ? WHERE id = ?").bind(nombre, vence, activo, nota, id).run();
  let cambio = false, listaError = null;
  if (per.publicado && (activo !== per.activo || vence !== per.vence)) {
    try { cambio = await publicarLista(env, per.mundo, `Perfil ${id} ${activo ? "activo" : "desactivado"}`); }
    catch (e) { listaError = String(e.message || e); }
  }
  return json({ ok: true, listaCambiada: cambio, listaError });
}

async function hojaEnvio(env, id, h) {
  const o = await env.ENVIOS.get(`envios/${id}_${h}.jpg`);
  if (!o) fallo("Ya no está (se aprobó, se rechazó o se reemplazó)", 404);
  return new Response(o.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
}

/**
 * Aprueba un envío. Sin cuerpo: se publica tal cual lo mandó el cliente.
 * Con cuerpo (multipart): el panel manda las hojas ya rehechas sin los cuadros
 * rechazados (esos vuelven a la foto de antes) + 'rechazados' y 'nota'.
 */
async function aprobar(req, env, id) {
  const e = await env.DB.prepare("SELECT e.*, p.mundo FROM envios e JOIN perfiles p ON p.id = e.perfil WHERE e.id = ?").bind(id).first();
  if (!e) fallo("No existe ese envío", 404);
  if (e.estado !== "pendiente") fallo("Ese envío ya está " + e.estado);
  const cfg = MUNDOS[e.mundo], espacios = JSON.parse(e.espacios);
  let hojas = [], rechazados = [], nota = null;
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await req.formData();
    rechazados = JSON.parse(form.get("rechazados") || "[]").map(Number).filter(n => espacios.includes(n));
    nota = form.get("nota") ? String(form.get("nota")).slice(0, 300) : null;
    if (rechazados.length >= espacios.length) fallo("Rechazaste todos los cuadros: usa «Rechazar todo»");
    for (let h = 0; h < cfg.hojas; h++) {
      const f = form.get("hoja" + h);
      if (!f || typeof f === "string") fallo("Falta la hoja " + h);
      const buf = await f.arrayBuffer();
      const t = tamJpeg(buf);
      if (!t || t.ancho !== 2048 || t.alto !== 2048 || buf.byteLength > MAX_HOJA_BYTES) fallo("La hoja " + h + " no es válida");
      hojas.push(buf);
    }
  } else {
    for (let h = 0; h < cfg.hojas; h++) {
      const o = await env.ENVIOS.get(`envios/${id}_${h}.jpg`);
      if (!o) fallo("Falta la hoja " + h + " en R2", 500);
      hojas.push(await o.arrayBuffer());
    }
  }
  const archivos = hojas.map((buf, h) => ({ ruta: `${e.mundo}/p/${String(e.perfil).padStart(4, "0")}_${h}.jpg`, base64: b64(buf) }));
  // las hojas y la lista van en el mismo commit
  const antes = (await env.DB.prepare("SELECT publicado FROM perfiles WHERE id = ?").bind(e.perfil).first()).publicado;
  await env.DB.prepare("UPDATE perfiles SET publicado = ? WHERE id = ?").bind(ahora(), e.perfil).run();
  archivos.push({ ruta: `${e.mundo}/lista.txt`, texto: await textoLista(env, e.mundo) });
  try {
    await commit(env, archivos, `Fotos aprobadas del perfil ${e.perfil}`);
  } catch (x) {
    await env.DB.prepare("UPDATE perfiles SET publicado = ? WHERE id = ?").bind(antes, e.perfil).run();
    throw x;
  }
  await env.DB.prepare("UPDATE envios SET estado = 'aprobado', revisado = ?, rechazados = ?, nota = ? WHERE id = ?")
    .bind(ahora(), rechazados.length ? JSON.stringify(rechazados) : null, rechazados.length ? nota : null, id).run();
  // copia propia de lo publicado: GitHub Pages tarda unos minutos en servir lo nuevo, y lo que se
  // arme después (otro envío, otro rechazo) tiene que partir de esto y no de una versión vieja
  for (let h = 0; h < cfg.hojas; h++)
    await env.ENVIOS.put(`publicadas/${e.perfil}_${h}.jpg`, hojas[h], { httpMetadata: { contentType: "image/jpeg" } });
  const per = await env.DB.prepare("SELECT aprobados FROM perfiles WHERE id = ?").bind(e.perfil).first();
  const ya = new Set(await aprobadosDe(env, { ...(await env.DB.prepare("SELECT * FROM perfiles WHERE id = ?").bind(e.perfil).first()), aprobados: per && per.aprobados }));
  for (const n of espacios) if (!rechazados.includes(n)) ya.add(n);
  await env.DB.prepare("UPDATE perfiles SET aprobados = ? WHERE id = ?").bind(JSON.stringify([...ya].sort((a, b) => a - b)), e.perfil).run();
  for (let h = 0; h < cfg.hojas; h++) await env.ENVIOS.delete(`envios/${id}_${h}.jpg`);
  return json({ ok: true, rechazados });
}

async function rechazar(req, env, id) {
  const { nota } = await req.json().catch(() => ({}));
  const e = await env.DB.prepare("SELECT e.*, p.mundo FROM envios e JOIN perfiles p ON p.id = e.perfil WHERE e.id = ?").bind(id).first();
  if (!e) fallo("No existe ese envío", 404);
  if (e.estado !== "pendiente") fallo("Ese envío ya está " + e.estado);
  await env.DB.prepare("UPDATE envios SET estado = 'rechazado', revisado = ?, nota = ? WHERE id = ?").bind(ahora(), nota ? String(nota).slice(0, 300) : null, id).run();
  for (let h = 0; h < MUNDOS[e.mundo].hojas; h++) await env.ENVIOS.delete(`envios/${id}_${h}.jpg`);
  return json({ ok: true });
}

// ------------------------------------------------------------ publicación (GitHub)

async function textoLista(env, mundo) {
  const filas = (await env.DB.prepare(`SELECT id, cifrado FROM perfiles WHERE mundo = ? AND activo = 1 AND publicado IS NOT NULL
      AND (vence IS NULL OR vence >= ?) ORDER BY id`).bind(mundo, hoy()).all()).results;
  return "# cifrado numero  (FNV-1a 64 de 'sal:codigo'; los códigos no se guardan aquí)\n" +
    filas.map(f => `${f.cifrado} ${f.id}`).join("\n") + "\n";
}

/** Rehace la lista si cambió. Devuelve true si hizo un commit. */
async function publicarLista(env, mundo, mensaje) {
  const texto = await textoLista(env, mundo);
  const actual = await gh(env, "GET", `contents/${mundo}/lista.txt?ref=${env.GITHUB_RAMA || "main"}`).catch(() => null);
  if (actual && actual.content) {
    const viejo = new TextDecoder().decode(Uint8Array.from(atob(actual.content.replace(/\n/g, "")), c => c.charCodeAt(0)));
    if (viejo === texto) return false;
  }
  await commit(env, [{ ruta: `${mundo}/lista.txt`, texto }], mensaje);
  return true;
}

async function gh(env, metodo, ruta, cuerpo) {
  if (!env.GITHUB_TOKEN) fallo("Falta el secreto GITHUB_TOKEN en Cloudflare", 500);
  const r = await fetch(`${env.GITHUB_API || "https://api.github.com"}/repos/${env.GITHUB_REPO}/${ruta}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json",
      "user-agent": "cuervos-perfiles", "x-github-api-version": "2022-11-28",
      ...(cuerpo ? { "content-type": "application/json" } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${metodo} ${ruta.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Un solo commit con varios archivos (API de git). */
async function commit(env, archivos, mensaje) {
  const rama = env.GITHUB_RAMA || "main";
  const ref = await gh(env, "GET", `git/ref/heads/${rama}`);
  const padre = await gh(env, "GET", `git/commits/${ref.object.sha}`);
  const arbol = [];
  for (const a of archivos) {
    const blob = a.base64 !== undefined
      ? await gh(env, "POST", "git/blobs", { content: a.base64, encoding: "base64" })
      : await gh(env, "POST", "git/blobs", { content: a.texto, encoding: "utf-8" });
    arbol.push({ path: a.ruta, mode: "100644", type: "blob", sha: blob.sha });
  }
  const tree = await gh(env, "POST", "git/trees", { base_tree: padre.tree.sha, tree: arbol });
  const c = await gh(env, "POST", "git/commits", { message: mensaje, tree: tree.sha, parents: [ref.object.sha] });
  await gh(env, "PATCH", `git/refs/heads/${rama}`, { sha: c.sha });
}
