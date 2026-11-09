# Traynsko

Entrenador de repertorio de ajedrez. Repites una línea de tu repertorio con el reloj en marcha y, al terminarla, juegas la posición contra un bot que corre en tu propio dispositivo: Trayner, que juega como una persona del nivel elegido, u otros bots basados en Stockfish. Cada partida queda en tu registro, con visor jugada a jugada.

## Entrar y entrenar

- **Portada** (pulsando el título): solo los repertorios que ya abriste en este dispositivo. Para otro, basta su clave: la clave dice a qué repertorio (o repertorios) da acceso, así que la portada nunca muestra el catálogo.
- **Biblioteca**: las líneas del repertorio abierto y, debajo, los demás repertorios visibles (se abren con su clave).
  - Cada jugador elige qué líneas entrena (por línea, por conjunto o por capítulo) y las agrupa en **conjuntos** propios: se crean, renombran, ordenan, pliegan (queda solo el título) y se llenan arrastrando cada línea por su asa (ratón o dedo, con desplazamiento automático) o desde su menú ⋯.
  - **Buscar** por nombre o por jugada, con letras españolas o inglesas y número opcional (`12.Ae3`, `12.Be3`, `2...Cf6`, `Cd7` encuentra `Nbd7`). Sobre el resultado: *Entrenar solo estas*, activar, desactivar o agrupar.
  - El entrenamiento usa solo las líneas activas; el tablero indica cuántas hay cuando no son todas. Las líneas nuevas que suba el maestro entran activas.
  - **Al azar** o **En orden** (aquí y en el engranaje, es el mismo ajuste): en orden, las líneas activas salen una tras otra tal como las muestra la Biblioteca (capítulo a capítulo; dentro de cada uno, los conjuntos en su orden y luego las líneas sin conjunto). Una línea cuenta como hecha al empezarla o al saltarla con *Otra línea*, así que el orden sigue tras cerrar la app; al terminar la última vuelve a la primera. La línea siguiente aparece marcada en la lista, y *Volver a la primera* reinicia el orden. Se guarda en el dispositivo, por repertorio.
  - La selección se identifica por las jugadas de cada línea (no por el capítulo ni el nombre): sobrevive a renombrar o volver a subir un capítulo. Se guarda en el servidor por persona y repertorio (cuenta de Lichess o nombre) y en el dispositivo, así que es la misma en el móvil y en el ordenador.
- Al abrir un repertorio la partida no empieza sola: el tablero espera a **Comenzar partida**. El engranaje, en la esquina del tablero, permite ajustar antes la fuerza del bot, el color (el del repertorio o el contrario), el orden de las líneas (al azar o en orden) y el ritmo.
- Con el color contrario repites las respuestas de la línea mientras tu repertorio juega solo; no se ganan emblemas.
- Salir de una partida en curso (otro repertorio, la Sala) pide confirmación.

## Acceso por persona (Sala del maestro → Usuarios)

- Cada entrada a un repertorio queda registrada por persona: la cuenta de Lichess si la hay, si no el nombre escrito.
- El maestro ve a todos los usuarios, su perfil (repertorios, partidas, puntos, errores) y puede **bloquear o devolver el acceso a una persona en un repertorio** sin cambiar la clave de nadie. El bloqueo actúa en la siguiente acción y también impide volver a entrar.
- **Solo con cuenta de Lichess** (por repertorio): sin cuenta no se entra, así que un bloqueo no se puede esquivar escribiendo otro nombre. Recomendado para repertorios de pago.
- **Visible en la Biblioteca** (por repertorio): los repertorios nuevos son privados; solo los marcados aparecen en la Biblioteca de todos.

## Trayner, el bot humano (por defecto)

- **Maia-3** (CSSLab, Universidad de Toronto), una red entrenada con partidas de Lichess, propone las jugadas que haría una persona del nivel elegido y con qué probabilidad. Recibe las últimas 8 posiciones de la partida.
- **Stockfish** puntúa esas jugadas dos veces: a poca profundidad (lo que esa persona ve sobre el tablero: 4 jugadas a 1800, 10 a 2800) y en profundidad (la verdad). Los errores visibles impropios del nivel (dejar una pieza, no ver un mate corto) se descartan; lo que no se ve apenas pesa en niveles bajos, así que a veces cae en una táctica profunda o no la encuentra, como una persona. Por encima de ~2350 el motor pesa cada vez más.
- El tiempo de reflexión depende de la posición: poco en una recaptura o una jugada obvia, más cuando hay varias opciones, algo más al salir de la línea; con poco reloj, rápido. El ajuste «Tiempo del bot» es la media.
- Escala: el nivel del deslizador (tipo FIDE) se pasa a la escala de Lichess blitz de Maia con `maiaElo()` en `src/lib/maia.ts`, el punto que hay que ajustar si se siente fuerte o débil.
- Todo corre en el dispositivo: la red (12 MB, `assets/maia/`) y ONNX Runtime Web (wasm) se descargan una vez en segundo plano y quedan en la caché del navegador. Si el dispositivo no puede cargarla, Trayner juega con Stockfish y la pestaña Bots lo indica.
- Los ajustes antiguos pasan a Trayner una vez (versión 3 de los ajustes); los demás bots se pueden volver a activar en Bots.

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
python3 qa_order.py  /tmp/qa   # líneas al azar o en orden: engranaje, Biblioteca, saltar, recargar, vuelta completa
python3 qa_trayner.py /tmp/qa  # Trayner: carga de la red, jugadas humanas, tiempo variable, ajustes antiguos, sin red
npx esbuild tests/harness/maia-probe.ts --bundle --format=iife --outfile=.dev/maia-probe.js
python3 qa_maia_ref.py         # la red en el navegador frente a la referencia en Python (tests/fixtures/maia_ref.json)
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

GPL-3.0-or-later, porque incluye Stockfish (GPLv3) y chessground (GPLv3). Piezas cburnett (GPLv2+), sonidos de Kenney (CC0), fuentes Cinzel y Alegreya Sans (OFL). La red de Trayner es Maia-3 del CSSLab bajo AGPL-3.0 (detalles y procedencia en `assets/maia/NOTICE.md`); ONNX Runtime Web (MIT).
