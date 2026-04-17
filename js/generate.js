const WORKER_URL = "https://destroy-page-backend.faav.workers.dev"

var id = '';
var keyB64 = '';

// Crypto helpers
function bufToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

async function generateKey() {
    const raw = crypto.getRandomValues(new Uint8Array(7));
    const token = bufToBase64(raw); // ~10 chars
    const key = await deriveKey(token);
    return { key, keyB64: token };
}

async function encrypt(text, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    return bufToBase64(iv) + "." + bufToBase64(ciphertext);
}

window.createNote = async function () {
    const content = document.getElementById("noteContent").textContent.trim();

    if (!content) {
        alert("Please write something first.");
        return;
    }

    const createBtn = document.getElementById("createPage");
    createBtn.setAttribute("disabled", "true");

    const restartBtn = document.getElementById("restart");

    try {
        const { key, keyB64: generatedKey } = await generateKey();
        keyB64 = generatedKey;

        const payload = await encrypt(content, key);

        const res = await fetch(`${WORKER_URL}/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        id = data.id;

        history.pushState(null, "", `/${id}#${keyB64}`);
        document.getElementById("path").textContent = `/${id}#${keyB64}`;
        document.getElementById("noteContent").contentEditable = "false";

    } catch (err) {
        alert("Error creating note: " + err.message);
    } finally {
        createBtn.textContent = "page created";
        createBtn.style.textDecoration = "none";
        restartBtn.textContent = "click to destroy now";
        restartBtn.href = "javascript:destroy()";
        document.querySelector(".light").textContent = "you can't edit this page anymore, refresh to generate a new one";
    }
};

window.restart = function () {
    document.getElementById("noteContent").textContent = "";
    document.getElementById("noteContent").contentEditable = "true";
    updatePlaceholder();
}

window.destroy = async function () {
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
        alert("Error creating note: " + err.message);
    }
}

const editor = document.getElementById("noteContent");
const placeholder = document.querySelector(".placeholder");

function updatePlaceholder() {
    placeholder.style.opacity =
        (document.activeElement === editor || editor.innerText.trim()) ? "0" : "1";
}

editor.addEventListener("focus", updatePlaceholder);
editor.addEventListener("blur", updatePlaceholder);
editor.addEventListener("input", updatePlaceholder);