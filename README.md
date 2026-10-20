# Traynsko

Entrenador de repertorio de ajedrez. El alumno entra a un **mundo** con su clave, repite una línea de su repertorio con el reloj en marcha y, al terminarla, juega la posición contra un bot (Stockfish en su propio dispositivo). Las partidas quedan en su registro, con visor jugada a jugada.

- **Portada de mundos**: cada mundo es un tema (p. ej. «Mundo Benko») con su propia clave.
- **Sala del maestro** (★): crear mundos, ver y cambiar claves, subir PGN, ver alumnos y partidas. Cambiar una clave expulsa al instante a quien entró con la anterior.
- **Clave maestra**: solo se guarda su hash en la variable de entorno `TRAYNSKO_MASTER_HASH`; nunca en el código.

## Publicar en Vercel

1. **Importar** este repositorio en Vercel (Add New → Project). No hay que tocar la configuración: `vercel.json` ya indica cómo construir.
2. **Base de datos**: en el proyecto, *Storage* → *Upstash for Redis* → crear (plan gratuito) → *Connect*. Vercel añade solo las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN`.
3. **Clave maestra**: *Settings → Environment Variables* → `TRAYNSKO_MASTER_HASH` con el valor `scrypt$…` que corresponde a la clave maestra.
4. **Redeploy**. Al abrir la web, la ★ da acceso a la Sala del maestro.

Si falta algo, la portada lo indica («falta conectar la base de datos» / «falta la clave maestra»).

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:8790 · clave maestra local: maestro-dev
npm test             # pruebas del servidor
npm run typecheck
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/` | App (Preact + chessground + chess.js), estilos, motor y bots |
| `server/` | Lógica del servidor: mundos, claves, sesiones firmadas, partidas |
| `api/index.ts` | Función de Vercel que expone `server/` en `/api/*` |
| `shared/` | Tipos comunes |
| `dev/` | Servidor local con base de datos en memoria |

## Licencias

Traynsko se distribuye bajo **GPL-3.0-or-later** porque incluye Stockfish (GPLv3) y chessground (GPLv3). Piezas cburnett (GPLv2+), sonidos de Kenney (CC0), fuentes Cinzel y Alegreya Sans (OFL).
