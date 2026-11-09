# Página de perfiles de fotos

Un Worker de Cloudflare que sirve:

- `/` — página del cliente: entra con su código, elige una foto por cuadro, la recorta y la manda para aprobación.
- `/admin` — panel del dueño: crea perfiles (sale el código), aprueba o rechaza envíos, activa/desactiva perfiles.

Al aprobar, el Worker publica en este mismo repo (GitHub Pages) las hojas `casa/p/NNNN_0.jpg`, `NNNN_1.jpg`
y rehace `casa/lista.txt`. El mundo las lee en la siguiente instancia.

## Qué guarda cada cosa

| Dónde | Qué |
|---|---|
| D1 `cuervos-perfiles` | perfiles (nombre y nota solo los ve el dueño), envíos, intentos de entrada |
| R2 `cuervos-perfiles-envios` | hojas pendientes de aprobar (se borran al aprobar o rechazar) |
| Este repo | solo imágenes aprobadas y la lista cifrada. Nunca nombres ni códigos |

Los códigos no se guardan en ningún lado: solo su cifrado (el mismo que usa el mundo).

## Secretos (se ponen en Cloudflare, nunca en el repo)

- `ADMIN_CLAVE` — la clave del panel.
- `GITHUB_TOKEN` — token *fine-grained* con acceso solo a este repo y permiso **Contents: Read and write**.

## Desplegar

1. Crear la base D1 `cuervos-perfiles` y poner su ID en `wrangler.toml` (`database_id`).
2. Crear el bucket R2 `cuervos-perfiles-envios`.
3. Workers & Pages → Create → Import a repository → este repo, carpeta raíz `web`. Watch paths: `web/*`.
4. En el Worker: Settings → Variables and secrets → los dos secretos.

Las tablas se crean solas la primera vez.

## Probar en local

```
cd web && npm install
printf 'ADMIN_CLAVE="prueba"\nGITHUB_TOKEN="x"\n' > .dev.vars
npx wrangler dev
```

`casa/layout.json` y `public/casa/layout.json` deben ser iguales (el segundo lo usa la página).
