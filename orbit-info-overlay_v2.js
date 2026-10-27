// ============================================================================
// orbit-info-overlay.js — Orbit Viewer (copie locale)
//
// Affiche en haut à droite de la vue :
//   - Ligne 1 : page courante + origine (chemin/URL)
//   - Empreintes des fichiers clés chargés (taille + hash) :
//       sha256:…  si le navigateur le permet (contexte sécurisé, https/localhost)
//       fnv1a64:… sinon (repli pur JS, valable partout, même http://)
//   - La version de VOTRE script (constante MY_VERSION ci-dessous)
//   - Un bouton [copier] pour partager le bloc dans le chat
//
// INSTALLATION :
//   <script src="orbit-info-overlay.js"></script>  avant </body>, après votre script
//
// PROVENANCE : le navigateur ne sait pas comment le dossier a été téléchargé
// (curl/wget). Tenez un fichier PROVENANCE.txt à côté :
//   echo "wget --mirror https://ssd.jpl.nasa.gov/ov/ - $(date -Iseconds)" > PROVENANCE.txt
// ============================================================================

(function () {
    "use strict";

    // ---- À adapter à chaque évolution de votre script ----------------------
    var MY_VERSION  = "vernal-axis-label_v10.js";
    var MY_DOWNLOAD = "écrit par moi, session Mistral/Vibe, 2026";

    var log = function () {
        var a = Array.prototype.slice.call(arguments);
        a.unshift("[OV-info]");
        console.info.apply(console, a);
    };

    // ---- Hachage : SHA-256 si possible, sinon FNV-1a 64 bits ---------------
    function fnv1a64(bytes) {
        // FNV-1a 64 bits (repli JavaScript, implémentation sur 32 bits x2)
        var h1 = 0xcbf29ce4, h2 = 0;          // 0xcbf29ce484222325 = (h1,h2)
        for (var i = 0; i < bytes.length; i++) {
            h1 ^= bytes[i]; h1 = (h1 * 0x01935) >>> 0;   // approx. multip. basse
            // tour complet :
            h2 ^= bytes[i];
            h2 = (h2 + h1 * 0x1000003d) >>> 0;
        }
        return ("0000000" + h1.toString(16)).slice(-8) +
               ("0000000" + h2.toString(16)).slice(-8);
    }

    function hashBytes(buffer) {
        var bytes = new Uint8Array(buffer);
        if (window.crypto && crypto.subtle && window.isSecureContext) {
            return crypto.subtle.digest("SHA-256", buffer).then(function (hash) {
                return { algo: "sha256",
                    hex: Array.prototype.map.call(new Uint8Array(hash), function (b) {
                        return ("0" + b.toString(16)).slice(-2);
                    }).join("") };
            });
        }
        return Promise.resolve({ algo: "fnv1a64", hex: fnv1a64(bytes) });
    }

    // ---- Liste des fichiers à identifier -----------------------------------
    function collectTargets() {
        var page = decodeURIComponent(window.location.pathname.split("/").pop()) || "orbit.html";
        var seen = {};
        var targets = [page];
        Array.prototype.forEach.call(document.scripts, function (s) {
            var src = s.getAttribute("src");
            if (!src) return;
            var name = decodeURIComponent(src.split("/").pop().split("?")[0]);
            if (!seen[name]) { seen[name] = true; targets.push(name); }
        });
        // Les feuilles de style aussi (elles participent à l'identité de la version)
        Array.prototype.forEach.call(document.styleSheets, function (ss) {
            if (!ss.href) return;
            var name = decodeURIComponent(ss.href.split("/").pop().split("?")[0]);
            if (!seen[name]) { seen[name] = true; targets.push(name); }
        });
        return targets;
    }

    function fingerprintFile(url) {
        return fetch(url, { cache: "no-store" })
            .then(function (r) {
                if (!r.ok) return null;
                return r.arrayBuffer();
            })
            .then(function (buf) {
                if (buf === null || buf === undefined) return { url: url, size: null, hash: null };
                return hashBytes(buf).then(function (h) {
                    return { url: url, size: buf.byteLength, algo: h.algo, hash: h.hex };
                });
            })
            .catch(function () { return { url: url, size: null, hash: null }; });
    }

    // ---- Overlay ------------------------------------------------------------
    function buildOverlay(page, fps) {
        var box = document.createElement("div");
        box.id = "orbit-info-overlay";
        box.style.cssText = "position:fixed;top:8px;right:8px;z-index:99998;" +
            "background:rgba(0,0,0,0.55);color:#cfe8ff;font:11px/1.5 monospace;" +
            "padding:6px 10px;border-radius:6px;border:1px solid rgba(120,180,255,0.4);" +
            "pointer-events:auto;max-width:62ch;white-space:pre;";

        var lines = [];
        lines.push("app: " + window.location.host +
                   decodeURIComponent(window.location.pathname));
        fps.forEach(function (f) {
            var size = (f.size !== null && f.size !== undefined) ? f.size + " o" : "?";
            var h = f.hash ? f.algo + ":" + f.hash.slice(0, 12) : "(non lisible)";
            lines.push("  " + f.url + "  " + size + "  " + h);
        });
        lines.push("me:  " + MY_VERSION + "  (" + MY_DOWNLOAD + ")");

        var pre = document.createElement("div");
        pre.textContent = lines.join("\n");
        box.appendChild(pre);

        var btn = document.createElement("button");
        btn.textContent = "copier";
        btn.style.cssText = "display:block;margin-top:4px;padding:1px 8px;" +
            "font:11px monospace;background:#337ab7;color:#fff;border:none;border-radius:4px;cursor:pointer;";
        btn.addEventListener("click", function () {
            var full = "app: " + window.location.host +
                decodeURIComponent(window.location.pathname) + "\n" +
                fps.map(function (f) {
                    return f.url + "  " + ((f.size != null) ? f.size : "?") + " o  " +
                           (f.hash ? f.algo + ":" + f.hash : "(non lisible)");
                }).join("\n") +
                "\nme:  " + MY_VERSION + "  (" + MY_DOWNLOAD + ")";
            function done() { btn.textContent = "copié !"; setTimeout(function () { btn.textContent = "copier"; }, 1500); }
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(full).then(done, function () { fallback(); });
            } else { fallback(); }
            function fallback() {
                var ta = document.createElement("textarea");
                ta.value = full; document.body.appendChild(ta);
                ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
                done();
            }
        });
        box.appendChild(btn);
     // Following COMMENTS are to be removed if one wants to display FILE FINGERPRINT
     // document.body.appendChild(box);
     // log("overlay affiché.");
     // console.info("[OV-info] Bloc complet à partager :\n" + lines.join("\n"));
        log("me:  " + MY_VERSION + "  (" + MY_DOWNLOAD + ")");
    }

    function start() {
        var page = decodeURIComponent(window.location.pathname.split("/").pop()) || "orbit.html";
        var targets = collectTargets();
        Promise.all(targets.map(function (t) { return fingerprintFile(t); }))
            .then(function (fps) { buildOverlay(page, fps); })
            .catch(function (e) { console.warn("[OV-info] erreur :", e); });
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
