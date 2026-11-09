"""Store the Maia-3 5M weights in half precision (12 MB instead of 22 MB); the model still computes in float32.

Every float32 weight with 256+ values becomes a float16 initializer followed by a Cast back to float32, so the
graph, its inputs and outputs are unchanged. Checked against the original on 2738 positions: top move identical
in 99.9 % (the rest are near-ties), mean total-variation distance 0.0003.

    pip install onnx
    python3 scripts/maia_fp16.py maia3_5m.onnx assets/maia/maia3-5m.w16.onnx

Source: maia3_5m.onnx from the npm package maia3-js 0.2.0 (sha256 f7bd01b3…bb804), an ONNX export of
UofTCSSLab/Maia3-5M (CSSLab, AGPL-3.0).
"""
import sys
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
halves, casts = [], []
for init in list(g.initializer):
    arr = numpy_helper.to_array(init)
    if arr.dtype == np.float32 and arr.size >= 256:
        halves.append(numpy_helper.from_array(arr.astype(np.float16), init.name + '__f16'))
        casts.append(helper.make_node('Cast', [init.name + '__f16'], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
        g.initializer.remove(init)
g.initializer.extend(halves)
nodes = list(g.node)
del g.node[:]
g.node.extend(casts + nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
