// ============================================================================
// perihelion-markers.js (v3) — Orbit Viewer (base nasapsg/orbits)
//
// Changements v2 → v3 (retour utilisateur : écran trop chargé) :
//   - le marqueur est désormais un POINT (•) posé exactement sur le
//     périhélie, avec « P <Planète> » affiché À DROITE du point ;
//   - le libellé suit l'horizontale ÉCRAN (droite de la caméra), pas la
//     direction monde — le texte reste lisible quelle que soit l'orientation.
//
// Pour enlever les noms de planètes qui tournent autour (demande a) : tester
// d'abord le réglage NATIF du visualiseur — Settings → décocher
// « Planet Labels » (les points des planètes restent, seul le texte disparaît).
// Si la case enlève aussi les points, me le signaler : on masquera
// sélectivement les sprites de texte du visualiseur en v4.
//
// Identification par périhélie (UA, J2000) — inchangée depuis v2 :
//   Mercure 0.3070, Vénus 0.7183, Terre 0.9833, Mars 1.3814,
//   Jupiter 4.9511, Saturne 9.0150, Uranus 18.2861, Neptune 29.8063.
//
// Installation : <script src="perihelion-markers.js"></script> avant </body>.
// ============================================================================

(function () {
    'use strict';

    var SCRIPT_VERSION = 'v3.3';

    // Enregistrement + journal au chargement (convention maison, cf. overlay) :
    //   window.__scriptVersions['perihelion-markers.js'] = 'v3.2'
    //   → console : [load] perihelion-markers.js v3.2
    (function () {
        window.__scriptVersions = window.__scriptVersions || {};
        window.__scriptVersions['perihelion-markers.js'] = SCRIPT_VERSION;
        try { console.info('[load] perihelion-markers.js ' + SCRIPT_VERSION); } catch (e) {}
    })();

    var MARKER_COLOR  = '#ff9d5c';
    var DOT_RADIUS_PX = 7;       // rayon du point en pixels de texture
    var TEXT_GPX      = 10;       // écart point → texte (pixels de texture)
    var MARKER_PX     = 14;       // hauteur apparente du TEXTE à l'écran (px)
    var CLOSE_EPS     = 0.05;
    var MIN_VERTS     = 24;
    var MIN_EXTENT    = 0.5;      // UA
    var MAX_EXTENT    = 70;       // UA
    var ID_TOLERANCE  = 0.02;
    var DEBUG         = true;

    var PLANETS = [
        { name: 'Mercure', q: 0.3070 },
        { name: 'Vénus',   q: 0.7183 },
        { name: 'Terre',   q: 0.9833 },
        { name: 'Mars',    q: 1.3814 },
        { name: 'Jupiter', q: 4.9511 },
        { name: 'Saturne', q: 9.0150 },
        { name: 'Uranus',  q: 18.2861 },
        { name: 'Neptune', q: 29.8063 }
    ];

    var markers = [];
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

    function identifyPlanet(q) {
        for (var i = 0; i < PLANETS.length; i++) {
            if (Math.abs(q - PLANETS[i].q) / PLANETS[i].q <= ID_TOLERANCE) return PLANETS[i].name;
        }
        return null;
    }

    // ---- Texture : [•  P Nom] avec le point à GAUCHE du texte ---------------
    /* Le canevas contient le point (disque plein + liseré) puis le texte.
       Renvoie aussi « dotCenterX » : abscisse du centre du point dans le
       canevas, pour poser le point exactement sur le périhélie (le sprite
       sera décalé vers la droite de l'écran en conséquence). */
    function buildTexture(text) {
        var fontPx = 48;
        var fontSpec = 'bold ' + fontPx + 'px Arial, sans-serif';
        var meas = document.createElement('canvas').getContext('2d');
        meas.font = fontSpec;
        var metrics = meas.measureText(text);
        var ascent = metrics.actualBoundingBoxAscent || fontPx * 0.8;
        var descent = metrics.actualBoundingBoxDescent || fontPx * 0.2;
        var textH = ascent + descent;
        var dotR = DOT_RADIUS_PX;
        var pad = 8;

        var w = Math.ceil(pad + dotR * 2 + TEXT_GPX + metrics.width + pad);
        var h = Math.ceil(Math.max(textH, dotR * 2) + 2 * pad);
        var dotCenterX = pad + dotR;
        var centerY = h / 2;

        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        // point
        ctx.beginPath();
        ctx.arc(dotCenterX, centerY, dotR, 0, 2 * Math.PI);
        ctx.fillStyle = MARKER_COLOR;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 3;
        ctx.fill(); ctx.stroke();
        // texte
        ctx.font = fontSpec;
        ctx.fillStyle = MARKER_COLOR;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 4;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        var tx = pad + dotR * 2 + TEXT_GPX;
        ctx.strokeText(text, tx, centerY + ascent / 2);
        ctx.fillText(text, tx, centerY + ascent / 2);

        var texture = (typeof THREE.CanvasTexture === 'function')
            ? new THREE.CanvasTexture(canvas) : new THREE.Texture(canvas);
        texture.needsUpdate = true;
        return {
            texture: texture, aspect: w / h, texToText: h / textH,
            dotOffsetFrac: (dotCenterX - w / 2) / w   // négatif : point à gauche du centre
        };
    }

    function buildSprite(text) {
        var t = buildTexture(text);
        var material = new THREE.SpriteMaterial({
            map: t.texture, transparent: true, depthTest: false, depthWrite: false
        });
        var s = new THREE.Sprite(material);
        s.name = 'perihelionMarker';
        s.userData.aspect = t.aspect;
        s.userData.texToText = t.texToText;
        s.userData.dotOffsetFrac = t.dotOffsetFrac;
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
        if (a.distanceTo(b) >= CLOSE_EPS * size) return null;
        return { index: bestI, periAU: Math.sqrt(bestD), extent: size };
    }

    function scanOrbits() {
        scene.traverse(function (o) {
            var g = o.geometry;
            if (!g || !g.attributes || !g.attributes.position) return;
            if (markers.some(function (mk) { return mk.mesh === o; })) return;
            var res = analyseGeometry(g.attributes.position);
            if (!res) return;
            var planet = identifyPlanet(res.periAU);
            var label = planet ? ('P ' + planet) : 'P ?';
            var sprite = buildSprite(label);
            scene.add(sprite);
            markers.push({ sprite: sprite, mesh: o, localIndex: res.index,
                          periAU: res.periAU, planet: planet });
            info('marqueur posé : « ' + label + ' »  (périhélie ' + res.periAU.toFixed(3) + ' UA)');
        });
        info(markers.length + ' marqueur(s) de périhélie actifs.');
        scanned = true;
    }

    // ---- Mise à jour par image -----------------------------------------------
    var _wp = new THREE.Vector3();
    var _right = new THREE.Vector3();
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

    // ---- Maintenance : le viewer réécrit/recrée les orbites au zoom extrême.
    // Périodiquement (≈1 s) : retirer les marqueurs dont le mesh a disparu,
    // scanner les nouveaux meshes, recalculer l'indice du périhélie de chaque
    // orbite restante (les sommets peuvent avoir été réécrits).
    var _frameCount = 0;

    function meshIsInScene(mesh) {
        var found = false;
        scene.traverse(function (o) { if (o === mesh) found = true; });
        return found;
    }

    function maintenance() {
        // 1) purge des marqueurs orphelins
        var kept = [];
        for (var i = 0; i < markers.length; i++) {
            var mk = markers[i];
            if (meshIsInScene(mk.mesh)) kept.push(mk);
            else {
                try {
                    if (mk.sprite.parent) mk.sprite.parent.remove(mk.sprite);
                    if (mk.sprite.material.map) mk.sprite.material.map.dispose();
                    mk.sprite.material.dispose();
                } catch (e) {}
                info('marqueur retiré (orbite disparue, périhélie ' + mk.periAU.toFixed(3) + ' UA)');
            }
        }
        markers = kept;

        // 2) nouveaux meshes (corps ajoutés, scène reconstruite)
        scanOrbits();

        // 3) recalcul du sommet périhélie (géométrie réécrite au zoom extrême)
        for (var j = 0; j < markers.length; j++) {
            var m = markers[j];
            var attr = m.mesh.geometry.attributes.position;
            var bestD = Infinity, bestI = m.localIndex;
            for (var k = 0; k < attr.count; k++) {
                var x = attr.getX(k), y = attr.getY(k), z = attr.getZ(k);
                var d = x * x + y * y + z * z;
                if (d < bestD) { bestD = d; bestI = k; }
            }
            if (bestI !== m.localIndex) {
                m.localIndex = bestI;
                m.periAU = Math.sqrt(bestD);
                if (DEBUG) info('périhélie recalculé : ' + (m.planet || '?') +
                                ' → ' + m.periAU.toFixed(3) + ' UA');
            }
        }
    }

    function update() {
        if (!camera.matrixWorldInverse || !camera.projectionMatrix) return;
        var pm = scene.matrixWorld;
        if (!pm) return;
        if (++_frameCount % 60 === 0) { try { maintenance(); } catch (err) { warn('maintenance : ' + err); } }
        _m.copy(pm);
        var e = _m.elements;
        var parentScale = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
        if (!isFinite(parentScale) || parentScale <= 0) parentScale = 1;
        _mi.copy(_m);
        if (typeof _mi.invert === 'function') _mi.invert();
        else if (typeof _mi.getInverse === 'function') _mi.getInverse(_m);

        // direction « droite » à l'ÉCRAN (colonne 0 de la caméra, en monde)
        _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();

        for (var i = 0; i < markers.length; i++) {
            var mk = markers[i];
            var attr = mk.mesh.geometry.attributes.position;
            _wp.fromBufferAttribute(attr, mk.localIndex)
               .applyMatrix4(mk.mesh.matrixWorld);        // périhélie, espace MONDE

            var texToText = mk.sprite.userData.texToText || 1.7;
            var worldH = worldHeightForPixels(_wp, MARKER_PX * texToText);
            if (worldH === null) { mk.sprite.visible = false; continue; }
            mk.sprite.visible = true;

            // Décaler le sprite pour que le POINT (à gauche du canevas) soit
            // posé exactement sur le périhélie. Le point est à
            // dotOffsetFrac × largeur à GAUCHE du centre du sprite
            // (dotOffsetFrac < 0) → décaler le centre vers la DROITE de
            // −dotOffsetFrac × largeur monde pour ramener le point au périhélie.
            var worldW = worldH * mk.sprite.userData.aspect;
            _wp.addScaledVector(_right, -(mk.sprite.userData.dotOffsetFrac || 0) * worldW);

            _wp.applyMatrix4(_mi);                          // → espace local scène
            mk.sprite.position.copy(_wp);
            var localH = worldH / parentScale;
            mk.sprite.scale.set(localH * mk.sprite.userData.aspect, localH, 1);
        }
    }

    // Compte les géométries d'orbite qualifiables dans une scène — sert à ne
    // JAMAIS basculer vers une scène secondaire vide (bug v3.1 : le viewer
    // possède plusieurs Scene ; la bascule aveugle vidait les marqueurs).
    function countQualifyingMeshes(sc) {
        var n = 0;
        sc.traverse(function (o) {
            var g = o.geometry;
            if (!g || !g.attributes || !g.attributes.position) return;
            if (analyseGeometry(g.attributes.position)) n++;
        });
        return n;
    }

    // ---- Accroche -------------------------------------------------------------
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
                if (isScene(o) && o !== scene) {
                    if (scene === null) {
                        // TOUTE PREMIÈRE scène : l'accepter sans condition —
                        // les orbites ne sont pas encore chargées à cet instant
                        // (le scan a lieu 800 ms plus tard).
                        scene = o;
                        scheduled = true;
                        setTimeout(function () {
                            try { scanOrbits(); } catch (err) { warn('scan : ' + err); }
                        }, 800);
                    } else {
                        // changement ULTÉRIEUR de scène : ne basculer QUE si la
                        // candidate contient des orbites qualifiables (le viewer
                        // possède des scènes secondaires vides)
                        if (countQualifyingMeshes(o) > 0) {
                            scene = o;
                            markers = [];
                            setTimeout(function () {
                                try { scanOrbits(); } catch (err) { warn('scan : ' + err); }
                            }, 800);
                        }
                    }
                } else if (isScene(o)) {
                    if (!scheduled) {
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
