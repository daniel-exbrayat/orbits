/*
 * vernal-axis-label.js  (v7)
 *
 * Ajoute une étiquette « Point vernal ♈ » sur l'axe +X du visualiseur
 * d'orbites nasapsg/orbits (direction de l'équinoxe de printemps J2000).
 *
 * Installation : placer ce fichier à côté de orbit.html, puis ajouter
 *   <script src="vernal-axis-label.js"></script>
 * en DERNIER, juste après la ligne <script src="ui.js"></script>.
 *
 * v3 : accroche sur THREE.Object3D.prototype.updateMatrixWorld, méthode
 * présente sur le prototype dans TOUTES les versions de three.js (r50 à
 * r170+) et appelée à chaque rendu sur la scène et sur la caméra —
 * contrairement à renderer.render, qui est une méthode d'instance dans les
 * versions r70–r140. Le visualiseur lui-même n'est pas modifié ; en cas
 * d'erreur, l'étiquette se désactive seule sans rien casser.
 *
 * v4 : la taille de l'étiquette suit désormais le réglage « Label Font
 * Size » du visualiseur (champ #font_input des paramètres, ou
 * JPL.Config.labelFontSize si exposé). La référence est la valeur par
 * défaut constatée au chargement ; toute variation de ce réglage
 * agrandit/réduit l'étiquette proportionnellement (avec régénération de
 * la texture pour rester nette).
 *
 * v5 : l'étiquette est placée près du bord droit de la vue, au bout de
 * l'axe +X (point vernal), et sa hauteur apparente à l'écran est
 * CONSTANTE : elle ne grandit ni ne rétrécit quand on zoome/dézoome.
 * Seul le réglage « Label Font Size » modifie sa taille.
 *
 * v6 : la caméra du visualiseur est montée sur un support (sa position
 * locale n'est pas sa position monde) et le zoom passe par le champ de
 * vision — les formules v5 plaçaient donc l'étiquette près du Soleil.
 * v6 résout la position PAR PROJECTION : elle cherche, le long de l'axe
 * +X, le point qui se projette près du bord de la fenêtre (côté où
 * l'axe s'étend à l'écran), via camera.matrixWorldInverse et
 * camera.projectionMatrix.
 *
 * v7 : la taille écran constante est désormais dérivée DIRECTEMENT de la
 * matrice de projection (écart NDC entre le point et un point décalé
 * d'une unité) : insensible au fov, au facteur camera.zoom et au type
 * de caméra — donc réellement invariable au zoom, quelle que soit la
 * façon dont le visualiseur l'implémente.
 *
 * Astuce diagnostic : passer DEBUG = true pour suivre la détection
 * (scène, caméra, ajout du sprite) dans la console (F12).
 */

