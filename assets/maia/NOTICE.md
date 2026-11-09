# Maia-3 (modelo del bot Trayner)

`maia3-5m.w16.onnx` es el modelo **Maia-3 5M** del CSSLab (Universidad de Toronto): una red que predice la jugada que haría una persona de un rating dado, entrenada con partidas de Lichess.

- Proyecto: https://github.com/CSSLab/maia3 · pesos: https://huggingface.co/UofTCSSLab/Maia3-5M · artículo: *Chessformer: A Unified Architecture for Chess Modeling* (Monroe, Eilender, Chalmers, Tang, Anderson; ICLR 2026).
- Licencia: **GNU AGPL-3.0** (texto en `LICENSE-AGPL-3.0.txt`). Traynsko es GPL-3.0-or-later y su código completo es público, también el de esta integración.
- Exportación ONNX tomada del paquete npm `maia3-js` 0.2.0 (MIT, Cem Unuvar), archivo `models/maia3_5m.onnx`, sha256 `f7bd01b3e41dceb5e93eb9f4c61e9c4db8b35411effd1d8c984b006cd74bb804`.
- Modificación de Traynsko: pesos guardados en media precisión con `scripts/maia_fp16.py` (el cálculo sigue en float32). sha256 del resultado: `ae88eac80641302eeab2dd86cfafc55c6092e30b3f372785142f40e9cdae08f2`.
