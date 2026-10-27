// ============================================================================
// perihelion-markers.js (v1.1 — DIAGNOSTIC) — Orbit Viewer (base nasapsg/orbits)
//
// v1 n'a trouvé aucune boucle fermée : les orbites ne sont pas dessinées
// comme des lignes fermées. Cette v1.1 ne pose PAS encore de marqueurs :
// elle LISTE dans la console (F12) toutes les géométries ligne/points de la
// scène avec :
//   - type et nom de l'objet (et de son parent),
//   - nombre de sommets,
//   - distance premier → dernier sommet,
//   - distance minimale à l'origine (périhélie candidat),
//   - emprise (taille) de la géométrie.
//
// → Lancer, puis copier-coller TOUT le bloc [perihelion] de la console.
// La v1.2 posera les marqueurs avec le bon test de détection.
//
// Installation : <script src="perihelion-markers.js"></script> avant </body>.
// ============================================================================

(function () {
    'use strict';

    var MIN_VERTS = 8;    // lister à partir de 8 sommets
    var DEBUG = true;

    var scene = null;
    var reported = false;
    var disabled = false;

    function info(m) { try { console.info('[perihelion] ' + m); } catch (e) {} }
    function warn(m) { try { console.warn('[perihelion] ' + m); } catch (e) {} }

    if (typeof THREE === 'undefined' || !THREE.Object3D || !THREE.Object3D.prototype) {
        warn('THREE introuvable : script inactif (charger après include.js).');
        return;
    }

    function isScene(o) { return o && (o.type === 'Scene' || o.isScene === true); }

    function objectName(o) {
        var names = [];
        var c = o;
        for (var i = 0; i < 3 && c; i++) {
            if (c.name) names.push(c.name);
            c = c.parent;
        }
        return names.join(' < ') || '(sans nom)';
    }

    function scanAndReport() {
        var lines = [];
        scene.traverse(function (o) {
            var g = o.geometry;
            if (!g || !g.attributes || !g.attributes.position) return;
            var attr = g.attributes.position;
            var n = attr.count;
            if (n < MIN_VERTS) return;

            var a = new THREE.Vector3().fromBufferAttribute(attr, 0);
            var b = new THREE.Vector3().fromBufferAttribute(attr, n - 1);
            var endDist = a.distanceTo(b);

            var min = new THREE.Vector3(Infinity, Infinity, Infinity);
            var max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
            var bestD = Infinity;
            var v = new THREE.Vector3();
            for (var i = 0; i < n; i++) {
                v.fromBufferAttribute(attr, i);
                min.min(v); max.max(v);
                var d = v.lengthSq();
                if (d < bestD) bestD = d;
            }
            var size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);

            lines.push({
                type: o.type || '?',
                name: objectName(o),
                verts: n,
                endDist: endDist,
                periDist: Math.sqrt(bestD),
                size: size,
                closed: endDist < 0.05 * size
            });
        });

        console.info('[perihelion] ================== DIAGNOSTIC SCÈNE ==================');
        console.info('[perihelion] ' + lines.length + ' géométrie(s) ≥ ' + MIN_VERTS + ' sommets :');
        lines.sort(function (x, y) { return y.size - x.size; });
        lines.forEach(function (L) {
            console.info('[perihelion] ' + L.type.padEnd(12) +
                ' verts=' + String(L.verts).padStart(5) +
                '  boutAB=' + L.endDist.toFixed(3).padStart(8) +
                '  dOrigine=' + L.periDist.toFixed(3).padStart(8) +
                '  emprise=' + L.size.toFixed(2).padStart(9) +
                (L.closed ? '  [FERMÉE]' : '') +
                '  ' + L.name);
        });
        console.info('[perihelion] =======================================================');
        console.info('[perihelion] Copier-coller ce bloc en entier pour la v1.2.');
        reported = true;
    }

    // ---- Accroche (chaînable avec vernal-axis-label.js) --------------------
    var proto = THREE.Object3D.prototype;
    if (typeof proto.updateMatrixWorld !== 'function' || proto.__perihelionHook) {
        warn('hook indisponible : script inactif.');
        return;
    }
    var original = proto.updateMatrixWorld;
    proto.__perihelionHook = true;

    proto.updateMatrixWorld = function (force) {
        if (!disabled && !reported) {
            try {
                var o = this;
                if (isScene(o)) {
                    scene = o;
                    // attendre un rendu complet : la scène est vue au 2e passage
                    setTimeout(function () {
                        try { scanAndReport(); } catch (err) { warn('scan : ' + err); }
                    }, 800);
                }
            } catch (err) {
                disabled = true;
                warn('erreur : ' + (err && err.message ? err.message : err));
            }
        }
        return original.apply(this, arguments);
    };
})();
