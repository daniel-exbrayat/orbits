/*
 * vernal-axis-label.js  (v9)
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
 * v8 : le zoom du visualiseur met à l'ÉCHELLE la racine de la scène (le
 * sprite enfant était donc réduit et déplacé avec elle : proche du
 * Soleil et minuscule dézoomé, normal zoomé). Tous les calculs se font
 * en espace monde (position résolue par projection sur l'axe +X suivi
 * dans le repère monde via la matrice du parent, taille dérivée de la
 * projection), PUIS sont convertis en espace local du sprite :
 * position par l'inverse de la matrice monde du parent, taille
 * divisée par son échelle.
 *
 * v9 : texte long géré proprement :
 * - le canevas est taillé sur les MÉTRIQUES réelles du texte (largeur et
 *   hauteur mesurées), plus de hauteur fixe ;
 * - TEXT_ANCHOR = 'above' | 'below' | 'centered' place le texte
 *   au-dessus / en dessous / sur l'axe (espace vide dans la texture) —
 *   inutile de bricoler textBaseline ;
 * - l'ancre est RENTRÉE de la demi-largeur du texte (+ marge EDGE_INSET)
 *   pour que le texte ENTIER reste dans la fenêtre au lieu d'en
 *   déborder à droite.
 *
 * Astuce diagnostic : passer DEBUG = true pour suivre la détection
 * (scène, caméra, ajout du sprite) dans la console (F12).
 */

