const WORKER_URL = "https://destroy-page-backend.faav.workers.dev"

// Hash format: #noteId.keyB64
const hash = location.hash.slice(1);
const dotIndex = hash.indexOf(".");
const id = hash.slice(0, dotIndex);
const keyB64 = hash.slice(dotIndex + 1);

document.querySelector('#path').textContent = id ? `/${id}#${keyB64}` : '';
history.pushState(null, "", id ? `/${id}#${keyB64}` : '');

// Crypto helpers
function base64ToBuf(b64) {
    const std = b64.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(std);
    return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
}

async function deriveKey(token) {
    const raw = base64ToBuf(token);
    const baseKey = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new Uint8Array(0) },
        baseKey,
        { name: "AES-GCM", length: 128 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function decrypt(payload, key) {
    const [ivB64, ciphertextB64] = payload.split(".");
    const iv = base64ToBuf(ivB64);
    const ciphertext = base64ToBuf(ciphertextB64);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
}

function show(id) {
    ["confirm", "destroyed", "errorDisplay"].forEach(el => {
        document.getElementById(el).classList.add("hidden");
    });
    document.getElementById(id).classList.remove("hidden");
    document.getElementById("loading").remove();
}

async function init() {
    if (!id || !keyB64) {
        show("errorDisplay");
        return;
    }

    try {
        const res = await fetch(`${WORKER_URL}/peek/${id}`);
        const data = await res.json();

        if (data.exists) {
            show("confirm");
        } else {
            if (data.reason === "destroyed") {
                const when = data.destroyedAt
                    ? new Date(data.destroyedAt).toLocaleString()
                    : "recently";
                document.getElementById("destroyedAt").textContent = `destroyed at: ${when}`;
                show("destroyed");
            } else {
                document.getElementById("errorReason").textContent =
                    "this note doesn't exist or has expired.";
                show("errorDisplay");
            }
        }
    } catch {
        show("errorDisplay");
    }
}

window.copyNote = function () {
    if (document.getElementById("viewBtn").textContent.trim() !== "") {
        alert("Please view the note first, then click copy.");
        return;
    }
    navigator.clipboard.writeText(document.getElementById("noteContent").textContent.trim());
    document.getElementById("clickToCopy").textContent = "copied";
    setTimeout(() => (document.getElementById("clickToCopy").textContent = "click to copy"), 2000);
}

window.destroy = async function () {
    if (document.getElementById("viewBtn").textContent.trim() !== "") {
        alert("Please view the note first, then click destroy.");
        return;
    }
    try {
        await fetch(`${WORKER_URL}/note/${id}`);
        const res = await fetch(`${WORKER_URL}/peek/${id}`);
        const data = await res.json();

        if (data.reason === "destroyed") {
            const when = data.destroyedAt
                ? new Date(data.destroyedAt).toLocaleString()
                : "recently";
            document.getElementById("create").textContent = "this page and its contents have been destroyed";
            document.querySelector(".light").textContent = `destroyed at: ${when}`;

            document.getElementById("noteContent").textContent = "";
            document.getElementById("noteContent").contentEditable = "false";
            document.querySelector(".placeholder").textContent = ":(";
            updatePlaceholder();
        } else {
            throw new Error("Failed to destroy the note. It may have already been destroyed or the link is invalid.");
        }
    } catch (err) {
        alert("Error destroying note: " + err.message);
    }
}

window.viewNote = async () => {
    const btn = document.getElementById("viewBtn");
    btn.textContent = "loading...";
    btn.disabled = true;

    try {
        const res = await fetch(`${WORKER_URL}/note/${id}`);
        const data = await res.json();

        if (!res.ok) {
            show("errorDisplay");
            return;
        }

        // Decrypt in the browser, key was never sent to server
        const key = await deriveKey(keyB64);
        const plaintext = await decrypt(data.payload, key);

        document.getElementById("noteContent").textContent = plaintext;
    } catch {
        document.getElementById("errorReason").textContent =
            "failed to decrypt. the link may be corrupt or the note is already destroyed.";
        show("errorDisplay");
        btn.textContent = "click to view page";
        btn.disabled = false;
    } finally {
        btn.textContent = "";
    }
};

window.addEventListener("hashchange", () => location.reload());

init();