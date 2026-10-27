/*
 * vernal-axis-label.js  (v5)
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
  var EDGE_RATIO = 0.85;     // position sur +X : fraction du demi-axe visible (0.85 = proche du bord droit ; 1.0 = bord exact ; 0.5 = mi-course)
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

  /* 2) Position (bout droit de l'axe +X) et taille CONSTANTE à l'écran.
        Recalculées à chaque image ; seuls le réglage « Label Font Size »
        et le cadrage de la caméra (ratio) influencent la taille apparente,
        jamais le niveau de zoom. */
  function update() {
    if (!sprite || !camera || !camera.position) return;

    // suivre le réglage « Label Font Size » du visualiseur
    var scale = getFontScale();
    if (isFinite(scale) && scale > 0 && Math.abs(scale - builtScale) > 0.3) {
      try {
        var t = buildTexture(FONT_SIZE * scale);
        var oldMap = sprite.material.map;
        sprite.material.map = t.texture;
        sprite.userData.aspect = t.aspect;
        sprite.material.needsUpdate = true;
        if (oldMap && oldMap.dispose) oldMap.dispose();
        builtScale = scale;
        if (DEBUG) info('texture régénérée (échelle ' + scale.toFixed(2) + ')');
      } catch (e) { /* conserver la texture actuelle */ }
    }

    var d0 = camera.position.length(); // distance caméra ↔ origine (SSB)
    if (!isFinite(d0) || d0 <= 0) return;
    var fovRad = ((camera.fov || 60) * Math.PI) / 180;

    // --- position : extrémité droite de l'axe +X (point vernal) ---
    // hauteur visible à la profondeur de l'origine, convertie en largeur
    var vh0 = camera.isOrthographicCamera
      ? (camera.top - camera.bottom)
      : 2 * d0 * Math.tan(fovRad / 2);
    var vw0 = vh0 * (camera.aspect || 1.6);
    // +X = direction du point vernal (équinoxe de printemps J2000).
    // Pour un autre axe : (0, (vh0 / 2) * EDGE_RATIO, 0) ou (0, 0, ...).
    sprite.position.set((vw0 / 2) * EDGE_RATIO, 0, 0);

    // --- taille : hauteur constante à l'écran, indépendante du zoom ---
    var dist = camera.position.distanceTo(sprite.position);
    var vh = camera.isOrthographicCamera
      ? (camera.top - camera.bottom)
      : 2 * dist * Math.tan(fovRad / 2);
    var screenH = window.innerHeight || 800;
    var labelPx = TEXT_SCREEN_PX * scale * TEXT_TO_TEXTURE;
    var worldH = vh * (labelPx / screenH);
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
