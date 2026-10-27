/*
 * vernal-axis-label.js  (v3)
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
 * Astuce diagnostic : passer DEBUG = true pour suivre la détection
 * (scène, caméra, ajout du sprite) dans la console (F12).
 */

(function () {
  'use strict';

  // --------------------------- Configuration ---------------------------

  var LABEL_TEXT = 'Axe vernal \u2648'; // \u2648 = symbole du Bélier (♈), autre option : 'Vernal Equinox'
  var LABEL_COLOR = '#ffd75e';           // couleur du texte
  var FONT = 'bold 72px Arial, sans-serif'; 	// 'bold 52px Arial, sans-serif';
  var POSITION_RATIO = 0.8	// 0.45; // distance de l'étiquette sur +X : 45 % de la distance caméra ↔ origine (SSB)
  var SIZE_RATIO = 0.16;     // largeur apparente de l'étiquette : 16 % de cette même distance
  var DEBUG = false;         // true = messages de diagnostic dans la console

  // ----------------------------------------------------------------------

  var sprite = null;
  var scene = null;
  var camera = null;
  var disabled = false;

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

  /* 1) Étiquette sous forme de sprite à texture canvas */
  function buildSprite() {
    var canvas = document.createElement('canvas');
    var measure = canvas.getContext('2d');
    measure.font = FONT;
    var textWidth = measure.measureText(LABEL_TEXT).width;

    canvas.width = Math.ceil(textWidth) + 48;
    canvas.height = 120;	// 88;

    var ctx = canvas.getContext('2d');
    ctx.font = FONT;
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';	// 'middle';
    ctx.fillText(LABEL_TEXT, canvas.width / 2, canvas.height / 2);

    var texture = (typeof THREE.CanvasTexture === 'function')
      ? new THREE.CanvasTexture(canvas)
      : new THREE.Texture(canvas);
    texture.needsUpdate = true;

    var material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    var s = new THREE.Sprite(material);
    s.name = 'vernalAxisLabel';
    s.userData.aspect = canvas.width / canvas.height;
    try { s.raycast = function () {}; } catch (e) {} // neutre pour le picking de la souris
    if (DEBUG) info('sprite créé (texture ' + canvas.width + 'x' + canvas.height + ')');
    return s;
  }

  /* 2) Position et taille recalculées à chaque image (suit le zoom) */
  function update() {
    if (!sprite || !camera || !camera.position) return;
    var d = camera.position.length();
    if (!isFinite(d) || d <= 0) return;

    // +X = direction du point vernal (équinoxe de printemps J2000).
    // Si l'étiquette n'apparaît pas sur le bon axe chez vous, essayez
    // (0, d * POSITION_RATIO, 0) ou (0, 0, d * POSITION_RATIO).
    sprite.position.set(d * POSITION_RATIO, 0, 0);

    var w = d * SIZE_RATIO;
    sprite.scale.set(w, w / sprite.userData.aspect, 1);
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
