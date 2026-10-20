# Traynsko

Entrenador de repertorio de ajedrez. Repites una línea de tu repertorio con el reloj en marcha y, al terminarla, juegas la posición contra un bot que corre en tu propio dispositivo (Stockfish). Cada partida queda en tu registro, con visor jugada a jugada.

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

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/` | Aplicación (Preact, chessground, chess.js), estilos, motor y bots |
| `server/` | API: contenidos, sesiones y registro de partidas |
| `shared/` | Tipos comunes |
| `dev/` | Servidor local con datos en memoria |

## Licencias

GPL-3.0-or-later, porque incluye Stockfish (GPLv3) y chessground (GPLv3). Piezas cburnett (GPLv2+), sonidos de Kenney (CC0), fuentes Cinzel y Alegreya Sans (OFL).
