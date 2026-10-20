# Builds the board sounds from Kenney CC0 recordings (Starter Kit City Builder, "placement"/"removal").
import numpy as np, wave, base64, json, sys
SRC = sys.argv[1]
SR = 44100
def load(name):
    w = wave.open(f'{SRC}/{name}.wav'); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    assert w.getframerate() == SR
    return x
def hp(x, fc=60):  # one-pole high-pass: removes DC / rumble
    a = np.exp(-2*np.pi*fc/SR); y = np.zeros_like(x); prev_x = prev_y = 0.0
    for i, v in enumerate(x):
        prev_y = a*(prev_y + v - prev_x); prev_x = v; y[i] = prev_y
    return y
def trim(x, db=-45):
    thr = np.abs(x).max() * 10**(db/20); idx = np.where(np.abs(x) > thr)[0]
    return x[max(0, idx[0]-20): idx[-1]+1]
def fade(x, ms=12):
    n = min(len(x), int(SR*ms/1000)); x = x.copy(); x[-n:] *= np.linspace(1, 0, n)**2; return x
def norm(x, peak_db=-2):
    return x / np.abs(x).max() * 10**(peak_db/20)
def mix(parts):
    n = max(int(off*SR) + len(s) for s, off, g in parts); y = np.zeros(n)
    for s, off, g in parts: o = int(off*SR); y[o:o+len(s)] += s*g
    return y
def prep(name): return fade(trim(hp(load(name))))
a, b, c, d = (prep('k_Starter-Kit-City-Builder_sounds_placement-' + k) for k in 'abcd')
cut = lambda x, ms: fade(x[: int(SR*ms/1000)], 10)   # keep only the first knock
a1, c1, d1 = cut(a, 42), cut(c, 55), cut(d, 33)
rem = prep('k_Starter-Kit-City-Builder_sounds_removal-a')[: int(0.24*SR)]
out = {
    'move': norm(a1, -3),
    'capture': norm(mix([(d1, 0, 1.0), (a1, 0.032, 0.9)]), -2),
    'castle': norm(mix([(a1, 0, 1.0), (c1, 0.085, 0.8)]), -3),
    'wrong': norm(fade(rem, 40), -6),
}
res = {}
for k, x in out.items():
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    path = f'assets/sounds/{k}.wav'
    w = wave.open(path, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes()); w.close()
    res[k] = base64.b64encode(open(path, 'rb').read()).decode()
    print(k, f'{len(x)/SR*1000:.0f} ms', len(res[k])//1024, 'KB b64')
open('src/sounds-data.ts', 'w').write('// Board sounds built from Kenney CC0 recordings (kenney.nl). See scripts_make_sounds.py.\nexport const SOUNDS: Record<string, string> = ' + json.dumps(res) + ';\n')
