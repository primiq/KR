"""Minimal 3DS -> GLB converter: keeps every triangle, smooth normals from smoothing groups,
one primitive per (object, material), textures assigned from a name->file map."""
import json, struct, sys
import numpy as np

src, out, texdir = sys.argv[1], sys.argv[2], sys.argv[3]
texmap = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
normalmap = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
data = open(src, 'rb').read()

objects, materials = [], {}
cur_mat = None


def cstr(p):
    e = data.index(b'\0', p)
    return data[p:e].decode('latin1'), e + 1


def color(p, end):
    while p < end:
        cid, ln = struct.unpack_from('<HI', data, p)
        if cid == 0x0011:
            return [c / 255 for c in data[p + 6:p + 9]]
        if cid == 0x0010:
            return list(struct.unpack_from('<3f', data, p + 6))
        p += ln
    return [0.8, 0.8, 0.8]


def pct(p, end):
    while p < end:
        cid, ln = struct.unpack_from('<HI', data, p)
        if cid == 0x0030:
            return struct.unpack_from('<H', data, p + 6)[0] / 100
        if cid == 0x0031:
            return struct.unpack_from('<f', data, p + 6)[0]
        p += ln
    return 0


def walk(off, end, obj=None):
    global cur_mat
    while off + 6 <= end:
        cid, ln = struct.unpack_from('<HI', data, off)
        if ln < 6:
            break
        body, nxt = off + 6, off + ln
        if cid in (0x4D4D, 0x3D3D, 0xAFFF):
            walk(body, nxt, obj)
        elif cid == 0x4000:
            name, p = cstr(body)
            o = {'name': name}
            walk(p, nxt, o)
            if 'v' in o and 'f' in o:
                objects.append(o)
        elif cid == 0x4100:
            walk(body, nxt, obj)
        elif cid == 0x4110:
            n = struct.unpack_from('<H', data, body)[0]
            obj['v'] = np.frombuffer(data, '<f4', n * 3, body + 2).reshape(n, 3).astype(np.float64)
        elif cid == 0x4140:
            n = struct.unpack_from('<H', data, body)[0]
            obj['uv'] = np.frombuffer(data, '<f4', n * 2, body + 2).reshape(n, 2).copy()
        elif cid == 0x4120:
            n = struct.unpack_from('<H', data, body)[0]
            f = np.frombuffer(data, '<u2', n * 4, body + 2).reshape(n, 4)
            obj['f'] = f[:, :3].astype(np.int64)
            obj['groups'] = []
            p = body + 2 + n * 8
            while p < nxt:
                sid, sl = struct.unpack_from('<HI', data, p)
                if sid == 0x4130:
                    mname, q = cstr(p + 6)
                    cnt = struct.unpack_from('<H', data, q)[0]
                    idx = np.frombuffer(data, '<u2', cnt, q + 2).astype(np.int64)
                    obj['groups'].append((mname, idx))
                elif sid == 0x4150:
                    obj['sg'] = np.frombuffer(data, '<u4', n, p + 6).copy()
                p += sl
        elif cid == 0xAFFF:
            walk(body, nxt)
        elif cid == 0xA000:
            cur_mat, _ = cstr(body)
            materials[cur_mat] = {'diffuse': [0.8, 0.8, 0.8], 'transparency': 0}
        elif cid == 0xA020 and cur_mat:
            materials[cur_mat]['diffuse'] = color(body, nxt)
        elif cid == 0xA050 and cur_mat:
            materials[cur_mat]['transparency'] = pct(body, nxt)
        off = nxt


walk(0, len(data))

# ---- Build glTF ----------------------------------------------------------------------
buf = bytearray()
accessors, views, meshes_json, nodes = [], [], [], []


def add_view(arr, target=None):
    b = arr.tobytes()
    while len(buf) % 4:
        buf.append(0)
    views.append({'buffer': 0, 'byteOffset': len(buf), 'byteLength': len(b), **({'target': target} if target else {})})
    buf.extend(b)
    return len(views) - 1


def add_acc(arr, ctype, typ, target=None, minmax=False):
    v = add_view(arr, target)
    a = {'bufferView': v, 'componentType': ctype, 'count': len(arr), 'type': typ}
    if minmax:
        a['min'] = arr.min(axis=0).tolist()
        a['max'] = arr.max(axis=0).tolist()
    accessors.append(a)
    return len(accessors) - 1


mat_index = {}
gl_materials, images, textures = [], [], []
image_index = {}


