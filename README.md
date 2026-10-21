# Traynsko

Entrenador de repertorio de ajedrez. Repites una línea de tu repertorio con el reloj en marcha y, al terminarla, juegas la posición contra un bot que corre en tu propio dispositivo (Stockfish). Cada partida queda en tu registro, con visor jugada a jugada.

## Cuentas y Atlas

- **Entrar con Lichess** (OAuth2 + PKCE, sin registrar la app ni claves extra). El navegador obtiene el código; el servidor lo canjea, lee el nombre de usuario y revoca el token de inmediato. No se piden permisos: Traynsko solo conoce el nombre de usuario.
- La sesión de cuenta es un token firmado por el propio servidor (cabecera `X-Traynsko-User`), independiente de la clave de cada repertorio.
- **Emblemas**: completar una línea sin errores ni ayudas, empezando en la jugada 1, otorga su emblema. Se identifica por color + posición inicial + jugadas (no por el nombre): renombrar conserva el emblema; cambiar una jugada lo deja «a revalidar».
- **Atlas**: la colección por capítulo, con las líneas no conseguidas ocultas.
- Se puede seguir entrando sin cuenta (con nombre); en Ajustes, una cuenta puede reclamar las partidas antiguas de un nombre y borrar sus datos.

## Desarrollo

```bash
npm install
npm run dev        # servidor local en http://localhost:8790
npm test
npm run typecheck
```

Pruebas visuales (con `npm run dev` en marcha; requieren Python con Playwright):

```bash
python3 tests/qa_board.py  /tmp/qa   # piezas exactas tras cambiar de pestaña, redimensionar y girar
python3 tests/qa_layout.py /tmp/qa   # móviles, tabletas y escritorio, en vertical y horizontal
python3 tests/qa_hint.py             # la flecha de ayuda desaparece cuando debe
```

Cuentas y emblemas, con Lichess simulado (el código devuelto se toma como nombre de usuario):

```bash
DEV_FAKE_LICHESS=1 npm run dev
python3 tests/e2e_accounts.py /tmp/qa
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/` | Aplicación (Preact, chessground, chess.js), estilos, motor y bots |
| `server/` | API: contenidos, sesiones y registro de partidas |
| `shared/` | Tipos comunes |
| `dev/` | Servidor local con datos en memoria |

## Licencias

GPL-3.0-or-later, porque incluye Stockfish (GPLv3) y chessground (GPLv3). Piezas cburnett (GPLv2+), sonidos de Kenney (CC0), fuentes Cinzel y Alegreya Sans (OFL).
