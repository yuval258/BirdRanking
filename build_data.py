import json, hashlib
m = json.load(open('raw/master.json'))
seen, out = set(), []
FOODS = ['Invertebrate','Seed','Fish','Fruit','Rodent','Nectar']
for b in sorted(m, key=lambda b: b['id']):
    key = (b['Common name'], b['Scientific name'])
    if key in seen:
        continue
    seen.add(key)
    out.append({
        'id': b['id'], 'n': b['Common name'], 's': b['Scientific name'],
        'c': b['Color'], 'p': b['Power text'], 'v': int(b['Victory points'] or 0),
        'nest': b['Nest type'], 'e': int(b['Egg limit'] or 0), 'w': b['Wingspan'],
        'h': [h[0] for h in ('Forest', 'Grassland', 'Wetland') if b[h]],
        'f': [[f.lower(), int(b[f])] for f in FOODS if b[f]] + ([['wild', int(b['Wild (food)'])]] if b['Wild (food)'] else []),
        'or': 1 if b['/ (food cost)'] == '/' else 0,
        'pr': 1 if b['Predator'] else 0, 'fl': 1 if b['Flocking'] else 0,
        'set': b['Set'],
    })
blob = json.dumps(out, separators=(',', ':'), ensure_ascii=False)
open('data/birds.json', 'w').write(blob)
print(len(m), len(out), len(blob), hashlib.sha1(blob.encode()).hexdigest()[:8])
