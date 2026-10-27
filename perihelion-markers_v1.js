// ============================================================================
// perihelion-markers.js (v1) — Orbit Viewer (copie locale, base nasapsg/orbits)
//
// Pour chaque orbite planétaire dessinée, place un marqueur « P » au périhélie
// (point de l'orbite le plus proche du Soleil). Détection géométrique :
//   - une orbite est une LIGNE FERMÉE (premier sommet ≈ dernier), ce qui
//     l'exclut de la grille écliptique et des lignes de rappel ;
//   - le périhélie est le sommet de distance minimale au Soleil (origine).
//
// Cohérence avec vernal-axis-label.js v8+ :
//   - accroche sur THREE.Object3D.prototype.updateMatrixWorld (chaînable
//     avec le hook de vernal-axis-label, aucun conflit) ;
//   - positions calculées en espace MONDE via la matrice de chaque ligne
//     d'orbite, puis converties en espace local du marqueur (inverse de la
//     matrice monde de la scène), taille divisée par l'échelle de la scène ;
//   - taille écran CONSTANTE, dérivée de la matrice de projection (comme v7).
//
// Installation : à côté de orbit.html, puis avant </body> :
//   <script src="perihelion-markers.js"></script>
//
// DEBUG = true : liste dans la console les lignes candidates détectées
// (nombre de sommets, nom si disponible) — première exécution : coller la
// sortie console pour valider/affiner la détection.
// ============================================================================

(function () {
    'use strict';

    var MARKER_TEXT   = 'P';        // glyphe du marqueur
    var MARKER_COLOR  = '#ff9d5c';  // couleur du texte
    var MARKER_PX     = 14;         // hauteur apparente du texte à l'écran (pixels)
    var CLOSE_EPS     = 0.05;       // boucle « fermée » si écart premier/dernier sommet < ceci × taille
    var MIN_VERTS     = 24;         // en dessous : pas une orbite
    var DEBUG         = true;

    var markers = [];   // { sprite, line, localIndex }
    var scene = null;
    var camera = null;
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

    // ---- Texture du marqueur (canvas, texte réel mesuré — cf. v9) -----------
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
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';  // liseré pour lisibilité sur orbite claire
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

    // ---- Détection des lignes d'orbite (boucles fermées) -------------------
    function isClosedLoop(attr) {
        var n = attr.count;
        if (n < MIN_VERTS) return false;
        var a = new THREE.Vector3().fromBufferAttribute(attr, 0);
        var b = new THREE.Vector3().fromBufferAttribute(attr, n - 1);
        // taille de la boucle : emprise max des sommets
        var min = new THREE.Vector3(Infinity, Infinity, Infinity);
        var max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        var v = new THREE.Vector3();
        for (var i = 0; i < n; i += 4) { // échantillonner : vitesse suffisante
            v.fromBufferAttribute(attr, i);
            min.min(v); max.max(v);
        }
        var size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
        if (!(size > 0)) return false;
        return a.distanceTo(b) < CLOSE_EPS * size;
    }

    /* Périhélie : sommet le plus proche de l'ORIGINE du repère local de la
       ligne (le Soleil/SSB est à l'origine du repère des orbites). Renvoie
       {index, distance} ou null. */
    function findPerihelion(attr) {
        var best = null, bestD = Infinity;
        var v = new THREE.Vector3();
        for (var i = 0; i < attr.count; i++) {
            v.fromBufferAttribute(attr, i);
            var d = v.lengthSq();
            if (d < bestD) { bestD = d; best = i; }
        }
        return (best === null) ? null : { index: best, distance: Math.sqrt(bestD) };
    }

    function objectName(o) {
        var names = [];
        var c = o;
        for (var i = 0; i < 3 && c; i++) {
            if (c.name) names.push(c.name);
            c = c.parent;
        }
        return names.join(' < ') || '(sans nom)';
    }

    function scanOrbits() {
        var candidates = 0;
        scene.traverse(function (o) {
            if (disabled) return;
            var g = o.geometry;
            if (!g || !g.attributes || !g.attributes.position) return;
            if (markers.some(function (mk) { return mk.line === o; })) return;
            var attr = g.attributes.position;
            if (!isClosedLoop(attr)) return;
            candidates++;
            var peri = findPerihelion(attr);
            if (!peri) return;
            var sprite = buildSprite();
            scene.add(sprite);
            markers.push({ sprite: sprite, line: o, localIndex: peri.index, name: objectName(o) });
            if (DEBUG) info('orbite détectée : ' + objectName(o) + '  sommets=' + attr.count +
                            '  périhélie≈' + peri.distance.toFixed(3) + ' unités');
        });
        if (DEBUG) info('scan : ' + candidates + ' boucle(s) fermée(s), ' + markers.length + ' marqueur(s) posé(s).');
        scanned = true;
    }

    // ---- Mise à jour par image : position monde → local, taille écran -------
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
            var attr = mk.line.geometry.attributes.position;
            _wp.fromBufferAttribute(attr, mk.localIndex)
               .applyMatrix4(mk.line.matrixWorld);      // position MONDE du périhélie
            var texToText = mk.sprite.userData.texToText || 1.7;
            var worldH = worldHeightForPixels(_wp, MARKER_PX * texToText);
            if (worldH === null) { mk.sprite.visible = false; continue; }
            mk.sprite.visible = true;
            _wp.applyMatrix4(_mi);                      // → espace local de la scène
            mk.sprite.position.copy(_wp);
            var localH = worldH / parentScale;
            mk.sprite.scale.set(localH * mk.sprite.userData.aspect, localH, 1);
        }
    }

    /* Visibilité liée à la case « Orbit » de chaque objet : simplification —
       suivre le réglage global « Planet Labels » (id galaxy des labels). */
    function refreshVisibility() {
        var toggle = document.getElementById('planet-labels-toggle');
        var show = !toggle || toggle.checked;
        for (var i = 0; i < markers.length; i++) markers[i].sprite.visible = markers[i].sprite.visible && show;
        markers._show = show;
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
                if (scene === null && isScene(o)) scene = o;
                else if (isCamera(o)) camera = o;
                else if (o === scene && scene && camera) {
                    if (!scanned) scanOrbits();
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
