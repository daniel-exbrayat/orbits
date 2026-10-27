// ============================================================================
// perihelion-markers.js (v1.2) — Orbit Viewer (base nasapsg/orbits)
//
// Diagnostic v1.1 : les orbites planétaires sont des MESH fermés (~1028
// sommets), Soleil à l'origine, unités UA. Périhélies constatés :
//   Mercure 0.307, Vénus 0.718, Terre 0.983, Mars 1.381,
//   Jupiter 4.951, Saturne 9.015, Neptune 29.806 UA.
//
// v1.2 : pose un marqueur « P » au périhélie de chaque orbite.
//   Détection : géométrie FERMÉE (premier≈dernier sommet), ≥ 24 sommets,
//   emprise 0.5–70 UA (rayon des orbites affichables).
//   Position : sommet de distance minimale à l'origine (Soleil).
//   Taille écran constante (technique vernal-axis-label v7/v8 : dérivée de
//   la matrice de projection, convertie en espace local de la scène).
//   Scan déclenché une seule fois, 800 ms après la première image (bug de
//   répétition v1.1 corrigé par le flag `scheduled`).
//
// Installation : <script src="perihelion-markers.js"></script> avant </body>.
// ============================================================================

(function () {
    'use strict';

    var MARKER_TEXT   = 'P';
    var MARKER_COLOR  = '#ff9d5c';
    var MARKER_PX     = 14;      // hauteur apparente du texte à l'écran (pixels)
    var CLOSE_EPS     = 0.05;    // boucle « fermée » si écart < 5 % de l'emprise
    var MIN_VERTS     = 24;
    var MIN_EXTENT    = 0.5;     // UA : ignore les petits débris/junk
    var MAX_EXTENT    = 70;      // UA : ignore les géométries non orbitales
    var DEBUG         = true;

    var markers = [];   // { sprite, mesh, localIndex, name }
    var scene = null;
    var camera = null;
    var scheduled = false;
    var scanned = false;
    var disabled = false;

    function info(m) { try { console.info('[perihelion] ' + m); } catch (e) {} }
    function warn(m) { try { console.warn('[perihelion] ' + m); } catch (e) {} }

    if (typeof THREE === 'undefined' || !THREE.Object3D || !THREE.Object3D.prototype) {
        warn('THREE introuvable : script inactif (charger après include.js).');
        return;
    }

    function isScene(o) { return o && (o.type === 'Scene' || o.isScene === true); }
    function isCamera(o) {
        return o && (o.isCamera === true || o.isPerspectiveCamera === true ||
                     o.type === 'PerspectiveCamera' || o.type === 'OrthographicCamera');
    }

    // ---- Marqueur (sprite à texture canvas, texte mesuré) -------------------
    function buildTexture() {
        var fontPx = 48;
        var fontSpec = 'bold ' + fontPx + 'px Arial, sans-serif';
        var canvas = document.createElement('canvas');
        var m = canvas.getContext('2d');
        m.font = fontSpec;
        var metrics = m.measureText(MARKER_TEXT);
        var ascent = metrics.actualBoundingBoxAscent || fontPx * 0.8;
        var descent = metrics.actualBoundingBoxDescent || fontPx * 0.2;
        var w = Math.ceil(metrics.width) + 16;
        var h = Math.ceil(ascent + descent) + 12;
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.font = fontSpec;
        ctx.fillStyle = MARKER_COLOR;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 4;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.strokeText(MARKER_TEXT, w / 2, 8 + ascent);
        ctx.fillText(MARKER_TEXT, w / 2, 8 + ascent);
        var texture = (typeof THREE.CanvasTexture === 'function')
            ? new THREE.CanvasTexture(canvas) : new THREE.Texture(canvas);
        texture.needsUpdate = true;
        return { texture: texture, aspect: w / h, texToText: h / (ascent + descent) };
    }

    function buildSprite() {
        var t = buildTexture();
        var material = new THREE.SpriteMaterial({
            map: t.texture, transparent: true, depthTest: false, depthWrite: false
        });
        var s = new THREE.Sprite(material);
        s.name = 'perihelionMarker';
        s.userData.aspect = t.aspect;
        s.userData.texToText = t.texToText;
        try { s.raycast = function () {}; } catch (e) {}
        return s;
    }

    // ---- Détection et pose des marqueurs ------------------------------------
    function analyseGeometry(attr) {
        var n = attr.count;
        if (n < MIN_VERTS) return null;
        var a = new THREE.Vector3().fromBufferAttribute(attr, 0);
        var b = new THREE.Vector3().fromBufferAttribute(attr, n - 1);
        var min = new THREE.Vector3(Infinity, Infinity, Infinity);
        var max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        var v = new THREE.Vector3();
        var bestD = Infinity, bestI = -1;
        for (var i = 0; i < n; i++) {
            v.fromBufferAttribute(attr, i);
            min.min(v); max.max(v);
            var d = v.lengthSq();
            if (d < bestD) { bestD = d; bestI = i; }
        }
        var size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
        if (!(size >= MIN_EXTENT && size <= MAX_EXTENT)) return null;
        if (a.distanceTo(b) >= CLOSE_EPS * size) return null; // pas fermée
        return { index: bestI, periAU: Math.sqrt(bestD), extent: size };
    }

    function scanOrbits() {
        scene.traverse(function (o) {
            var g = o.geometry;
            if (!g || !g.attributes || !g.attributes.position) return;
            if (markers.some(function (mk) { return mk.mesh === o; })) return;
            var res = analyseGeometry(g.attributes.position);
            if (!res) return;
            var sprite = buildSprite();
            scene.add(sprite);
            markers.push({ sprite: sprite, mesh: o, localIndex: res.index,
                          periAU: res.periAU, extent: res.extent });
            if (DEBUG) info('marqueur posé : périhélie ' + res.periAU.toFixed(3) +
                            ' UA (emprise ' + res.extent.toFixed(2) + ' AU)');
        });
        info(markers.length + ' marqueur(s) de périhélie actifs.');
        scanned = true;
    }

    // ---- Mise à jour par image -----------------------------------------------
    var _wp = new THREE.Vector3();
    var _probe = new THREE.Vector3();
    var _probe2 = new THREE.Vector3();
    var _m = new THREE.Matrix4();
    var _mi = new THREE.Matrix4();

    function worldHeightForPixels(worldPos, px) {
        _probe.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
        _probe2.copy(_probe); _probe2.y += 1;
        _probe.applyMatrix4(camera.projectionMatrix);
        _probe2.applyMatrix4(camera.projectionMatrix);
        var ndc = Math.abs(_probe2.y - _probe.y);
        if (!isFinite(ndc) || ndc < 1e-9) return null;
        var screenH = window.innerHeight || 800;
        return px / (ndc * (screenH / 2));
    }

    function update() {
        if (!camera.matrixWorldInverse || !camera.projectionMatrix) return;
        var pm = scene.matrixWorld;
        if (!pm) return;
        _m.copy(pm);
        var e = _m.elements;
        var parentScale = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
        if (!isFinite(parentScale) || parentScale <= 0) parentScale = 1;
        _mi.copy(_m);
        if (typeof _mi.invert === 'function') _mi.invert();
        else if (typeof _mi.getInverse === 'function') _mi.getInverse(_m);

        for (var i = 0; i < markers.length; i++) {
            var mk = markers[i];
            var attr = mk.mesh.geometry.attributes.position;
            _wp.fromBufferAttribute(attr, mk.localIndex)
               .applyMatrix4(mk.mesh.matrixWorld);      // espace MONDE
            var texToText = mk.sprite.userData.texToText || 1.7;
            var worldH = worldHeightForPixels(_wp, MARKER_PX * texToText);
            if (worldH === null) { mk.sprite.visible = false; continue; }
            mk.sprite.visible = true;
            _wp.applyMatrix4(_mi);                       // → espace local scène
            mk.sprite.position.copy(_wp);
            var localH = worldH / parentScale;
            mk.sprite.scale.set(localH * mk.sprite.userData.aspect, localH, 1);
        }
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
        if (!disabled) {
            try {
                var o = this;
                if (scene === null && isScene(o)) {
                    scene = o;
                    if (!scheduled) {          // v1.1 : planifié UNE seule fois
                        scheduled = true;
                        setTimeout(function () {
                            try { scanOrbits(); } catch (err) { warn('scan : ' + err); }
                        }, 800);
                    }
                } else if (isCamera(o)) {
                    camera = o;
                } else if (o === scene && scene && camera && scanned) {
                    update();
                }
            } catch (err) {
                disabled = true;
                warn('erreur, marqueurs désactivés : ' + (err && err.message ? err.message : err));
            }
        }
        return original.apply(this, arguments);
    };
})();
