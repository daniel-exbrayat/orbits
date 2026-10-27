/*
 * vernal-axis-label.js
 *
 * Ajoute une étiquette « Point vernal ♈ » sur l'axe +X du visualiseur
 * d'orbites nasapsg/orbits (direction de l'équinoxe de printemps J2000,
 * déjà matérialisée par l'axe le plus lumineux de « Ecliptic Axes »).
 *
 * Installation : placer ce fichier à côté de orbit.html, puis ajouter
 *   <script src="vernal-axis-label.js"></script>
 * juste APRÈS la ligne <script src="ui.js"></script> dans orbit.html.
 *
 * Ce script ne modifie aucun fichier existant : il s'injecte au runtime
 * (interception de THREE.Scene et du rendu), s'affiche/masque avec la
 * case « Ecliptic Axes » des paramètres, et s'adapte au niveau de zoom.
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

  if (typeof THREE === 'undefined') {
    console.warn('[vernal-axis-label] THREE introuvable : charger ce script après include.js');
    return;
  }

  var sprite = null;
  var scene = null;

  /* 1) Intercepter la création de la scène pour en garder une référence.
        main.js crée la THREE.Scene à l'intérieur de JPL.OrbitViewer,
        inaccessible autrement sans modifier main.js. */
  var OriginalScene = THREE.Scene;
  if (OriginalScene && !OriginalScene.__vernalPatched) {
    THREE.Scene = class extends OriginalScene {
      constructor() {
        super();
        window.__ovScene = this; // référence vers la dernière scène créée
      }
    };
    THREE.Scene.__vernalPatched = true;
  }

  /* 2) Construction de l'étiquette (sprite à texture canvas) */
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

    var texture = THREE.CanvasTexture
      ? new THREE.CanvasTexture(canvas)
      : new THREE.Texture(canvas);
    texture.needsUpdate = true;

    var material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,   // reste lisible par-dessus les lignes d'orbites
      depthWrite: false
    });

    var s = new THREE.Sprite(material);
    s.name = 'vernalAxisLabel';
    s.userData.aspect = canvas.width / canvas.height;
    s.raycast = function () {}; // neutre pour le picking de la souris
    return s;
  }

  /* 3) Visibilité liée à la case « Ecliptic Axes » des paramètres */
  function refreshVisibility() {
    if (!sprite) return;
    var toggle = document.getElementById('ecliptic-axis-toggle');
    sprite.visible = !toggle || toggle.checked;
  }
  document.addEventListener('change', function (evt) {
    if (evt.target && evt.target.id === 'ecliptic-axis-toggle') refreshVisibility();
  });

  /* 4) Recalcul de la position et de la taille à chaque rendu (suit le zoom) */
  function update(camera) {
    if (!sprite) return;
    if (!sprite.parent && scene) scene.add(sprite);
    if (!camera || !camera.position) return;

    // Distance caméra ↔ origine (le SSB est à l'origine du repère J2000).
    var d = camera.position.length();
    if (!isFinite(d) || d <= 0) return;

    // +X = direction du point vernal (équinoxe de printemps J2000),
    // conformément au repère décrit dans l'aide du visualiseur.
    // Si l'étiquette n'apparaît pas sur le bon axe chez vous,
    // remplacez la ligne ci-dessous par (0, d * POSITION_RATIO, 0) ou (0, 0, d * POSITION_RATIO).
    sprite.position.set(d * POSITION_RATIO, 0, 0);

    var w = d * SIZE_RATIO;
    sprite.scale.set(w, w / sprite.userData.aspect, 1);
  }

  /* 5) Intercepter le rendu pour appeler update() à chaque image */
  var proto = THREE.WebGLRenderer && THREE.WebGLRenderer.prototype;
  if (proto && typeof proto.render === 'function' && !proto.__vernalPatched) {
    var originalRender = proto.render;
    proto.render = function () {
      try { update(arguments[1]); } catch (e) { /* ne jamais casser le rendu */ }
      return originalRender.apply(this, arguments);
    };
    proto.__vernalPatched = true;
  }

  /* 6) Attendre que le visualiseur ait créé sa scène, puis ajouter l'étiquette */
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.__ovScene) {
      scene = window.__ovScene;
      if (!sprite) {
        sprite = buildSprite();
        scene.add(sprite);
        refreshVisibility();
      }
      clearInterval(timer);
    } else if (tries > 300) { // ~30 s
      clearInterval(timer);
      console.warn('[vernal-axis-label] scène du visualiseur introuvable');
    }
  }, 100);
})();