def get_mat(name):
    if name in mat_index:
        return mat_index[name]
    m = materials.get(name, {'diffuse': [0.8, 0.8, 0.8], 'transparency': 0})
    pbr = {'baseColorFactor': [*m['diffuse'], 1 - m['transparency']], 'metallicFactor': 0, 'roughnessFactor': 0.6}
    def texture(fname):
        if fname not in image_index:
            img = open(f'{texdir}/{fname}', 'rb').read()
            images.append({'bufferView': add_view(np.frombuffer(img, np.uint8)), 'mimeType': 'image/jpeg', 'name': fname})
            textures.append({'source': len(images) - 1})
            image_index[fname] = len(textures) - 1
        return image_index[fname]
    tex = texmap.get(name)
    if tex:
        pbr['baseColorTexture'] = {'index': texture(tex)}
        pbr['baseColorFactor'] = [1, 1, 1, 1]
    g = {'name': name, 'pbrMetallicRoughness': pbr, 'doubleSided': True}
    if normalmap.get(name):
        g['normalTexture'] = {'index': texture(normalmap[name])}
    if m['transparency'] > 0.01:
        g['alphaMode'] = 'BLEND'
    gl_materials.append(g)
    mat_index[name] = len(gl_materials) - 1
    return mat_index[name]


for o in objects:
    V, F = o['v'], o['f']
    UV = o.get('uv')
    SG = o.get('sg', np.ones(len(F), np.uint32))
    # Face normals (area weighted).
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    # Smooth normals: accumulate per (position, smoothing group) so hard edges between groups survive
    # and UV seams (duplicated vertices) don't show.
    pos_key = np.unique(np.round(V, 5), axis=0, return_inverse=True)[1].reshape(-1)
    corner_v = F.reshape(-1)
    corner_key = pos_key[corner_v].astype(np.int64) * 4294967296 + np.repeat(SG, 3).astype(np.int64)
    uniq, inv = np.unique(corner_key, return_inverse=True)
    acc = np.zeros((len(uniq), 3))
    np.add.at(acc, inv, np.repeat(fn, 3, axis=0))
    corner_n = acc[inv]
    corner_n /= np.maximum(np.linalg.norm(corner_n, axis=1, keepdims=True), 1e-12)
    # Unique output vertices = (vertex index, quantised normal).
    nq = np.round(corner_n * 1000).astype(np.int64)
    combo = np.stack([corner_v, nq[:, 0], nq[:, 1], nq[:, 2]], axis=1)
    _, first, remap = np.unique(combo, axis=0, return_index=True, return_inverse=True)
    remap = remap.reshape(-1)
    out_v = V[corner_v[first]]
    out_n = corner_n[first]
    out_uv = UV[corner_v[first]] if UV is not None else None
    tris = remap.reshape(-1, 3)
    # 3DS is Z-up right-handed -> glTF Y-up right-handed.
    pos = np.stack([out_v[:, 0], out_v[:, 2], -out_v[:, 1]], axis=1).astype(np.float32)
    nor = np.stack([out_n[:, 0], out_n[:, 2], -out_n[:, 1]], axis=1).astype(np.float32)
    a_pos = add_acc(pos, 5126, 'VEC3', 34962, True)
    a_nor = add_acc(nor, 5126, 'VEC3', 34962)
    attrs = {'POSITION': a_pos, 'NORMAL': a_nor}
    if out_uv is not None:
        uv = out_uv.copy()
        uv[:, 1] = 1 - uv[:, 1]
        attrs['TEXCOORD_0'] = add_acc(uv.astype(np.float32), 5126, 'VEC2', 34962)
    prims = []
    groups = o['groups'] or [(None, np.arange(len(F)))]
    for mname, idx in groups:
        # Fully transparent placeholder materials (hidden in the original scene) are dropped.
        if len(idx) == 0 or materials.get(mname, {}).get('transparency', 0) >= 0.99:
            continue
        ind = tris[idx].reshape(-1).astype(np.uint32)
        p = {'attributes': attrs, 'indices': add_acc(ind, 5125, 'SCALAR', 34963), 'mode': 4}
        if mname:
            p['material'] = get_mat(mname)
        prims.append(p)
    meshes_json.append({'name': o['name'], 'primitives': prims})
    nodes.append({'name': o['name'], 'mesh': len(meshes_json) - 1})

gltf = {
    'asset': {'version': '2.0', 'generator': '3ds2glb.py'},
    'scene': 0,
    'scenes': [{'nodes': list(range(len(nodes)))}],
    'nodes': nodes,
    'meshes': meshes_json,
    'materials': gl_materials,
    'accessors': accessors,
    'bufferViews': views,
    'buffers': [{'byteLength': len(buf)}],
}
if images:
    gltf['images'] = images
    gltf['textures'] = textures
    gltf['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
    for t in textures:
        t['sampler'] = 0
j = json.dumps(gltf, separators=(',', ':')).encode()
j += b' ' * ((4 - len(j) % 4) % 4)
while len(buf) % 4:
    buf.append(0)
with open(out, 'wb') as fh:
    fh.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(buf)))
    fh.write(struct.pack('<II', len(j), 0x4E4F534A) + j)
    fh.write(struct.pack('<II', len(buf), 0x004E4942) + bytes(buf))
allv = np.concatenate([o['v'] for o in objects])
print('objects', len(objects), 'tris', sum(len(o['f']) for o in objects), 'bbox', allv.min(0).round(2).tolist(), allv.max(0).round(2).tolist())
for n, m in materials.items():
    print(n, [round(c, 2) for c in m['diffuse']], m['transparency'])
