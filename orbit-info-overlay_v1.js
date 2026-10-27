// ============================================================================
// orbit-info-overlay.js — Orbit Viewer (copie locale, version JPL SSD/CNEOS)
//
// Affiche en haut à droite de la vue :
//   - Ligne 1 : identité de la version de l'application (origine + SHA-256
//     des fichiers clés chargés) — pour savoir exactement quelle version
//     tourne, et la communiquer sans ambiguïté.
//   - Ligne 2 : la version de VOTRE script (constante MY_VERSION ci-dessous).
//   - Un bouton [copier] : met tout le bloc dans le presse-papier pour le
//     coller dans le chat.
//
// INSTALLATION :
//   1. Placer ce fichier à côté de index.html
//   2. Ajouter avant </body> :
//        <script src="orbit-info-overlay.js"></script>
//
// NOTE : le navigateur ne peut pas savoir si le dossier a été téléchargé par
// curl, wget ou autre. Tenez à jour un fichier PROVENANCE.txt à côté :
//   echo "wget --mirror https://ssd.jpl.nasa.gov/ov/ - $(date -Iseconds)" > PROVENANCE.txt
// ============================================================================

(function () {
    "use strict";

    // ---- À adapter à chaque évolution de votre script ----------------------
    var MY_VERSION  = "vernal-axis-label_v10.js";
    var MY_DOWNLOAD = "écrite par moi, session Mistral/Vibe, 2026";

    var log = function () {
        var a = Array.prototype.slice.call(arguments);
        a.unshift("[OV-info]");
        console.info.apply(console, a);
    };

    // ---- Empreinte SHA-256 d'un fichier ------------------------------------
    function sha256(buffer) {
        return crypto.subtle.digest("SHA-256", buffer).then(function (hash) {
            return Array.prototype.map.call(new Uint8Array(hash), function (b) {
                return ("0" + b.toString(16)).slice(-2);
            }).join("");
        });
    }

    function shortHash(hex) { return hex.slice(0, 12); }

    function fingerprintFile(url) {
        return fetch(url, { cache: "no-store" })
            .then(function (r) { return r.arrayBuffer(); })
            .then(function (buf) { return sha256(buf); })
            .then(function (hex) { return { url: url, sha256: hex }; })
            .catch(function () { return { url: url, sha256: null }; });
    }

    // ---- Chaîne de version de l'application -------------------------------
    function buildAppIdentity() {
        var loc = window.location;
        var files = ["index.html", "ui.js", "main.js", "include.js", "lib/three/three.module.js"];
        // Ne conserver que les fichiers réellement référencés par la page :
        var scripts = Array.prototype.map.call(
            document.scripts,
            function (s) { return s.getAttribute("src"); }
        ).filter(Boolean);
        files = files.filter(function (f) {
            return scripts.indexOf(f) >= 0 ||
                   scripts.some(function (s) { return s && s.indexOf(f.split("/").pop()) >= 0; });
        });
        if (files.indexOf("index.html") < 0) files.unshift("index.html");

        return Promise.all(files.map(function (f) { return fingerprintFile(f); }))
            .then(function (fps) {
                return {
                    origin: loc.origin + loc.pathname.replace(/index\.html$/, ""),
                    files: fps
                };
            });
    }

    // ---- Overlay ------------------------------------------------------------
    function buildOverlay(identity) {
        var box = document.createElement("div");
        box.id = "orbit-info-overlay";
        box.style.cssText = "position:fixed;top:8px;right:8px;z-index:99998;" +
            "background:rgba(0,0,0,0.55);color:#cfe8ff;font:11px/1.5 monospace;" +
            "padding:6px 10px;border-radius:6px;border:1px solid rgba(120,180,255,0.4);" +
            "pointer-events:auto;max-width:60ch;white-space:pre-wrap;";

        var lines = [];
        lines.push("app: " + identity.origin);
        identity.files.forEach(function (f) {
            lines.push("  " + f.url + (f.sha256 ? "  sha256:" + shortHash(f.sha256) : "  (illisible)"));
        });
        lines.push("me:  " + MY_VERSION + "  (" + MY_DOWNLOAD + ")");

        box.textContent = lines.join("\n");

        var btn = document.createElement("button");
        btn.textContent = "copier";
        btn.style.cssText = "display:block;margin-top:4px;padding:1px 8px;" +
            "font:11px monospace;background:#337ab7;color:#fff;border:none;border-radius:4px;cursor:pointer;";
        btn.addEventListener("click", function () {
            var full = lines.map(function (l) { return l.trim(); }).join("\n");
            (navigator.clipboard ? navigator.clipboard.writeText(full) : Promise.reject())
                .then(function () { btn.textContent = "copié !"; setTimeout(function () { btn.textContent = "copier"; }, 1500); })
                .catch(function () {
                    // Fallback sans clipboard API
                    var ta = document.createElement("textarea");
                    ta.value = full; document.body.appendChild(ta);
                    ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
                    btn.textContent = "copié !"; setTimeout(function () { btn.textContent = "copier"; }, 1500);
                });
        });
        box.appendChild(btn);
        document.body.appendChild(box);
        log("overlay affiché.");
        console.info("[OV-info] Bloc à partager :\n" + identity.files.map(function (f) {
            return f.url + "  sha256:" + f.sha256;
        }).join("\n"));
    }

    // Attente du DOM puis calcul + affichage
    function start() {
        buildAppIdentity().then(buildOverlay).catch(function (e) {
            console.warn("[OV-info] erreur :", e);
        });
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