(function () {
  'use strict';

  // --------------------------- Configuration ---------------------------

  var LABEL_TEXT = 'Point vernal \u2648'; // \u2648 = symbole du Bélier (♈), autre option : 'Vernal Equinox'
  var LABEL_COLOR = '#ffd75e';           // couleur du texte
  var FONT_SIZE = 52;                     // taille de base du texte (pixels de texture)
  var FONT_WEIGHT = 'bold';
  var FONT_FAMILY = 'Arial, sans-serif';
  var EDGE_NDC = 0.85;       // position : bord visé en coordonnées écran (0.85 ≈ 85 % de la demi-largeur ; 1.0 = bord exact)
  var TEXT_SCREEN_PX = 20;   // hauteur apparente du TEXTE à l'écran en pixels, avant application du réglage « Label Font Size »
  var TEXT_TO_TEXTURE = 1.7; // hauteur de la texture ≈ 1.7 × hauteur du texte
  var DEBUG = true;         // true = messages de diagnostic dans la console

  // ----------------------------------------------------------------------

  var sprite = null;
  var scene = null;
  var camera = null;
  var disabled = false;
  var baselineFont = null;  // valeur de référence du réglage « Label Font Size »
  var builtScale = 1;       // échelle de texture déjà générée

  function info(msg) { try { console.info('[vernal-axis-label] ' + msg); } catch (e) {} }
  function warn(msg) { try { console.warn('[vernal-axis-label] ' + msg); } catch (e) {} }

  if (typeof THREE === 'undefined' || !THREE.Object3D || !THREE.Object3D.prototype) {
    warn('THREE introuvable : script inactif (charger après include.js).');
    return;
  }

  function isScene(o) {
    return o && (o.type === 'Scene' || o.isScene === true);
  }
  function isCamera(o) {
    return o && (o.isCamera === true || o.isPerspectiveCamera === true ||
                 o.type === 'PerspectiveCamera' || o.type === 'OrthographicCamera');
  }

  /* Lit la valeur du réglage « Label Font Size » du visualiseur. */
  function readFontValue() {
    var v = null;
    // 1) configuration interne du visualiseur, si elle est exposée
    try {
      var cfg = (typeof JPL !== 'undefined' && JPL && JPL.Config) ? JPL.Config : null;
      if (cfg) {
        var keys = ['labelFontSize', 'fontSize', 'labelFont', 'font_size', 'labelSize'];
        for (var i = 0; i < keys.length; i++) {
          var val = parseFloat(cfg[keys[i]]);
          if (isFinite(val) && val > 0) { v = val; break; }
        }
      }
    } catch (e) {}
    // 2) champ « Label Font Size » des paramètres (orbit.html)
    if (v === null) {
      var input = document.getElementById('font_input');
      if (input && input.value !== undefined && input.value !== '') {
        var f = parseFloat(input.value);
        if (isFinite(f) && f > 0) v = f;
      }
    }
    return v;
  }

  /* Multiplicateur par rapport à la valeur par défaut du visualiseur,
     mémorisée à la première lecture. */
  function getFontScale() {
    var v = readFontValue();
    if (v === null) return 1;
    if (baselineFont === null) {
      baselineFont = v;
      if (DEBUG) info('réglage « Label Font Size » de référence : ' + v);
    }
    var s = v / baselineFont;
    return (isFinite(s) && s > 0) ? s : 1;
  }

  /* 1) Étiquette sous forme de sprite à texture canvas */
  function buildTexture(fontPx) {
    fontPx = Math.max(8, Math.min(200, fontPx || FONT_SIZE));
    var fontSpec = FONT_WEIGHT + ' ' + fontPx + 'px ' + FONT_FAMILY;

    var canvas = document.createElement('canvas');
    var measure = canvas.getContext('2d');
    measure.font = fontSpec;
    var textWidth = measure.measureText(LABEL_TEXT).width;

    canvas.width = Math.ceil(textWidth) + 48;
    canvas.height = Math.ceil(fontPx * 1.7);

    var ctx = canvas.getContext('2d');
    ctx.font = fontSpec;
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(LABEL_TEXT, canvas.width / 2, canvas.height / 2);

    var texture = (typeof THREE.CanvasTexture === 'function')
      ? new THREE.CanvasTexture(canvas)
      : new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return { texture: texture, aspect: canvas.width / canvas.height };
  }

  function buildSprite() {
    var t = buildTexture(FONT_SIZE);
    var material = new THREE.SpriteMaterial({
      map: t.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    var s = new THREE.Sprite(material);
    s.name = 'vernalAxisLabel';
    s.userData.aspect = t.aspect;
    try { s.raycast = function () {}; } catch (e) {} // neutre pour le picking de la souris
    if (DEBUG) info('sprite créé');
    return s;
  }

  /* 2) Position et taille, recalculées à chaque image.
        - position : résolue PAR PROJECTION — on cherche, le long de l'axe
          +X (point vernal), le point qui se projette près du bord de la
          fenêtre, du côté où l'axe s'étend à l'écran (droite par défaut,
          gauche si la vue a été tournée de 180°) ;
        - taille : hauteur CONSTANTE à l'écran, indépendante du zoom,
          modulée uniquement par le réglage « Label Font Size ». */
  var _p = new THREE.Vector3();
  var _v1 = new THREE.Vector3();
  var _v2 = new THREE.Vector3();
  var _v3 = new THREE.Vector3();
  var lastT = null;

  /* Hauteur MONDE nécessaire pour que l'étiquette mesure « labelPx » pixels
     à l'écran. Dérivée de la matrice de projection elle-même : on mesure
     l'écart NDC entre la position monde et la même position décalée d'une
     unité vers le haut dans l'espace vue. Insensible au fov, au facteur
     camera.zoom (qui multiplie la projection) et au type de caméra. */
  function worldHeightForPixels(worldPos, labelPx) {
    _v1.copy(worldPos).applyMatrix4(camera.matrixWorldInverse); // espace vue
    _v2.copy(_v1);
    _v2.y += 1;                                                  // 1 unité plus haut
    _v3.copy(_v1).applyMatrix4(camera.projectionMatrix);          // NDC du centre
    _v2.applyMatrix4(camera.projectionMatrix);                    // NDC du point décalé
    var ndcPerUnit = Math.abs(_v2.y - _v3.y);
    if (!isFinite(ndcPerUnit) || ndcPerUnit < 1e-9) return null;
    var screenH = window.innerHeight || 800;
    return labelPx / (ndcPerUnit * (screenH / 2)); // NDC [-1 ; 1] ↔ screenH px
  }

  /* Projection NDC (±1) du point (t,0,0) de l'axe ; front = devant la caméra */
  function probe(t) {
    _p.set(t, 0, 0).applyMatrix4(camera.matrixWorldInverse);
    var front = _p.z < 0; // repère vue : -Z vers l'avant
    _p.applyMatrix4(camera.projectionMatrix);
    return { x: _p.x, front: front };
  }

  /* Recherche du t (en UA sur l'axe +X) dont la projection atteint ±EDGE_NDC */
  function solveEdge() {
    var o = probe(0);
    if (!o || !o.front) return null;

    var prevT = 0, prevX = o.x, dir = 0;
    for (var i = -2; i <= 5; i++) {         // t : 0.01 → 100 000 UA
      var t = Math.pow(10, i);
      var c = probe(t);
      if (!c.front) break;                  // l'axe passe derrière la caméra
      if (dir === 0) {
        if (c.x - prevX > 1e-6) dir = 1;    // l'axe s'étend vers la droite à l'écran
        else if (c.x - prevX < -1e-6) dir = -1; // ... ou vers la gauche
      }
      if (dir !== 0 && dir * c.x >= EDGE_NDC) {
        // bissection entre prevT et t
        var lo = prevT, hi = t;
        for (var k = 0; k < 14; k++) {
          var mid = (lo + hi) / 2, m = probe(mid);
          if (m.front && dir * m.x >= EDGE_NDC) hi = mid; else lo = mid;
        }
        return (lo + hi) / 2;
      }
      prevT = t;
      prevX = c.x;
    }
    return prevT > 0 ? prevT : null;         // bord non atteint : dernier point valide
  }

  function update() {
    if (!sprite || !camera || !camera.position) return;

    // suivre le réglage « Label Font Size » du visualiseur
    var scale = getFontScale();
    if (isFinite(scale) && scale > 0 && Math.abs(scale - builtScale) > 0.3) {
      try {
        var t0 = buildTexture(FONT_SIZE * scale);
        var oldMap = sprite.material.map;
        sprite.material.map = t0.texture;
        sprite.userData.aspect = t0.aspect;
        sprite.material.needsUpdate = true;
        if (oldMap && oldMap.dispose) oldMap.dispose();
        builtScale = scale;
        if (DEBUG) info('texture régénérée (échelle ' + scale.toFixed(2) + ')');
      } catch (e) { /* conserver la texture actuelle */ }
    }

    if (!camera.matrixWorldInverse || !camera.projectionMatrix) return;

    // --- position : point de l'axe +X projeté près du bord de la fenêtre ---
    var t = solveEdge();
    if (t === null || !isFinite(t) || t <= 0) {
      if (lastT === null) return;
      t = lastT; // conserver la dernière position valide
    }
    lastT = t;
    sprite.position.set(t, 0, 0);

    // --- taille : hauteur constante à l'écran, dérivée de la projection ---
    var labelPx = TEXT_SCREEN_PX * scale * TEXT_TO_TEXTURE;
    _p.set(t, 0, 0);
    var worldH = worldHeightForPixels(_p, labelPx);
    if (worldH === null) return;
    sprite.scale.set(worldH * sprite.userData.aspect, worldH, 1);
  }

  /* 3) Visibilité liée à la case « Ecliptic Axes » des paramètres */
  function refreshVisibility() {
    if (!sprite) return;
    var toggle = document.getElementById('ecliptic-axis-toggle');
    sprite.visible = !toggle || toggle.checked;
  }
  document.addEventListener('change', function (evt) {
    try {
      if (evt.target && evt.target.id === 'ecliptic-axis-toggle') refreshVisibility();
    } catch (e) {}
  });

  /* 4) Accroche : updateMatrixWorld est appelée sur la scène et sur la
        caméra à chaque rendu, quelle que soit la version de three.js. */
  var proto = THREE.Object3D.prototype;
  if (typeof proto.updateMatrixWorld !== 'function' || proto.__vernalHook) {
    warn('hook indisponible : script inactif.');
    return;
  }

  var originalUpdateMatrixWorld = proto.updateMatrixWorld;
  proto.__vernalHook = true;

  proto.updateMatrixWorld = function (force) {
    if (!disabled) {
      try {
        var o = this;
        if (scene === null && isScene(o)) {
          scene = o;
          if (DEBUG) info('scène détectée');
        } else if (isCamera(o)) {
          camera = o; // toujours garder la caméra la plus récente
        } else if (o === scene) {
          // une image de rendu : garantir la présence et recalculer
          if (!sprite) {
            sprite = buildSprite();
            refreshVisibility();
            info('étiquette « ' + LABEL_TEXT + ' » ajoutée sur l\'axe +X');
          }
          if (scene.children.indexOf(sprite) === -1) scene.add(sprite);
          update();
          refreshVisibility();
        }
      } catch (e) {
        disabled = true;
        try { if (sprite && sprite.parent) sprite.parent.remove(sprite); } catch (e2) {}
        sprite = null;
        warn('erreur, étiquette désactivée : ' + (e && e.message ? e.message : e));
      }
    }
    return originalUpdateMatrixWorld.apply(this, arguments);
  };
})();
