/*
 * vernal-axis-label.js  (v2)
 *
 * Ajoute une étiquette « Point vernal ♈ » sur l'axe +X du visualiseur
 * d'orbites nasapsg/orbits (direction de l'équinoxe de printemps J2000).
 *
 * Installation : placer ce fichier à côté de orbit.html, puis ajouter
 *   <script src="vernal-axis-label.js"></script>
 * en DERNIER, juste après la ligne <script src="ui.js"></script>.
 * (Attention : la balise doit être fermée par </script>, jamais auto-fermée.)
 *
 * v2 : plus aucune modification de THREE.Scene — la scène est récupérée
 * directement via les arguments de renderer.render(). Tout le code est
 * protégé : en cas d'erreur, l'étiquette se désactive d'elle-même et
 * le visualiseur continue de fonctionner normalement.
 */

(function () {
  'use strict';

  // --------------------------- Configuration ---------------------------

  var LABEL_TEXT = 'Point vernal \u2648'; // \u2648 = symbole du Bélier (♈), autre option : 'Vernal Equinox'
  var LABEL_COLOR = '#ffd75e';           // couleur du texte
  var FONT = 'bold 52px Arial, sans-serif';
  var POSITION_RATIO = 0.45; // distance de l'étiquette sur +X : 45 % de la distance caméra ↔ origine (SSB)
  var SIZE_RATIO = 0.16;     // largeur apparente de l'étiquette : 16 % de cette même distance

  // ----------------------------------------------------------------------

  var sprite = null;
  var disabled = false;

  function log(msg) { try { console.warn('[vernal-axis-label] ' + msg); } catch (e) {} }

  /* 1) Étiquette sous forme de sprite à texture canvas */
  function buildSprite() {
    var canvas = document.createElement('canvas');
    var measure = canvas.getContext('2d');
    measure.font = FONT;
    var textWidth = measure.measureText(LABEL_TEXT).width;

    canvas.width = Math.ceil(textWidth) + 48;
    canvas.height = 88;

    var ctx = canvas.getContext('2d');
    ctx.font = FONT;
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
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
    return s;
  }

  /* 2) Position et taille recalculées à chaque rendu (suit le zoom) */
  function update(camera) {
    if (!camera || !camera.position) return;
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

  /* 4) Unique point d'accroche : le rendu. La scène est récupérée via
        arguments[0], la caméra via arguments[1]. Aucune autre API n'est
        modifiée, et toute erreur désactive l'étiquette sans casser le
        visualiseur. */
  var proto = (typeof THREE !== 'undefined' && THREE.WebGLRenderer)
    ? THREE.WebGLRenderer.prototype
    : null;

  if (!proto || typeof proto.render !== 'function') {
    log('THREE.WebGLRenderer introuvable : script inactif.');
    return;
  }
  if (proto.__vernalPatched) return; // éviter un double patch

  var originalRender = proto.render;
  proto.__vernalPatched = true;

  proto.render = function (scene, camera) {
    if (!disabled) {
      try {
        if (!sprite && scene && typeof scene.add === 'function') {
          sprite = buildSprite();
          scene.add(sprite);
          refreshVisibility();
        }
        if (sprite) {
          if (scene && scene.add && sprite.parent !== scene) scene.add(sprite);
          update(camera);
        }
      } catch (e) {
        disabled = true;
        try { if (sprite && sprite.parent) sprite.parent.remove(sprite); } catch (e2) {}
        sprite = null;
        log('Erreur, étiquette désactivée : ' + (e && e.message ? e.message : e));
      }
    }
    return originalRender.apply(this, arguments);
  };
})();
