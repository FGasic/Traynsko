# Traynsko

Entrenador de repertorio de ajedrez. Repites una línea de tu repertorio con el reloj en marcha y, al terminarla, juegas la posición contra un bot que corre en tu propio dispositivo (Stockfish). Cada partida queda en tu registro, con visor jugada a jugada.

## Entrar y entrenar

- **Portada** (pulsando el título): solo los repertorios que ya abriste en este dispositivo. Para otro, basta su clave: la clave dice a qué repertorio (o repertorios) da acceso, así que la portada nunca muestra el catálogo.
- **Biblioteca**: las líneas del repertorio abierto y, debajo, los demás repertorios visibles (se abren con su clave).
  - Cada jugador elige qué líneas entrena (por línea, por conjunto o por capítulo) y las agrupa en **conjuntos** propios: se crean, renombran, ordenan, pliegan (queda solo el título) y se llenan arrastrando cada línea por su asa (ratón o dedo, con desplazamiento automático) o desde su menú ⋯.
  - **Buscar** por nombre o por jugada, con letras españolas o inglesas y número opcional (`12.Ae3`, `12.Be3`, `2...Cf6`, `Cd7` encuentra `Nbd7`). Sobre el resultado: *Entrenar solo estas*, activar, desactivar o agrupar.
  - El entrenamiento usa solo las líneas activas; el tablero indica cuántas hay cuando no son todas. Las líneas nuevas que suba el maestro entran activas.
  - La selección se identifica por las jugadas de cada línea (no por el capítulo ni el nombre): sobrevive a renombrar o volver a subir un capítulo. Se guarda en el servidor por persona y repertorio (cuenta de Lichess o nombre) y en el dispositivo, así que es la misma en el móvil y en el ordenador.
- Al abrir un repertorio la partida no empieza sola: el tablero espera a **Comenzar partida**. El engranaje, en la esquina del tablero, permite ajustar antes la fuerza del bot, el color (el del repertorio o el contrario) y el ritmo.
- Con el color contrario repites las respuestas de la línea mientras tu repertorio juega solo; no se ganan emblemas.
- Salir de una partida en curso (otro repertorio, la Sala) pide confirmación.

## Acceso por persona (Sala del maestro → Usuarios)

- Cada entrada a un repertorio queda registrada por persona: la cuenta de Lichess si la hay, si no el nombre escrito.
- El maestro ve a todos los usuarios, su perfil (repertorios, partidas, puntos, errores) y puede **bloquear o devolver el acceso a una persona en un repertorio** sin cambiar la clave de nadie. El bloqueo actúa en la siguiente acción y también impide volver a entrar.
- **Solo con cuenta de Lichess** (por repertorio): sin cuenta no se entra, así que un bloqueo no se puede esquivar escribiendo otro nombre. Recomendado para repertorios de pago.
- **Visible en la Biblioteca** (por repertorio): los repertorios nuevos son privados; solo los marcados aparecen en la Biblioteca de todos.

## Tablas contra el bot

- Puedes ofrecer tablas en la partida. El bot acepta en finales simplificados o posiciones sin progreso si no está claramente mejor; al principio de una partida con piezas solo acepta si está peor.
- El bot ofrece tablas cuando la posición lleva varias jugadas igualada y no pasa nada (final sin damas o diez jugadas sin capturas ni movimientos de peón). Mover sin responder equivale a seguir jugando.

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
cd tests
python3 qa_board.py  /tmp/qa   # piezas exactas tras cambiar de pestaña, redimensionar y girar
python3 qa_layout.py /tmp/qa   # móviles, tabletas y escritorio, en vertical y horizontal
python3 qa_hint.py   /tmp/qa   # la flecha de ayuda desaparece cuando debe
python3 qa_flow.py   /tmp/qa   # «Comenzar partida», engranaje, color contrario, portada, Biblioteca, claves
python3 qa_users.py  /tmp/qa   # Usuarios: perfil, bloqueo por persona, repertorios privados
python3 qa_library.py /tmp/qa  # Biblioteca: conjuntos, arrastrar (ratón y dedo), búsqueda por jugada, solo estas, otro dispositivo
```

Cuentas y emblemas, con Lichess simulado (el código devuelto se toma como nombre de usuario):

```bash
DEV_FAKE_LICHESS=1 npm run dev
python3 tests/e2e_accounts.py /tmp/qa
```

Tablas en un final de torres (con `npm run dev` y datos limpios):

```bash
python3 tests/e2e_draws.py /tmp/qa
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