(function () {
  'use strict';

  // --------------------------- Configuration ---------------------------

  var LABEL_TEXT = 'Axe des équinoxes (direction du Point vernal \u2648)'; // \u2648 = symbole du Bélier (♈)
  var LABEL_COLOR = '#ffd75e';           // couleur du texte
  var FONT_SIZE = 52;                     // taille de base du texte (pixels de texture)
  var FONT_WEIGHT = 'bold';
  var FONT_FAMILY = 'Arial, sans-serif';
  var EDGE_NDC = 0.85;       // position : bord visé en coordonnées écran (0.85 ≈ 85 % de la demi-largeur ; 1.0 = bord exact)
  var EDGE_INSET = 1.06;     // marge de rentrée du bord (1.0 = collé au bord ; 1.06 = 6 % de marge) pour afficher le texte ENTIER
  var TEXT_ANCHOR = 'above'; // 'above' : texte au-dessus de l'axe ; 'below' : en dessous ; 'centered' : sur l'axe
  var TEXT_SCREEN_PX = 20;   // hauteur apparente du TEXTE à l'écran en pixels, avant application du réglage « Label Font Size »
  var TEXT_TO_TEXTURE = 1.7; // secours : hauteur de texture ≈ 1.7 × hauteur du texte (remplacé par la mesure réelle)
  var DEBUG = false;         // true = messages de diagnostic dans la console

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

  /* 1) Étiquette sous forme de sprite à texture canvas.
        Le canevas est taillé sur les métriques RÉELLES du texte (largeur
        et hauteur mesurées), et selon TEXT_ANCHOR un espace vide est
        ajouté sous ou sur le texte pour l'afficher au-dessus ou en
        dessous de l'axe, sans toucher à textBaseline. */
  function buildTexture(fontPx) {
    fontPx = Math.max(8, Math.min(200, fontPx || FONT_SIZE));
    var fontSpec = FONT_WEIGHT + ' ' + fontPx + 'px ' + FONT_FAMILY;

    var canvas = document.createElement('canvas');
    var measure = canvas.getContext('2d');
    measure.font = fontSpec;
    var metrics = measure.measureText(LABEL_TEXT);
    var textWidth = metrics.width;
    var ascent = metrics.actualBoundingBoxAscent || fontPx * 0.8;
    var descent = metrics.actualBoundingBoxDescent || fontPx * 0.25;
    var textHeight = ascent + descent;

    // espace vide pour placer le texte par rapport à l'axe
    var padTop = 8, padBottom = 8;
    if (TEXT_ANCHOR === 'above') padBottom += textHeight; // vide sous le texte → texte AU-DESSUS de l'axe
    if (TEXT_ANCHOR === 'below') padTop += textHeight;    // vide au-dessus → texte EN-DESSOUS de l'axe

    canvas.width = Math.ceil(textWidth) + 48;
    canvas.height = Math.ceil(textHeight) + padTop + padBottom;

    var ctx = canvas.getContext('2d');
    ctx.font = fontSpec;
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(LABEL_TEXT, canvas.width / 2, padTop + ascent);

    var texture = (typeof THREE.CanvasTexture === 'function')
      ? new THREE.CanvasTexture(canvas)
      : new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return {
      texture: texture,
      aspect: canvas.width / canvas.height,
      texToText: canvas.height / textHeight // hauteur texture ÷ hauteur texte
    };
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
    s.userData.texToText = t.texToText;
    try { s.raycast = function () {}; } catch (e) {} // neutre pour le picking de la souris
    if (DEBUG) info('sprite créé');
    return s;
  }

  /* 2) Position et taille, recalculées à chaque image.
        Le visualiseur zoome en mettant à l'échelle (et déplaçant) la
        racine de la scène : tout est donc calculé en espace MONDE, puis
        converti en espace LOCAL du sprite via la matrice monde de son
        parent — position par son inverse, taille divisée par son échelle. */
  var _p = new THREE.Vector3();
  var _v1 = new THREE.Vector3();
  var _v2 = new THREE.Vector3();
  var _v3 = new THREE.Vector3();
  var _wPoint = new THREE.Vector3();
  var _m = new THREE.Matrix4();
  var _mi = new THREE.Matrix4();
  var _wStart = new THREE.Vector3();
  var _wDir = new THREE.Vector3();
  var lastT = null;

  /* Matrice monde du parent du sprite + repère monde de l'axe +X local.
     Renvoie l'échelle du parent (facteur de zoom de la scène). */
  function refreshFrame() {
    var pm = (sprite.parent && sprite.parent.matrixWorld) ? sprite.parent.matrixWorld : null;
    if (pm) _m.copy(pm); else _m.identity();
    _wStart.set(0, 0, 0).applyMatrix4(_m); // position monde de l'origine locale
    _wDir.set(1, 0, 0);
    _wDir.transformDirection(_m);         // direction monde de l'axe +X (normée)
    var e = _m.elements;
    return Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
  }

  /* Projection NDC (±1) du point de l'axe à la distance t ; front = devant la caméra */
  function probe(t) {
    _p.copy(_wStart).addScaledVector(_wDir, t).applyMatrix4(camera.matrixWorldInverse);
    var front = _p.z < 0; // repère vue : -Z vers l'avant
    _p.applyMatrix4(camera.projectionMatrix);
    return { x: _p.x, front: front };
  }

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
        sprite.userData.texToText = t0.texToText;
        sprite.material.needsUpdate = true;
        if (oldMap && oldMap.dispose) oldMap.dispose();
        builtScale = scale;
        if (DEBUG) info('texture régénérée (échelle ' + scale.toFixed(2) + ')');
      } catch (e) { /* conserver la texture actuelle */ }
    }

    if (!camera.matrixWorldInverse || !camera.projectionMatrix) return;

    // matrice du parent + repère monde de l'axe +X (point vernal)
    var parentScale = refreshFrame();
    if (!isFinite(parentScale) || parentScale <= 0) parentScale = 1;

    // --- position : point de l'axe +X projeté près du bord de la fenêtre ---
    var t = solveEdge();
    if (t === null || !isFinite(t) || t <= 0) {
      if (lastT === null) return;
      t = lastT; // conserver la dernière position valide
    }
    lastT = t;

    // point monde au bord de la fenêtre
    _wPoint.copy(_wStart).addScaledVector(_wDir, t);

    // hauteur monde pour la taille voulue (texture complète)
    var texToText = sprite.userData.texToText || TEXT_TO_TEXTURE;
    var labelPx = TEXT_SCREEN_PX * scale * texToText;
    var worldH = worldHeightForPixels(_wPoint, labelPx);
    if (worldH === null) return;

    // rentrer l'ancre de la demi-largeur du texte (+ marge EDGE_INSET)
    // pour que le texte ENTIER reste dans la fenêtre au lieu d'en
    // déborder à droite
    var worldW = worldH * sprite.userData.aspect;
    t = Math.max(0.001, t - (worldW / 2) * EDGE_INSET);

    // position monde visée, convertie en coordonnées LOCALES du sprite
    _wPoint.copy(_wStart).addScaledVector(_wDir, t);
    worldH = worldHeightForPixels(_wPoint, labelPx); // recalcul au point final
    if (worldH === null) return;
    _mi.copy(_m);
    if (typeof _mi.invert === 'function') _mi.invert();
    else if (typeof _mi.getInverse === 'function') _mi.getInverse(_m);
    _wPoint.applyMatrix4(_mi);
    sprite.position.copy(_wPoint);

    // --- taille : hauteur constante à l'écran, convertie en unités locales ---
    var localH = worldH / parentScale;
    sprite.scale.set(localH * sprite.userData.aspect, localH, 1);
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
