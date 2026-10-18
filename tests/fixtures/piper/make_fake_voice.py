"""Genera una «voz» ONNX mínima con la misma interfaz que un modelo Piper (VITS).

No es una voz real: produce un tono a partir de los identificadores de fonemas. Sirve solo para
probar de extremo a extremo la instalación, el caché, los fonemas (espeak-ng WASM), la inferencia con
ONNX Runtime Web y la reproducción, sin descargar modelos.

Uso: python3 make_fake_voice.py  (requiere el paquete «onnx»)
"""
import json
from pathlib import Path

import numpy as np
from onnx import TensorProto, checker, helper, numpy_helper, save

here = Path(__file__).parent
inputs = [
    helper.make_tensor_value_info("input", TensorProto.INT64, [1, "T"]),
    helper.make_tensor_value_info("input_lengths", TensorProto.INT64, [1]),
    helper.make_tensor_value_info("scales", TensorProto.FLOAT, [3]),
]
output = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 1, "N"])
consts = [
    numpy_helper.from_array(np.array([0.05], dtype=np.float32), "k"),
    numpy_helper.from_array(np.array([2], dtype=np.int64), "axis"),
    numpy_helper.from_array(np.linspace(0, 60, 220, dtype=np.float32).reshape(1, 1, 220), "ramp"),
    numpy_helper.from_array(np.array([0.2], dtype=np.float32), "gain"),
    numpy_helper.from_array(np.array([1, 1, -1], dtype=np.int64), "shape"),
]
nodes = [
    helper.make_node("Cast", ["input"], ["f"], to=TensorProto.FLOAT),
    helper.make_node("Mul", ["f", "k"], ["fk"]),
    helper.make_node("Unsqueeze", ["fk", "axis"], ["u"]),
    helper.make_node("Add", ["u", "ramp"], ["phase"]),
    helper.make_node("Sin", ["phase"], ["s"]),
    helper.make_node("Mul", ["s", "gain"], ["g"]),
    helper.make_node("Reshape", ["g", "shape"], ["output"]),
]
graph = helper.make_graph(nodes, "fake_piper", inputs, [output], initializer=consts)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], producer_name="oratoria-lab-tests")
model.ir_version = 8
checker.check_model(model)
save(model, here / "fake-voice.onnx")
config = {
    "audio": {"sample_rate": 22050},
    "espeak": {"voice": "es"},
    "inference": {"noise_scale": 0.667, "length_scale": 1, "noise_w": 0.8},
    "num_speakers": 1,
}
(here / "fake-voice.onnx.json").write_text(json.dumps(config, indent=2) + "\n")
print("ok", (here / "fake-voice.onnx").stat().st_size, "bytes")
